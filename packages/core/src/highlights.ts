import type { EntryAiDigest, EntryRecord, HighlightItem } from "./index.js";

export interface ScoredHighlightCandidate {
  entryId: string;
  date: string;
  title: string;
  summary: string;
  score: number;
  mustKeep: boolean;
  algoTag: string;
  reason: string;
  quarter: string;
}

export function dateToQuarter(dateStr: string): string {
  const m = Number(dateStr.slice(5, 7)) || 1;
  if (m <= 3) return "Q1";
  if (m <= 6) return "Q2";
  if (m <= 9) return "Q3";
  return "Q4";
}

/**
 * C-16 第一阶段：本地规则初筛高光候选池。
 */
export function scoreHighlightCandidates(
  entries: EntryRecord[],
  digestsById: Map<string, EntryAiDigest>,
  limit: number = 12
): ScoredHighlightCandidate[] {
  if (!entries.length) return [];
  const totalWords = entries.reduce((acc, e) => acc + (e.wordCount || 0), 0);
  const avgWords = Math.max(100, totalWords / entries.length);

  const scored: ScoredHighlightCandidate[] = entries.map((e) => {
    let score = 0;
    const reasons: string[] = [];
    let algoTag = "综合加权";
    let mustKeep = false;

    if (e.tags.includes("重要事件")) {
      score += 50;
      mustKeep = true;
      algoTag = "重要事件保送";
      reasons.push("标记「重要事件」");
    }
    if (e.tags.includes("年度复盘") || e.kind === "special") {
      score += 35;
      if (!mustKeep) algoTag = "专项复盘加权";
      reasons.push("专项/年度复盘记录");
    }
    if (e.tags.includes("节点事件")) {
      score += 30;
      if (algoTag === "综合加权") algoTag = "节点事件加权";
      reasons.push("标记「节点事件」");
    }
    if (e.tags.includes("旅行游玩")) {
      score += 26;
      if (algoTag === "综合加权") algoTag = "旅行游玩加权";
      reasons.push("包含旅行体验");
    }
    if (e.tags.includes("反省总结")) {
      score += 15;
      reasons.push("包含深度反省");
    }

    const ratio = (e.wordCount || 0) / avgWords;
    if (ratio >= 1.4) {
      score += 22 + Math.min(18, Math.round((ratio - 1.4) * 15));
      if (algoTag === "综合加权") algoTag = `篇幅峰值 ${ratio.toFixed(1)}x`;
      reasons.push(`篇幅达均值 ${ratio.toFixed(1)} 倍`);
    }

    if (e.moods.some((m) => m.includes("兴奋") || m.includes("开心"))) {
      score += 12;
      reasons.push("高正反馈情绪峰值");
    } else if (e.moods.some((m) => m.includes("低落") || m.includes("生气"))) {
      score += 10;
      if (algoTag === "综合加权") algoTag = "情绪转折点";
      reasons.push("显著情绪波动节点");
    }

    const digest = digestsById.get(e.id) ?? e.digest ?? null;
    const maxImp = digest?.keyEvents?.reduce((mx, ev) => Math.max(mx, ev.importance || 0), 0) ?? 0;
    if (maxImp >= 4) {
      score += 28;
      if (algoTag === "综合加权") algoTag = `关键事件 ${maxImp} 分`;
      reasons.push(`日概要关键事件重要度 ${maxImp} 分`);
    }

    if (score === 0) {
      score = Math.min(10, Math.round((e.wordCount || 0) / 100));
    }

    return {
      entryId: e.id,
      date: e.date,
      title: digest?.shortTitle || e.title || `${e.date} 日记`,
      summary: digest?.summary || e.contentText.slice(0, 120),
      score,
      mustKeep,
      algoTag,
      reason: reasons.length ? reasons.join(" · ") : "阶段代表性日常记录",
      quarter: dateToQuarter(e.date)
    };
  });

  scored.sort((a, b) => {
    if (a.mustKeep !== b.mustKeep) return a.mustKeep ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.date.localeCompare(b.date);
  });

  return scored.slice(0, limit);
}

/**
 * C-16 第二、三阶段：强日期溯源校验 + 手动钉选/移出锁定合并。
 */
export function verifyAndMergeHighlights(params: {
  scope: "monthly" | "yearly";
  candidates: ScoredHighlightCandidate[];
  aiSelected?: Array<{ date?: string; entryId?: string; title?: string; reason?: string; algoTag?: string }>;
  pinnedEntryIds: Set<string>;
  excludedEntryIds: Set<string>;
  entriesById: Map<string, EntryRecord>;
  entriesByDate: Map<string, EntryRecord>;
  digestsById: Map<string, EntryAiDigest>;
  minCount: number;
  maxCount: number;
}): HighlightItem[] {
  const {
    scope,
    candidates,
    aiSelected = [],
    pinnedEntryIds,
    excludedEntryIds,
    entriesById,
    entriesByDate,
    digestsById,
    minCount,
    maxCount
  } = params;

  const result: HighlightItem[] = [];
  const usedEntryIds = new Set<string>();

  // 1. 先放入全部手动钉选（无视排除、无视 AI 删减，强制保留）
  for (const eid of pinnedEntryIds) {
    const entry = entriesById.get(eid);
    if (!entry) continue;
    const digest = digestsById.get(eid) ?? entry.digest ?? null;
    usedEntryIds.add(eid);
    result.push({
      id: `hl-${eid}`,
      date: entry.date,
      quarter: scope === "yearly" ? dateToQuarter(entry.date) : undefined,
      title: digest?.shortTitle || entry.title || `${entry.date} 日记`,
      reason: "由用户手动钉选锁定为高光记忆节点",
      algoTag: "手动钉选",
      entryId: eid,
      pinned: true
    });
  }

  // 2. 校验模型精选条目（强日期溯源：必须映射到真实存在的日记且未被移出）
  for (const item of aiSelected) {
    if (result.length >= maxCount) break;
    const matched =
      (item.entryId ? entriesById.get(item.entryId) : undefined) ??
      (item.date ? entriesByDate.get(item.date) : undefined);
    if (!matched) continue; // 拦截幻觉假日期
    if (excludedEntryIds.has(matched.id) || usedEntryIds.has(matched.id)) continue;

    const cand = candidates.find((c) => c.entryId === matched.id);
    const digest = digestsById.get(matched.id) ?? matched.digest ?? null;
    usedEntryIds.add(matched.id);
    result.push({
      id: `hl-${matched.id}`,
      date: matched.date,
      quarter: scope === "yearly" ? dateToQuarter(matched.date) : undefined,
      title: (item.title && item.title.trim()) || digest?.shortTitle || matched.title || `${matched.date} 日记`,
      reason: (item.reason && item.reason.trim()) || cand?.reason || "周期重点节点",
      algoTag: (item.algoTag && item.algoTag.trim()) || cand?.algoTag || "模型精选",
      entryId: matched.id,
      pinned: false
    });
  }

  // 3. 若数量未达标，从本地规则初筛候选池按分值补齐
  for (const cand of candidates) {
    if (result.length >= Math.max(minCount, Math.min(maxCount, candidates.length))) break;
    if (excludedEntryIds.has(cand.entryId) || usedEntryIds.has(cand.entryId)) continue;
    usedEntryIds.add(cand.entryId);
    result.push({
      id: `hl-${cand.entryId}`,
      date: cand.date,
      quarter: scope === "yearly" ? cand.quarter : undefined,
      title: cand.title,
      reason: cand.reason,
      algoTag: cand.algoTag,
      entryId: cand.entryId,
      pinned: false
    });
  }

  // 4. 按日期正序排列展示
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

import type Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  buildMonthlyReviewPrompt,
  buildSingleEntryDigestPrompt,
  buildYearlyReviewPrompt,
  checkMonthlyUnlock,
  checkYearlyUnlock,
  scoreHighlightCandidates,
  SINGLE_DIGEST_MAX_TOKENS,
  validateMonthlyReviewDepth,
  validateYearlyReviewDepth,
  verifyAndMergeHighlights,
  type EntryAiDigest,
  type EntryRecord,
  type HighlightItem,
  type MonthlyReviewData,
  type YearlyReviewData
} from "@lifebook/core";
import { sha256 } from "../crypto.js";
import { callAiCompletion, extractJsonFromAiText, getAiConfigFull } from "./ai-client.js";
import { getEntryById, hydrateEntries } from "./entries.js";
import { fetchTimebookSummary } from "./timebook-sync.js";

/* ================= 1. 单篇结构化日概要与批量补齐 ================= */

export function computeDigestHash(entry: { title: string; contentText: string }): string {
  return sha256(`${entry.title}\n${entry.contentText}`);
}

function isNonRetryableAiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /(401|403|密钥|认证失败|未开启|无效的)/.test(msg);
}

interface ParsedEntryDigestPayload {
  shortTitle?: string;
  summary?: string;
  dimLife?: string;
  dimWork?: string;
  dimLeisure?: string;
  dimPeopleNotes?: string;
  keyEvents?: Array<{ title: string; importance: number; nature?: string }>;
  topics?: string[];
  reflection?: string;
}

export async function generateAndCacheEntryDigest(
  db: Database.Database,
  masterKey: Buffer,
  entryId: string,
  force: boolean = false
): Promise<EntryAiDigest | null> {
  const entry = getEntryById(db, entryId);
  if (!entry) return null;
  if (!entry.contentText.trim() && !entry.title.trim()) return null;

  const contentHash = computeDigestHash(entry);
  if (!force && entry.digest && entry.digest.contentHash === contentHash) {
    return entry.digest;
  }

  const cfg = getAiConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.apiKey) {
    return entry.digest ?? null;
  }

  const prompt = buildSingleEntryDigestPrompt({
    date: entry.date,
    kind: entry.kind,
    title: entry.title,
    moods: entry.moods,
    tags: entry.tags,
    contentText: entry.contentText
  });

  const retryDelaysMs = [400, 900];
  let parsed: ParsedEntryDigestPayload | null = null;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const userContent =
        attempt === 1
          ? prompt.user
          : `${prompt.user}\n\n【格式纠错重试】上一次返回的 JSON 存在语法错误，请务必只输出一个完整的合法 JSON 对象：字符串内部勿使用未转义英文双引号 "（请用「」替代），数组项之间务必用英文逗号分隔且末尾不留逗号。`;
      const res = await callAiCompletion(cfg, {
        system: prompt.system,
        messages: [{ role: "user", content: userContent }],
        maxTokens: SINGLE_DIGEST_MAX_TOKENS,
        temperature: attempt === 1 ? 0.2 : 0.1
      });
      parsed = extractJsonFromAiText<ParsedEntryDigestPayload>(res.contentText);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === 3 || isNonRetryableAiError(err)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1] ?? 600));
    }
  }

  if (!parsed) {
    throw lastErr instanceof Error ? lastErr : new Error("生成日概要失败");
  }

  const now = new Date().toISOString();
  const digest: EntryAiDigest = {
    entryId: entry.id,
    contentHash,
    shortTitle: (parsed.shortTitle || entry.title || `${entry.date} 日记`).slice(0, 32),
    summary: parsed.summary || entry.contentText.slice(0, 100),
    dimLife: parsed.dimLife || "无明显记录",
    dimWork: parsed.dimWork || "无明显记录",
    dimLeisure: parsed.dimLeisure || "无明显记录",
    dimPeopleNotes: parsed.dimPeopleNotes || "无明显记录",
    keyEvents: Array.isArray(parsed.keyEvents) ? parsed.keyEvents.slice(0, 3) : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 6) : [],
    reflection: parsed.reflection || "",
    updatedAt: now
  };

  db.prepare(
    `INSERT INTO entry_ai_digests (
       entry_id, content_hash, short_title, summary,
       dim_life, dim_work, dim_leisure, dim_people_notes,
       key_events_json, topics_json, reflection, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       short_title = excluded.short_title,
       summary = excluded.summary,
       dim_life = excluded.dim_life,
       dim_work = excluded.dim_work,
       dim_leisure = excluded.dim_leisure,
       dim_people_notes = excluded.dim_people_notes,
       key_events_json = excluded.key_events_json,
       topics_json = excluded.topics_json,
       reflection = excluded.reflection,
       updated_at = excluded.updated_at`
  ).run(
    digest.entryId,
    digest.contentHash,
    digest.shortTitle,
    digest.summary,
    digest.dimLife,
    digest.dimWork,
    digest.dimLeisure,
    digest.dimPeopleNotes,
    JSON.stringify(digest.keyEvents),
    JSON.stringify(digest.topics),
    digest.reflection,
    now
  );

  return digest;
}

export interface BatchFailedItem {
  date: string;
  entryId: string;
  error: string;
}

interface BatchState {
  running: boolean;
  paused: boolean;
  total: number;
  done: number;
  failed: number;
  lastError: string;
  currentDate: string;
  failedItems: BatchFailedItem[];
}

const batchState: BatchState = {
  running: false,
  paused: false,
  total: 0,
  done: 0,
  failed: 0,
  lastError: "",
  currentDate: "",
  failedItems: []
};

export function getBatchDigestStatus(db: Database.Database): BatchState {
  const totalRow = db
    .prepare("SELECT COUNT(*) as c FROM entries WHERE deleted_at IS NULL")
    .get() as { c: number };
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.content_text, d.content_hash
       FROM entries e
       LEFT JOIN entry_ai_digests d ON d.entry_id = e.id
       WHERE e.deleted_at IS NULL`
    )
    .all() as Array<{ id: string; title: string; content_text: string; content_hash: string | null }>;

  let cachedCount = 0;
  for (const r of rows) {
    if (r.content_hash && r.content_hash === computeDigestHash({ title: r.title, contentText: r.content_text })) {
      cachedCount++;
    }
  }

  return {
    ...batchState,
    failedItems: [...batchState.failedItems],
    total: totalRow.c,
    done: cachedCount
  };
}

export function pauseBatchDigest(db: Database.Database): BatchState {
  batchState.paused = true;
  batchState.running = false;
  return getBatchDigestStatus(db);
}

export function startBatchDigest(db: Database.Database, masterKey: Buffer): BatchState {
  if (batchState.running) {
    return getBatchDigestStatus(db);
  }
  const cfg = getAiConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.apiKey) {
    throw new Error("请先开启模型服务并配置有效的接口密钥");
  }

  batchState.running = true;
  batchState.paused = false;
  batchState.failed = 0;
  batchState.lastError = "";
  batchState.failedItems = [];

  const rows = db
    .prepare(
      `SELECT e.id, e.date, e.title, e.content_text, d.content_hash
       FROM entries e
       LEFT JOIN entry_ai_digests d ON d.entry_id = e.id
       WHERE e.deleted_at IS NULL
       ORDER BY e.date DESC`
    )
    .all() as Array<{
    id: string;
    date: string;
    title: string;
    content_text: string;
    content_hash: string | null;
  }>;

  const pending = rows.filter(
    (r) => !r.content_hash || r.content_hash !== computeDigestHash({ title: r.title, contentText: r.content_text })
  );

  void (async () => {
    try {
      for (const item of pending) {
        if (batchState.paused) break;
        batchState.currentDate = item.date;
        try {
          await generateAndCacheEntryDigest(db, masterKey, item.id, false);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          batchState.failed += 1;
          batchState.lastError = `${item.date}：${errMsg}`;
          if (batchState.failedItems.length < 20) {
            batchState.failedItems.push({
              date: item.date,
              entryId: item.id,
              error: errMsg
            });
          }
        }
        await new Promise((r) => setTimeout(r, 15));
      }
    } finally {
      batchState.running = false;
      batchState.currentDate = "";
    }
  })();

  return getBatchDigestStatus(db);
}

/* ================= 2. 深度月度 / 年度复盘与双高光时间轴 ================= */

function getPinnedAndExcluded(
  db: Database.Database,
  scope: "monthly" | "yearly",
  periodKey: string
): { pinnedIds: Set<string>; excludedIds: Set<string> } {
  const rows = db
    .prepare("SELECT entry_id, action FROM pinned_highlights WHERE scope = ? AND period_key = ?")
    .all(scope, periodKey) as Array<{ entry_id: string; action: "pin" | "exclude" }>;

  const pinnedIds = new Set<string>();
  const excludedIds = new Set<string>();
  for (const r of rows) {
    if (r.action === "pin") pinnedIds.add(r.entry_id);
    else if (r.action === "exclude") excludedIds.add(r.entry_id);
  }
  return { pinnedIds, excludedIds };
}

function loadEntriesForPeriod(db: Database.Database, prefix: string): EntryRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM entries
       WHERE deleted_at IS NULL AND date LIKE ?
       ORDER BY date ASC`
    )
    .all(`${prefix}%`) as Parameters<typeof hydrateEntries>[1];
  return hydrateEntries(db, rows);
}

export function getCachedMonthlyReview(db: Database.Database, ym: string): MonthlyReviewData {
  const lock = checkMonthlyUnlock(ym);
  if (lock.locked) {
    return {
      locked: true,
      periodKey: ym,
      unlockDate: lock.unlockDate,
      hint: lock.hint,
      withTimebook: false
    };
  }

  const row = db
    .prepare("SELECT * FROM period_reviews WHERE scope = 'monthly' AND period_key = ?")
    .get(ym) as
    | {
        with_timebook: number;
        overview_json: string;
        cross_insights_json: string;
        dimensions_json: string;
        next_actions_json: string;
        highlights_json: string;
        token_usage_json: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      locked: false,
      periodKey: ym,
      unlockDate: lock.unlockDate,
      withTimebook: false
    };
  }

  const overviewFull = JSON.parse(row.overview_json) as MonthlyReviewData["overview"] & {
    timebookMix?: MonthlyReviewData["timebookMix"];
  };
  const { timebookMix, ...overview } = overviewFull;

  return {
    locked: false,
    periodKey: ym,
    unlockDate: lock.unlockDate,
    withTimebook: row.with_timebook === 1,
    overview,
    timebookMix: timebookMix ?? [],
    crossInsights: JSON.parse(row.cross_insights_json),
    dimensions: JSON.parse(row.dimensions_json),
    nextActions: JSON.parse(row.next_actions_json),
    highlights: JSON.parse(row.highlights_json),
    tokenUsage: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    updatedAt: row.updated_at
  };
}

export async function generateMonthlyReview(
  db: Database.Database,
  masterKey: Buffer,
  ym: string
): Promise<MonthlyReviewData> {
  const lock = checkMonthlyUnlock(ym);
  if (lock.locked) {
    return {
      locked: true,
      periodKey: ym,
      unlockDate: lock.unlockDate,
      hint: lock.hint,
      withTimebook: false
    };
  }

  const cfg = getAiConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.apiKey) {
    throw new Error("模型服务未开启或未配置密钥，无法生成月度深度复盘");
  }

  const entries = loadEntriesForPeriod(db, ym);
  if (entries.length === 0) {
    throw new Error(`${ym} 月暂无日记记录，无法生成月度复盘`);
  }

  const totalWords = entries.reduce((a, e) => a + e.wordCount, 0);
  const avgWords = Math.round(totalWords / entries.length);
  const moodFreq = new Map<string, number>();
  for (const e of entries) {
    for (const m of e.moods) moodFreq.set(m, (moodFreq.get(m) ?? 0) + 1);
  }
  const topMoodStr =
    [...moodFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}(${v}次)`)
      .join(" · ") || "暂无标注";

  const digestsMap = new Map<string, EntryAiDigest>();
  for (const e of entries) {
    if (e.digest) digestsMap.set(e.id, e.digest);
  }

  const candidates = scoreHighlightCandidates(entries, digestsMap, 12);
  const timebook = await fetchTimebookSummary(db, masterKey, { scope: "monthly", periodKey: ym });

  const digestsText = entries
    .map((e) => {
      const d = e.digest;
      if (d) {
        return `[${e.date}] 《${d.shortTitle}》(${e.moods.join(" ")}; ${e.wordCount}字) 概要:${d.summary} | 生活:${d.dimLife} | 工作:${d.dimWork} | 娱乐:${d.dimLeisure} | 反思:${d.reflection}`;
      }
      return `[${e.date}] 《${e.title || "无标题"}》(${e.moods.join(" ")}; ${e.wordCount}字) 原文:${e.contentText.slice(0, 220)}`;
    })
    .join("\n");

  const prompt = buildMonthlyReviewPrompt({
    ym,
    stats: { days: entries.length, totalWords, avgWords, moodSummary: topMoodStr },
    digestsText,
    candidates,
    timebook
  });

  const aiRes = await callAiCompletion(cfg, {
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    maxTokens: prompt.maxTokens,
    temperature: 0.3,
    timeoutMs: 60_000
  });

  const parsed = extractJsonFromAiText<{
    overviewSummary?: string;
    crossInsights?: string[];
    dimensions?: { work?: string; life?: string; leisure?: string; emotion?: string };
    nextActions?: string[];
    highlights?: Array<{ date?: string; entryId?: string; title?: string; reason?: string; algoTag?: string }>;
  }>(aiRes.contentText);

  const dims = {
    work: parsed.dimensions?.work || "",
    life: parsed.dimensions?.life || "",
    leisure: parsed.dimensions?.leisure || "",
    emotion: parsed.dimensions?.emotion || ""
  };
  const depthCheck = validateMonthlyReviewDepth(dims);
  if (!depthCheck.ok) {
    // 仍允许保存但若过短做明确提醒或由模型输出决定，记录长度校验
    console.warn(`[lifebook] 月报深度提示：minLen=${depthCheck.minLen}`, depthCheck.details);
  }

  const { pinnedIds, excludedIds } = getPinnedAndExcluded(db, "monthly", ym);
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const entriesByDate = new Map(entries.map((e) => [e.date, e]));

  const highlights = verifyAndMergeHighlights({
    scope: "monthly",
    candidates,
    aiSelected: parsed.highlights ?? [],
    pinnedEntryIds: pinnedIds,
    excludedEntryIds: excludedIds,
    entriesById,
    entriesByDate,
    digestsById: digestsMap,
    minCount: 4,
    maxCount: 6
  });

  const overview = {
    days: `${entries.length} 篇`,
    words: `${totalWords.toLocaleString()} 字`,
    mood: topMoodStr,
    tbHours: timebook.available ? `${timebook.totalHours} 小时` : "未开启（已降级）",
    todoRate: timebook.available ? timebook.todoRate : "未联动",
    summary: parsed.overviewSummary || `${ym} 月共记录 ${entries.length} 篇日记，总计 ${totalWords.toLocaleString()} 字。`,
    contextNote: `第 2 层上下文：当月 ${entries.length} 篇结构化日概要 + 量化统计${timebook.available ? " + 时间簿当月聚合" : ""}`
  };

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO period_reviews (
       id, scope, period_key, with_timebook,
       overview_json, cross_insights_json, dimensions_json, next_actions_json, highlights_json, token_usage_json,
       created_at, updated_at
     ) VALUES (?, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, period_key) DO UPDATE SET
       with_timebook = excluded.with_timebook,
       overview_json = excluded.overview_json,
       cross_insights_json = excluded.cross_insights_json,
       dimensions_json = excluded.dimensions_json,
       next_actions_json = excluded.next_actions_json,
       highlights_json = excluded.highlights_json,
       token_usage_json = excluded.token_usage_json,
       updated_at = excluded.updated_at`
  ).run(
    `rev-${ulid()}`,
    ym,
    timebook.available ? 1 : 0,
    JSON.stringify({ ...overview, timebookMix: timebook.modules }),
    JSON.stringify(parsed.crossInsights ?? []),
    JSON.stringify(dims),
    JSON.stringify(parsed.nextActions ?? []),
    JSON.stringify(highlights),
    aiRes.usage ? JSON.stringify(aiRes.usage) : null,
    now,
    now
  );

  return getCachedMonthlyReview(db, ym);
}

export function getCachedYearlyReview(db: Database.Database, year: string): YearlyReviewData {
  const lock = checkYearlyUnlock(year);
  if (lock.locked) {
    return {
      locked: true,
      periodKey: year,
      unlockDate: lock.unlockDate,
      hint: lock.hint,
      withTimebook: false
    };
  }

  const row = db
    .prepare("SELECT * FROM period_reviews WHERE scope = 'yearly' AND period_key = ?")
    .get(year) as
    | {
        with_timebook: number;
        overview_json: string;
        cross_insights_json: string;
        dimensions_json: string;
        next_actions_json: string;
        highlights_json: string;
        token_usage_json: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      locked: false,
      periodKey: year,
      unlockDate: lock.unlockDate,
      withTimebook: false
    };
  }

  const overviewFull = JSON.parse(row.overview_json) as YearlyReviewData["overview"] & {
    timebookMix?: YearlyReviewData["timebookMix"];
    quarters?: YearlyReviewData["quarters"];
  };
  const { timebookMix, quarters, ...overview } = overviewFull;

  return {
    locked: false,
    periodKey: year,
    unlockDate: lock.unlockDate,
    withTimebook: row.with_timebook === 1,
    overview,
    timebookMix: timebookMix ?? [],
    quarters: quarters ?? [],
    threeLines: JSON.parse(row.dimensions_json),
    patterns: JSON.parse(row.cross_insights_json),
    anchors: JSON.parse(row.next_actions_json),
    highlights: JSON.parse(row.highlights_json),
    tokenUsage: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    updatedAt: row.updated_at
  };
}

export async function generateYearlyReview(
  db: Database.Database,
  masterKey: Buffer,
  year: string
): Promise<YearlyReviewData> {
  const lock = checkYearlyUnlock(year);
  if (lock.locked) {
    return {
      locked: true,
      periodKey: year,
      unlockDate: lock.unlockDate,
      hint: lock.hint,
      withTimebook: false
    };
  }

  const cfg = getAiConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.apiKey) {
    throw new Error("模型服务未开启或未配置密钥，无法生成年度深度复盘");
  }

  const entries = loadEntriesForPeriod(db, `${year}-`);
  if (entries.length === 0) {
    throw new Error(`${year} 年暂无日记记录，无法生成年度复盘`);
  }

  const totalWords = entries.reduce((a, e) => a + e.wordCount, 0);
  const avgWords = Math.round(totalWords / entries.length);
  const prevYear = String(Number(year) - 1);
  const prevAgg = db
    .prepare(
      "SELECT COALESCE(SUM(word_count), 0) as w FROM entries WHERE deleted_at IS NULL AND substr(date, 1, 4) = ?"
    )
    .get(prevYear) as { w: number };
  const yoyDelta =
    prevAgg.w > 0
      ? `${totalWords >= prevAgg.w ? "+" : ""}${Math.round(((totalWords - prevAgg.w) / prevAgg.w) * 100)}%（较 ${prevYear}）`
      : "首年基线";

  // 收集全年已生成月报 + 防漏兜底（重要事件 / 节点事件 / 年度复盘）
  const monthlyRows = db
    .prepare(
      `SELECT period_key, overview_json, dimensions_json, highlights_json
       FROM period_reviews
       WHERE scope = 'monthly' AND period_key LIKE ?
       ORDER BY period_key ASC`
    )
    .all(`${year}-%`) as Array<{
    period_key: string;
    overview_json: string;
    dimensions_json: string;
    highlights_json: string;
  }>;

  const monthlySummariesText = monthlyRows.length
    ? monthlyRows
        .map((m) => {
          const ov = JSON.parse(m.overview_json) as { summary?: string; days?: string; words?: string };
          const dm = JSON.parse(m.dimensions_json) as { work?: string; life?: string };
          return `[${m.period_key}] ${ov.days || ""} ${ov.words || ""}：${ov.summary || ""}（工作:${(dm.work || "").slice(0, 80)}；生活:${(dm.life || "").slice(0, 80)}）`;
        })
        .join("\n")
    : entries
        .slice(0, 80)
        .map((e) => `[${e.date}] 《${e.digest?.shortTitle || e.title}》${e.digest?.summary || e.contentText.slice(0, 100)}`)
        .join("\n");

  const specialEntriesText = entries
    .filter((e) => e.kind === "special" || e.tags.includes("年度复盘"))
    .map((e) => `[${e.date}] 《${e.title}》\n${e.contentText.slice(0, 1500)}`)
    .join("\n---\n");

  const digestsMap = new Map<string, EntryAiDigest>();
  for (const e of entries) {
    if (e.digest) digestsMap.set(e.id, e.digest);
  }

  // 全年候选池：合并各月月轴条目 + 规则初筛高分条
  const monthHlIds = new Set<string>();
  for (const m of monthlyRows) {
    try {
      const list = JSON.parse(m.highlights_json) as HighlightItem[];
      for (const h of list) monthHlIds.add(h.entryId);
    } catch {
      // ignore
    }
  }
  const candidates = scoreHighlightCandidates(entries, digestsMap, 24);
  for (const c of candidates) {
    if (monthHlIds.has(c.entryId)) c.score += 15;
  }
  candidates.sort((a, b) => b.score - a.score);

  const timebook = await fetchTimebookSummary(db, masterKey, { scope: "yearly", periodKey: year });

  const prompt = buildYearlyReviewPrompt({
    year,
    stats: { days: entries.length, totalWords, avgWords, yoyDelta },
    monthlySummariesText,
    specialEntriesText,
    candidates,
    timebook
  });

  const aiRes = await callAiCompletion(cfg, {
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    maxTokens: prompt.maxTokens,
    temperature: 0.3,
    timeoutMs: 60_000
  });

  const parsed = extractJsonFromAiText<{
    overviewSummary?: string;
    quarters?: Array<{ q: string; desc: string }>;
    threeLines?: { work?: string; life?: string; growth?: string };
    patterns?: string[];
    anchors?: string[];
    highlights?: Array<{ date?: string; entryId?: string; title?: string; reason?: string; algoTag?: string }>;
  }>(aiRes.contentText);

  const threeLines = {
    work: parsed.threeLines?.work || "",
    life: parsed.threeLines?.life || "",
    growth: parsed.threeLines?.growth || ""
  };
  const depthCheck = validateYearlyReviewDepth(threeLines);
  if (!depthCheck.ok) {
    console.warn(`[lifebook] 年报深度提示：minLen=${depthCheck.minLen}`, depthCheck.details);
  }

  const { pinnedIds, excludedIds } = getPinnedAndExcluded(db, "yearly", year);
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const entriesByDate = new Map(entries.map((e) => [e.date, e]));

  const highlights = verifyAndMergeHighlights({
    scope: "yearly",
    candidates,
    aiSelected: parsed.highlights ?? [],
    pinnedEntryIds: pinnedIds,
    excludedEntryIds: excludedIds,
    entriesById,
    entriesByDate,
    digestsById: digestsMap,
    minCount: 8,
    maxCount: 12
  });

  const overview = {
    days: `${entries.length} 篇`,
    words: `${totalWords.toLocaleString()} 字`,
    delta: yoyDelta,
    tbHours: timebook.available ? `${timebook.totalHours} 小时` : "未开启（已降级）",
    summary: parsed.overviewSummary || `${year} 年共记录 ${entries.length} 篇日记，总计 ${totalWords.toLocaleString()} 字。`,
    contextNote: `第 3 层上下文：${monthlyRows.length} 份月报摘要 + 全年高光候选池${timebook.available ? " + 时间簿全年聚合" : ""}`
  };

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO period_reviews (
       id, scope, period_key, with_timebook,
       overview_json, cross_insights_json, dimensions_json, next_actions_json, highlights_json, token_usage_json,
       created_at, updated_at
     ) VALUES (?, 'yearly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, period_key) DO UPDATE SET
       with_timebook = excluded.with_timebook,
       overview_json = excluded.overview_json,
       cross_insights_json = excluded.cross_insights_json,
       dimensions_json = excluded.dimensions_json,
       next_actions_json = excluded.next_actions_json,
       highlights_json = excluded.highlights_json,
       token_usage_json = excluded.token_usage_json,
       updated_at = excluded.updated_at`
  ).run(
    `rev-${ulid()}`,
    year,
    timebook.available ? 1 : 0,
    JSON.stringify({ ...overview, timebookMix: timebook.modules, quarters: parsed.quarters ?? [] }),
    JSON.stringify(parsed.patterns ?? []),
    JSON.stringify(threeLines),
    JSON.stringify(parsed.anchors ?? []),
    JSON.stringify(highlights),
    aiRes.usage ? JSON.stringify(aiRes.usage) : null,
    now,
    now
  );

  return getCachedYearlyReview(db, year);
}

/* ================= 3. 手动钉选 / 移出高光时间轴锁定 ================= */

export function setHighlightAction(
  db: Database.Database,
  params: {
    scope: "monthly" | "yearly";
    periodKey: string;
    entryId: string;
    action: "pin" | "exclude" | "unpin";
  }
): HighlightItem[] {
  const entry = getEntryById(db, params.entryId);
  if (!entry) throw new Error("目标日记不存在");

  const now = new Date().toISOString();
  if (params.action === "unpin") {
    db.prepare(
      "DELETE FROM pinned_highlights WHERE scope = ? AND period_key = ? AND entry_id = ?"
    ).run(params.scope, params.periodKey, params.entryId);
  } else {
    db.prepare(
      `INSERT INTO pinned_highlights (id, scope, period_key, entry_id, action, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, period_key, entry_id) DO UPDATE SET
         action = excluded.action,
         updated_at = excluded.updated_at`
    ).run(`ph-${ulid()}`, params.scope, params.periodKey, params.entryId, params.action, now);
  }

  // 若已有缓存周期复盘，即时更新其 highlights_json 以保持视图同步
  const row = db
    .prepare("SELECT highlights_json FROM period_reviews WHERE scope = ? AND period_key = ?")
    .get(params.scope, params.periodKey) as { highlights_json: string } | undefined;

  if (!row) return [];
  let list = JSON.parse(row.highlights_json) as HighlightItem[];

  if (params.action === "exclude") {
    list = list.filter((h) => h.entryId !== params.entryId);
  } else if (params.action === "unpin") {
    list = list.map((h) => (h.entryId === params.entryId ? { ...h, pinned: false } : h));
  } else if (params.action === "pin") {
    const exists = list.some((h) => h.entryId === params.entryId);
    if (exists) {
      list = list.map((h) => (h.entryId === params.entryId ? { ...h, pinned: true } : h));
    } else {
      list.unshift({
        id: `hl-${entry.id}`,
        date: entry.date,
        quarter: params.scope === "yearly" ? `Q${Math.ceil(Number(entry.date.slice(5, 7)) / 3)}` : undefined,
        title: entry.digest?.shortTitle || entry.title || `${entry.date} 日记`,
        reason: "由用户手动钉选锁定为高光记忆节点",
        algoTag: "手动钉选",
        entryId: entry.id,
        pinned: true
      });
    }
  }

  db.prepare("UPDATE period_reviews SET highlights_json = ?, updated_at = ? WHERE scope = ? AND period_key = ?").run(
    JSON.stringify(list),
    now,
    params.scope,
    params.periodKey
  );
  return list;
}

/* ================= 4. 内容规律洞察（快乐触发器 / 消耗点本地聚合） ================= */

export function getContentInsights(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT e.id, e.date, e.title, d.short_title, d.reflection, d.topics_json,
              GROUP_CONCAT(m.label) as mood_labels
       FROM entries e
       LEFT JOIN entry_ai_digests d ON d.entry_id = e.id
       LEFT JOIN entry_moods em ON em.entry_id = e.id
       LEFT JOIN moods m ON m.id = em.mood_id
       WHERE e.deleted_at IS NULL
       GROUP BY e.id
       ORDER BY e.date DESC
       LIMIT 300`
    )
    .all() as Array<{
    id: string;
    date: string;
    title: string;
    short_title: string | null;
    reflection: string | null;
    topics_json: string | null;
    mood_labels: string | null;
  }>;

  const positiveTriggers: Array<{ entryId: string; date: string; title: string; text: string }> = [];
  const drainSignals: Array<{ entryId: string; date: string; title: string; text: string }> = [];

  for (const r of rows) {
    const moods = r.mood_labels || "";
    const text = r.reflection || r.short_title || r.title;
    if (!text) continue;
    if ((moods.includes("开心") || moods.includes("兴奋")) && positiveTriggers.length < 4) {
      positiveTriggers.push({
        entryId: r.id,
        date: r.date,
        title: r.short_title || r.title || `${r.date} 日记`,
        text
      });
    } else if (
      (moods.includes("疲惫") || moods.includes("焦虑") || moods.includes("烦躁") || moods.includes("生气") || moods.includes("低落")) &&
      drainSignals.length < 4
    ) {
      drainSignals.push({
        entryId: r.id,
        date: r.date,
        title: r.short_title || r.title || `${r.date} 日记`,
        text
      });
    }
    if (positiveTriggers.length >= 4 && drainSignals.length >= 4) break;
  }

  return { positiveTriggers, drainSignals };
}

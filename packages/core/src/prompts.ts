import type { ScoredHighlightCandidate } from "./highlights.js";
import type { TimebookSummary } from "./index.js";

export const MONTHLY_REVIEW_MAX_TOKENS = 3000;
export const YEARLY_REVIEW_MAX_TOKENS = 5000;
export const QA_MAX_TOOL_ROUNDS = 4;
export const QA_MAX_CONTEXT_CHARS = 16000;

export function buildSingleEntryDigestPrompt(input: {
  date: string;
  kind: string;
  title: string;
  moods: string[];
  tags: string[];
  contentText: string;
}): { system: string; user: string } {
  return {
    system: [
      "你是私密个人日记工具「人生簿」的结构化整理助手。请严格用中文简体客观提炼单篇日记的结构化日概要，只输出合法 JSON 对象，不要输出 Markdown 代码围栏以外的多余解释。",
      "质量要求：总有效提炼约 220~320 字，保留真实具体事实与细节，杜绝空泛口号。",
      "JSON 字段格式：",
      `{
  "shortTitle": "12~18字浓缩短标题",
  "summary": "60~90字客观摘要",
  "dimLife": "生活与健康具体事实（如空写无明显记录）",
  "dimWork": "工作与事务推进具体事实",
  "dimLeisure": "娱乐学习与成长具体事实",
  "dimPeopleNotes": "人际互动与见闻记事",
  "keyEvents": [{ "title": "关键事件名称", "importance": 4, "nature": "工作/生活/情感/旅行" }],
  "topics": ["主题词1", "主题词2", "主题词3"],
  "reflection": "一句当日情绪诱因或客观反思"
}`
    ].join("\n"),
    user: [
      `日期：${input.date}`,
      `类型：${input.kind === "special" ? "专项复盘" : "每日日记"}`,
      `原标题：${input.title || "（无标题）"}`,
      `心情：${input.moods.join("、") || "未标注"}`,
      `标签：${input.tags.join("、") || "无"}`,
      `正文：\n${input.contentText.slice(0, 6000)}`
    ].join("\n")
  };
}

export function buildMonthlyReviewPrompt(input: {
  ym: string;
  stats: { days: number; totalWords: number; avgWords: number; moodSummary: string };
  digestsText: string;
  candidates: ScoredHighlightCandidate[];
  timebook: TimebookSummary;
}): { system: string; user: string; maxTokens: number } {
  const tbBlock = input.timebook.available
    ? `【时间簿本月客观聚合】总投入 ${input.timebook.totalHours} 小时，待办完成率 ${input.timebook.todoRate}（${input.timebook.todoDone}/${input.timebook.todoTotal}）；模块分布：${input.timebook.modules.map((m) => `${m.name} ${m.hours}h(${m.pct}%, 环比${m.delta})`).join("；")}`
    : "【时间簿联动状态】未配置或离线，请仅基于主观日记数据进行纯日记客观复盘。";

  const candBlock = input.candidates
    .map((c) => `- ${c.date} [id:${c.entryId}] (${c.algoTag}, 分值${c.score}) 《${c.title}》：${c.summary}`)
    .join("\n");

  return {
    maxTokens: MONTHLY_REVIEW_MAX_TOKENS,
    system: [
      "你是「人生簿」的私人客观月度复盘分析师。请严格使用中文简体，采用客观、克制、有数据与日期支撑的私人观察视角，只输出合法 JSON 对象。",
      "【深度展开硬性要求（C-17）】",
      "1. 四维深度盘点（work、life、leisure、emotion）每一维度必须达到 150~260 字，按「带具体日期的事件事实 → 过程规律与卡点拆解（若时间簿已联动须对照模块耗时）→ 客观得失判断」三层展开，严禁输出一两句话的浅层概括！",
      "2. highlights 必须从提供的候选池中精选 4~6 条，date 与 entryId 必须严格引用输入中的真实记录，禁止编造日期。",
      "JSON 输出结构：",
      `{
  "overviewSummary": "120~180字月度整体节奏全景总结",
  "crossInsights": ["主观日记×时间簿客观耗时交叉洞察1", "交叉洞察2"],
  "dimensions": {
    "work": "150~260字工作与事务深度盘点（含YYYY-MM-DD具体日期事实）",
    "life": "150~260字生活与健康深度盘点（含YYYY-MM-DD具体日期事实）",
    "leisure": "150~260字娱乐与成长深度盘点（含YYYY-MM-DD具体日期事实）",
    "emotion": "150~260字情绪波动与恢复规律深度盘点（含YYYY-MM-DD具体日期事实）"
  },
  "nextActions": ["具体可执行下月建议1", "建议2"],
  "highlights": [
    { "date": "YYYY-MM-DD", "entryId": "对应id", "title": "高光短标题", "reason": "入选理由", "algoTag": "标签来源" }
  ]
}`
    ].join("\n"),
    user: [
      `目标月份：${input.ym}`,
      `量化统计：记录 ${input.stats.days} 天，总字数 ${input.stats.totalWords} 字，篇均 ${input.stats.avgWords} 字，心情分布：${input.stats.moodSummary}`,
      tbBlock,
      `\n【高光候选池（请从中精选 4~6 条）】\n${candBlock}`,
      `\n【本月结构化日概要（按日期正序）】\n${input.digestsText}`
    ].join("\n")
  };
}

export function buildYearlyReviewPrompt(input: {
  year: string;
  stats: { days: number; totalWords: number; avgWords: number; yoyDelta: string };
  monthlySummariesText: string;
  specialEntriesText: string;
  candidates: ScoredHighlightCandidate[];
  timebook: TimebookSummary;
}): { system: string; user: string; maxTokens: number } {
  const tbBlock = input.timebook.available
    ? `【时间簿全年客观聚合】总投入 ${input.timebook.totalHours} 小时，待办完成率 ${input.timebook.todoRate}；模块分布：${input.timebook.modules.map((m) => `${m.name} ${m.hours}h(${m.pct}%)`).join("；")}`
    : "【时间簿联动状态】未配置或离线，请仅基于全年日记与月度复盘做客观年度复盘。";

  const candBlock = input.candidates
    .map((c) => `- ${c.date} (${c.quarter}) [id:${c.entryId}] (${c.algoTag}) 《${c.title}》：${c.summary}`)
    .join("\n");

  return {
    maxTokens: YEARLY_REVIEW_MAX_TOKENS,
    system: [
      "你是「人生簿」的私人客观年度复盘分析师。请严格使用中文简体，采用客观、克制、有跨月事实与量化佐证的私人观察视角，只输出合法 JSON 对象。",
      "【深度展开硬性要求（C-17）】",
      "1. 工作积累（work）、生活秩序（life）、个人成长（growth）三条主线盘点，每一条主线必须达到 300~500 字，按「全年演进脉络 → 跨月带日期事实例证与量化佐证 → 深层收获与未解瓶颈」深度展开，严禁浅层概括！",
      "2. highlights 从高光候选池中精选 8~12 条，去重合并连续事件并平衡 Q1~Q4 四季分布，date 与 entryId 必须真实存在。",
      "JSON 输出结构：",
      `{
  "overviewSummary": "160~240字年度全景总结",
  "quarters": [
    { "q": "Q1（1-3月）", "desc": "季度节奏与重心" },
    { "q": "Q2（4-6月）", "desc": "季度节奏与重心" },
    { "q": "Q3（7-9月）", "desc": "季度节奏与重心" },
    { "q": "Q4（10-12月）", "desc": "季度节奏与重心" }
  ],
  "threeLines": {
    "work": "300~500字工作积累主线深度盘点（含跨月具体日期与量化事实）",
    "life": "300~500字生活秩序主线深度盘点（含跨月具体日期与量化事实）",
    "growth": "300~500字个人成长主线深度盘点（含跨月具体日期与量化事实）"
  },
  "patterns": ["跨月重复出现的行为模式1", "行为模式2", "行为模式3"],
  "anchors": ["来年锚点建议1", "来年锚点建议2", "来年锚点建议3"],
  "highlights": [
    { "date": "YYYY-MM-DD", "entryId": "对应id", "title": "高光标题", "reason": "入选理由", "algoTag": "来源标签" }
  ]
}`
    ].join("\n"),
    user: [
      `目标年份：${input.year}`,
      `全年统计：记录 ${input.stats.days} 天，总字数 ${input.stats.totalWords} 字，篇均 ${input.stats.avgWords} 字，同比 ${input.stats.yoyDelta}`,
      tbBlock,
      `\n【全年高光候选池（请精选 8~12 条，注意平衡 Q1~Q4）】\n${candBlock}`,
      `\n【各月度复盘摘要】\n${input.monthlySummariesText || "（暂无已生成月报，基于日概要汇总）"}`,
      `\n【当年专项/年度复盘原文参考】\n${input.specialEntriesText || "（无）"}`
    ].join("\n")
  };
}

export function validateMonthlyReviewDepth(dimensions: {
  work: string;
  life: string;
  leisure: string;
  emotion: string;
}): { ok: boolean; minLen: number; details: Record<string, number> } {
  const details = {
    work: (dimensions.work ?? "").replace(/\s+/g, "").length,
    life: (dimensions.life ?? "").replace(/\s+/g, "").length,
    leisure: (dimensions.leisure ?? "").replace(/\s+/g, "").length,
    emotion: (dimensions.emotion ?? "").replace(/\s+/g, "").length
  };
  const minLen = Math.min(...Object.values(details));
  return { ok: minLen >= 140, minLen, details };
}

export function validateYearlyReviewDepth(threeLines: {
  work: string;
  life: string;
  growth: string;
}): { ok: boolean; minLen: number; details: Record<string, number> } {
  const details = {
    work: (threeLines.work ?? "").replace(/\s+/g, "").length,
    life: (threeLines.life ?? "").replace(/\s+/g, "").length,
    growth: (threeLines.growth ?? "").replace(/\s+/g, "").length
  };
  const minLen = Math.min(...Object.values(details));
  return { ok: minLen >= 280, minLen, details };
}

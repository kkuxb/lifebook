export type EntryKind = "daily" | "special";

export interface PaletteItem {
  key: string;
  name: string;
  color: string;
  tint: string;
  ink: string;
  darkTint: string;
  darkInk: string;
}

export interface TagItem {
  id: string;
  name: string;
  colorKey: string;
  color: string;
  tint: string;
  ink: string;
  darkTint: string;
  darkInk: string;
  enabled: boolean;
  sort: number;
  count?: number;
}

export interface MoodItem {
  id: string;
  emoji: string;
  name: string;
  label: string;
  tone: string;
  level: number;
  sort: number;
  count?: number;
}

export interface EntryRecord {
  id: string;
  kind: EntryKind;
  date: string;
  title: string;
  contentHtml: string;
  contentText: string;
  wordCount: number;
  importBatch: string | null;
  tags: string[];
  moods: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  digest?: EntryAiDigest | null;
}

export interface EntrySnapshot {
  id: string;
  entryId: string;
  snapshotDate: string;
  title: string;
  contentHtml: string;
  wordCount: number;
  createdAt: string;
}

export interface KeyEventItem {
  title: string;
  importance: number; // 1 ~ 5
  nature?: string;
}

export interface EntryAiDigest {
  entryId: string;
  contentHash: string;
  shortTitle: string;
  summary: string;
  dimLife: string;
  dimWork: string;
  dimLeisure: string;
  dimPeopleNotes: string;
  keyEvents: KeyEventItem[];
  topics: string[];
  reflection: string;
  updatedAt: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  desc: string;
  sections: string[];
  isDefault: boolean;
}

export interface HighlightItem {
  id: string;
  date: string;
  quarter?: string;
  title: string;
  reason: string;
  algoTag: string;
  entryId: string;
  pinned: boolean;
}

export interface TimebookModuleMix {
  name: string;
  hours: number;
  pct: number;
  delta: string;
  color: string;
}

export interface TimebookSummary {
  available: boolean;
  reason?: string;
  totalHours: number;
  todoTotal: number;
  todoDone: number;
  todoRate: string;
  modules: TimebookModuleMix[];
}

export interface MonthlyReviewData {
  locked: boolean;
  periodKey: string;
  unlockDate: string;
  hint?: string;
  withTimebook: boolean;
  overview?: {
    days: string;
    words: string;
    mood: string;
    tbHours: string;
    todoRate: string;
    summary: string;
    contextNote: string;
  };
  timebookMix?: TimebookModuleMix[];
  crossInsights?: string[];
  dimensions?: {
    work: string;
    life: string;
    leisure: string;
    emotion: string;
  };
  nextActions?: string[];
  highlights?: HighlightItem[];
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  updatedAt?: string;
}

export interface YearlyReviewData {
  locked: boolean;
  periodKey: string;
  unlockDate: string;
  hint?: string;
  withTimebook: boolean;
  overview?: {
    days: string;
    words: string;
    delta: string;
    tbHours: string;
    summary: string;
    contextNote: string;
  };
  timebookMix?: TimebookModuleMix[];
  quarters?: Array<{ q: string; desc: string }>;
  threeLines?: {
    work: string;
    life: string;
    growth: string;
  };
  patterns?: string[];
  anchors?: string[];
  highlights?: HighlightItem[];
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  updatedAt?: string;
}

export interface QaTraceStep {
  round: number;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  summary: string;
}

export interface QaCitation {
  entryId: string;
  date: string;
  title: string;
}

export interface QaResponse {
  answer: string;
  traces: QaTraceStep[];
  citations: QaCitation[];
  roundsUsed: number;
  truncatedAtMaxRounds: boolean;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
}

export type AiProviderType = "openai" | "gemini" | "anthropic";

export interface AiConfigPublic {
  enabled: boolean;
  provider: AiProviderType;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  modelId: string;
}

export interface TimebookConfigPublic {
  enabled: boolean;
  url: string;
  hasPassword: boolean;
  passwordMasked: string;
}

export const TAG_PALETTE: PaletteItem[] = [
  { key: "blue", name: "晴空蓝", color: "#4F7BFF", tint: "#EDF1FF", ink: "#2D4FCC", darkTint: "#1E2842", darkInk: "#9AB4FF" },
  { key: "purple", name: "薰衣紫", color: "#8B5CF6", tint: "#F2EDFF", ink: "#6236D6", darkTint: "#292140", darkInk: "#C4B5FD" },
  { key: "amber", name: "琥珀黄", color: "#F59E0B", tint: "#FEF5E2", ink: "#9A5800", darkTint: "#332714", darkInk: "#FCD34D" },
  { key: "rose", name: "玫瑰红", color: "#F43F5E", tint: "#FFEDF0", ink: "#C8203E", darkTint: "#371D26", darkInk: "#FDA4AF" },
  { key: "teal", name: "薄荷青", color: "#14B8A6", tint: "#E6F7F4", ink: "#0B7F72", darkTint: "#162E2C", darkInk: "#5EEAD4" },
  { key: "sky", name: "海天蓝", color: "#0EA5E9", tint: "#E5F5FD", ink: "#086A99", darkTint: "#172B38", darkInk: "#7DD3FC" },
  { key: "green", name: "森野绿", color: "#22C55E", tint: "#E8F8EE", ink: "#15803D", darkTint: "#162E20", darkInk: "#86EFAC" },
  { key: "pink", name: "樱花粉", color: "#EC4899", tint: "#FDEDF6", ink: "#B5186E", darkTint: "#341E2C", darkInk: "#F9A8D4" },
  { key: "indigo", name: "深靛蓝", color: "#6366F1", tint: "#EEF2FF", ink: "#4338CA", darkTint: "#222442", darkInk: "#A5B4FC" },
  { key: "slate", name: "石板灰", color: "#64748B", tint: "#F1F5F9", ink: "#334155", darkTint: "#232A36", darkInk: "#CBD5E1" }
];

export const DEFAULT_TAGS: Omit<TagItem, "id">[] = [
  { ...TAG_PALETTE[0], name: "日常记录", colorKey: TAG_PALETTE[0].key, enabled: true, sort: 1 },
  { ...TAG_PALETTE[1], name: "节点事件", colorKey: TAG_PALETTE[1].key, enabled: true, sort: 2 },
  { ...TAG_PALETTE[2], name: "重要事件", colorKey: TAG_PALETTE[2].key, enabled: true, sort: 3 },
  { ...TAG_PALETTE[3], name: "负面事件", colorKey: TAG_PALETTE[3].key, enabled: true, sort: 4 },
  { ...TAG_PALETTE[4], name: "休闲躺平", colorKey: TAG_PALETTE[4].key, enabled: true, sort: 5 },
  { ...TAG_PALETTE[5], name: "出差工作", colorKey: TAG_PALETTE[5].key, enabled: true, sort: 6 },
  { ...TAG_PALETTE[6], name: "旅行游玩", colorKey: TAG_PALETTE[6].key, enabled: true, sort: 7 },
  { ...TAG_PALETTE[7], name: "反省总结", colorKey: TAG_PALETTE[7].key, enabled: true, sort: 8 },
  { ...TAG_PALETTE[8], name: "年度复盘", colorKey: TAG_PALETTE[8].key, enabled: true, sort: 9 }
];

export const DEFAULT_MOODS: Omit<MoodItem, "id">[] = [
  { emoji: "😄", name: "开心", label: "😄 开心", tone: "#22C55E", level: 4, sort: 1 },
  { emoji: "🥰", name: "兴奋", label: "🥰 兴奋", tone: "#F59E0B", level: 4, sort: 2 },
  { emoji: "😌", name: "平静", label: "😌 平静", tone: "#64748B", level: 3, sort: 3 },
  { emoji: "😮‍💨", name: "疲惫", label: "😮‍💨 疲惫", tone: "#8B5CF6", level: 2, sort: 4 },
  { emoji: "😰", name: "焦虑", label: "😰 焦虑", tone: "#3B82F6", level: 1, sort: 5 },
  { emoji: "😤", name: "烦躁", label: "😤 烦躁", tone: "#F97316", level: 1, sort: 6 },
  { emoji: "😠", name: "生气", label: "😠 生气", tone: "#EF4444", level: 1, sort: 7 },
  { emoji: "😢", name: "低落", label: "😢 低落", tone: "#BE123C", level: 1, sort: 8 }
];

export const OLD_12_TO_NEW_8_MOOD_MAP: Record<string, string> = {
  "😐 平静": "😌 平静",
  "平静": "😌 平静",
  "🙃 一般": "😌 平静",
  "一般": "😌 平静",
  "😔 不差": "😌 平静",
  "不差": "😌 平静",
  "😄 开心": "😄 开心",
  "开心": "😄 开心",
  "🥰 兴奋": "🥰 兴奋",
  "兴奋": "🥰 兴奋",
  "😣 疲惫": "😮‍💨 疲惫",
  "疲惫": "😮‍💨 疲惫",
  "😔 心累": "😮‍💨 疲惫",
  "心累": "😮‍💨 疲惫",
  "😖 焦虑": "😰 焦虑",
  "焦虑": "😰 焦虑",
  "😷 不爽": "😤 烦躁",
  "不爽": "😤 烦躁",
  "😤 烦躁": "😤 烦躁",
  "烦躁": "😤 烦躁",
  "😠 生气": "😠 生气",
  "生气": "😠 生气",
  "😫 伤心": "😢 低落",
  "伤心": "😢 低落",
  "💔 心碎": "😢 低落",
  "心碎": "😢 低落",
  "😧 糟糕": "😢 低落",
  "糟糕": "😢 低落"
};

export const DEFAULT_TEMPLATES: TemplateItem[] = [
  {
    id: "tpl-daily",
    name: "标准四段日记",
    desc: "延续每日写作文脉：生活、工作、娱乐与见闻",
    sections: ["生活部分", "工作部分", "娱乐部分", "见闻记事"],
    isDefault: true
  },
  {
    id: "tpl-annual",
    name: "专项 / 年度复盘骨架",
    desc: "适合月末、年末或重大节点深度梳理",
    sections: ["一、关键收获与高光瞬间", "二、暴露的问题与反思", "三、下阶段重点行动"],
    isDefault: false
  }
];

export function getShanghaiNowParts(now: Date = new Date()): {
  date: string;
  month: string;
  year: string;
  time: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  const minute = pick("minute");
  const second = pick("second");
  return {
    date: `${year}-${month}-${day}`,
    month: `${year}-${month}`,
    year,
    time: `${hour}:${minute}:${second}`
  };
}

export function checkMonthlyUnlock(
  ym: string,
  now: Date = new Date()
): { locked: boolean; unlockDate: string; hint: string } {
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { locked: true, unlockDate: "", hint: "月份格式须为 YYYY-MM" };
  }
  const [yStr, mStr] = ym.split("-");
  let y = Number(yStr);
  let m = Number(mStr);
  if (m < 1 || m > 12) {
    return { locked: true, unlockDate: "", hint: "无效月份" };
  }
  let nextY = y;
  let nextM = m + 1;
  if (nextM > 12) {
    nextY += 1;
    nextM = 1;
  }
  const unlockDate = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  const cur = getShanghaiNowParts(now);
  if (ym >= cur.month) {
    return {
      locked: true,
      unlockDate,
      hint: `${y} 年 ${m} 月尚未结束（当前上海日期 ${cur.date}）。为保证整月口径完整，进入 ${unlockDate}（次月 1 日）后自动解锁生成本月客观复盘与月度高光轴。`
    };
  }
  return { locked: false, unlockDate, hint: "" };
}

export function checkYearlyUnlock(
  year: string,
  now: Date = new Date()
): { locked: boolean; unlockDate: string; hint: string } {
  if (!/^\d{4}$/.test(year)) {
    return { locked: true, unlockDate: "", hint: "年份格式须为 YYYY" };
  }
  const y = Number(year);
  const unlockDate = `${y + 1}-01-01`;
  const cur = getShanghaiNowParts(now);
  if (year >= cur.year) {
    return {
      locked: true,
      unlockDate,
      hint: `${y} 自然年尚未结束（当前上海日期 ${cur.date}）。为保证全年口径完整，进入 ${unlockDate}（次年 1 月 1 日）后自动解锁生成年度复盘与年度高光轴。`
    };
  }
  return { locked: false, unlockDate, hint: "" };
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote|pre|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(htmlOrText: string): number {
  const plain = /<[^>]+>/.test(htmlOrText) ? stripHtml(htmlOrText) : (htmlOrText || "");
  return plain.replace(/\s+/g, "").length;
}

export function buildHtmlFromSections(sections: string[]): string {
  return sections.map((s) => `<h3>${escapeHtml(s)}</h3><p></p>`).join("");
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export * from "./import-parser.js";
export * from "./highlights.js";
export * from "./prompts.js";

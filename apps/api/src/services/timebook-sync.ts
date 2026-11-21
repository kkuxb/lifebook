import type Database from "better-sqlite3";
import type { TimebookConfigPublic, TimebookModuleMix, TimebookSummary } from "@lifebook/core";
import { decryptSecret, encryptSecret, maskSecret, sha256 } from "../crypto.js";

export interface TimebookConfigFull {
  enabled: boolean;
  url: string;
  password: string;
}

const DEFAULT_TB_CONFIG: TimebookConfigFull = {
  enabled: false,
  url: "",
  password: ""
};

const MODULE_COLORS = ["#4F7BFF", "#8B5CF6", "#14B8A6", "#22C55E", "#F59E0B", "#EC4899"];

const COLOR_KEY_MAP: Record<string, string> = {
  blue: "#4F7BFF",
  indigo: "#6366F1",
  purple: "#8B5CF6",
  teal: "#14B8A6",
  green: "#22C55E",
  amber: "#F59E0B",
  yellow: "#F59E0B",
  orange: "#F97316",
  pink: "#EC4899",
  rose: "#F43F5E",
  red: "#EF4444",
  sky: "#0EA5E9",
  slate: "#64748B",
  gray: "#64748B"
};

export function getModuleColorByKey(colorKey?: string, rawColor?: string, idx: number = 0): string {
  if (rawColor && /^#[0-9a-fA-F]{3,8}$/.test(rawColor.trim())) {
    return rawColor.trim();
  }
  if (colorKey) {
    const k = colorKey.trim().toLowerCase();
    if (COLOR_KEY_MAP[k]) return COLOR_KEY_MAP[k];
  }
  return MODULE_COLORS[idx % MODULE_COLORS.length];
}

export function toEpochMs(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v >= 1e11 ? v : v * 1000;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n >= 1e11 ? n : n * 1000;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const parsed = Date.parse(`${s}T00:00:00+08:00`);
      return Number.isNaN(parsed) ? null : parsed;
    }
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const SHANGHAI_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function epochMsToShanghaiDate(ms: number): string {
  const parts = SHANGHAI_DATE_FMT.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function epochMsToShanghaiMonth(ms: number): string {
  return epochMsToShanghaiDate(ms).slice(0, 7);
}

export function getTimebookConfigFull(db: Database.Database, masterKey: Buffer): TimebookConfigFull {
  const row = db
    .prepare("SELECT value, encrypted FROM settings WHERE key = 'timebook_config'")
    .get() as { value: string; encrypted: number } | undefined;
  if (!row) return { ...DEFAULT_TB_CONFIG };
  try {
    const raw = row.encrypted ? decryptSecret(row.value, masterKey) : row.value;
    const parsed = JSON.parse(raw) as Partial<TimebookConfigFull>;
    return {
      enabled: Boolean(parsed.enabled),
      url: parsed.url || "",
      password: parsed.password || ""
    };
  } catch {
    return { ...DEFAULT_TB_CONFIG };
  }
}

export function getTimebookConfigPublic(
  db: Database.Database,
  masterKey: Buffer
): TimebookConfigPublic {
  const cfg = getTimebookConfigFull(db, masterKey);
  return {
    enabled: cfg.enabled,
    url: cfg.url,
    hasPassword: cfg.password.length > 0,
    passwordMasked: maskSecret(cfg.password)
  };
}

export function saveTimebookConfig(
  db: Database.Database,
  masterKey: Buffer,
  input: { enabled?: boolean; url?: string; password?: string }
): TimebookConfigPublic {
  const current = getTimebookConfigFull(db, masterKey);
  const nextPwd =
    input.password !== undefined && input.password !== "" && !input.password.includes("••••")
      ? input.password
      : current.password;

  const merged: TimebookConfigFull = {
    enabled: input.enabled ?? current.enabled,
    url: (input.url ?? current.url).trim().replace(/\/+$/, ""),
    password: nextPwd
  };

  const encrypted = encryptSecret(JSON.stringify(merged), masterKey);
  db.prepare(
    `INSERT INTO settings (key, value, encrypted, updated_at)
     VALUES ('timebook_config', ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 1, updated_at = excluded.updated_at`
  ).run(encrypted, new Date().toISOString());

  clearTimebookCache();
  return getTimebookConfigPublic(db, masterKey);
}

interface RawTimebookModule {
  id: string;
  name: string;
  color?: string;
  colorKey?: string;
  color_key?: string;
  sort?: number;
  deletedAt?: string | number | null;
  deleted_at?: string | number | null;
}

interface RawTimebookTag {
  id: string;
  moduleId?: string;
  module_id?: string;
  name: string;
  sort?: number;
  deletedAt?: string | number | null;
  deleted_at?: string | number | null;
}

interface RawTimebookSession {
  id: string;
  moduleId?: string;
  module_id?: string;
  tagId?: string;
  tag_id?: string;
  todoId?: string;
  todo_id?: string;
  title?: string;
  startAt?: string | number;
  start_at?: string | number;
  startedAt?: string | number;
  startTime?: string | number;
  endAt?: string | number;
  end_at?: string | number;
  endedAt?: string | number;
  endTime?: string | number;
  durationSeconds?: number;
  durationMs?: number;
  deletedAt?: string | number | null;
  deleted_at?: string | number | null;
}

interface RawTimebookTodo {
  id: string;
  title?: string;
  name?: string;
  tagId?: string;
  tag_id?: string;
  moduleId?: string;
  module_id?: string;
  planDate?: string;
  plan_date?: string;
  dueDate?: string;
  due_date?: string;
  recur?: string | null;
  doneAt?: string | number | null;
  done_at?: string | number | null;
  completed?: boolean;
  done?: boolean;
  createdAt?: string | number;
  created_at?: string | number;
  deletedAt?: string | number | null;
  deleted_at?: string | number | null;
}

interface RawTimebookTodoCheck {
  id?: string;
  todoId?: string;
  todo_id?: string;
  date?: string;
  doneAt?: string | number | null;
  done_at?: string | number | null;
  checked?: boolean;
  deletedAt?: string | number | null;
  deleted_at?: string | number | null;
}

interface TimebookSyncPayload {
  modules?: RawTimebookModule[];
  tags?: RawTimebookTag[];
  sessions?: RawTimebookSession[];
  todos?: RawTimebookTodo[];
  todoChecks?: RawTimebookTodoCheck[];
  todo_checks?: RawTimebookTodoCheck[];
}

export interface NormalizedModule {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface NormalizedTag {
  id: string;
  moduleId: string;
  name: string;
}

export interface NormalizedSession {
  id: string;
  moduleId: string;
  moduleName: string;
  tagId: string;
  tagName: string;
  title: string;
  startMs: number;
  endMs: number | null;
  durationSec: number;
  shanghaiDate: string;
  shanghaiMonth: string;
}

export interface NormalizedTodoItem {
  id: string;
  title: string;
  moduleId: string;
  moduleName: string;
  tagId: string;
  tagName: string;
  dateStr: string;
  isDone: boolean;
  recur: string;
}

export interface NormalizedTimebookData {
  modules: NormalizedModule[];
  moduleMap: Map<string, NormalizedModule>;
  tagMap: Map<string, NormalizedTag>;
  sessions: NormalizedSession[];
  todos: NormalizedTodoItem[];
  todoChecks: Array<{
    todoId: string;
    date: string;
    isDone: boolean;
  }>;
}

const CACHE_TTL_MS = 60_000;
const syncCache = new Map<string, { fetchedAtMs: number; data: NormalizedTimebookData }>();

export function clearTimebookCache(): void {
  syncCache.clear();
}

function isDeleted(item: { deletedAt?: unknown; deleted_at?: unknown }): boolean {
  return Boolean(item.deletedAt || item.deleted_at);
}

function normalizeSyncPayload(payload: TimebookSyncPayload): NormalizedTimebookData {
  const activeModules = (payload.modules ?? [])
    .filter((m) => !isDeleted(m))
    .map((m, idx) => ({
      id: m.id,
      name: m.name || "未命名模块",
      color: getModuleColorByKey(m.color_key ?? m.colorKey, m.color, idx),
      sort: m.sort ?? idx
    }));
  const moduleMap = new Map(activeModules.map((m) => [m.id, m]));

  const activeTags = (payload.tags ?? [])
    .filter((t) => !isDeleted(t))
    .map((t) => ({
      id: t.id,
      moduleId: t.moduleId || t.module_id || "",
      name: t.name || "未命名标签"
    }));
  const tagMap = new Map(activeTags.map((t) => [t.id, t]));

  const sessions: NormalizedSession[] = [];
  for (const s of payload.sessions ?? []) {
    if (isDeleted(s)) continue;
    const rawStart = s.start_at ?? s.startAt ?? s.startedAt ?? s.startTime;
    const startMs = toEpochMs(rawStart);
    if (!startMs) continue;

    const rawEnd = s.end_at ?? s.endAt ?? s.endedAt ?? s.endTime;
    const endMs = toEpochMs(rawEnd);

    let durationSec = 0;
    if (endMs && endMs > startMs) {
      durationSec = (endMs - startMs) / 1000;
    } else if (typeof s.durationSeconds === "number" && s.durationSeconds > 0) {
      durationSec = s.durationSeconds;
    } else if (typeof s.durationMs === "number" && s.durationMs > 0) {
      durationSec = s.durationMs / 1000;
    }
    if (durationSec <= 0) continue;

    const tagId = s.tagId || s.tag_id || "";
    const tag = tagId ? tagMap.get(tagId) : undefined;
    const modId = s.moduleId || s.module_id || tag?.moduleId || "unknown";
    const mod = moduleMap.get(modId);
    const shanghaiDate = epochMsToShanghaiDate(startMs);

    sessions.push({
      id: s.id,
      moduleId: modId,
      moduleName: mod?.name || "其他模块",
      tagId,
      tagName: tag?.name || "未分类",
      title: (s.title || "").trim(),
      startMs,
      endMs,
      durationSec,
      shanghaiDate,
      shanghaiMonth: shanghaiDate.slice(0, 7)
    });
  }

  const todos: NormalizedTodoItem[] = [];
  for (const t of payload.todos ?? []) {
    if (isDeleted(t)) continue;
    const tagId = t.tagId || t.tag_id || "";
    const tag = tagId ? tagMap.get(tagId) : undefined;
    const modId = t.moduleId || t.module_id || tag?.moduleId || "";
    const mod = modId ? moduleMap.get(modId) : undefined;

    const doneMs = toEpochMs(t.done_at ?? t.doneAt);
    const createdMs = toEpochMs(t.created_at ?? t.createdAt);
    const rawDate = t.plan_date || t.planDate || t.due_date || t.dueDate || "";
    let dateStr = "";
    if (rawDate) {
      dateStr = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : (toEpochMs(rawDate) ? epochMsToShanghaiDate(toEpochMs(rawDate)!) : "");
    } else if (doneMs) {
      dateStr = epochMsToShanghaiDate(doneMs);
    } else if (createdMs) {
      dateStr = epochMsToShanghaiDate(createdMs);
    }

    const isDone = Boolean(doneMs || t.completed || t.done);
    todos.push({
      id: t.id,
      title: (t.title || t.name || "").trim(),
      moduleId: modId,
      moduleName: mod?.name || "其他模块",
      tagId,
      tagName: tag?.name || "未分类",
      dateStr,
      isDone,
      recur: (t.recur || "").trim()
    });
  }

  const rawChecks = [...(payload.todoChecks ?? []), ...(payload.todo_checks ?? [])];
  const todoChecks: NormalizedTimebookData["todoChecks"] = [];
  for (const c of rawChecks) {
    if (isDeleted(c)) continue;
    const todoId = c.todoId || c.todo_id || "";
    const hasDoneAtField = c.done_at !== undefined || c.doneAt !== undefined;
    const doneAtMs = toEpochMs(c.done_at ?? c.doneAt);
    const isDone = hasDoneAtField ? Boolean(doneAtMs) : c.checked !== false;
    const date = (c.date || (doneAtMs ? epochMsToShanghaiDate(doneAtMs) : "")).slice(0, 10);
    todoChecks.push({ todoId, date, isDone });
  }

  return {
    modules: activeModules,
    moduleMap,
    tagMap,
    sessions,
    todos,
    todoChecks
  };
}

async function loginAndPullTimebook(cfg: TimebookConfigFull): Promise<TimebookSyncPayload> {
  if (!cfg.url || !cfg.password) {
    throw new Error("时间簿服务地址或访问口令未配置");
  }
  const base = cfg.url.replace(/\/+$/, "");

  const loginResp = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: cfg.password }),
    signal: AbortSignal.timeout(5000)
  });

  if (!loginResp.ok) {
    throw new Error(`时间簿登录失败（HTTP ${loginResp.status}），请检查访问口令`);
  }

  const loginJson = (await loginResp.json().catch(() => ({}))) as { token?: string };
  const setCookieHeader = loginResp.headers.get("set-cookie");
  const headers: Record<string, string> = {};
  if (loginJson.token) headers["Authorization"] = `Bearer ${loginJson.token}`;
  if (setCookieHeader) headers["Cookie"] = setCookieHeader.split(";")[0];

  const syncResp = await fetch(`${base}/api/sync?since=0`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(8000)
  });

  if (!syncResp.ok) {
    throw new Error(`时间簿只读同步接口返回错误（HTTP ${syncResp.status}）`);
  }

  return (await syncResp.json()) as TimebookSyncPayload;
}

async function getNormalizedTimebookData(cfg: TimebookConfigFull): Promise<NormalizedTimebookData> {
  const cacheKey = `${cfg.url}|${sha256(cfg.password).slice(0, 16)}`;
  const cached = syncCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
    return cached.data;
  }
  const payload = await loginAndPullTimebook(cfg);
  const data = normalizeSyncPayload(payload);
  syncCache.set(cacheKey, { fetchedAtMs: Date.now(), data });
  return data;
}

export async function testTimebookConnection(
  db: Database.Database,
  masterKey: Buffer,
  override?: Partial<TimebookConfigFull>
): Promise<{ ok: boolean; latencyMs: number; message: string; moduleCount: number }> {
  const saved = getTimebookConfigFull(db, masterKey);
  const cfg: TimebookConfigFull = {
    enabled: true,
    url: (override?.url ?? saved.url).trim().replace(/\/+$/, ""),
    password:
      override?.password && override.password !== "" && !override.password.includes("••••")
        ? override.password
        : saved.password
  };

  const t0 = performance.now();
  const payload = await loginAndPullTimebook(cfg);
  const data = normalizeSyncPayload(payload);
  const latencyMs = Math.max(1, Math.round(performance.now() - t0));
  return {
    ok: true,
    latencyMs,
    moduleCount: data.modules.length,
    message: `只读连接成功！已读取到 ${data.modules.length} 个模块、${data.tagMap.size} 个细分标签与 ${data.sessions.length} 条计时记录（耗时 ${latencyMs} ms）`
  };
}

function getPreviousMonthKey(ym: string): string {
  const [yStr, mStr] = ym.split("-");
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function computeTodosInRange(
  data: NormalizedTimebookData,
  matchesDate: (dateStr: string) => boolean,
  filterPred?: (item: { moduleName: string; tagName: string; title: string }) => boolean
): {
  total: number;
  done: number;
  rate: string;
  sampleItems: Array<{ title: string; date: string; done: boolean; moduleName: string; tagName: string }>;
} {
  const todoById = new Map(data.todos.map((t) => [t.id, t]));
  const checksByTodoId = new Map<string, Array<{ date: string; isDone: boolean }>>();
  for (const c of data.todoChecks) {
    if (c.date && !matchesDate(c.date)) continue;
    const arr = checksByTodoId.get(c.todoId) ?? [];
    arr.push({ date: c.date, isDone: c.isDone });
    checksByTodoId.set(c.todoId, arr);
  }

  let total = 0;
  let done = 0;
  const sampleItems: Array<{ title: string; date: string; done: boolean; moduleName: string; tagName: string }> = [];
  const handledRecurTodoIds = new Set<string>();

  for (const t of data.todos) {
    if (filterPred && !filterPred(t)) continue;
    if (t.recur) {
      handledRecurTodoIds.add(t.id);
      const checks = checksByTodoId.get(t.id) ?? [];
      for (const ch of checks) {
        total += 1;
        if (ch.isDone) done += 1;
        if (sampleItems.length < 8) {
          sampleItems.push({
            title: t.title || "周期习惯",
            date: ch.date,
            done: ch.isDone,
            moduleName: t.moduleName,
            tagName: t.tagName
          });
        }
      }
      continue;
    }

    if (t.dateStr && !matchesDate(t.dateStr)) continue;
    const checks = checksByTodoId.get(t.id) ?? [];
    const isDone = t.isDone || checks.some((ch) => ch.isDone);
    total += 1;
    if (isDone) done += 1;
    if (sampleItems.length < 8) {
      sampleItems.push({
        title: t.title || "未命名待办",
        date: t.dateStr,
        done: isDone,
        moduleName: t.moduleName,
        tagName: t.tagName
      });
    }
  }

  // 兜底未被 todos 列表关联的独立打卡记录
  for (const c of data.todoChecks) {
    if (c.date && !matchesDate(c.date)) continue;
    const parent = todoById.get(c.todoId);
    if (parent) {
      if (parent.recur) continue; // 已在上方周期习惯循环计数
      if (!parent.dateStr || matchesDate(parent.dateStr)) continue; // 已在普通待办计数
    }
    if (filterPred && parent && !filterPred(parent)) continue;
    total += 1;
    if (c.isDone) done += 1;
    if (sampleItems.length < 8) {
      sampleItems.push({
        title: parent?.title || "待办打卡",
        date: c.date,
        done: c.isDone,
        moduleName: parent?.moduleName || "其他模块",
        tagName: parent?.tagName || "未分类"
      });
    }
  }

  const rate = total > 0 ? `${Math.round((done / total) * 100)}%` : "暂无待办";
  return { total, done, rate, sampleItems };
}

export async function fetchTimebookSummary(
  db: Database.Database,
  masterKey: Buffer,
  params: { scope: "monthly" | "yearly"; periodKey: string }
): Promise<TimebookSummary> {
  const cfg = getTimebookConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.url || !cfg.password) {
    return {
      available: false,
      reason: "时间簿联动未开启，已平滑降级为纯日记复盘",
      totalHours: 0,
      todoTotal: 0,
      todoDone: 0,
      todoRate: "未联动",
      modules: []
    };
  }

  try {
    const data = await getNormalizedTimebookData(cfg);
    const prefix = params.periodKey; // YYYY-MM 或 YYYY
    const prevPrefix =
      params.scope === "monthly" ? getPreviousMonthKey(prefix) : String(Number(prefix) - 1);

    const curSecondsByMod = new Map<string, number>();
    const prevSecondsByMod = new Map<string, number>();

    for (const s of data.sessions) {
      const key = params.scope === "monthly" ? s.shanghaiMonth : s.shanghaiDate.slice(0, 4);
      if (key === prefix) {
        curSecondsByMod.set(s.moduleId, (curSecondsByMod.get(s.moduleId) ?? 0) + s.durationSec);
      } else if (key === prevPrefix) {
        prevSecondsByMod.set(s.moduleId, (prevSecondsByMod.get(s.moduleId) ?? 0) + s.durationSec);
      }
    }

    const totalSec = [...curSecondsByMod.values()].reduce((a, b) => a + b, 0);
    const totalHours = Math.round((totalSec / 3600) * 10) / 10;

    const modules: TimebookModuleMix[] = [...curSecondsByMod.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([modId, sec], idx) => {
        const mod = data.moduleMap.get(modId);
        const hours = Math.round((sec / 3600) * 10) / 10;
        const prevHours = Math.round(((prevSecondsByMod.get(modId) ?? 0) / 3600) * 10) / 10;
        const diff = Math.round((hours - prevHours) * 10) / 10;
        const delta = diff >= 0 ? `+${diff}h` : `${diff}h`;
        return {
          name: mod?.name || "其他模块",
          hours,
          pct: totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0,
          delta,
          color: mod?.color || MODULE_COLORS[idx % MODULE_COLORS.length]
        };
      });

    const todoRes = computeTodosInRange(data, (dateStr) => dateStr.startsWith(prefix));

    return {
      available: true,
      totalHours,
      todoTotal: todoRes.total,
      todoDone: todoRes.done,
      todoRate: todoRes.rate,
      modules
    };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : "时间簿离线，已自动降级为纯日记复盘",
      totalHours: 0,
      todoTotal: 0,
      todoDone: 0,
      todoRate: "已降级",
      modules: []
    };
  }
}

export interface TimebookQaResult {
  available: boolean;
  reason?: string;
  totalHours?: number;
  totalMinutes?: number;
  sessionCount?: number;
  avgSessionMinutes?: number;
  longestSession?: {
    date: string;
    hours: number;
    minutes: number;
    moduleName: string;
    tagName: string;
    title: string;
  } | null;
  byModule?: Array<{ name: string; hours: number; pct: number; sessionCount: number }>;
  byTag?: Array<{ name: string; moduleName: string; hours: number; minutes: number; sessionCount: number }>;
  topDays?: Array<{
    date: string;
    hours: number;
    minutes: number;
    sessionCount: number;
    sampleTitles: string[];
  }>;
  timeline?: Array<{ period: string; hours: number; minutes: number; sessionCount: number }>;
  todoSummary?: {
    total: number;
    done: number;
    rate: string;
    sampleItems: Array<{ title: string; date: string; done: boolean; moduleName: string; tagName: string }>;
  };
}

export async function queryTimebookForQa(
  db: Database.Database,
  masterKey: Buffer,
  params: {
    startDate?: string;
    endDate?: string;
    keyword?: string;
    groupBy?: "none" | "day" | "month";
  }
): Promise<TimebookQaResult> {
  const cfg = getTimebookConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.url || !cfg.password) {
    return { available: false, reason: "时间簿联动未开启" };
  }

  let data: NormalizedTimebookData;
  try {
    data = await getNormalizedTimebookData(cfg);
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : "时间簿服务连接失败，已平滑降级"
    };
  }

  const startDate = (params.startDate || "").trim();
  const endDate = (params.endDate || "").trim();
  const tokens = (params.keyword || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  const matchesDate = (d: string) => {
    if (!d) return false;
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const matchesTokens = (haystack: string) => {
    if (tokens.length === 0) return true;
    const lower = haystack.toLowerCase();
    return tokens.every((tk) => lower.includes(tk));
  };

  const matchedSessions = data.sessions.filter((s) => {
    if (!matchesDate(s.shanghaiDate)) return false;
    return matchesTokens(`${s.moduleName} ${s.tagName} ${s.title}`);
  });

  const totalSec = matchedSessions.reduce((acc, s) => acc + s.durationSec, 0);
  const totalMinutes = Math.round(totalSec / 60);
  const totalHours = Math.round((totalSec / 3600) * 10) / 10;
  const sessionCount = matchedSessions.length;
  const avgSessionMinutes = sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0;

  let longestSession: TimebookQaResult["longestSession"] = null;
  for (const s of matchedSessions) {
    if (!longestSession || s.durationSec > longestSession.minutes * 60) {
      longestSession = {
        date: s.shanghaiDate,
        hours: Math.round((s.durationSec / 3600) * 10) / 10,
        minutes: Math.round(s.durationSec / 60),
        moduleName: s.moduleName,
        tagName: s.tagName,
        title: s.title || s.tagName
      };
    }
  }

  const modMap = new Map<string, { sec: number; count: number }>();
  const tagAggMap = new Map<string, { name: string; moduleName: string; sec: number; count: number }>();
  const dayMap = new Map<string, { sec: number; count: number; titles: Set<string> }>();
  const periodMap = new Map<string, { sec: number; count: number }>();

  for (const s of matchedSessions) {
    const mEntry = modMap.get(s.moduleName) ?? { sec: 0, count: 0 };
    mEntry.sec += s.durationSec;
    mEntry.count += 1;
    modMap.set(s.moduleName, mEntry);

    const tagKey = `${s.moduleName}::${s.tagName}`;
    const tEntry = tagAggMap.get(tagKey) ?? {
      name: s.tagName,
      moduleName: s.moduleName,
      sec: 0,
      count: 0
    };
    tEntry.sec += s.durationSec;
    tEntry.count += 1;
    tagAggMap.set(tagKey, tEntry);

    const dEntry = dayMap.get(s.shanghaiDate) ?? { sec: 0, count: 0, titles: new Set<string>() };
    dEntry.sec += s.durationSec;
    dEntry.count += 1;
    if (s.title) dEntry.titles.add(s.title);
    else if (s.tagName && s.tagName !== "未分类") dEntry.titles.add(s.tagName);
    dayMap.set(s.shanghaiDate, dEntry);

    if (params.groupBy === "day" || params.groupBy === "month") {
      const pKey = params.groupBy === "day" ? s.shanghaiDate : s.shanghaiMonth;
      const pEntry = periodMap.get(pKey) ?? { sec: 0, count: 0 };
      pEntry.sec += s.durationSec;
      pEntry.count += 1;
      periodMap.set(pKey, pEntry);
    }
  }

  const byModule = [...modMap.entries()]
    .sort((a, b) => b[1].sec - a[1].sec)
    .slice(0, 10)
    .map(([name, info]) => ({
      name,
      hours: Math.round((info.sec / 3600) * 10) / 10,
      pct: totalSec > 0 ? Math.round((info.sec / totalSec) * 100) : 0,
      sessionCount: info.count
    }));

  const byTag = [...tagAggMap.values()]
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 15)
    .map((info) => ({
      name: info.name,
      moduleName: info.moduleName,
      hours: Math.round((info.sec / 3600) * 10) / 10,
      minutes: Math.round(info.sec / 60),
      sessionCount: info.count
    }));

  const topDays = [...dayMap.entries()]
    .sort((a, b) => b[1].sec - a[1].sec)
    .slice(0, 10)
    .map(([date, info]) => ({
      date,
      hours: Math.round((info.sec / 3600) * 10) / 10,
      minutes: Math.round(info.sec / 60),
      sessionCount: info.count,
      sampleTitles: [...info.titles].slice(0, 4)
    }));

  const timeline =
    params.groupBy === "day" || params.groupBy === "month"
      ? [...periodMap.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 40)
          .map(([period, info]) => ({
            period,
            hours: Math.round((info.sec / 3600) * 10) / 10,
            minutes: Math.round(info.sec / 60),
            sessionCount: info.count
          }))
      : undefined;

  const todoSummary = computeTodosInRange(
    data,
    (dateStr) => (!dateStr ? true : matchesDate(dateStr)),
    (item) => matchesTokens(`${item.moduleName} ${item.tagName} ${item.title}`)
  );

  return {
    available: true,
    totalHours,
    totalMinutes,
    sessionCount,
    avgSessionMinutes,
    longestSession,
    byModule,
    byTag,
    topDays,
    ...(timeline ? { timeline } : {}),
    todoSummary
  };
}

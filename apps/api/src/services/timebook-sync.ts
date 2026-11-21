import type Database from "better-sqlite3";
import type { TimebookConfigPublic, TimebookModuleMix, TimebookSummary } from "@lifebook/core";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto.js";

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

  return getTimebookConfigPublic(db, masterKey);
}

interface TimebookSyncPayload {
  modules?: Array<{ id: string; name: string; color?: string; deletedAt?: string | null }>;
  sessions?: Array<{
    id: string;
    moduleId?: string;
    module_id?: string;
    startedAt?: string;
    startTime?: string;
    endedAt?: string;
    endTime?: string;
    durationSeconds?: number;
    durationMs?: number;
    deletedAt?: string | null;
  }>;
  todos?: Array<{
    id: string;
    completed?: boolean;
    done?: boolean;
    dueDate?: string;
    createdAt?: string;
    deletedAt?: string | null;
  }>;
  todoChecks?: Array<{
    id: string;
    todoId?: string;
    date?: string;
    checked?: boolean;
    deletedAt?: string | null;
  }>;
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

export async function testTimebookConnection(
  db: Database.Database,
  masterKey: Buffer,
  override?: Partial<TimebookConfigFull>
): Promise<{ ok: boolean; latencyMs: number; message: string; moduleCount: number }> {
  const saved = getTimebookConfigFull(db, masterKey);
  const cfg: TimebookConfigFull = {
    enabled: true,
    url: (override?.url ?? saved.url).trim(),
    password:
      override?.password && override.password !== "" && !override.password.includes("••••")
        ? override.password
        : saved.password
  };

  const t0 = performance.now();
  const payload = await loginAndPullTimebook(cfg);
  const latencyMs = Math.max(1, Math.round(performance.now() - t0));
  const activeModules = (payload.modules ?? []).filter((m) => !m.deletedAt);
  return {
    ok: true,
    latencyMs,
    moduleCount: activeModules.length,
    message: `只读连接成功！已读取到 ${activeModules.length} 个时间簿模块与最近计时记录（耗时 ${latencyMs} ms）`
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
    const payload = await loginAndPullTimebook(cfg);
    const activeModules = (payload.modules ?? []).filter((m) => !m.deletedAt);
    const moduleMap = new Map(activeModules.map((m) => [m.id, m]));

    const prefix = params.periodKey; // YYYY-MM 或 YYYY
    const prevPrefix = params.scope === "monthly" ? getPreviousMonthKey(prefix) : String(Number(prefix) - 1);

    const curSecondsByMod = new Map<string, number>();
    const prevSecondsByMod = new Map<string, number>();

    for (const s of payload.sessions ?? []) {
      if (s.deletedAt) continue;
      const startStr = (s.startedAt || s.startTime || "").slice(0, prefix.length);
      const modId = s.moduleId || s.module_id || "unknown";
      let durSec = s.durationSeconds ?? (s.durationMs ? s.durationMs / 1000 : 0);
      if (!durSec && (s.startedAt || s.startTime) && (s.endedAt || s.endTime)) {
        const t1 = Date.parse(s.startedAt || s.startTime || "");
        const t2 = Date.parse(s.endedAt || s.endTime || "");
        if (!Number.isNaN(t1) && !Number.isNaN(t2) && t2 > t1) {
          durSec = (t2 - t1) / 1000;
        }
      }
      if (durSec <= 0) continue;

      if (startStr === prefix) {
        curSecondsByMod.set(modId, (curSecondsByMod.get(modId) ?? 0) + durSec);
      } else if (startStr === prevPrefix) {
        prevSecondsByMod.set(modId, (prevSecondsByMod.get(modId) ?? 0) + durSec);
      }
    }

    const totalSec = [...curSecondsByMod.values()].reduce((a, b) => a + b, 0);
    const totalHours = Math.round((totalSec / 3600) * 10) / 10;

    const modules: TimebookModuleMix[] = [...curSecondsByMod.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([modId, sec], idx) => {
        const mod = moduleMap.get(modId);
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

    // 统计待办完成率
    const activeTodos = (payload.todos ?? []).filter((t) => {
      if (t.deletedAt) return false;
      const dateStr = (t.dueDate || t.createdAt || "").slice(0, prefix.length);
      return !dateStr || dateStr === prefix;
    });
    const periodChecks = (payload.todoChecks ?? []).filter(
      (c) => !c.deletedAt && (!c.date || c.date.startsWith(prefix))
    );
    let todoTotal = activeTodos.length;
    let todoDone = activeTodos.filter((t) => t.completed || t.done).length;
    if (periodChecks.length > 0) {
      todoTotal = Math.max(todoTotal, periodChecks.length);
      todoDone = Math.max(todoDone, periodChecks.filter((c) => c.checked !== false).length);
    }
    const todoRate = todoTotal > 0 ? `${Math.round((todoDone / todoTotal) * 100)}%` : "暂无待办";

    return {
      available: true,
      totalHours,
      todoTotal,
      todoDone,
      todoRate,
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

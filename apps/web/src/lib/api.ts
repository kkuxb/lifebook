import type {
  AiConfigPublic,
  AiProviderType,
  EntryKind,
  EntryRecord,
  EntrySnapshot,
  HighlightItem,
  MonthlyReviewData,
  MoodItem,
  QaResponse,
  TagItem,
  TemplateItem,
  TimebookConfigPublic,
  YearlyReviewData
} from "@lifebook/core";

const TOKEN_STORAGE_KEY = "lifebook_auth_token";

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(url, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error || `请求失败（HTTP ${resp.status}）`, resp.status);
  }
  return (await resp.json()) as T;
}

export const api = {
  authMe: () => requestJson<{ initialized: boolean; authenticated: boolean }>("/api/auth/me"),
  setupPassword: async (password: string) => {
    const res = await requestJson<{ ok: boolean; token: string }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    setStoredToken(res.token);
    return res;
  },
  login: async (password: string) => {
    const res = await requestJson<{ ok: boolean; token: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    setStoredToken(res.token);
    return res;
  },
  logout: async () => {
    setStoredToken("");
    return requestJson<{ ok: boolean }>("/api/logout", { method: "POST" });
  },

  listEntries: (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== "all") sp.set(k, String(v));
    }
    return requestJson<{
      items: EntryRecord[];
      total: number;
      totalWords: number;
      elapsedMs: number;
      page: number;
      pageSize: number;
    }>(`/api/entries?${sp.toString()}`);
  },
  getEntryById: (id: string) => requestJson<EntryRecord>(`/api/entries/${encodeURIComponent(id)}`),
  getEntryByDate: (date: string) =>
    requestJson<{ entry: EntryRecord | null; onThisDay: EntryRecord[] }>(
      `/api/entries/by-date/${encodeURIComponent(date)}`
    ),
  saveEntry: (payload: {
    id?: string;
    kind: EntryKind;
    date: string;
    title: string;
    contentHtml: string;
    tags: string[];
    moods: string[];
    createSnapshot?: boolean;
  }) => {
    if (payload.id) {
      return requestJson<EntryRecord>(`/api/entries/${encodeURIComponent(payload.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    }
    return requestJson<EntryRecord>("/api/entries", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  deleteEntry: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/entries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listSnapshots: (entryId: string) =>
    requestJson<{ items: EntrySnapshot[] }>(
      `/api/entries/${encodeURIComponent(entryId)}/snapshots`
    ),
  restoreSnapshot: (entryId: string, snapId: string) =>
    requestJson<EntryRecord>(
      `/api/entries/${encodeURIComponent(entryId)}/snapshots/${encodeURIComponent(snapId)}/restore`,
      { method: "POST" }
    ),
  refreshEntryDigest: (entryId: string) =>
    requestJson(`/api/entries/${encodeURIComponent(entryId)}/digest/refresh`, { method: "POST" }),

  uploadImageFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return requestJson<{ url: string; filename: string; size: number }>("/api/uploads", {
      method: "POST",
      body: form
    });
  },

  listTags: () => requestJson<{ items: TagItem[] }>("/api/tags"),
  createTag: (input: { name: string; colorKey?: string }) =>
    requestJson<TagItem>("/api/tags", { method: "POST", body: JSON.stringify(input) }),
  updateTag: (id: string, input: { name?: string; colorKey?: string; enabled?: boolean }) =>
    requestJson<TagItem>(`/api/tags/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteTag: (id: string, replaceWithId?: string) =>
    requestJson<{ deletedId: string; migratedCount: number }>(
      `/api/tags/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ replaceWithId })
      }
    ),

  listMoods: () => requestJson<{ items: MoodItem[] }>("/api/moods"),
  createMood: (input: { emoji: string; name: string; tone?: string }) =>
    requestJson<MoodItem>("/api/moods", { method: "POST", body: JSON.stringify(input) }),
  updateMood: (id: string, input: { emoji?: string; name?: string; tone?: string }) =>
    requestJson<MoodItem>(`/api/moods/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteMood: (id: string, replaceWithId?: string) =>
    requestJson<{ deletedId: string; migratedCount: number }>(
      `/api/moods/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ replaceWithId })
      }
    ),

  listTemplates: () => requestJson<{ items: TemplateItem[] }>("/api/templates"),
  updateTemplate: (id: string, input: { name?: string; desc?: string; sections: string[] }) =>
    requestJson<TemplateItem>(`/api/templates/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),

  getHeatmap: (year: string) =>
    requestJson<{
      year: string;
      availableYears: string[];
      cells: Record<
        string,
        {
          date: string;
          entryId: string;
          wordCount: number;
          title: string;
          shortTitle: string;
          aiReady: boolean;
          mood: string;
          moodTone: string;
          tags: string[];
        }
      >;
      summary: { count: number; totalWords: number; avgWords: number; maxStreak: number };
    }>(`/api/stats/heatmap?year=${encodeURIComponent(year)}`),

  getOverviewStats: (year: string) =>
    requestJson<{
      year: string;
      availableYears: string[];
      count: number;
      totalWords: number;
      avgWords: number;
      maxWords: number;
      monthlyWords: number[];
      monthlyThousandWords: number[];
      moodDistribution: Array<{ id: string; label: string; tone: string; count: number }>;
      topTopics: Array<{ word: string; count: number }>;
    }>(`/api/stats/overview?year=${encodeURIComponent(year)}`),

  getContentInsights: () =>
    requestJson<{
      positiveTriggers: Array<{ entryId: string; date: string; title: string; text: string }>;
      drainSignals: Array<{ entryId: string; date: string; title: string; text: string }>;
    }>("/api/stats/insights"),

  previewImportZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return requestJson<{
      previewId: string;
      filename: string;
      totalParsed: number;
      blankDraftsFiltered: number;
      attachmentCount: number;
      moodStats: Array<{ oldLabel: string; defaultNewLabel: string; count: number }>;
      conflicts: Array<{
        date: string;
        existingId: string;
        existingTitle: string;
        existingWords: number;
        incomingTempId: string;
        incomingTitle: string;
        incomingWords: number;
        defaultStrategy: "skip" | "overwrite" | "merge";
      }>;
      sampleItems: Array<{
        date: string;
        rawTitle: string;
        cleanTitle: string;
        mappedMoods: string[];
        tags: string[];
        wordCount: number;
      }>;
    }>("/api/import/preview", { method: "POST", body: form });
  },
  commitImportZip: (input: {
    previewId: string;
    conflictDecisions?: Record<string, "skip" | "overwrite" | "merge">;
    moodMapping?: Record<string, string>;
  }) =>
    requestJson<{
      batchId: string;
      importedCount: number;
      skippedCount: number;
      overwrittenCount: number;
      mergedCount: number;
    }>("/api/import/commit", { method: "POST", body: JSON.stringify(input) }),
  listImportBatches: () =>
    requestJson<{
      items: Array<{
        id: string;
        filename: string;
        totalCount: number;
        importedCount: number;
        skippedCount: number;
        overwrittenCount: number;
        mergedCount: number;
        createdAt: string;
      }>;
    }>("/api/import/batches"),
  undoImportBatch: (batchId: string) =>
    requestJson<{ ok: boolean; deletedEntries: number; restoredEntries: number }>(
      `/api/import/batches/${encodeURIComponent(batchId)}`,
      { method: "DELETE" }
    ),

  getBackupStatus: () =>
    requestJson<{
      backupsDir: string;
      items: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
    }>("/api/backup/status"),
  runBackup: () =>
    requestJson<{
      ok: boolean;
      filename: string;
      sizeBytes: number;
      cleanedSnapshots: number;
      purgedTrash: number;
    }>("/api/backup/run", { method: "POST" }),
  listTrash: () =>
    requestJson<{
      items: Array<{
        id: string;
        kind: EntryKind;
        date: string;
        title: string;
        wordCount: number;
        deletedAt: string;
      }>;
    }>("/api/trash"),
  restoreTrash: (id: string) =>
    requestJson<EntryRecord>(`/api/trash/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  deleteTrashPermanent: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getAiConfig: () => requestJson<AiConfigPublic>("/api/settings/ai"),
  saveAiConfig: (input: {
    enabled?: boolean;
    provider?: AiProviderType;
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
  }) => requestJson<AiConfigPublic>("/api/settings/ai", { method: "PUT", body: JSON.stringify(input) }),
  testAiConnection: (input?: {
    provider?: AiProviderType;
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
  }) =>
    requestJson<{ ok: boolean; latencyMs: number; message: string }>("/api/settings/ai/test", {
      method: "POST",
      body: JSON.stringify(input || {})
    }),
  getBatchStatus: () =>
    requestJson<{
      running: boolean;
      paused: boolean;
      total: number;
      done: number;
      failed: number;
      lastError: string;
      currentDate: string;
      failedItems?: Array<{ date: string; entryId: string; error: string }>;
    }>("/api/ai/batch/status"),
  startBatch: () =>
    requestJson<{
      running: boolean;
      paused: boolean;
      total: number;
      done: number;
      failed: number;
      lastError: string;
      currentDate: string;
      failedItems?: Array<{ date: string; entryId: string; error: string }>;
    }>("/api/ai/batch/start", { method: "POST" }),
  pauseBatch: () =>
    requestJson<{
      running: boolean;
      paused: boolean;
      total: number;
      done: number;
      failed: number;
      lastError: string;
      currentDate: string;
      failedItems?: Array<{ date: string; entryId: string; error: string }>;
    }>("/api/ai/batch/pause", { method: "POST" }),
  askMemoryQa: (question: string) =>
    requestJson<QaResponse>("/api/ai/qa", {
      method: "POST",
      body: JSON.stringify({ question })
    }),

  getTimebookConfig: () => requestJson<TimebookConfigPublic>("/api/settings/timebook"),
  saveTimebookConfig: (input: { enabled?: boolean; url?: string; password?: string }) =>
    requestJson<TimebookConfigPublic>("/api/settings/timebook", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  testTimebookConnection: (input?: { url?: string; password?: string }) =>
    requestJson<{ ok: boolean; latencyMs: number; message: string; moduleCount: number }>(
      "/api/settings/timebook/test",
      { method: "POST", body: JSON.stringify(input || {}) }
    ),

  getMonthlyReview: (ym: string) =>
    requestJson<MonthlyReviewData>(`/api/reviews/monthly/${encodeURIComponent(ym)}`),
  generateMonthlyReview: (ym: string) =>
    requestJson<MonthlyReviewData>(`/api/reviews/monthly/${encodeURIComponent(ym)}/generate`, {
      method: "POST"
    }),
  getYearlyReview: (year: string) =>
    requestJson<YearlyReviewData>(`/api/reviews/yearly/${encodeURIComponent(year)}`),
  generateYearlyReview: (year: string) =>
    requestJson<YearlyReviewData>(`/api/reviews/yearly/${encodeURIComponent(year)}/generate`, {
      method: "POST"
    }),
  pinHighlight: (scope: "monthly" | "yearly", periodKey: string, entryId: string) =>
    requestJson<{ ok: boolean; highlights: HighlightItem[] }>(
      `/api/reviews/${scope}/${encodeURIComponent(periodKey)}/highlights/pin`,
      { method: "POST", body: JSON.stringify({ entryId }) }
    ),
  unpinHighlight: (scope: "monthly" | "yearly", periodKey: string, entryId: string) =>
    requestJson<{ ok: boolean; highlights: HighlightItem[] }>(
      `/api/reviews/${scope}/${encodeURIComponent(periodKey)}/highlights/unpin`,
      { method: "POST", body: JSON.stringify({ entryId }) }
    ),
  excludeHighlight: (scope: "monthly" | "yearly", periodKey: string, entryId: string) =>
    requestJson<{ ok: boolean; highlights: HighlightItem[] }>(
      `/api/reviews/${scope}/${encodeURIComponent(periodKey)}/highlights/exclude`,
      { method: "POST", body: JSON.stringify({ entryId }) }
    )
};

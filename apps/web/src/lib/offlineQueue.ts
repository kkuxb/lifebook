import type { EntryKind, EntryRecord } from "@lifebook/core";
import { api, ApiError } from "./api";

export interface OfflineDraftPayload {
  queueKey: string;
  id?: string;
  kind: EntryKind;
  date: string;
  title: string;
  contentHtml: string;
  tags: string[];
  moods: string[];
  updatedAt: number;
}

const QUEUE_KEY = "lifebook_offline_queue_v1";

export function readOfflineQueue(): OfflineDraftPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineDraftPayload[]) : [];
  } catch {
    return [];
  }
}

function writeOfflineQueue(list: OfflineDraftPayload[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota error
  }
}

export function enqueueOfflineDraft(draft: Omit<OfflineDraftPayload, "queueKey" | "updatedAt">): OfflineDraftPayload[] {
  const queueKey = draft.id ? `id:${draft.id}` : `${draft.kind}:${draft.date}`;
  const list = readOfflineQueue().filter(
    (item) => item.queueKey !== queueKey && !(draft.kind === "daily" && item.kind === "daily" && item.date === draft.date)
  );
  list.push({
    ...draft,
    queueKey,
    updatedAt: Date.now()
  });
  writeOfflineQueue(list);
  return list;
}

export function removeOfflineDraft(draft: { id?: string; kind: EntryKind; date: string }): void {
  const list = readOfflineQueue().filter(
    (item) =>
      !(draft.id && item.id === draft.id) &&
      !(draft.kind === "daily" && item.kind === "daily" && item.date === draft.date)
  );
  writeOfflineQueue(list);
}

export function findOfflineDraft(params: { id?: string; kind?: EntryKind; date?: string }): OfflineDraftPayload | null {
  const list = readOfflineQueue();
  if (params.id) {
    const byId = list.find((x) => x.id === params.id);
    if (byId) return byId;
  }
  if (params.kind === "daily" && params.date) {
    return list.find((x) => x.kind === "daily" && x.date === params.date) ?? null;
  }
  return null;
}

export async function flushOfflineQueue(): Promise<{
  syncedCount: number;
  remainingCount: number;
  syncedEntries: EntryRecord[];
}> {
  const list = readOfflineQueue();
  if (!list.length) {
    return { syncedCount: 0, remainingCount: 0, syncedEntries: [] };
  }

  const remaining: OfflineDraftPayload[] = [];
  const syncedEntries: EntryRecord[] = [];
  let syncedCount = 0;

  for (const item of list) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      remaining.push(item);
      continue;
    }
    try {
      const saved = await api.saveEntry({
        id: item.id,
        kind: item.kind,
        date: item.date,
        title: item.title,
        contentHtml: item.contentHtml,
        tags: item.tags,
        moods: item.moods,
        createSnapshot: true
      });
      syncedCount++;
      syncedEntries.push(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        // 客户端校验类错误不无限重试
      } else {
        remaining.push(item);
      }
    }
  }

  writeOfflineQueue(remaining);
  return { syncedCount, remainingCount: remaining.length, syncedEntries };
}

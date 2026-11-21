import type Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  countWords,
  getShanghaiNowParts,
  stripHtml,
  type EntryAiDigest,
  type EntryKind,
  type EntryRecord,
  type EntrySnapshot
} from "@lifebook/core";
import { buildFtsMatchQuery, tokenizeForFts } from "../db/schema.js";

interface RawEntryRow {
  id: string;
  kind: EntryKind;
  date: string;
  title: string;
  content_html: string;
  content_text: string;
  word_count: number;
  import_batch: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RawDigestRow {
  entry_id: string;
  content_hash: string;
  short_title: string;
  summary: string;
  dim_life: string;
  dim_work: string;
  dim_leisure: string;
  dim_people_notes: string;
  key_events_json: string;
  topics_json: string;
  reflection: string;
  updated_at: string;
}

export function hydrateEntries(db: Database.Database, rows: RawEntryRow[]): EntryRecord[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  const tagRows = db
    .prepare(
      `SELECT et.entry_id, t.name FROM entry_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE et.entry_id IN (${placeholders})
       ORDER BY t.sort ASC, t.name ASC`
    )
    .all(...ids) as Array<{ entry_id: string; name: string }>;

  const moodRows = db
    .prepare(
      `SELECT em.entry_id, m.label FROM entry_moods em
       JOIN moods m ON m.id = em.mood_id
       WHERE em.entry_id IN (${placeholders})
       ORDER BY m.sort ASC, m.label ASC`
    )
    .all(...ids) as Array<{ entry_id: string; label: string }>;

  const digestRows = db
    .prepare(`SELECT * FROM entry_ai_digests WHERE entry_id IN (${placeholders})`)
    .all(...ids) as RawDigestRow[];

  const tagsMap = new Map<string, string[]>();
  for (const r of tagRows) {
    const arr = tagsMap.get(r.entry_id) ?? [];
    arr.push(r.name);
    tagsMap.set(r.entry_id, arr);
  }

  const moodsMap = new Map<string, string[]>();
  for (const r of moodRows) {
    const arr = moodsMap.get(r.entry_id) ?? [];
    arr.push(r.label);
    moodsMap.set(r.entry_id, arr);
  }

  const digestMap = new Map<string, EntryAiDigest>();
  for (const d of digestRows) {
    digestMap.set(d.entry_id, {
      entryId: d.entry_id,
      contentHash: d.content_hash,
      shortTitle: d.short_title,
      summary: d.summary,
      dimLife: d.dim_life,
      dimWork: d.dim_work,
      dimLeisure: d.dim_leisure,
      dimPeopleNotes: d.dim_people_notes,
      keyEvents: safeParseJson(d.key_events_json, []),
      topics: safeParseJson(d.topics_json, []),
      reflection: d.reflection,
      updatedAt: d.updated_at
    });
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    date: r.date,
    title: r.title,
    contentHtml: r.content_html,
    contentText: r.content_text,
    wordCount: r.word_count,
    importBatch: r.import_batch,
    tags: tagsMap.get(r.id) ?? [],
    moods: moodsMap.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    digest: digestMap.get(r.id) ?? null
  }));
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function syncEntryFts(
  db: Database.Database,
  entryId: string,
  title: string,
  contentText: string
): void {
  db.prepare("DELETE FROM entries_fts WHERE entry_id = ?").run(entryId);
  db.prepare("INSERT INTO entries_fts (entry_id, title, content_text) VALUES (?, ?, ?)").run(
    entryId,
    tokenizeForFts(title),
    tokenizeForFts(contentText)
  );
}

export function removeEntryFts(db: Database.Database, entryId: string): void {
  db.prepare("DELETE FROM entries_fts WHERE entry_id = ?").run(entryId);
}

export interface ListEntriesQuery {
  q?: string;
  startDate?: string;
  endDate?: string;
  kind?: string;
  tag?: string;
  mood?: string;
  sortBy?: "date_desc" | "date_asc" | "words_desc" | "words_asc";
  minWords?: number;
  maxWords?: number;
  fuzzyTagMood?: boolean;
  page?: number;
  pageSize?: number;
}

export function listEntries(
  db: Database.Database,
  query: ListEntriesQuery
): {
  items: EntryRecord[];
  total: number;
  totalWords: number;
  elapsedMs: number;
  page: number;
  pageSize: number;
} {
  const startedAt = performance.now();
  const where: string[] = ["e.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (query.kind && query.kind !== "all") {
    where.push("e.kind = ?");
    params.push(query.kind);
  }
  if (query.startDate) {
    where.push("e.date >= ?");
    params.push(query.startDate);
  }
  if (query.endDate) {
    where.push("e.date <= ?");
    params.push(query.endDate);
  }
  if (query.tag && query.tag !== "all") {
    if (query.fuzzyTagMood) {
      where.push(
        `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND (t.name = ? OR t.id = ? OR t.name LIKE ?))`
      );
      params.push(query.tag, query.tag, `%${query.tag}%`);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND (t.name = ? OR t.id = ?))`
      );
      params.push(query.tag, query.tag);
    }
  }
  if (query.mood && query.mood !== "all") {
    if (query.fuzzyTagMood) {
      where.push(
        `EXISTS (SELECT 1 FROM entry_moods em JOIN moods m ON m.id = em.mood_id WHERE em.entry_id = e.id AND (m.label = ? OR m.id = ? OR m.name = ? OR m.label LIKE ?))`
      );
      params.push(query.mood, query.mood, query.mood, `%${query.mood}%`);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM entry_moods em JOIN moods m ON m.id = em.mood_id WHERE em.entry_id = e.id AND (m.label = ? OR m.id = ? OR m.name = ?))`
      );
      params.push(query.mood, query.mood, query.mood);
    }
  }
  if (typeof query.minWords === "number" && Number.isFinite(query.minWords)) {
    where.push("e.word_count >= ?");
    params.push(Math.max(0, Math.floor(query.minWords)));
  }
  if (typeof query.maxWords === "number" && Number.isFinite(query.maxWords)) {
    where.push("e.word_count <= ?");
    params.push(Math.max(0, Math.floor(query.maxWords)));
  }

  const q = (query.q ?? "").trim();
  if (q) {
    const terms = [...new Set(q.split(/\s+/).filter(Boolean))].slice(0, 6);
    const ftsParts: string[] = [];
    for (const term of terms) {
      // 纯数字/日期片段可能只出现在 e.date 列而不在 FTS5 正文索引里，不强加进 FTS AND 条件
      if (!/^\d{2,4}(-\d{1,2}){0,2}$/.test(term)) {
        const fq = buildFtsMatchQuery(term);
        if (fq) ftsParts.push(fq);
      }
      const likePattern = `%${term}%`;
      where.push(`(e.title LIKE ? OR e.content_text LIKE ? OR e.date LIKE ?)`);
      params.push(likePattern, likePattern, likePattern);
    }
    if (ftsParts.length > 0) {
      where.push(`e.id IN (SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ?)`);
      params.push([...new Set(ftsParts)].join(" AND "));
    }
  }

  const whereSql = where.join(" AND ");
  const statsRow = db
    .prepare(`SELECT COUNT(*) as total, COALESCE(SUM(e.word_count), 0) as totalWords FROM entries e WHERE ${whereSql}`)
    .get(...params) as { total: number; totalWords: number };

  const orderSql =
    query.sortBy === "date_asc"
      ? "e.date ASC, e.updated_at ASC"
      : query.sortBy === "words_desc"
        ? "e.word_count DESC, e.date DESC"
        : query.sortBy === "words_asc"
          ? "e.word_count ASC, e.date DESC"
          : "e.date DESC, e.updated_at DESC";

  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 50)));
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as RawEntryRow[];

  const items = hydrateEntries(db, rows);
  const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
  return {
    items,
    total: statsRow.total,
    totalWords: statsRow.totalWords,
    elapsedMs,
    page,
    pageSize
  };
}

export function getEntryById(db: Database.Database, id: string): EntryRecord | null {
  const row = db
    .prepare("SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL")
    .get(id) as RawEntryRow | undefined;
  if (!row) return null;
  return hydrateEntries(db, [row])[0] ?? null;
}

export function getEntryAndOtdByDate(
  db: Database.Database,
  date: string
): { entry: EntryRecord | null; onThisDay: EntryRecord[] } {
  const row = db
    .prepare("SELECT * FROM entries WHERE kind = 'daily' AND date = ? AND deleted_at IS NULL")
    .get(date) as RawEntryRow | undefined;
  const entry = row ? hydrateEntries(db, [row])[0] ?? null : null;

  const md = date.slice(5); // MM-DD
  const otdRows = db
    .prepare(
      `SELECT * FROM entries
       WHERE kind = 'daily' AND deleted_at IS NULL AND substr(date, 6, 5) = ? AND date != ?
       ORDER BY date DESC`
    )
    .all(md, date) as RawEntryRow[];

  return {
    entry,
    onThisDay: hydrateEntries(db, otdRows)
  };
}

export interface UpsertEntryInput {
  id?: string;
  kind: EntryKind;
  date: string;
  title?: string;
  contentHtml: string;
  tags?: string[];
  moods?: string[];
  importBatch?: string | null;
  createSnapshot?: boolean;
  /** 可选覆盖当日上海日期（仅用于验证或系统任务，默认为 Asia/Shanghai 当天） */
  snapshotDateOverride?: string;
}

export function upsertEntry(db: Database.Database, input: UpsertEntryInput): EntryRecord {
  const now = new Date().toISOString();
  const shanghaiToday = input.snapshotDateOverride || getShanghaiNowParts().date;
  const contentText = stripHtml(input.contentHtml);
  const wordCount = countWords(contentText);
  const title = (input.title ?? "").trim();

  const tx = db.transaction((): string => {
    let targetId = input.id?.trim() || "";

    if (input.kind === "daily") {
      const existingByDate = db
        .prepare("SELECT id FROM entries WHERE kind = 'daily' AND date = ? AND deleted_at IS NULL")
        .get(input.date) as { id: string } | undefined;
      if (existingByDate) {
        targetId = existingByDate.id;
      }
    }

    const existingRow = targetId
      ? (db.prepare("SELECT id FROM entries WHERE id = ?").get(targetId) as { id: string } | undefined)
      : undefined;

    if (existingRow) {
      db.prepare(
        `UPDATE entries
         SET kind = ?, date = ?, title = ?, content_html = ?, content_text = ?, word_count = ?, updated_at = ?, deleted_at = NULL
         WHERE id = ?`
      ).run(input.kind, input.date, title, input.contentHtml, contentText, wordCount, now, targetId);
    } else {
      targetId = targetId || `${input.kind === "daily" ? "d" : "s"}-${ulid()}`;
      db.prepare(
        `INSERT INTO entries (id, kind, date, title, content_html, content_text, word_count, import_batch, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        targetId,
        input.kind,
        input.date,
        title,
        input.contentHtml,
        contentText,
        wordCount,
        input.importBatch ?? null,
        now,
        now
      );
    }

    // 同步标签与心情关联
    if (Array.isArray(input.tags)) {
      db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(targetId);
      const findTag = db.prepare("SELECT id FROM tags WHERE name = ? OR id = ?");
      const insEt = db.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
      for (const tName of input.tags) {
        const clean = tName.trim();
        if (!clean) continue;
        const found = findTag.get(clean, clean) as { id: string } | undefined;
        if (found) insEt.run(targetId, found.id);
      }
    }

    if (Array.isArray(input.moods)) {
      db.prepare("DELETE FROM entry_moods WHERE entry_id = ?").run(targetId);
      const findMood = db.prepare("SELECT id FROM moods WHERE label = ? OR id = ? OR name = ?");
      const insEm = db.prepare("INSERT OR IGNORE INTO entry_moods (entry_id, mood_id) VALUES (?, ?)");
      for (const mName of input.moods) {
        const clean = mName.trim();
        if (!clean) continue;
        const found = findMood.get(clean, clean, clean) as { id: string } | undefined;
        if (found) insEm.run(targetId, found.id);
      }
    }

    // 同步 FTS5
    syncEntryFts(db, targetId, title, contentText);

    // C-18：清理早于今日（Asia/Shanghai）的历史快照，并只保留同 entry_id 当日最新 5 份
    if (input.createSnapshot !== false) {
      cleanupExpiredSnapshots(db, shanghaiToday);
      const snapId = `snap-${ulid()}`;
      db.prepare(
        `INSERT INTO entry_snapshots (id, entry_id, snapshot_date, title, content_html, word_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(snapId, targetId, shanghaiToday, title, input.contentHtml, wordCount, now);

      db.prepare(
        `DELETE FROM entry_snapshots
         WHERE entry_id = ? AND snapshot_date = ?
           AND id NOT IN (
             SELECT id FROM entry_snapshots
             WHERE entry_id = ? AND snapshot_date = ?
             ORDER BY created_at DESC, rowid DESC
             LIMIT 5
           )`
      ).run(targetId, shanghaiToday, targetId, shanghaiToday);
    }

    return targetId;
  });

  const savedId = tx();
  return getEntryById(db, savedId)!;
}

export function cleanupExpiredSnapshots(
  db: Database.Database,
  todayShanghai?: string
): number {
  const today = todayShanghai || getShanghaiNowParts().date;
  const info = db
    .prepare("DELETE FROM entry_snapshots WHERE snapshot_date < ?")
    .run(today);
  return info.changes;
}

export function listEntrySnapshots(
  db: Database.Database,
  entryId: string,
  todayShanghai?: string
): EntrySnapshot[] {
  const today = todayShanghai || getShanghaiNowParts().date;
  cleanupExpiredSnapshots(db, today);
  const rows = db
    .prepare(
      `SELECT id, entry_id, snapshot_date, title, content_html, word_count, created_at
       FROM entry_snapshots
       WHERE entry_id = ? AND snapshot_date = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 5`
    )
    .all(entryId, today) as Array<{
    id: string;
    entry_id: string;
    snapshot_date: string;
    title: string;
    content_html: string;
    word_count: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    snapshotDate: r.snapshot_date,
    title: r.title,
    contentHtml: r.content_html,
    wordCount: r.word_count,
    createdAt: r.created_at
  }));
}

export function restoreEntrySnapshot(
  db: Database.Database,
  entryId: string,
  snapId: string
): EntryRecord | null {
  const snap = db
    .prepare("SELECT * FROM entry_snapshots WHERE id = ? AND entry_id = ?")
    .get(snapId, entryId) as
    | { title: string; content_html: string }
    | undefined;
  if (!snap) return null;
  const existing = getEntryById(db, entryId);
  if (!existing) return null;
  return upsertEntry(db, {
    id: existing.id,
    kind: existing.kind,
    date: existing.date,
    title: snap.title,
    contentHtml: snap.content_html,
    tags: existing.tags,
    moods: existing.moods,
    createSnapshot: true
  });
}

export function softDeleteEntry(db: Database.Database, id: string): boolean {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const res = db
      .prepare("UPDATE entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now, id);
    if (res.changes > 0) {
      removeEntryFts(db, id);
      return true;
    }
    return false;
  });
  return tx();
}

export function listTrashEntries(db: Database.Database): Array<{
  id: string;
  kind: EntryKind;
  date: string;
  title: string;
  wordCount: number;
  deletedAt: string;
}> {
  purgeExpiredTrash(db);
  const rows = db
    .prepare(
      `SELECT id, kind, date, title, word_count, deleted_at
       FROM entries
       WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`
    )
    .all() as Array<{
    id: string;
    kind: EntryKind;
    date: string;
    title: string;
    word_count: number;
    deleted_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    date: r.date,
    title: r.title,
    wordCount: r.word_count,
    deletedAt: r.deleted_at
  }));
}

export function restoreTrashEntry(db: Database.Database, id: string): EntryRecord | null {
  const row = db
    .prepare("SELECT * FROM entries WHERE id = ? AND deleted_at IS NOT NULL")
    .get(id) as RawEntryRow | undefined;
  if (!row) return null;

  const tx = db.transaction(() => {
    // 若同日已新建了另一篇 daily 日记，恢复时避免唯一索引冲突：若冲突则抛出可解释提示
    if (row.kind === "daily") {
      const clash = db
        .prepare("SELECT id FROM entries WHERE kind = 'daily' AND date = ? AND deleted_at IS NULL")
        .get(row.date) as { id: string } | undefined;
      if (clash) {
        throw new Error(`${row.date} 已存在未删除日记，无法直接恢复同日旧稿`);
      }
    }
    db.prepare("UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      id
    );
    syncEntryFts(db, id, row.title, row.content_text);
  });
  tx();
  return getEntryById(db, id);
}

export function permanentDeleteTrashEntry(db: Database.Database, id: string): boolean {
  const res = db
    .prepare("DELETE FROM entries WHERE id = ? AND deleted_at IS NOT NULL")
    .run(id);
  return res.changes > 0;
}

export function purgeExpiredTrash(db: Database.Database): number {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = db
    .prepare("DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?")
    .run(cutoff);
  return res.changes;
}

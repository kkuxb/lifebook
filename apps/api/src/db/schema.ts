import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { DEFAULT_MOODS, DEFAULT_TAGS, DEFAULT_TEMPLATES } from "@lifebook/core";

export function tokenizeForFts(text: string): string {
  if (!text) return "";
  // 保留英文/数字词元，并对中文连续片段做 1字+2字切分，保证 FTS5 unicode61 可高速命中任意中文关键词
  const tokens: string[] = [];
  const asciiMatches = text.match(/[A-Za-z0-9_.-]{2,}/g);
  if (asciiMatches) {
    tokens.push(...asciiMatches.map((w) => w.toLowerCase()));
  }
  const cjkRuns = text.match(/[\u4e00-\u9fa5]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length; i++) {
        tokens.push(run[i]);
        if (i + 1 < run.length) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    }
  }
  return tokens.join(" ");
}

export function buildFtsMatchQuery(q: string): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const parts: string[] = [];

  const asciiWords = trimmed.match(/[A-Za-z0-9_.-]{2,}/g) ?? [];
  for (const w of asciiWords) {
    parts.push(`"${w.toLowerCase().replace(/"/g, "")}"`);
  }

  const cjkRuns = trimmed.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      parts.push(`"${run}"`);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        parts.push(`"${run.slice(i, i + 2)}"`);
      }
    }
  }

  if (parts.length === 0) return null;
  return [...new Set(parts)].join(" AND ");
}

export function initDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });

  const dbPath = path.join(dataDir, "lifebook.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('daily', 'special')),
      date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      import_batch TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_daily_date_unique
      ON entries(date) WHERE kind='daily' AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entries_deleted_at ON entries(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_entries_import_batch ON entries(import_batch);

    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      entry_id UNINDEXED,
      title,
      content_text,
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color_key TEXT NOT NULL,
      color TEXT NOT NULL,
      tint TEXT NOT NULL,
      ink TEXT NOT NULL,
      dark_tint TEXT NOT NULL,
      dark_ink TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moods (
      id TEXT PRIMARY KEY,
      emoji TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL UNIQUE,
      tone TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 3,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

    CREATE TABLE IF NOT EXISTS entry_moods (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      mood_id TEXT NOT NULL REFERENCES moods(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, mood_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entry_moods_mood ON entry_moods(mood_id);

    CREATE TABLE IF NOT EXISTS entry_snapshots (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      snapshot_date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_entry_date
      ON entry_snapshots(entry_id, snapshot_date, created_at);

    CREATE TABLE IF NOT EXISTS entry_ai_digests (
      entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      short_title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      dim_life TEXT NOT NULL DEFAULT '',
      dim_work TEXT NOT NULL DEFAULT '',
      dim_leisure TEXT NOT NULL DEFAULT '',
      dim_people_notes TEXT NOT NULL DEFAULT '',
      key_events_json TEXT NOT NULL DEFAULT '[]',
      topics_json TEXT NOT NULL DEFAULT '[]',
      reflection TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS period_reviews (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('monthly', 'yearly')),
      period_key TEXT NOT NULL,
      with_timebook INTEGER NOT NULL DEFAULT 0,
      overview_json TEXT NOT NULL,
      cross_insights_json TEXT NOT NULL DEFAULT '[]',
      dimensions_json TEXT NOT NULL,
      next_actions_json TEXT NOT NULL DEFAULT '[]',
      highlights_json TEXT NOT NULL DEFAULT '[]',
      token_usage_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, period_key)
    );

    CREATE TABLE IF NOT EXISTS pinned_highlights (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('monthly', 'yearly')),
      period_key TEXT NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('pin', 'exclude')),
      updated_at TEXT NOT NULL,
      UNIQUE(scope, period_key, entry_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      desc TEXT NOT NULL DEFAULT '',
      sections_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      overwritten_count INTEGER NOT NULL DEFAULT 0,
      merged_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeat (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      updated_at TEXT NOT NULL
    );
  `);

  seedDefaults(db);
  return db;
}

function seedDefaults(db: Database.Database): void {
  const now = new Date().toISOString();
  const tagCount = (db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
  if (tagCount === 0) {
    const insTag = db.prepare(`
      INSERT INTO tags (id, name, color_key, color, tint, ink, dark_tint, dark_ink, enabled, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of DEFAULT_TAGS) {
      insTag.run(
        `tag-${ulid()}`,
        t.name,
        t.colorKey,
        t.color,
        t.tint,
        t.ink,
        t.darkTint,
        t.darkInk,
        t.enabled ? 1 : 0,
        t.sort,
        now,
        now
      );
    }
  }

  const moodCount = (db.prepare("SELECT COUNT(*) as c FROM moods").get() as { c: number }).c;
  if (moodCount === 0) {
    const insMood = db.prepare(`
      INSERT INTO moods (id, emoji, name, label, tone, level, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of DEFAULT_MOODS) {
      insMood.run(`mood-${ulid()}`, m.emoji, m.name, m.label, m.tone, m.level, m.sort, now, now);
    }
  }

  const tplCount = (db.prepare("SELECT COUNT(*) as c FROM templates").get() as { c: number }).c;
  if (tplCount === 0) {
    const insTpl = db.prepare(`
      INSERT INTO templates (id, name, desc, sections_json, is_default, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const tpl of DEFAULT_TEMPLATES) {
      insTpl.run(tpl.id, tpl.name, tpl.desc, JSON.stringify(tpl.sections), tpl.isDefault ? 1 : 0, now);
    }
  }

  db.prepare(`
    INSERT INTO heartbeat (id, updated_at) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(now);
}

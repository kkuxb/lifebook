import type Database from "better-sqlite3";
import { ulid } from "ulid";
import { TAG_PALETTE, type MoodItem, type TagItem, type TemplateItem } from "@lifebook/core";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
  }
}

export function listTags(db: Database.Database): TagItem[] {
  const rows = db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM entry_tags et
               JOIN entries e ON e.id = et.entry_id
               WHERE et.tag_id = t.id AND e.deleted_at IS NULL) as cnt
       FROM tags t
       ORDER BY t.sort ASC, t.created_at ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    color_key: string;
    color: string;
    tint: string;
    ink: string;
    dark_tint: string;
    dark_ink: string;
    enabled: number;
    sort: number;
    cnt: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    colorKey: r.color_key,
    color: r.color,
    tint: r.tint,
    ink: r.ink,
    darkTint: r.dark_tint,
    darkInk: r.dark_ink,
    enabled: r.enabled === 1,
    sort: r.sort,
    count: r.cnt
  }));
}

export function createTag(
  db: Database.Database,
  input: { name: string; colorKey?: string }
): TagItem {
  const name = input.name.trim();
  if (!name) throw new ValidationError("标签名称不能为空");
  const dup = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: string } | undefined;
  if (dup) throw new ValidationError(`已存在同名标签「${name}」`);

  const curCount = (db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
  const pal =
    TAG_PALETTE.find((p) => p.key === input.colorKey) ??
    TAG_PALETTE[curCount % TAG_PALETTE.length];
  const now = new Date().toISOString();
  const id = `tag-${ulid()}`;

  db.prepare(
    `INSERT INTO tags (id, name, color_key, color, tint, ink, dark_tint, dark_ink, enabled, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(id, name, pal.key, pal.color, pal.tint, pal.ink, pal.darkTint, pal.darkInk, curCount + 1, now, now);

  return listTags(db).find((t) => t.id === id)!;
}

export function updateTag(
  db: Database.Database,
  id: string,
  input: { name?: string; colorKey?: string; enabled?: boolean }
): TagItem {
  const existing = db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as
    | { id: string; name: string; color_key: string; enabled: number }
    | undefined;
  if (!existing) throw new ValidationError("标签不存在");

  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  if (!nextName) throw new ValidationError("标签名称不能为空");
  if (nextName !== existing.name) {
    const dup = db
      .prepare("SELECT id FROM tags WHERE name = ? AND id != ?")
      .get(nextName, id) as { id: string } | undefined;
    if (dup) throw new ValidationError(`已存在同名标签「${nextName}」`);
  }

  const pal = input.colorKey ? TAG_PALETTE.find((p) => p.key === input.colorKey) : undefined;
  const nextEnabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled;
  const now = new Date().toISOString();

  if (pal) {
    db.prepare(
      `UPDATE tags SET name = ?, color_key = ?, color = ?, tint = ?, ink = ?, dark_tint = ?, dark_ink = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextName, pal.key, pal.color, pal.tint, pal.ink, pal.darkTint, pal.darkInk, nextEnabled, now, id);
  } else {
    db.prepare(`UPDATE tags SET name = ?, enabled = ?, updated_at = ? WHERE id = ?`).run(
      nextName,
      nextEnabled,
      now,
      id
    );
  }
  return listTags(db).find((t) => t.id === id)!;
}

export function deleteTagSafely(
  db: Database.Database,
  id: string,
  replaceWithId?: string
): { deletedId: string; migratedCount: number } {
  const existing = db.prepare("SELECT id, name FROM tags WHERE id = ?").get(id) as
    | { id: string; name: string }
    | undefined;
  if (!existing) throw new ValidationError("要删除的标签不存在");

  const totalTags = (db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
  if (totalTags <= 1) {
    throw new ValidationError("至少需要保留 1 个可用标签");
  }

  const refCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM entry_tags et
         JOIN entries e ON e.id = et.entry_id
         WHERE et.tag_id = ? AND e.deleted_at IS NULL`
      )
      .get(id) as { c: number }
  ).c;

  // 含已软删记录的关联也一并安全迁移，保证零丢失
  const totalRefCount = (
    db.prepare("SELECT COUNT(*) as c FROM entry_tags WHERE tag_id = ?").get(id) as { c: number }
  ).c;

  if (totalRefCount > 0) {
    const targetId = (replaceWithId ?? "").trim();
    if (!targetId) {
      throw new ValidationError("该标签已关联日记，必须选择 replaceWithId 替换目标标签后才能删除");
    }
    if (targetId === id) {
      throw new ValidationError("替换目标标签不能是当前被删除标签自身");
    }
    const targetExists = db.prepare("SELECT id FROM tags WHERE id = ?").get(targetId) as
      | { id: string }
      | undefined;
    if (!targetExists) {
      throw new ValidationError("指定的替换目标标签不存在");
    }

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id)
         SELECT entry_id, ? FROM entry_tags WHERE tag_id = ?`
      ).run(targetId, id);
      db.prepare("DELETE FROM entry_tags WHERE tag_id = ?").run(id);
      db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    });
    tx();
    return { deletedId: id, migratedCount: refCount };
  }

  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return { deletedId: id, migratedCount: 0 };
}

export function listMoods(db: Database.Database): MoodItem[] {
  const rows = db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM entry_moods em
               JOIN entries e ON e.id = em.entry_id
               WHERE em.mood_id = m.id AND e.deleted_at IS NULL) as cnt
       FROM moods m
       ORDER BY m.sort ASC, m.created_at ASC`
    )
    .all() as Array<{
    id: string;
    emoji: string;
    name: string;
    label: string;
    tone: string;
    level: number;
    sort: number;
    cnt: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    emoji: r.emoji,
    name: r.name,
    label: r.label,
    tone: r.tone,
    level: r.level,
    sort: r.sort,
    count: r.cnt
  }));
}

export function createMood(
  db: Database.Database,
  input: { emoji: string; name: string; tone?: string; level?: number }
): MoodItem {
  const emoji = (input.emoji ?? "").trim() || "🌟";
  const name = (input.name ?? "").trim();
  if (!name) throw new ValidationError("心情名称不能为空");
  const label = `${emoji} ${name}`;
  const dup = db.prepare("SELECT id FROM moods WHERE label = ? OR name = ?").get(label, name) as
    | { id: string }
    | undefined;
  if (dup) throw new ValidationError(`已存在相同心情「${label}」`);

  const curCount = (db.prepare("SELECT COUNT(*) as c FROM moods").get() as { c: number }).c;
  const tone = input.tone || "#7DD3FC";
  const level = input.level ?? 3;
  const now = new Date().toISOString();
  const id = `mood-${ulid()}`;

  db.prepare(
    `INSERT INTO moods (id, emoji, name, label, tone, level, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, emoji, name, label, tone, level, curCount + 1, now, now);

  return listMoods(db).find((m) => m.id === id)!;
}

export function updateMood(
  db: Database.Database,
  id: string,
  input: { emoji?: string; name?: string; tone?: string; level?: number }
): MoodItem {
  const existing = db.prepare("SELECT * FROM moods WHERE id = ?").get(id) as
    | { id: string; emoji: string; name: string; tone: string; level: number }
    | undefined;
  if (!existing) throw new ValidationError("心情不存在");

  const nextEmoji = input.emoji !== undefined ? input.emoji.trim() : existing.emoji;
  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  if (!nextEmoji || !nextName) throw new ValidationError("心情表情与名称均不能为空");
  const nextLabel = `${nextEmoji} ${nextName}`;

  const dup = db
    .prepare("SELECT id FROM moods WHERE label = ? AND id != ?")
    .get(nextLabel, id) as { id: string } | undefined;
  if (dup) throw new ValidationError(`已存在相同心情「${nextLabel}」`);

  db.prepare(
    `UPDATE moods SET emoji = ?, name = ?, label = ?, tone = ?, level = ?, updated_at = ? WHERE id = ?`
  ).run(
    nextEmoji,
    nextName,
    nextLabel,
    input.tone ?? existing.tone,
    input.level ?? existing.level,
    new Date().toISOString(),
    id
  );

  return listMoods(db).find((m) => m.id === id)!;
}

export function deleteMoodSafely(
  db: Database.Database,
  id: string,
  replaceWithId?: string
): { deletedId: string; migratedCount: number } {
  const existing = db.prepare("SELECT id, label FROM moods WHERE id = ?").get(id) as
    | { id: string; label: string }
    | undefined;
  if (!existing) throw new ValidationError("要删除的心情不存在");

  const totalMoods = (db.prepare("SELECT COUNT(*) as c FROM moods").get() as { c: number }).c;
  if (totalMoods <= 1) {
    throw new ValidationError("至少需要保留 1 个可用心情");
  }

  const refCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM entry_moods em
         JOIN entries e ON e.id = em.entry_id
         WHERE em.mood_id = ? AND e.deleted_at IS NULL`
      )
      .get(id) as { c: number }
  ).c;

  const totalRefCount = (
    db.prepare("SELECT COUNT(*) as c FROM entry_moods WHERE mood_id = ?").get(id) as { c: number }
  ).c;

  if (totalRefCount > 0) {
    const targetId = (replaceWithId ?? "").trim();
    if (!targetId) {
      throw new ValidationError("该心情已关联日记，必须选择 replaceWithId 替换目标心情后才能删除");
    }
    if (targetId === id) {
      throw new ValidationError("替换目标心情不能是当前被删除心情自身");
    }
    const targetExists = db.prepare("SELECT id FROM moods WHERE id = ?").get(targetId) as
      | { id: string }
      | undefined;
    if (!targetExists) {
      throw new ValidationError("指定的替换目标心情不存在");
    }

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO entry_moods (entry_id, mood_id)
         SELECT entry_id, ? FROM entry_moods WHERE mood_id = ?`
      ).run(targetId, id);
      db.prepare("DELETE FROM entry_moods WHERE mood_id = ?").run(id);
      db.prepare("DELETE FROM moods WHERE id = ?").run(id);
    });
    tx();
    return { deletedId: id, migratedCount: refCount };
  }

  db.prepare("DELETE FROM moods WHERE id = ?").run(id);
  return { deletedId: id, migratedCount: 0 };
}

export function listTemplates(db: Database.Database): TemplateItem[] {
  const rows = db.prepare("SELECT * FROM templates ORDER BY is_default DESC, id ASC").all() as Array<{
    id: string;
    name: string;
    desc: string;
    sections_json: string;
    is_default: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    desc: r.desc,
    sections: JSON.parse(r.sections_json) as string[],
    isDefault: r.is_default === 1
  }));
}

export function updateTemplate(
  db: Database.Database,
  id: string,
  input: { name?: string; desc?: string; sections: string[] }
): TemplateItem {
  const existing = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as
    | { id: string; name: string; desc: string }
    | undefined;
  if (!existing) throw new ValidationError("模板不存在");
  const cleanSections = input.sections.map((s) => s.trim()).filter(Boolean);
  db.prepare("UPDATE templates SET name = ?, desc = ?, sections_json = ?, updated_at = ? WHERE id = ?").run(
    input.name?.trim() || existing.name,
    input.desc ?? existing.desc,
    JSON.stringify(cleanSections),
    new Date().toISOString(),
    id
  );
  return listTemplates(db).find((t) => t.id === id)!;
}

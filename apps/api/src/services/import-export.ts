import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import JSZip from "jszip";
import { ulid } from "ulid";
import {
  countWords,
  getShanghaiNowParts,
  isBlankDraftRecord,
  mapOldMoodsToNew,
  markdownToHtml,
  normalizeDateString,
  parseCsvRecords,
  resolveConflictEntry,
  stripDatePrefixFromTitle,
  stripHtml,
  type ConflictStrategy,
  type EntryKind
} from "@lifebook/core";
import {
  cleanupExpiredSnapshots,
  getEntryById,
  purgeExpiredTrash,
  removeEntryFts,
  syncEntryFts,
  upsertEntry
} from "./entries.js";
import { createTag, listTags } from "./tags-moods.js";

export interface ParsedImportEntry {
  tempId: string;
  kind: EntryKind;
  date: string;
  rawTitle: string;
  cleanTitle: string;
  rawMoods: string[];
  mappedMoods: string[];
  tags: string[];
  markdown: string;
  wordCount: number;
  imageRefs: string[];
}

export interface PreviewSession {
  previewId: string;
  filename: string;
  createdAt: number;
  entries: ParsedImportEntry[];
  blankDraftsFiltered: number;
  attachments: Map<string, { ext: string; data: Buffer }>;
  moodStats: Array<{ oldLabel: string; defaultNewLabel: string; count: number }>;
  conflicts: Array<{
    date: string;
    existingId: string;
    existingTitle: string;
    existingWords: number;
    incomingTempId: string;
    incomingTitle: string;
    incomingWords: number;
    defaultStrategy: ConflictStrategy;
  }>;
}

const previewStore = new Map<string, PreviewSession>();

function cleanupOldPreviews(): void {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of previewStore.entries()) {
    if (v.createdAt < cutoff) previewStore.delete(k);
  }
}

function splitListField(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，;；|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFrontmatter(mdText: string): { meta: Record<string, string>; body: string } {
  const normalized = mdText.replace(/\r\n/g, "\n");
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: normalized };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      meta[k] = v;
    }
  }
  return { meta, body: m[2] };
}

function extractImageRefs(md: string): string[] {
  const refs: string[] = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const p = m[1].trim();
    if (p && !/^https?:\/\//i.test(p) && !p.startsWith("data:")) {
      refs.push(p.replace(/^\.\//, ""));
    }
  }
  return refs;
}

function inferImageExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) return ext;
  return ".png";
}

export async function previewZipImport(
  db: Database.Database,
  zipBuffer: Buffer,
  filename: string
): Promise<Omit<PreviewSession, "entries" | "attachments" | "createdAt"> & { sampleItems: Array<{ date: string; rawTitle: string; cleanTitle: string; mappedMoods: string[]; tags: string[]; wordCount: number }>; totalParsed: number; attachmentCount: number }> {
  cleanupOldPreviews();
  const zip = await JSZip.loadAsync(zipBuffer);

  const csvFiles: Array<{ name: string; content: string }> = [];
  const mdFiles = new Map<string, string>();
  const attachments = new Map<string, { ext: string; data: Buffer }>();

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const file of entries) {
    const posixName = file.name.replace(/\\/g, "/");
    const lower = posixName.toLowerCase();
    if (lower.endsWith(".csv")) {
      csvFiles.push({ name: posixName, content: await file.async("string") });
    } else if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
      mdFiles.set(posixName, await file.async("string"));
    } else if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) {
      const buf = await file.async("nodebuffer");
      attachments.set(posixName, { ext: inferImageExt(posixName), data: buf });
    }
  }

  const parsedEntries: ParsedImportEntry[] = [];
  let blankDraftsFiltered = 0;

  if (csvFiles.length > 0) {
    // 优先结合 CSV 索引表与同名/路径指向的 Markdown 文件
    const consumedMd = new Set<string>();
    for (const csvFile of csvFiles) {
      const rows = parseCsvRecords(csvFile.content);
      for (const row of rows) {
        const rawTitle =
          row["标题"] ?? row["title"] ?? row["Name"] ?? row["名称"] ?? "";
        const rawDate =
          row["日期"] ?? row["date"] ?? row["Date"] ?? row["创建时间"] ?? "";
        const date = normalizeDateString(rawDate) || normalizeDateString(rawTitle);
        const rawMoods = splitListField(
          row["心情"] ?? row["mood"] ?? row["moods"] ?? row["Mood"] ?? ""
        );
        const tags = splitListField(
          row["标签"] ?? row["tag"] ?? row["tags"] ?? row["Tags"] ?? ""
        );
        const kindRaw = (row["类型"] ?? row["kind"] ?? "").trim();
        const kind: EntryKind =
          kindRaw === "special" || kindRaw.includes("专项") || tags.includes("年度复盘")
            ? "special"
            : "daily";

        let mdBody = row["正文"] ?? row["content"] ?? row["body"] ?? "";
        const fileRef = row["文件"] ?? row["file"] ?? row["path"] ?? "";
        if (!mdBody && fileRef) {
          const matchedKey = [...mdFiles.keys()].find(
            (k) => k === fileRef || k.endsWith("/" + fileRef) || path.posix.basename(k) === path.posix.basename(fileRef)
          );
          if (matchedKey) {
            mdBody = mdFiles.get(matchedKey) ?? "";
            consumedMd.add(matchedKey);
          }
        }
        if (!mdBody && date) {
          const matchedKey = [...mdFiles.keys()].find(
            (k) => !consumedMd.has(k) && path.posix.basename(k).includes(date)
          );
          if (matchedKey) {
            mdBody = mdFiles.get(matchedKey) ?? "";
            consumedMd.add(matchedKey);
          }
        }

        const { meta, body } = parseFrontmatter(mdBody);
        const finalDate = date || normalizeDateString(meta.date || "");
        const finalRawTitle = rawTitle || meta.title || "";
        const finalMoods = rawMoods.length ? rawMoods : splitListField(meta.moods || meta.mood || "");
        const finalTags = tags.length ? tags : splitListField(meta.tags || "");

        if (
          isBlankDraftRecord({
            date: finalDate,
            title: finalRawTitle,
            contentText: body.replace(/[#>*`\-\s]/g, "")
          })
        ) {
          blankDraftsFiltered++;
          continue;
        }
        if (!finalDate) continue;

        const cleanTitle = stripDatePrefixFromTitle(finalRawTitle, finalDate);
        const mappedMoods = mapOldMoodsToNew(finalMoods);
        const wc = countWords(stripHtml(markdownToHtml(body)));
        parsedEntries.push({
          tempId: `imp-${ulid()}`,
          kind,
          date: finalDate,
          rawTitle: finalRawTitle,
          cleanTitle,
          rawMoods: finalMoods,
          mappedMoods: mappedMoods.length ? mappedMoods : ["😌 平静"],
          tags: finalTags.length ? finalTags : ["日常记录"],
          markdown: body,
          wordCount: wc,
          imageRefs: extractImageRefs(body)
        });
      }
    }

    // 处理未被 CSV 引用的剩余独立 Markdown
    for (const [mdPath, mdContent] of mdFiles.entries()) {
      if (consumedMd.has(mdPath)) continue;
      const item = parseSingleMarkdownEntry(mdPath, mdContent);
      if (item === "blank") blankDraftsFiltered++;
      else if (item) parsedEntries.push(item);
    }
  } else {
    for (const [mdPath, mdContent] of mdFiles.entries()) {
      const item = parseSingleMarkdownEntry(mdPath, mdContent);
      if (item === "blank") blankDraftsFiltered++;
      else if (item) parsedEntries.push(item);
    }
  }

  // 统计旧心情分布
  const moodFreq = new Map<string, number>();
  for (const item of parsedEntries) {
    for (const rm of item.rawMoods) {
      moodFreq.set(rm, (moodFreq.get(rm) ?? 0) + 1);
    }
  }
  const moodStats = [...moodFreq.entries()].map(([oldLabel, count]) => ({
    oldLabel,
    defaultNewLabel: mapOldMoodsToNew([oldLabel])[0] ?? "😌 平静",
    count
  }));

  // 检测同日冲突
  const existingDailyRows = db
    .prepare("SELECT id, date, title, word_count FROM entries WHERE kind = 'daily' AND deleted_at IS NULL")
    .all() as Array<{ id: string; date: string; title: string; word_count: number }>;
  const existingByDate = new Map(existingDailyRows.map((r) => [r.date, r]));

  const conflicts: PreviewSession["conflicts"] = [];
  for (const item of parsedEntries) {
    if (item.kind !== "daily") continue;
    const ex = existingByDate.get(item.date);
    if (ex) {
      conflicts.push({
        date: item.date,
        existingId: ex.id,
        existingTitle: ex.title || `${ex.date} 日记`,
        existingWords: ex.word_count,
        incomingTempId: item.tempId,
        incomingTitle: item.cleanTitle || `${item.date} 日记`,
        incomingWords: item.wordCount,
        defaultStrategy: "skip"
      });
    }
  }

  const previewId = `prev-${ulid()}`;
  const session: PreviewSession = {
    previewId,
    filename,
    createdAt: Date.now(),
    entries: parsedEntries,
    blankDraftsFiltered,
    attachments,
    moodStats,
    conflicts
  };
  previewStore.set(previewId, session);

  return {
    previewId,
    filename,
    totalParsed: parsedEntries.length,
    blankDraftsFiltered,
    attachmentCount: attachments.size,
    moodStats,
    conflicts,
    sampleItems: parsedEntries.slice(0, 20).map((e) => ({
      date: e.date,
      rawTitle: e.rawTitle,
      cleanTitle: e.cleanTitle,
      mappedMoods: e.mappedMoods,
      tags: e.tags,
      wordCount: e.wordCount
    }))
  };
}

function parseSingleMarkdownEntry(
  mdPath: string,
  mdContent: string
): ParsedImportEntry | "blank" | null {
  const { meta, body } = parseFrontmatter(mdContent);
  const baseName = path.posix.basename(mdPath, path.posix.extname(mdPath));
  const headingMatch = body.match(/^#\s+(.+)$/m);
  const rawTitle = meta.title || (headingMatch ? headingMatch[1].trim() : baseName);
  const date =
    normalizeDateString(meta.date || "") ||
    normalizeDateString(baseName) ||
    normalizeDateString(rawTitle);

  const cleanedBody = headingMatch ? body.replace(/^#\s+.+\n?/, "").trim() : body.trim();
  const rawMoods = splitListField(meta.moods || meta.mood || "");
  const tags = splitListField(meta.tags || "");

  if (
    isBlankDraftRecord({
      date,
      title: rawTitle,
      contentText: cleanedBody.replace(/[#>*`\-\s]/g, "")
    })
  ) {
    return "blank";
  }
  if (!date) return null;

  const cleanTitle = stripDatePrefixFromTitle(rawTitle, date);
  const mappedMoods = mapOldMoodsToNew(rawMoods);
  const kind: EntryKind =
    meta.kind === "special" || tags.includes("年度复盘") ? "special" : "daily";

  return {
    tempId: `imp-${ulid()}`,
    kind,
    date,
    rawTitle,
    cleanTitle,
    rawMoods,
    mappedMoods: mappedMoods.length ? mappedMoods : ["😌 平静"],
    tags: tags.length ? tags : ["日常记录"],
    markdown: cleanedBody,
    wordCount: countWords(stripHtml(markdownToHtml(cleanedBody))),
    imageRefs: extractImageRefs(cleanedBody)
  };
}

export function commitZipImport(
  db: Database.Database,
  dataDir: string,
  input: {
    previewId: string;
    conflictDecisions?: Record<string, ConflictStrategy>;
    moodMapping?: Record<string, string>;
  }
): {
  batchId: string;
  importedCount: number;
  skippedCount: number;
  overwrittenCount: number;
  mergedCount: number;
} {
  const session = previewStore.get(input.previewId);
  if (!session) {
    throw new Error("导入预览已过期或不存在，请重新上传压缩包");
  }

  const batchId = `batch-${ulid()}`;
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  // 1. 先保存附件文件并构建路径映射表（保证每张唯一图片仅落盘一份，同时注册 basename 方便相对路径匹配）
  const savedAttachments = new Map<string, string>();
  const savedFilesList: string[] = [];
  const writtenBuffers = new Map<Buffer, string>();
  for (const [key, att] of session.attachments.entries()) {
    let url = writtenBuffers.get(att.data);
    if (!url) {
      const filename = `imp-${ulid()}${att.ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), att.data);
      url = `/api/uploads/${filename}`;
      writtenBuffers.set(att.data, url);
      savedFilesList.push(filename);
    }
    savedAttachments.set(key, url);
    const base = path.posix.basename(key);
    if (!savedAttachments.has(base)) {
      savedAttachments.set(base, url);
    }
  }

  // 2. 补充缺失标签（如原包带有新自定义标签）
  const existingTagNames = new Set(listTags(db).map((t) => t.name));
  for (const item of session.entries) {
    for (const t of item.tags) {
      if (!existingTagNames.has(t)) {
        createTag(db, { name: t });
        existingTagNames.add(t);
      }
    }
  }

  let importedCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;
  let mergedCount = 0;

  const createdIds: string[] = [];
  const modifiedBackups: Array<{
    id: string;
    title: string;
    contentHtml: string;
    tags: string[];
    moods: string[];
  }> = [];

  const tx = db.transaction(() => {
    for (const item of session.entries) {
      const resolvedMoods =
        item.rawMoods.length > 0
          ? mapOldMoodsToNew(item.rawMoods, input.moodMapping)
          : item.mappedMoods;

      const html = markdownToHtml(item.markdown, (rawSrc) => {
        const clean = rawSrc.replace(/^\.\//, "");
        return savedAttachments.get(clean) ?? savedAttachments.get(path.posix.basename(clean)) ?? rawSrc;
      });

      if (item.kind === "daily") {
        const existingRow = db
          .prepare("SELECT id FROM entries WHERE kind = 'daily' AND date = ? AND deleted_at IS NULL")
          .get(item.date) as { id: string } | undefined;

        if (existingRow) {
          const strategy: ConflictStrategy =
            input.conflictDecisions?.[item.date] ?? "skip";
          if (strategy === "skip") {
            skippedCount++;
            continue;
          }
          const existing = getEntryById(db, existingRow.id)!;
          modifiedBackups.push({
            id: existing.id,
            title: existing.title,
            contentHtml: existing.contentHtml,
            tags: existing.tags,
            moods: existing.moods
          });
          const resolved = resolveConflictEntry(
            {
              title: existing.title,
              contentHtml: existing.contentHtml,
              tags: existing.tags,
              moods: existing.moods
            },
            {
              title: item.cleanTitle,
              contentHtml: html,
              tags: item.tags,
              moods: resolvedMoods
            },
            strategy
          );
          upsertEntry(db, {
            id: existing.id,
            kind: "daily",
            date: item.date,
            title: resolved.title,
            contentHtml: resolved.contentHtml,
            tags: resolved.tags,
            moods: resolved.moods,
            createSnapshot: false
          });
          if (strategy === "overwrite") overwrittenCount++;
          else mergedCount++;
          continue;
        }
      }

      const saved = upsertEntry(db, {
        kind: item.kind,
        date: item.date,
        title: item.cleanTitle,
        contentHtml: html,
        tags: item.tags,
        moods: resolvedMoods,
        importBatch: batchId,
        createSnapshot: false
      });
      createdIds.push(saved.id);
      importedCount++;
    }

    db.prepare(
      `INSERT INTO import_batches (id, filename, total_count, imported_count, skipped_count, overwritten_count, merged_count, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      batchId,
      session.filename,
      session.entries.length,
      importedCount,
      skippedCount,
      overwrittenCount,
      mergedCount,
      JSON.stringify({ createdIds, modifiedBackups, savedFilesList }),
      new Date().toISOString()
    );
  });

  tx();
  previewStore.delete(input.previewId);

  return {
    batchId,
    importedCount,
    skippedCount,
    overwrittenCount,
    mergedCount
  };
}

export function listImportBatches(db: Database.Database) {
  const rows = db
    .prepare("SELECT * FROM import_batches ORDER BY created_at DESC")
    .all() as Array<{
    id: string;
    filename: string;
    total_count: number;
    imported_count: number;
    skipped_count: number;
    overwritten_count: number;
    merged_count: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    totalCount: r.total_count,
    importedCount: r.imported_count,
    skippedCount: r.skipped_count,
    overwrittenCount: r.overwritten_count,
    mergedCount: r.merged_count,
    createdAt: r.created_at
  }));
}

export function undoImportBatch(
  db: Database.Database,
  dataDir: string,
  batchId: string
): { deletedEntries: number; restoredEntries: number } {
  const row = db
    .prepare("SELECT * FROM import_batches WHERE id = ?")
    .get(batchId) as { id: string; summary_json: string } | undefined;
  if (!row) throw new Error("导入批次不存在或已被撤销");

  const summary = JSON.parse(row.summary_json) as {
    createdIds?: string[];
    modifiedBackups?: Array<{
      id: string;
      title: string;
      contentHtml: string;
      tags: string[];
      moods: string[];
    }>;
    savedFilesList?: string[];
  };

  let deletedEntries = 0;
  let restoredEntries = 0;

  const tx = db.transaction(() => {
    const batchRows = db
      .prepare("SELECT id FROM entries WHERE import_batch = ?")
      .all(batchId) as Array<{ id: string }>;
    const allNewIds = new Set([
      ...(summary.createdIds ?? []),
      ...batchRows.map((x) => x.id)
    ]);

    for (const id of allNewIds) {
      removeEntryFts(db, id);
      const res = db.prepare("DELETE FROM entries WHERE id = ?").run(id);
      deletedEntries += res.changes;
    }

    for (const prev of summary.modifiedBackups ?? []) {
      const existing = getEntryById(db, prev.id);
      if (existing) {
        upsertEntry(db, {
          id: existing.id,
          kind: existing.kind,
          date: existing.date,
          title: prev.title,
          contentHtml: prev.contentHtml,
          tags: prev.tags,
          moods: prev.moods,
          createSnapshot: false
        });
        syncEntryFts(db, existing.id, prev.title, stripHtml(prev.contentHtml));
        restoredEntries++;
      }
    }

    db.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
  });

  tx();

  // 清理该批次保存的附件文件
  const uploadsDir = path.join(dataDir, "uploads");
  for (const f of summary.savedFilesList ?? []) {
    const p = path.join(uploadsDir, path.basename(f));
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }

  return { deletedEntries, restoredEntries };
}

export async function runHotBackup(
  db: Database.Database,
  dataDir: string
): Promise<{ filename: string; path: string; sizeBytes: number; cleanedSnapshots: number; purgedTrash: number }> {
  const backupsDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  const cleanedSnapshots = cleanupExpiredSnapshots(db);
  const purgedTrash = purgeExpiredTrash(db);

  const nowParts = getShanghaiNowParts();
  const stamp = `${nowParts.date.replace(/-/g, "")}-${nowParts.time.replace(/:/g, "")}`;
  const filename = `lifebook-${stamp}.sqlite`;
  const destPath = path.join(backupsDir, filename);

  await db.backup(destPath);
  const stat = fs.statSync(destPath);

  // 仅保留最近 14 份热备
  const allFiles = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith("lifebook-") && f.endsWith(".sqlite"))
    .sort()
    .reverse();
  for (const old of allFiles.slice(14)) {
    try {
      fs.unlinkSync(path.join(backupsDir, old));
    } catch {
      // ignore
    }
  }

  return {
    filename,
    path: destPath,
    sizeBytes: stat.size,
    cleanedSnapshots,
    purgedTrash
  };
}

export function listBackups(dataDir: string) {
  const backupsDir = path.join(dataDir, "backups");
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".sqlite"))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(backupsDir, f));
      return {
        filename: f,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString()
      };
    });
}

export function exportAllJson(db: Database.Database) {
  const rows = db
    .prepare("SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY date DESC")
    .all() as Array<{ id: string }>;
  const entries = rows.map((r) => getEntryById(db, r.id)).filter(Boolean);
  return {
    version: "lifebook-export-v1",
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries
  };
}

export async function exportAllMarkdownZip(
  db: Database.Database,
  dataDir: string
): Promise<Buffer> {
  const zip = new JSZip();
  const data = exportAllJson(db);
  const mdFolder = zip.folder("entries")!;

  for (const e of data.entries) {
    if (!e) continue;
    const safeTitle = (e.title || "日记").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    const filename = `${e.date}-${safeTitle}-${e.id.slice(-6)}.md`;
    const frontmatter = [
      "---",
      `date: "${e.date}"`,
      `kind: "${e.kind}"`,
      `title: "${(e.title || "").replace(/"/g, '\\"')}"`,
      `moods: "${e.moods.join(", ")}"`,
      `tags: "${e.tags.join(", ")}"`,
      `wordCount: ${e.wordCount}`,
      "---",
      ""
    ].join("\n");
    const mdBody = htmlToReadableMarkdown(e.contentHtml);
    mdFolder.file(filename, `${frontmatter}${mdBody}\n`);
  }

  const uploadsDir = path.join(dataDir, "uploads");
  if (fs.existsSync(uploadsDir)) {
    const upFolder = zip.folder("uploads")!;
    for (const f of fs.readdirSync(uploadsDir)) {
      const full = path.join(uploadsDir, f);
      if (fs.statSync(full).isFile()) {
        upFolder.file(f, fs.readFileSync(full));
      }
    }
  }

  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function htmlToReadableMarkdown(html: string): string {
  return (html || "")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, "\n> $1\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<mark[^>]*>(.*?)<\/mark>/gi, "==$1==")
    .replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, "![$2]($1)")
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, "![]($1)")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

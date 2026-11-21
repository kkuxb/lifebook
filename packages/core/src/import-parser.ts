import { OLD_12_TO_NEW_8_MOOD_MAP, escapeHtml, stripHtml } from "./index.js";

export type ConflictStrategy = "skip" | "overwrite" | "merge";

/**
 * 剥离原平台导出标题开头重复的日期前缀（如 `2025-11-20 标题`、`2025年11月20日：标题` 等）。
 */
export function stripDatePrefixFromTitle(rawTitle: string, entryDate?: string): string {
  let title = (rawTitle ?? "").trim();
  if (!title) return "";

  const patterns = [
    /^[【\[]?\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s*[】\]]?\s*[-—:：·|]?\s*/,
    /^\d{8}\s*[-—:：·|]?\s*/
  ];
  while (true) {
    let matched = false;
    for (const re of patterns) {
      const next = title.replace(re, "").trim();
      if (next !== title) {
        title = next;
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  if (entryDate && title === entryDate) {
    return "";
  }
  return title;
}

/**
 * 识别原空间无日期、无标题、无正文的空白占位草稿。
 */
export function isBlankDraftRecord(record: {
  date?: string;
  title?: string;
  contentHtml?: string;
  contentText?: string;
}): boolean {
  const date = (record.date ?? "").trim();
  const title = stripDatePrefixFromTitle(record.title ?? "", date).trim();
  const text = (record.contentText ?? stripHtml(record.contentHtml ?? "")).replace(/\s+/g, "");
  return !date && !title && text.length === 0;
}

/**
 * 将原平台 12 项心情归并映射至 8 档核心心情并去重，支持自定义映射覆盖。
 */
export function mapOldMoodsToNew(
  rawMoods: string[],
  customMap?: Record<string, string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawMoods) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    let mapped =
      customMap?.[cleaned] ??
      OLD_12_TO_NEW_8_MOOD_MAP[cleaned] ??
      OLD_12_TO_NEW_8_MOOD_MAP[cleaned.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, "").trim()];

    if (!mapped) {
      // 若已是新 8 档之一则直接保留
      if (/^(😄|🥰|😌|😮‍💨|😰|😤|😠|😢)\s+/.test(cleaned)) {
        mapped = cleaned;
      } else {
        mapped = "😌 平静";
      }
    }
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

export function normalizeDateString(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return "";
  const y = m[1];
  const mon = String(Number(m[2])).padStart(2, "0");
  const day = String(Number(m[3])).padStart(2, "0");
  const iso = `${y}-${mon}-${day}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return iso;
}

export function resolveConflictEntry(
  existing: {
    title: string;
    contentHtml: string;
    tags: string[];
    moods: string[];
  },
  incoming: {
    title: string;
    contentHtml: string;
    tags: string[];
    moods: string[];
  },
  strategy: ConflictStrategy
): {
  action: "skipped" | "overwritten" | "merged";
  title: string;
  contentHtml: string;
  tags: string[];
  moods: string[];
} {
  if (strategy === "skip") {
    return {
      action: "skipped",
      title: existing.title,
      contentHtml: existing.contentHtml,
      tags: existing.tags,
      moods: existing.moods
    };
  }
  if (strategy === "overwrite") {
    return {
      action: "overwritten",
      title: incoming.title || existing.title,
      contentHtml: incoming.contentHtml,
      tags: [...new Set(incoming.tags)],
      moods: [...new Set(incoming.moods)]
    };
  }
  const mergedTitle = existing.title || incoming.title;
  const separator = `<hr><p><strong>[合并导入内容]</strong></p>`;
  const mergedHtml =
    existing.contentHtml && incoming.contentHtml
      ? `${existing.contentHtml}${separator}${incoming.contentHtml}`
      : existing.contentHtml || incoming.contentHtml;
  return {
    action: "merged",
    title: mergedTitle,
    contentHtml: mergedHtml,
    tags: [...new Set([...existing.tags, ...incoming.tags])],
    moods: [...new Set([...existing.moods, ...incoming.moods])]
  };
}

/**
 * 解析 CSV 文本（支持双引号字段与字段内换行）。
 */
export function parseCsvRecords(csvText: string): Array<Record<string, string>> {
  const text = csvText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        if (text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const records: Array<Record<string, string>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0].trim() === "") continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (r[j] ?? "").trim();
    }
    records.push(obj);
  }
  return records;
}

/**
 * 将简化 Markdown 正文转换为块级 HTML（保留标题、列表、引用、代码块、分割线、图片、加粗/高亮）。
 */
export function markdownToHtml(
  md: string,
  imageUrlResolver?: (rawSrc: string) => string
): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const inlineFmt = (raw: string): string => {
    let s = escapeHtml(raw);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/==(.+?)==/g, "<mark>$1</mark>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      closeList();
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      closeList();
      continue;
    }
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      closeList();
      const alt = escapeHtml(imgMatch[1] || "日记配图");
      const rawSrc = imgMatch[2].trim();
      const src = imageUrlResolver ? imageUrlResolver(rawSrc) : rawSrc;
      out.push(`<img src="${escapeHtml(src)}" alt="${alt}" />`);
      continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeList();
      out.push("<hr>");
      continue;
    }
    if (trimmed.startsWith("### ")) {
      closeList();
      out.push(`<h3>${inlineFmt(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      out.push(`<h2>${inlineFmt(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      out.push(`<h2>${inlineFmt(trimmed.slice(2))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("> ")) {
      closeList();
      out.push(`<blockquote><p>${inlineFmt(trimmed.slice(2))}</p></blockquote>`);
      continue;
    }
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inlineFmt(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inlineFmt(olMatch[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineFmt(trimmed)}</p>`);
  }
  closeList();
  if (inCode && codeLines.length) {
    out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return out.join("");
}

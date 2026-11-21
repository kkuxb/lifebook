import type Database from "better-sqlite3";
import { listMoods } from "./tags-moods.js";

export interface HeatmapCell {
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

export function getHeatmap(
  db: Database.Database,
  year: string
): {
  year: string;
  availableYears: string[];
  cells: Record<string, HeatmapCell>;
  summary: { count: number; totalWords: number; avgWords: number; maxStreak: number };
} {
  const yearsRows = db
    .prepare(
      `SELECT DISTINCT substr(date, 1, 4) as y FROM entries WHERE deleted_at IS NULL ORDER BY y DESC`
    )
    .all() as Array<{ y: string }>;
  const availableYears = yearsRows.map((r) => r.y);

  const moodRows = listMoods(db);
  const moodToneMap = new Map(moodRows.map((m) => [m.label, m.tone]));

  const whereYear = year && year !== "all" ? "AND substr(e.date, 1, 4) = ?" : "";
  const params = year && year !== "all" ? [year] : [];

  const rows = db
    .prepare(
      `SELECT e.id, e.date, e.title, e.word_count, d.short_title
       FROM entries e
       LEFT JOIN entry_ai_digests d ON d.entry_id = e.id
       WHERE e.deleted_at IS NULL AND e.kind = 'daily' ${whereYear}
       ORDER BY e.date ASC`
    )
    .all(...params) as Array<{
    id: string;
    date: string;
    title: string;
    word_count: number;
    short_title: string | null;
  }>;

  const ids = rows.map((r) => r.id);
  const firstMoodMap = new Map<string, string>();
  const tagsMap = new Map<string, string[]>();

  if (ids.length > 0) {
    // 分批查询避免 SQLite 变量上限（999）
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const ph = chunk.map(() => "?").join(",");
      const mRows = db
        .prepare(
          `SELECT em.entry_id, m.label FROM entry_moods em
           JOIN moods m ON m.id = em.mood_id
           WHERE em.entry_id IN (${ph}) ORDER BY m.sort ASC`
        )
        .all(...chunk) as Array<{ entry_id: string; label: string }>;
      for (const mr of mRows) {
        if (!firstMoodMap.has(mr.entry_id)) firstMoodMap.set(mr.entry_id, mr.label);
      }

      const tRows = db
        .prepare(
          `SELECT et.entry_id, t.name FROM entry_tags et
           JOIN tags t ON t.id = et.tag_id
           WHERE et.entry_id IN (${ph}) ORDER BY t.sort ASC`
        )
        .all(...chunk) as Array<{ entry_id: string; name: string }>;
      for (const tr of tRows) {
        const arr = tagsMap.get(tr.entry_id) ?? [];
        arr.push(tr.name);
        tagsMap.set(tr.entry_id, arr);
      }
    }
  }

  const cells: Record<string, HeatmapCell> = {};
  let totalWords = 0;
  let maxStreak = 0;
  let curStreak = 0;
  let prevTime: number | null = null;

  for (const r of rows) {
    totalWords += r.word_count;
    const mood = firstMoodMap.get(r.id) ?? "😌 平静";
    const t = Date.parse(`${r.date}T00:00:00Z`);
    if (prevTime !== null && t - prevTime === 86_400_000) {
      curStreak += 1;
    } else {
      curStreak = 1;
    }
    if (curStreak > maxStreak) maxStreak = curStreak;
    prevTime = t;

    cells[r.date] = {
      date: r.date,
      entryId: r.id,
      wordCount: r.word_count,
      title: r.title || `${r.date} 日记`,
      shortTitle: r.short_title || "",
      aiReady: Boolean(r.short_title),
      mood,
      moodTone: moodToneMap.get(mood) ?? "#64748B",
      tags: tagsMap.get(r.id) ?? []
    };
  }

  return {
    year,
    availableYears,
    cells,
    summary: {
      count: rows.length,
      totalWords,
      avgWords: rows.length ? Math.round(totalWords / rows.length) : 0,
      maxStreak
    }
  };
}

export function getOverviewStats(
  db: Database.Database,
  year: string
): {
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
} {
  const yearsRows = db
    .prepare(
      `SELECT DISTINCT substr(date, 1, 4) as y FROM entries WHERE deleted_at IS NULL ORDER BY y DESC`
    )
    .all() as Array<{ y: string }>;
  const availableYears = yearsRows.map((r) => r.y);

  const isAll = !year || year === "all";
  const where = isAll ? "deleted_at IS NULL" : "deleted_at IS NULL AND substr(date, 1, 4) = ?";
  const params = isAll ? [] : [year];

  const agg = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(word_count), 0) as total, COALESCE(MAX(word_count), 0) as mx
       FROM entries WHERE ${where}`
    )
    .get(...params) as { cnt: number; total: number; mx: number };

  const monthlyWords = Array(12).fill(0) as number[];
  const mRows = db
    .prepare(
      `SELECT CAST(substr(date, 6, 2) AS INTEGER) as m, SUM(word_count) as w
       FROM entries WHERE ${where}
       GROUP BY m`
    )
    .all(...params) as Array<{ m: number; w: number }>;
  for (const r of mRows) {
    if (r.m >= 1 && r.m <= 12) monthlyWords[r.m - 1] = r.w;
  }

  const moodRows = db
    .prepare(
      `SELECT m.id, m.label, m.tone, COUNT(em.entry_id) as cnt
       FROM moods m
       LEFT JOIN entry_moods em ON em.mood_id = m.id
       LEFT JOIN entries e ON e.id = em.entry_id AND e.deleted_at IS NULL ${isAll ? "" : "AND substr(e.date, 1, 4) = ?"}
       GROUP BY m.id
       ORDER BY m.sort ASC`
    )
    .all(...params) as Array<{ id: string; label: string; tone: string; cnt: number }>;

  // 重新统计受年份过滤后的精准心情数（避免 LEFT JOIN 条件误计被过滤掉的日记）
  const moodCountRows = db
    .prepare(
      `SELECT em.mood_id, COUNT(*) as cnt
       FROM entry_moods em
       JOIN entries e ON e.id = em.entry_id
       WHERE e.deleted_at IS NULL ${isAll ? "" : "AND substr(e.date, 1, 4) = ?"}
       GROUP BY em.mood_id`
    )
    .all(...params) as Array<{ mood_id: string; cnt: number }>;
  const mcMap = new Map(moodCountRows.map((x) => [x.mood_id, x.cnt]));

  const moodDistribution = moodRows.map((m) => ({
    id: m.id,
    label: m.label,
    tone: m.tone,
    count: mcMap.get(m.id) ?? 0
  }));

  // 聚合主题词云
  const topicRows = db
    .prepare(
      `SELECT d.topics_json FROM entry_ai_digests d
       JOIN entries e ON e.id = d.entry_id
       WHERE e.deleted_at IS NULL ${isAll ? "" : "AND substr(e.date, 1, 4) = ?"}`
    )
    .all(...params) as Array<{ topics_json: string }>;

  const topicFreq = new Map<string, number>();
  for (const r of topicRows) {
    try {
      const list = JSON.parse(r.topics_json) as string[];
      for (const t of list) {
        const clean = t.trim();
        if (clean) topicFreq.set(clean, (topicFreq.get(clean) ?? 0) + 1);
      }
    } catch {
      // ignore
    }
  }
  const topTopics = [...topicFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([word, count]) => ({ word, count }));

  return {
    year: isAll ? "all" : year,
    availableYears,
    count: agg.cnt,
    totalWords: agg.total,
    avgWords: agg.cnt ? Math.round(agg.total / agg.cnt) : 0,
    maxWords: agg.mx,
    monthlyWords,
    monthlyThousandWords: monthlyWords.map((w) => Math.round(w / 1000)),
    moodDistribution,
    topTopics
  };
}

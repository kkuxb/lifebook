import { Fragment, useEffect, useState } from "react";
import {
  getShanghaiNowParts,
  type EntryRecord,
  type MoodItem,
  type TagItem
} from "@lifebook/core";
import { api } from "../lib/api";
import { TagBadge } from "../components/TagBadge";

type DatePreset = "all" | "7d" | "30d" | "month" | "thisYear" | "lastYear" | "2024" | "2023" | "custom";

function shiftDate(baseIso: string, deltaDays: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function getDateRangeForPreset(preset: DatePreset, today: string, customStart: string, customEnd: string) {
  const curYear = today.slice(0, 4);
  const lastYear = String(Number(curYear) - 1);
  if (preset === "7d") return { start: shiftDate(today, -6), end: today };
  if (preset === "30d") return { start: shiftDate(today, -29), end: today };
  if (preset === "month") return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-31` };
  if (preset === "thisYear") return { start: `${curYear}-01-01`, end: `${curYear}-12-31` };
  if (preset === "lastYear") return { start: `${lastYear}-01-01`, end: `${lastYear}-12-31` };
  if (preset === "2024") return { start: "2024-01-01", end: "2024-12-31" };
  if (preset === "2023") return { start: "2023-01-01", end: "2023-12-31" };
  if (preset === "custom") return { start: customStart, end: customEnd };
  return { start: "", end: "" };
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="search-hl">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function HistoryPage({
  theme,
  tags,
  moods,
  initialQuery,
  initialTag,
  onOpenEntryId
}: {
  theme: "light" | "dark";
  tags: TagItem[];
  moods: MoodItem[];
  initialQuery: string;
  initialTag: string;
  onOpenEntryId: (id: string) => void;
}) {
  const today = getShanghaiNowParts().date;
  const [q, setQ] = useState(initialQuery);
  const [preset, setPreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [kind, setKind] = useState("all");
  const [tagFilter, setTagFilter] = useState(initialTag || "all");
  const [moodFilter, setMoodFilter] = useState("all");
  const [layout, setLayout] = useState<"list" | "gallery">("list");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<EntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setTagFilter(initialTag || "all");
  }, [initialTag]);

  useEffect(() => {
    let cancelled = false;
    const range = getDateRangeForPreset(preset, today, startDate, endDate);
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .listEntries({
          q,
          startDate: range.start,
          endDate: range.end,
          kind,
          tag: tagFilter,
          mood: moodFilter,
          page,
          pageSize: 40
        })
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setTotal(res.total);
          setTotalWords(res.totalWords);
          setElapsedMs(res.elapsedMs);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, preset, startDate, endDate, kind, tagFilter, moodFilter, page, today]);

  const activeRange = getDateRangeForPreset(preset, today, startDate, endDate);
  const presetItems: Array<[DatePreset, string]> = [
    ["all", "全部时间"],
    ["7d", "近 7 天"],
    ["30d", "近 30 天"],
    ["month", "本月"],
    ["thisYear", "今年"],
    ["lastYear", "去年"],
    ["2024", "2024 年"],
    ["2023", "2023 年"]
  ];

  return (
    <div>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900 }}>历史日记与全文检索</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>
            基于 SQLite FTS5 全文索引与中文二元分词，支持跨年毫秒检索与日期范围组合筛选
          </div>
        </div>
        <div className="seg-mini">
          <button
            type="button"
            className={layout === "list" ? "active" : ""}
            onClick={() => setLayout("list")}
          >
            紧凑列表
          </button>
          <button
            type="button"
            className={layout === "gallery" ? "active" : ""}
            onClick={() => setLayout("gallery")}
          >
            正文卡片
          </button>
        </div>
      </div>

      <div className="card search-bar-box">
        <span style={{ fontSize: 16 }}>🔎</span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="搜索标题、正文关键词（例如试搜：海风、银杏、阅读、复盘）…"
        />
        {q && (
          <button
            type="button"
            className="btn btn-soft"
            style={{ height: 30, padding: "0 10px", fontSize: 12 }}
            onClick={() => {
              setQ("");
              setPage(1);
            }}
          >
            清空
          </button>
        )}
        <span className="badge-count num">
          {loading ? "检索中…" : `${total} 篇 · ${totalWords.toLocaleString()} 字 · ${elapsedMs} 毫秒`}
        </span>
      </div>

      <div className="date-presets" aria-label="快捷日期范围">
        {presetItems.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`preset-pill ${preset === k ? "active" : ""}`}
            onClick={() => {
              setPreset(k);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <div className="date-range-inputs" title="自定义起止日期">
          <span style={{ color: "var(--ink-3)" }}>起</span>
          <input
            type="date"
            value={activeRange.start}
            onChange={(e) => {
              setPreset("custom");
              setStartDate(e.target.value);
              setEndDate(activeRange.end);
              setPage(1);
            }}
          />
          <span style={{ color: "var(--ink-3)" }}>至</span>
          <input
            type="date"
            value={activeRange.end}
            onChange={(e) => {
              setPreset("custom");
              setStartDate(activeRange.start);
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="select-pill"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部类型</option>
          <option value="daily">每日日记</option>
          <option value="special">专项复盘</option>
        </select>

        <select
          className="select-pill"
          value={tagFilter}
          onChange={(e) => {
            setTagFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
              {!t.enabled ? "（已停用）" : ""}
            </option>
          ))}
        </select>

        <select
          className="select-pill"
          value={moodFilter}
          onChange={(e) => {
            setMoodFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部心情</option>
          {moods.map((m) => (
            <option key={m.id} value={m.label}>
              {m.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn-soft"
          style={{ height: 36 }}
          onClick={() => {
            setQ("");
            setPreset("all");
            setStartDate("");
            setEndDate("");
            setKind("all");
            setTagFilter("all");
            setMoodFilter("all");
            setPage(1);
          }}
        >
          重置筛选
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontWeight: 700 }}>
          {loading ? "正在读取历史记录…" : "没有符合当前条件的日记，试试清空关键词或放宽筛选条件。"}
        </div>
      ) : layout === "list" ? (
        <div className="hist-list">
          {items.map((e) => (
            <div key={e.id} className="card lift hist-row" onClick={() => onOpenEntryId(e.id)}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-3)" }}>
                    {e.kind === "special" ? `📌 专项复盘 · ${e.date}` : e.date}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800 }}>
                    <HighlightedText text={e.title || `${e.date} 日记`} query={q} />
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  <HighlightedText text={e.contentText.slice(0, 140)} query={q} />
                  {e.contentText.length > 140 ? "…" : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{e.moods.join(" ")}</span>
                {e.tags.map((tName) => (
                  <TagBadge key={tName} tagName={tName} tags={tags} theme={theme} />
                ))}
                <span className="badge-count num">{e.wordCount} 字</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="hist-gallery">
          {items.map((e) => (
            <div key={e.id} className="card lift hist-card" onClick={() => onOpenEntryId(e.id)}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}>
                <span className="num">{e.kind === "special" ? `📌 ${e.date}` : e.date}</span>
                <span>{e.moods.join(" ")}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4 }}>
                <HighlightedText text={e.title || `${e.date} 日记`} query={q} />
              </div>
              <div className="hist-card-snippet">
                <HighlightedText text={e.contentText} query={q} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", gap: 8 }}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {e.tags.map((tName) => (
                    <TagBadge key={tName} tagName={tName} tags={tags} theme={theme} />
                  ))}
                </div>
                <span className="num" style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>
                  {e.wordCount} 字
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 40 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="badge-count num" style={{ height: 36, padding: "0 14px" }}>
            第 {page} 页 / 共 {Math.ceil(total / 40)} 页
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page * 40 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

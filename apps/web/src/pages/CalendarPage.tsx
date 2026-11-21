import { useEffect, useState } from "react";
import { getShanghaiNowParts, type AiConfigPublic, type TagItem } from "@lifebook/core";
import { api } from "../lib/api";

export function CalendarPage({
  tags,
  aiConfig,
  onOpenDate,
  onNotify
}: {
  tags: TagItem[];
  aiConfig: AiConfigPublic;
  onOpenDate: (date: string) => void;
  onNotify: (msg: string) => void;
}) {
  const today = getShanghaiNowParts().date;
  const [calYear, setCalYear] = useState(Number(today.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [heatmap, setHeatmap] = useState<Awaited<ReturnType<typeof api.getHeatmap>> | null>(null);
  const [recalcDate, setRecalcDate] = useState<string | null>(null);

  async function loadYear() {
    try {
      const res = await api.getHeatmap(String(calYear));
      setHeatmap(res);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadYear();
  }, [calYear]);

  async function handleRecalcDigest(entryId: string, dateStr: string) {
    setRecalcDate(dateStr);
    try {
      await api.refreshEntryDigest(entryId);
      onNotify(`✦ 已为 ${dateStr} 按需生成并缓存智能概要`);
      await loadYear();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "补算概要失败");
    } finally {
      setRecalcDate(null);
    }
  }

  const first = new Date(Date.UTC(calYear, calMonth, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(Date.UTC(calYear, calMonth, 1 - startOffset));
  const cells: Array<{ date: string; day: number; isCur: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000);
    cells.push({
      date: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      isCur: d.getUTCMonth() === calMonth
    });
  }

  return (
    <div>
      <div className="cal-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="num" style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: "-.02em" }}>
              {calYear} 年 {calMonth + 1} 月
            </h1>
            {aiConfig.enabled ? (
              <span className="ai-badge">✦ 格子展示智能短标题</span>
            ) : (
              <span className="raw-badge">已降级为原标题</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>
            点击任意日期格阅读、续写或补写日记；未总结日期可点「✦ 补算概要」按需生成
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (calMonth === 0) {
                setCalYear((y) => y - 1);
                setCalMonth(11);
              } else {
                setCalMonth((m) => m - 1);
              }
            }}
          >
            ← 上个月
          </button>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => {
              setCalYear(Number(today.slice(0, 4)));
              setCalMonth(Number(today.slice(5, 7)) - 1);
            }}
          >
            回到本月
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (calMonth === 11) {
                setCalYear((y) => y + 1);
                setCalMonth(0);
              } else {
                setCalMonth((m) => m + 1);
              }
            }}
          >
            下个月 →
          </button>
        </div>
      </div>

      <div className="card cal-card">
        <div className="cal-weekdays">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div className="cal-grid">
          {cells.map((c) => {
            const rec = heatmap?.cells[c.date];
            const firstTag = rec?.tags[0] || "";
            const tObj = tags.find((x) => x.name === firstTag);
            const hasAiTitle = Boolean(rec && aiConfig.enabled && rec.aiReady && rec.shortTitle);
            const needRecalc = Boolean(rec && aiConfig.enabled && !rec.aiReady);
            const shownTitle = hasAiTitle ? rec!.shortTitle : rec?.title || "";

            return (
              <div
                key={c.date}
                className={`cal-cell ${c.isCur ? "" : "other-month"} ${c.date === today ? "today" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenDate(c.date)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenDate(c.date);
                }}
              >
                <div className="cal-cell-top">
                  <span className="num">{c.day}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {hasAiTitle && (
                      <span title="智能短标题" style={{ color: "var(--ai-ink)", fontSize: 11, fontWeight: 900 }}>
                        ✦
                      </span>
                    )}
                    <span>{rec ? rec.mood.split(" ")[0] : ""}</span>
                  </span>
                </div>
                {rec ? (
                  <>
                    <div className="cal-cell-title">{shownTitle}</div>
                    <div className="cal-cell-foot">
                      {needRecalc ? (
                        <button
                          type="button"
                          className="cal-recalc-btn"
                          disabled={recalcDate === c.date}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRecalcDigest(rec.entryId, c.date);
                          }}
                        >
                          {recalcDate === c.date ? "生成中…" : "✦ 补算概要"}
                        </button>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {tObj && (
                            <i style={{ width: 6, height: 6, borderRadius: "50%", background: tObj.color, display: "inline-block" }} />
                          )}
                          <span>{firstTag || "日记"}</span>
                        </span>
                      )}
                      <span className="num">{rec.wordCount}字</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-4)" }}>+ 补写</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

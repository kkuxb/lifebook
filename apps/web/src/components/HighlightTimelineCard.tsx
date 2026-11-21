import { useState } from "react";
import type { EntryRecord, HighlightItem } from "@lifebook/core";
import { api } from "../lib/api";

export function HighlightTimelineCard({
  title,
  subDesc,
  list,
  scope,
  periodKey,
  onOpenEntry,
  onUpdated,
  onNotify
}: {
  title: string;
  subDesc: string;
  list: HighlightItem[];
  scope: "monthly" | "yearly";
  periodKey: string;
  onOpenEntry: (entryId: string) => void;
  onUpdated: (nextList: HighlightItem[]) => void;
  onNotify: (msg: string) => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [candidates, setCandidates] = useState<EntryRecord[]>([]);
  const [loadingPick, setLoadingPick] = useState(false);

  async function openManualPicker() {
    setPickOpen(true);
    setLoadingPick(true);
    try {
      const startDate = scope === "monthly" ? `${periodKey}-01` : `${periodKey}-01-01`;
      const endDate = scope === "monthly" ? `${periodKey}-31` : `${periodKey}-12-31`;
      const res = await api.listEntries({ startDate, endDate, pageSize: 60 });
      setCandidates(res.items);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "加载候选日记失败");
    } finally {
      setLoadingPick(false);
    }
  }

  async function handlePin(entryId: string, pinned: boolean) {
    try {
      const res = pinned
        ? await api.unpinHighlight(scope, periodKey, entryId)
        : await api.pinHighlight(scope, periodKey, entryId);
      onUpdated(res.highlights);
      onNotify(pinned ? "已取消钉选锁定" : "📌 已钉选锁定，重算复盘时严格保留");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleExclude(entryId: string) {
    try {
      const res = await api.excludeHighlight(scope, periodKey, entryId);
      onUpdated(res.highlights);
      onNotify("已将该条移出时间轴");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "移出失败");
    }
  }

  async function handleManualPin(entryId: string) {
    try {
      const res = await api.pinHighlight(scope, periodKey, entryId);
      onUpdated(res.highlights);
      setPickOpen(false);
      onNotify("📌 已手动钉选为高光记忆节点");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "钉选失败");
    }
  }

  return (
    <div className="card insight-card" style={{ marginTop: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>{subDesc}</div>
        </div>
        <button
          type="button"
          className="btn btn-soft"
          style={{ height: 30, padding: "0 11px", fontSize: 12 }}
          onClick={() => void openManualPicker()}
        >
          + 手动钉选一篇日记
        </button>
      </div>

      {list.length > 0 ? (
        <div className="highlight-timeline">
          {list.map((hl) => (
            <div key={hl.entryId} className="hl-item-row">
              <button
                type="button"
                className="hl-main-btn"
                onClick={() => onOpenEntry(hl.entryId)}
                title="点击直达这篇日记原文"
              >
                <span className="hl-dot" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="num" style={{ fontSize: 13, fontWeight: 900 }}>
                      {hl.date}
                      {hl.quarter ? ` · ${hl.quarter}` : ""}
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 800 }}>{hl.title}</span>
                    {hl.pinned ? (
                      <span className="pin-badge">📌 已手动钉选</span>
                    ) : (
                      <span className="algo-tag">{hl.algoTag}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>
                    {hl.reason}
                  </div>
                </div>
              </button>
              <div className="hl-actions">
                <button
                  type="button"
                  className="hl-op-btn"
                  onClick={() => void handlePin(hl.entryId, hl.pinned)}
                  title={hl.pinned ? "取消钉选锁定" : "钉选锁定，重算复盘时自动保留"}
                >
                  {hl.pinned ? "取消钉选" : "📌 钉选"}
                </button>
                <button
                  type="button"
                  className="hl-op-btn"
                  onClick={() => void handleExclude(hl.entryId)}
                  title="从本条时间轴移出"
                >
                  移出
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: 18,
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 12.5,
            fontWeight: 700,
            background: "var(--surface-hover)",
            borderRadius: 12
          }}
        >
          当前时间轴暂无条目，可点击右上「+ 手动钉选一篇日记」或重新生成。
        </div>
      )}

      {pickOpen && (
        <div className="center-modal-mask" onClick={() => setPickOpen(false)}>
          <div className="center-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>选择一篇日记钉选为高光（{periodKey}）</div>
              <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setPickOpen(false)}>
                ✕
              </button>
            </div>
            {loadingPick ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--ink-3)" }}>正在加载本期日记…</div>
            ) : candidates.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--ink-3)" }}>本周期暂无可选日记</div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="manage-row"
                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                    onClick={() => void handleManualPin(c.id)}
                  >
                    <div>
                      <span className="num" style={{ fontWeight: 800, marginRight: 8 }}>{c.date}</span>
                      <span style={{ fontWeight: 700 }}>{c.digest?.shortTitle || c.title || "无标题日记"}</span>
                    </div>
                    <span className="badge-count num">{c.wordCount} 字</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

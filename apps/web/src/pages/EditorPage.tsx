import { useEffect, useRef, useState } from "react";
import {
  buildHtmlFromSections,
  countWords,
  getShanghaiNowParts,
  type AiConfigPublic,
  type EntryKind,
  type EntryRecord,
  type EntrySnapshot,
  type MoodItem,
  type TagItem,
  type TemplateItem
} from "@lifebook/core";
import { api } from "../lib/api";
import { enqueueOfflineDraft, findOfflineDraft, removeOfflineDraft } from "../lib/offlineQueue";
import { RichEditor } from "../components/RichEditor";
import { TagBadge } from "../components/TagBadge";

export function EditorPage({
  theme,
  entryId,
  initialDate,
  initialKind,
  initialTag,
  tags,
  moods,
  templates,
  aiConfig,
  offlineSyncSignal,
  onBack,
  onOpenEntryId,
  onSyncChange,
  onNotify
}: {
  theme: "light" | "dark";
  entryId: string | null;
  initialDate: string;
  initialKind: EntryKind;
  initialTag?: string;
  tags: TagItem[];
  moods: MoodItem[];
  templates: TemplateItem[];
  aiConfig: AiConfigPublic;
  offlineSyncSignal?: { tick: number; entries: EntryRecord[] };
  onBack: () => void;
  onOpenEntryId: (id: string) => void;
  onSyncChange: (mode: "ok" | "syncing" | "offline") => void;
  onNotify: (msg: string) => void;
}) {
  const [curId, setCurId] = useState<string | null>(entryId);
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [date, setDate] = useState<string>(initialDate || getShanghaiNowParts().date);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("<p></p>");
  const [selMoods, setSelMoods] = useState<string[]>(["😌 平静"]);
  const [selTags, setSelTags] = useState<string[]>(initialTag ? [initialTag] : ["日常记录"]);
  const [saveText, setSaveText] = useState("已就绪 · 本地防丢已开启");
  const [popover, setPopover] = useState<null | "mood" | "tag" | "template" | "versions">(null);
  const [snapshots, setSnapshots] = useState<EntrySnapshot[]>([]);
  const [showOtd, setShowOtd] = useState(false);
  const [otdMode, setOtdMode] = useState<"summary" | "raw">("summary");
  const [otdList, setOtdList] = useState<EntryRecord[]>([]);

  const saveTimerRef = useRef<number | null>(null);
  const latestPayloadRef = useRef({ curId, kind, date, title, contentHtml, selTags, selMoods });
  latestPayloadRef.current = { curId, kind, date, title, contentHtml, selTags, selMoods };

  // 加载已有日记或按日期检查当日是否已有日记
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 检查离线暂存草稿
      const offline = findOfflineDraft({
        id: entryId || undefined,
        kind: initialKind,
        date: initialDate
      });

      if (entryId) {
        try {
          const rec = await api.getEntryById(entryId);
          if (cancelled) return;
          setCurId(rec.id);
          setKind(rec.kind);
          setDate(rec.date);
          setTitle(offline ? offline.title : rec.title);
          setContentHtml(offline ? offline.contentHtml : rec.contentHtml || "<p></p>");
          setSelMoods(offline ? offline.moods : rec.moods.length ? rec.moods : []);
          setSelTags(offline ? offline.tags : rec.tags.length ? rec.tags : []);
          if (offline) {
            setSaveText("已恢复离线暂存草稿");
            onNotify("已恢复离线暂存未同步草稿");
          } else {
            setSaveText("已同步至服务器");
          }
          void api.getEntryByDate(rec.date).then((r) => !cancelled && setOtdList(r.onThisDay)).catch(() => {});
          return;
        } catch {
          // 若离线尝试用暂存恢复
        }
      }

      if (initialKind === "daily") {
        try {
          const r = await api.getEntryByDate(initialDate);
          if (cancelled) return;
          setOtdList(r.onThisDay);
          if (r.entry) {
            setCurId(r.entry.id);
            setKind(r.entry.kind);
            setDate(r.entry.date);
            setTitle(offline ? offline.title : r.entry.title);
            setContentHtml(offline ? offline.contentHtml : r.entry.contentHtml || "<p></p>");
            setSelMoods(offline ? offline.moods : r.entry.moods);
            setSelTags(
              offline
                ? offline.tags
                : initialTag && !r.entry.tags.includes(initialTag)
                  ? [...r.entry.tags, initialTag]
                  : r.entry.tags
            );
            setSaveText(offline ? "已恢复离线暂存草稿" : "已打开当日日记");
            return;
          }
        } catch {
          // 离线状态
        }
      }

      if (offline) {
        setTitle(offline.title);
        setContentHtml(offline.contentHtml);
        setSelMoods(offline.moods);
        setSelTags(offline.tags);
        setSaveText("已恢复离线暂存草稿");
      } else {
        setCurId(null);
        setTitle("");
        const defaultTpl = templates.find((t) => t.isDefault) || templates[0];
        setContentHtml(defaultTpl ? buildHtmlFromSections(defaultTpl.sections) : "<p></p>");
        setSelMoods(["😌 平静"]);
        setSelTags(initialTag ? [initialTag] : ["日常记录"]);
        setSaveText("新建草稿 · 本地防丢已开启");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [entryId, initialDate, initialKind, initialTag]);

  // 离线队列恢复同步后，实时更新编辑器左上角徽标与当前日记 ID
  useEffect(() => {
    if (!offlineSyncSignal || offlineSyncSignal.tick === 0) return;
    const p = latestPayloadRef.current;
    const stillOffline = findOfflineDraft({
      id: p.curId || undefined,
      kind: p.kind,
      date: p.date
    });
    if (!stillOffline) {
      const matched = offlineSyncSignal.entries.find(
        (e) =>
          (p.curId && e.id === p.curId) ||
          (p.kind === "daily" && e.kind === "daily" && e.date === p.date)
      );
      if (matched && matched.id !== p.curId) {
        setCurId(matched.id);
      }
      setSaveText(`已同步 · ${getShanghaiNowParts().time.slice(0, 5)}`);
    }
  }, [offlineSyncSignal]);

  async function persistNow(createSnapshot: boolean = true): Promise<"synced" | "offline"> {
    const p = latestPayloadRef.current;
    // 先写本地防丢草稿
    enqueueOfflineDraft({
      id: p.curId || undefined,
      kind: p.kind,
      date: p.date,
      title: p.title,
      contentHtml: p.contentHtml,
      tags: p.selTags,
      moods: p.selMoods
    });

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      onSyncChange("offline");
      setSaveText("离线暂存中（联网后自动同步）");
      return "offline";
    }

    onSyncChange("syncing");
    setSaveText("正在保存…");
    try {
      const saved = await api.saveEntry({
        id: p.curId || undefined,
        kind: p.kind,
        date: p.date,
        title: p.title,
        contentHtml: p.contentHtml,
        tags: p.selTags,
        moods: p.selMoods,
        createSnapshot
      });
      removeOfflineDraft({ id: p.curId || undefined, kind: p.kind, date: p.date });
      setCurId(saved.id);
      onSyncChange("ok");
      setSaveText(`已保存 · ${getShanghaiNowParts().time.slice(0, 5)}`);
      if (popover === "versions") {
        const snaps = await api.listSnapshots(saved.id);
        setSnapshots(snaps.items);
      }
      return "synced";
    } catch {
      onSyncChange("offline");
      setSaveText("保存受阻，已安全暂存本地防丢队列");
      return "offline";
    }
  }

  function scheduleAutoSave() {
    setSaveText("编辑中…");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persistNow(true);
    }, 650);
  }

  async function openVersionsPopover() {
    if (popover === "versions") {
      setPopover(null);
      return;
    }
    setPopover("versions");
    if (curId) {
      try {
        const res = await api.listSnapshots(curId);
        setSnapshots(res.items);
      } catch {
        setSnapshots([]);
      }
    } else {
      setSnapshots([]);
    }
  }

  async function handleRestoreSnapshot(snapId: string) {
    if (!curId) return;
    try {
      const restored = await api.restoreSnapshot(curId, snapId);
      setTitle(restored.title);
      setContentHtml(restored.contentHtml);
      setPopover(null);
      onNotify("已恢复至选定当日快照版本");
      const snaps = await api.listSnapshots(curId);
      setSnapshots(snaps.items);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "恢复快照失败");
    }
  }

  async function handleMoveToTrash() {
    if (!curId) {
      onBack();
      return;
    }
    try {
      await api.deleteEntry(curId);
      removeOfflineDraft({ id: curId, kind, date });
      onNotify("已移入 30 天回收站（可在设置-备份与回收站中还原）");
      onBack();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "删除失败");
    }
  }

  const wordCount = countWords(contentHtml);
  const activeTags = tags.filter((t) => t.enabled);

  return (
    <div className="editor-shell">
      <div className="editor-main-col">
        <div className="editor-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 34, padding: "0 12px" }}
              onClick={() => {
                void persistNow(true);
                onBack();
              }}
            >
              ← 返回
            </button>
            <span className="save-badge">
              <span className="sync-dot" style={{ color: "var(--ok-dot)" }} />
              <span className="num">{saveText}</span>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn btn-soft"
              style={{ height: 34, padding: "0 12px" }}
              onClick={() => setPopover(popover === "template" ? null : "template")}
            >
              🧩 套用模板
            </button>
            <button
              type="button"
              className={`btn ${showOtd ? "btn-dark" : "btn-ghost"}`}
              style={{ height: 34, padding: "0 12px" }}
              onClick={() => setShowOtd((v) => !v)}
            >
              🕰 那年今日 ({otdList.length})
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 34, padding: "0 12px" }}
              onClick={() => void openVersionsPopover()}
            >
              🕒 当日快照
            </button>
            {curId && (
              <button
                type="button"
                className="btn btn-danger-soft"
                style={{ height: 34, padding: "0 10px" }}
                onClick={() => void handleMoveToTrash()}
              >
                移入回收站
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 34, padding: "0 16px", fontSize: 13, borderRadius: 10 }}
              onClick={() => {
                void persistNow(true).then((status) =>
                  onNotify(
                    status === "synced"
                      ? "已保存至服务器"
                      : "当前网络不可用，已暂存至本地防丢队列，联网后自动同步"
                  )
                );
              }}
            >
              立即保存
            </button>
          </div>
        </div>

        <article className="paper-card paper-canvas">
          <div className="paper-meta-top">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--ink)" }}>
                {kind === "daily" ? "📔 每日日记" : "📌 专项复盘"}
              </span>
              <label className="date-input-pill">
                <span>{kind === "daily" ? "日期" : "记录日期"}</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setDate(nextDate);
                    if (kind === "daily") {
                      void api.getEntryByDate(nextDate).then((r) => {
                        setOtdList(r.onThisDay);
                        if (r.entry && r.entry.id !== curId) {
                          onNotify(`${nextDate} 已有日记，已切换至该日续写`);
                          onOpenEntryId(r.entry.id);
                        }
                      });
                    }
                  }}
                />
              </label>
            </div>
            <span className="badge-count num">正文 {wordCount} 字</span>
          </div>

          <input
            className="doc-title-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleAutoSave();
            }}
            placeholder="用一句话概括今天（可空，展示时自动带日期）…"
          />

          <div className="meta-chips-bar">
            {selMoods.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                title="点击移除"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" }}
                onClick={() => {
                  setSelMoods((prev) => prev.filter((x) => x !== m));
                  scheduleAutoSave();
                }}
              >
                {m} ×
              </button>
            ))}
            <button
              type="button"
              className="add-meta-btn"
              onClick={() => setPopover(popover === "mood" ? null : "mood")}
            >
              + 心情
            </button>
            <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
            {selTags.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <TagBadge tagName={t} tags={tags} theme={theme} />
                <button
                  type="button"
                  style={{ border: 0, background: "transparent", color: "var(--ink-3)", fontSize: 12, padding: "0 4px" }}
                  onClick={() => {
                    setSelTags((prev) => prev.filter((x) => x !== t));
                    scheduleAutoSave();
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="add-meta-btn"
              onClick={() => setPopover(popover === "tag" ? null : "tag")}
            >
              + 标签
            </button>

            {popover === "mood" && (
              <div className="popover-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                  <span>选择今日心情（可多选）</span>
                  <button type="button" style={{ border: 0, background: "transparent" }} onClick={() => setPopover(null)}>✕</button>
                </div>
                <div className="popover-grid">
                  {moods.map((m) => {
                    const active = selMoods.includes(m.label);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`pick-opt ${active ? "selected" : ""}`}
                        onClick={() => {
                          setSelMoods((prev) =>
                            prev.includes(m.label) ? prev.filter((x) => x !== m.label) : [...prev, m.label]
                          );
                          scheduleAutoSave();
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {popover === "tag" && (
              <div className="popover-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                  <span>选择分类标签（可多选）</span>
                  <button type="button" style={{ border: 0, background: "transparent" }} onClick={() => setPopover(null)}>✕</button>
                </div>
                <div className="popover-grid">
                  {activeTags.map((t) => {
                    const active = selTags.includes(t.name);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`pick-opt ${active ? "selected" : ""}`}
                        onClick={() => {
                          setSelTags((prev) =>
                            prev.includes(t.name) ? prev.filter((x) => x !== t.name) : [...prev, t.name]
                          );
                          scheduleAutoSave();
                        }}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {popover === "template" && (
              <div className="popover-panel" style={{ right: 0, left: "auto", width: 340 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                  <span>插入写作分段模板</span>
                  <button type="button" style={{ border: 0, background: "transparent" }} onClick={() => setPopover(null)}>✕</button>
                </div>
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: 6,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--surface-hover)"
                    }}
                    onClick={() => {
                      const add = buildHtmlFromSections(tpl.sections);
                      setContentHtml((prev) => `${prev}${add}`);
                      setPopover(null);
                      scheduleAutoSave();
                      onNotify(`已插入「${tpl.name}」分段骨架`);
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>
                      {tpl.sections.join(" · ")}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {popover === "versions" && (
              <div className="popover-panel" style={{ right: 0, left: "auto", width: 340 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                  <span>当日防丢快照（最多保留 5 份，跨日自动清理）</span>
                  <button type="button" style={{ border: 0, background: "transparent" }} onClick={() => setPopover(null)}>✕</button>
                </div>
                {snapshots.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: 8 }}>
                    今日暂无已落盘快照，保存日记后自动保留最近 5 份当日快照。
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {snapshots.map((sp) => (
                      <div key={sp.id} className="sub-card" style={{ padding: "10px 12px", marginBottom: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div>
                            <div className="num" style={{ fontSize: 12, fontWeight: 800 }}>
                              {sp.snapshotDate} · {getShanghaiNowParts(new Date(sp.createdAt)).time}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                              {sp.title || "无标题"} · {sp.wordCount} 字
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ height: 26, padding: "0 9px", fontSize: 11.5 }}
                            onClick={() => void handleRestoreSnapshot(sp.id)}
                          >
                            恢复此版
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <RichEditor
            valueHtml={contentHtml}
            onChangeHtml={(html) => {
              setContentHtml(html);
              scheduleAutoSave();
            }}
            onNotify={onNotify}
          />
        </article>
      </div>

      {showOtd && (
        <aside className="card otd-drawer" aria-label="那年今日对照阅读">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>🕰 那年今日 ({date.slice(5)})</div>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 30, height: 30, borderRadius: 9 }}
              onClick={() => setShowOtd(false)}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>边对照往年回忆，边写今天</span>
            {aiConfig.enabled ? (
              <div className="mini-toggle">
                <button
                  type="button"
                  className={otdMode === "summary" ? "active" : ""}
                  onClick={() => setOtdMode("summary")}
                >
                  ✦ 智能概要
                </button>
                <button
                  type="button"
                  className={otdMode === "raw" ? "active" : ""}
                  onClick={() => setOtdMode("raw")}
                >
                  查看原文
                </button>
              </div>
            ) : (
              <span className="raw-badge">已降级为原文</span>
            )}
          </div>
          {otdList.length === 0 ? (
            <div className="otd-drawer-item" style={{ color: "var(--ink-3)", fontSize: 13 }}>
              历史上这一天还没有记录。
            </div>
          ) : (
            otdList.map((m) => {
              const showAi = aiConfig.enabled && otdMode === "summary" && Boolean(m.digest?.summary);
              return (
                <div key={m.id} className="otd-drawer-item">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 800 }}>
                    <span className="num">{m.date}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {showAi ? <span className="ai-badge">✦ 概要</span> : <span className="raw-badge">原文</span>}
                      <span>{m.moods.join(" ")}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
                    {showAi ? m.digest?.shortTitle : m.title || `${m.date} 日记`}
                  </div>
                  <div className="otd-drawer-body">{showAi ? m.digest?.summary : m.contentText}</div>
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn-soft"
                      style={{ height: 26, padding: "0 9px", fontSize: 11.5 }}
                      onClick={() => onOpenEntryId(m.id)}
                    >
                      打开该篇 →
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </aside>
      )}
    </div>
  );
}

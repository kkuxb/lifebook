import { useEffect, useState } from "react";
import {
  getShanghaiNowParts,
  type AiConfigPublic,
  type EntryRecord,
  type MoodItem,
  type QaResponse,
  type TagItem
} from "@lifebook/core";
import { api } from "../lib/api";
import { TagBadge } from "../components/TagBadge";

interface QaThreadItem {
  id: string;
  question: string;
  response?: QaResponse;
  error?: string;
  traceOpen: boolean;
}

const SAMPLE_QUESTIONS = [
  "去年这个时候我在忙什么？",
  "翻翻最近我心情比较低落或疲惫的日子",
  "过去哪几次海边或户外出行最开心？",
  "统计我一共写了多少篇、累计多少字"
];

export function HomePage({
  theme,
  tags,
  moods,
  aiConfig,
  onWriteToday,
  onNewSpecial,
  onOpenEntryId,
  onOpenDate,
  onFilterByTag,
  onQuickTagToday,
  onOpenHistory,
  onOpenSettings,
  onNotify
}: {
  theme: "light" | "dark";
  tags: TagItem[];
  moods: MoodItem[];
  aiConfig: AiConfigPublic;
  onWriteToday: () => void;
  onNewSpecial: () => void;
  onOpenEntryId: (id: string) => void;
  onOpenDate: (date: string) => void;
  onFilterByTag: (tagName: string) => void;
  onQuickTagToday: (tagName: string) => void;
  onOpenHistory: () => void;
  onOpenSettings: (tab: "ai" | "tags") => void;
  onNotify: (msg: string) => void;
}) {
  const today = getShanghaiNowParts().date;
  const [otdList, setOtdList] = useState<EntryRecord[]>([]);
  const [otdMode, setOtdMode] = useState<"summary" | "raw">("summary");
  const [heatYear, setHeatYear] = useState<string>(today.slice(0, 4));
  const [heatColorBy, setHeatColorBy] = useState<"words" | "mood">("words");
  const [heatmap, setHeatmap] = useState<Awaited<ReturnType<typeof api.getHeatmap>> | null>(null);
  const [allSummary, setAllSummary] = useState<{ count: number; totalWords: number } | null>(null);

  const [qaInput, setQaInput] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaCollapsed, setQaCollapsed] = useState(false);
  const [qaThread, setQaThread] = useState<QaThreadItem[]>([]);

  useEffect(() => {
    void api.getEntryByDate(today).then((res) => setOtdList(res.onThisDay)).catch(() => {});
    void api.getOverviewStats("all").then((ov) => setAllSummary({ count: ov.count, totalWords: ov.totalWords })).catch(() => {});
  }, [today]);

  useEffect(() => {
    void api.getHeatmap(heatYear).then(setHeatmap).catch(() => {});
  }, [heatYear]);

  async function submitQa(questionText?: string) {
    const q = (questionText ?? qaInput).trim();
    if (!q || qaLoading) return;
    setQaInput("");
    setQaCollapsed(false);
    const id = String(Date.now());
    setQaThread((prev) => [...prev, { id, question: q, traceOpen: false }]);
    setQaLoading(true);
    try {
      const res = await api.askMemoryQa(q);
      setQaThread((prev) => prev.map((it) => (it.id === id ? { ...it, response: res } : it)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "回忆问答请求失败";
      setQaThread((prev) => prev.map((it) => (it.id === id ? { ...it, error: msg } : it)));
    } finally {
      setQaLoading(false);
    }
  }

  function getWordHeatColor(wc: number): string {
    if (wc <= 0) return "var(--heat-0)";
    if (wc <= 400) return "var(--heat-1)";
    if (wc <= 800) return "var(--heat-2)";
    if (wc <= 1300) return "var(--heat-3)";
    return "var(--heat-4)";
  }

  function buildYearCells() {
    const y = Number(heatYear) || Number(today.slice(0, 4));
    const jan1 = new Date(Date.UTC(y, 0, 1));
    const startOffset = (jan1.getUTCDay() + 6) % 7;
    const dec31 = new Date(Date.UTC(y, 11, 31));
    const totalDays = Math.round((dec31.getTime() - jan1.getTime()) / 86_400_000) + 1;
    const cells: Array<{ pad?: boolean; date?: string }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ pad: true });
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(jan1.getTime() + i * 86_400_000);
      cells.push({ date: d.toISOString().slice(0, 10) });
    }
    return cells;
  }

  const activeTags = tags.filter((t) => t.enabled);
  const yearOptions = Array.from(
    new Set([today.slice(0, 4), ...(heatmap?.availableYears ?? [])])
  ).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <section className="hero-row">
        <div>
          <h1 className="hero-title">
            今天是 <span className="hl-date num">{today}</span>
          </h1>
          <div className="hero-sub">
            <span>在属于自己的暖白纸面上，留住每一天真实的微光</span>
            {allSummary && (
              <span className="badge-count num">
                已记录 {allSummary.count} 篇 · {(allSummary.totalWords / 10000).toFixed(2)} 万字
              </span>
            )}
          </div>
        </div>
        <div className="hero-btns">
          <button type="button" className="btn btn-primary" onClick={onWriteToday}>
            ✍ 写今天日记
          </button>
          <button type="button" className="btn btn-ghost" onClick={onNewSpecial}>
            📌 新建专项复盘
          </button>
        </div>
      </section>

      {/* 问问过去的自己 */}
      <section className="card qa-card" aria-label="问问过去的自己">
        <div className="qa-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="qa-title">
              <span className="ai-badge">✦ 问问过去的自己</span>
              <span>基于本地日记库的回忆问答</span>
            </h2>
            {!aiConfig.enabled && (
              <span className="raw-badge">模型未开启 · 当前自动降级为本地关键词检索</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {!aiConfig.enabled && (
              <button
                type="button"
                className="btn btn-soft"
                style={{ height: 30, fontSize: 12 }}
                onClick={() => onOpenSettings("ai")}
              >
                去配置模型
              </button>
            )}
            {qaThread.length > 0 && (
              <button
                type="button"
                className="btn btn-soft"
                style={{ height: 30, fontSize: 12 }}
                onClick={() => setQaThread([])}
              >
                清空对话
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 30, fontSize: 12 }}
              onClick={() => setQaCollapsed((v) => !v)}
            >
              {qaCollapsed ? "展开" : "收起"}
            </button>
          </div>
        </div>

        {!qaCollapsed && (
          <>
            <div className="qa-prompts">
              {SAMPLE_QUESTIONS.map((sq) => (
                <button
                  key={sq}
                  type="button"
                  className="qa-prompt-pill"
                  onClick={() => void submitQa(sq)}
                >
                  {sq}
                </button>
              ))}
            </div>

            <div className="qa-input-row">
              <input
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitQa();
                }}
                placeholder="问一句关于过往日记的问题（严格只读 4 工具，最多 4 轮检索，附日期原文出处）…"
              />
              <button
                type="button"
                className="btn btn-dark"
                disabled={qaLoading || !qaInput.trim()}
                onClick={() => void submitQa()}
              >
                {qaLoading ? "检索思考中…" : "发送提问"}
              </button>
            </div>

            {qaThread.length > 0 && (
              <div className="qa-thread">
                {qaThread.map((item) => (
                  <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="qa-msg-user">{item.question}</div>
                    <div className="qa-msg-ai">
                      {!item.response && !item.error && (
                        <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 700 }}>
                          正在通过只读数据库工具筛查与精读日记…
                        </div>
                      )}
                      {item.error && <div className="conn-result err">{item.error}</div>}
                      {item.response && (
                        <>
                          {item.response.traces.length > 0 && (
                            <div className="qa-trace">
                              <button
                                type="button"
                                className="qa-trace-head"
                                onClick={() =>
                                  setQaThread((prev) =>
                                    prev.map((x) =>
                                      x.id === item.id ? { ...x, traceOpen: !x.traceOpen } : x
                                    )
                                  )
                                }
                              >
                                <span>
                                  🔍 已调用 {item.response.traces.length} 次只读本地工具（共 {item.response.roundsUsed} 轮
                                  {item.response.truncatedAtMaxRounds ? " · 已触发 4 轮安全截断" : ""}）
                                </span>
                                <span>{item.traceOpen ? "收起轨迹 ▲" : "查看工具轨迹 ▼"}</span>
                              </button>
                              {item.traceOpen && (
                                <div className="qa-trace-steps">
                                  {item.response.traces.map((tr, idx) => (
                                    <div key={idx} className="num">
                                      第 {tr.round} 轮 · <b>{tr.tool}</b>({JSON.stringify(tr.args)}) → {tr.summary}（{tr.durationMs}ms）
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="qa-answer-text">{item.response.answer}</div>
                          {item.response.citations.length > 0 && (
                            <div className="qa-cites">
                              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}>
                                原文出处：
                              </span>
                              {item.response.citations.map((cit) => (
                                <button
                                  key={cit.entryId}
                                  type="button"
                                  className="cite-chip"
                                  onClick={() => onOpenEntryId(cit.entryId)}
                                >
                                  <span className="num">{cit.date}</span>
                                  <span>·</span>
                                  <span>{cit.title}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* 那年今日 */}
      <section style={{ marginBottom: 28 }}>
        <div className="sec-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="sec-title">🕰 那年今日（{today.slice(5)}）</h2>
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
              <span className="raw-badge">已降级展示原文</span>
            )}
          </div>
          <button type="button" className="btn btn-soft" onClick={onOpenHistory}>
            查看全部历史 →
          </button>
        </div>

        {otdList.length === 0 ? (
          <div className="card" style={{ padding: 20, color: "var(--ink-3)", fontSize: 13.5, fontWeight: 700 }}>
            往年的今天（{today.slice(5)}）还没有历史记录，今天写下的日记将成为明年的「那年今日」。
          </div>
        ) : (
          <div className="otd-grid">
            {otdList.map((e) => {
              const showAi = aiConfig.enabled && otdMode === "summary" && Boolean(e.digest?.summary);
              return (
                <button
                  key={e.id}
                  type="button"
                  className="card lift otd-card"
                  onClick={() => onOpenEntryId(e.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="otd-year num">{e.date}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {showAi ? <span className="ai-badge">✦ 智能概要</span> : <span className="raw-badge">原文</span>}
                      <span>{e.moods.join(" ")}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>
                    {showAi ? e.digest?.shortTitle : e.title || `${e.date} 日记`}
                  </div>
                  <p className="otd-excerpt">{showAi ? e.digest?.summary : e.contentText}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 足迹热力图 */}
      <section className="card heat-card">
        <div className="sec-head">
          <div>
            <h2 className="sec-title">🔥 写作足迹热力图</h2>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 3 }}>
              冷暖高反差色阶：点击任意方格直接打开或补写当天日记
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="seg-mini">
              <button
                type="button"
                className={heatColorBy === "words" ? "active" : ""}
                onClick={() => setHeatColorBy("words")}
              >
                按字数着色
              </button>
              <button
                type="button"
                className={heatColorBy === "mood" ? "active" : ""}
                onClick={() => setHeatColorBy("mood")}
              >
                按心情着色
              </button>
            </div>
            <div className="seg-mini">
              {yearOptions.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={heatYear === y ? "active" : ""}
                  onClick={() => setHeatYear(y)}
                >
                  {y}年
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi-mini">
            <div className="k-label">{heatYear} 年记录天数</div>
            <div className="k-val num">{heatmap?.summary.count ?? 0} 篇</div>
          </div>
          <div className="kpi-mini">
            <div className="k-label">全年累计字数</div>
            <div className="k-val num">{(heatmap?.summary.totalWords ?? 0).toLocaleString()} 字</div>
          </div>
          <div className="kpi-mini">
            <div className="k-label">篇均字数</div>
            <div className="k-val num">{heatmap?.summary.avgWords ?? 0} 字</div>
          </div>
          <div className="kpi-mini">
            <div className="k-label">最长连续记录</div>
            <div className="k-val num">{heatmap?.summary.maxStreak ?? 0} 天</div>
          </div>
        </div>

        <div className="heat-scroll">
          <div className="heat-grid">
            {buildYearCells().map((c, idx) => {
              if (c.pad || !c.date) {
                return <div key={`pad-${idx}`} className="h-cell empty-pad" />;
              }
              const cell = heatmap?.cells[c.date];
              const bg = cell
                ? heatColorBy === "mood"
                  ? cell.moodTone
                  : getWordHeatColor(cell.wordCount)
                : "var(--heat-0)";
              const tip = cell
                ? `${c.date} · ${cell.shortTitle || cell.title}（${cell.wordCount}字 · ${cell.mood}）`
                : `${c.date} · 暂无记录，点击补写`;
              return (
                <button
                  key={c.date}
                  type="button"
                  className="h-cell"
                  style={{ background: bg }}
                  title={tip}
                  onClick={() => onOpenDate(c.date!)}
                />
              );
            })}
          </div>
        </div>

        <div className="heat-legend">
          <span>
            {heatColorBy === "mood"
              ? `${heatYear} 年每日心情热度图（按上海自然日统计）`
              : `${heatYear} 年每日字数热度图（按上海自然日统计）`}
          </span>
          {heatColorBy === "mood" ? (
            <div className="legend-boxes" style={{ flexWrap: "wrap", rowGap: 6, gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <i style={{ background: "var(--heat-0)" }} />
                <span>未记</span>
              </span>
              {moods.map((m) => (
                <span
                  key={m.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  title={m.label}
                >
                  <i style={{ background: m.tone }} />
                  <span>{m.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="legend-boxes">
              <span>未记</span>
              <i style={{ background: "var(--heat-0)" }} />
              <i style={{ background: "var(--heat-1)" }} title="1~400字" />
              <i style={{ background: "var(--heat-2)" }} title="401~800字" />
              <i style={{ background: "var(--heat-3)" }} title="801~1300字" />
              <i style={{ background: "var(--heat-4)" }} title="1301字以上" />
              <span>厚重长文</span>
            </div>
          )}
        </div>
      </section>

      {/* 启用标签墙 */}
      <section>
        <div className="sec-head">
          <h2 className="sec-title">
            日记标签 <span className="badge-count num">{activeTags.length} 个启用中</span>
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)" }}>
              点击卡片筛选历史，或直接带标签记一篇
            </span>
            <button
              type="button"
              className="btn btn-soft"
              style={{ height: 32, fontSize: 12 }}
              onClick={() => onOpenSettings("tags")}
            >
              ⚙ 管理标签
            </button>
          </div>
        </div>

        <div className="tags-grid">
          {activeTags.map((t) => (
            <div
              key={t.id}
              className="card lift tag-wall-card"
              onClick={() => onFilterByTag(t.name)}
            >
              <div className="tag-wall-top">
                <TagBadge tagName={t.name} tags={tags} theme={theme} />
                <span className="num" style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-3)" }}>
                  {t.count ?? 0} 篇
                </span>
              </div>
              <div className="tag-wall-foot">
                <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>点击查看历史</span>
                <button
                  type="button"
                  className="tag-quick-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickTagToday(t.name);
                  }}
                >
                  + 记一篇
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

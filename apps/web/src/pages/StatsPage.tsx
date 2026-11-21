import { useEffect, useState } from "react";
import {
  getShanghaiNowParts,
  type AiConfigPublic,
  type MonthlyReviewData,
  type TimebookConfigPublic,
  type YearlyReviewData
} from "@lifebook/core";
import { api } from "../lib/api";
import { HighlightTimelineCard } from "../components/HighlightTimelineCard";

function prevMonthKey(ym: string): string {
  const [yStr, mStr] = ym.split("-");
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function StatsPage({
  aiConfig,
  timebookConfig,
  onOpenEntryId,
  onSearchTopic,
  onOpenSettings,
  onNotify
}: {
  aiConfig: AiConfigPublic;
  timebookConfig: TimebookConfigPublic;
  onOpenEntryId: (id: string) => void;
  onSearchTopic: (topic: string) => void;
  onOpenSettings: (tab: "ai") => void;
  onNotify: (msg: string) => void;
}) {
  const shanghai = getShanghaiNowParts();
  const curYm = shanghai.month;
  const lastYm = prevMonthKey(curYm);
  const prev2Ym = prevMonthKey(lastYm);
  const curYear = shanghai.year;
  const lastYear = String(Number(curYear) - 1);

  const [statsYear, setStatsYear] = useState("all");
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getOverviewStats>> | null>(null);
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof api.getContentInsights>> | null>(null);

  const [revMode, setRevMode] = useState<"monthly" | "yearly">("monthly");
  const [revMonth, setRevMonth] = useState<string>(lastYm);
  const [revYear, setRevYear] = useState<string>(lastYear);
  const [monthData, setMonthData] = useState<MonthlyReviewData | null>(null);
  const [yearData, setYearData] = useState<YearlyReviewData | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void api.getOverviewStats(statsYear).then(setOverview).catch(() => {});
  }, [statsYear]);

  useEffect(() => {
    void api.getContentInsights().then(setInsights).catch(() => {});
  }, []);

  useEffect(() => {
    if (revMode === "monthly") {
      void api.getMonthlyReview(revMonth).then(setMonthData).catch(() => {});
    } else {
      void api.getYearlyReview(revYear).then(setYearData).catch(() => {});
    }
  }, [revMode, revMonth, revYear]);

  async function handleGenerateMonthly() {
    setGenerating(true);
    try {
      const res = await api.generateMonthlyReview(revMonth);
      setMonthData(res);
      onNotify(`✦ 已生成并缓存 ${revMonth} 深度月度复盘`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "生成月报失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateYearly() {
    setGenerating(true);
    try {
      const res = await api.generateYearlyReview(revYear);
      setYearData(res);
      onNotify(`✦ 已生成并缓存 ${revYear} 深度年度复盘`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "生成年报失败");
    } finally {
      setGenerating(false);
    }
  }

  const yearTabs = ["all", ...Array.from(new Set([curYear, lastYear, ...(overview?.availableYears ?? [])])).sort((a, b) => b.localeCompare(a))];
  const monthlyThousand = overview?.monthlyThousandWords ?? Array(12).fill(0);
  const maxM = Math.max(...monthlyThousand, 1);
  const maxMoodCnt = Math.max(...(overview?.moodDistribution.map((m) => m.count) ?? [1]), 1);
  const topTopics = overview?.topTopics ?? [];

  return (
    <div>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900 }}>写作与心情统计</h1>
          <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>
            全自动实时汇总篇数、字数、心情分布与自然周期客观复盘
          </div>
        </div>
        <div className="seg-mini">
          {yearTabs.map((y) => (
            <button
              key={y}
              type="button"
              className={statsYear === y ? "active" : ""}
              onClick={() => setStatsYear(y)}
            >
              {y === "all" ? "全部" : `${y}年`}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-strip">
        <div className="card kpi-mini" style={{ padding: 18 }}>
          <div className="k-label">日记篇数</div>
          <div className="k-val num">{overview?.count ?? 0} 篇</div>
        </div>
        <div className="card kpi-mini" style={{ padding: 18 }}>
          <div className="k-label">总写字数</div>
          <div className="k-val num">{(overview?.totalWords ?? 0).toLocaleString()} 字</div>
        </div>
        <div className="card kpi-mini" style={{ padding: 18 }}>
          <div className="k-label">平均每篇</div>
          <div className="k-val num">{overview?.avgWords ?? 0} 字</div>
        </div>
        <div className="card kpi-mini" style={{ padding: 18 }}>
          <div className="k-label">最长单篇</div>
          <div className="k-val num">{(overview?.maxWords ?? 0).toLocaleString()} 字</div>
        </div>
      </div>

      <div className="stats-grid-2">
        <div className="card chart-card">
          <h3 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 800 }}>月度字数趋势（千字）</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 190, paddingTop: 16 }}>
            {monthlyThousand.map((val, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  height: "100%",
                  justifyContent: "flex-end",
                  gap: 6
                }}
              >
                <span className="num" style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-3)" }}>
                  {val > 0 ? val : ""}
                </span>
                <div
                  title={`${i + 1}月：${(overview?.monthlyWords[i] ?? 0).toLocaleString()} 字`}
                  style={{
                    width: "100%",
                    maxWidth: 26,
                    height: Math.max(4, Math.round((val / maxM) * 135)),
                    borderRadius: "7px 7px 3px 3px",
                    background: val > 0 ? "var(--accent)" : "var(--heat-0)",
                    transition: "height .35s"
                  }}
                />
                <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>
                  {i + 1}月
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card chart-card">
          <h3 style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 800 }}>8 档核心心情分布</h3>
          {(overview?.moodDistribution ?? []).map((m) => (
            <div key={m.id} className="bar-row">
              <span className="bar-label">{m.label}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${m.count > 0 ? Math.max(4, Math.round((m.count / maxMoodCnt) * 100)) : 0}%`,
                    background: m.tone
                  }}
                />
              </div>
              <span className="bar-val num">{m.count} 次</span>
            </div>
          ))}
        </div>
      </div>

      {/* 客观周期深度复盘与双高光时间轴 */}
      <section className="review-shell" aria-label="客观周期复盘与双高光时间轴">
        <div className="sec-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 className="sec-title">
              <span className="ai-badge">✦ 客观周期复盘</span>
              <span>月度与年度深度总结 · 含双高光时间轴</span>
            </h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>
              严格按自然周期结算并缓存（月复盘次月 1 日解锁 · 年复盘次年 1 月 1 日解锁）
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="seg-mini">
              <button
                type="button"
                className={revMode === "monthly" ? "active" : ""}
                onClick={() => setRevMode("monthly")}
              >
                月度复盘 &amp; 月高光轴
              </button>
              <button
                type="button"
                className={revMode === "yearly" ? "active" : ""}
                onClick={() => setRevMode("yearly")}
              >
                年度复盘 &amp; 年高光轴
              </button>
            </div>
            <button
              type="button"
              className="btn btn-soft"
              style={{ height: 32, fontSize: 12 }}
              onClick={() => onOpenSettings("ai")}
            >
              {timebookConfig.enabled ? "⏱ 已配置时间簿联动" : "⏱ 配置时间簿联动"}
            </button>
          </div>
        </div>

        {revMode === "monthly" ? (
          <>
            <div className="review-controls">
              <div className="period-pills">
                {[curYm, lastYm, prev2Ym].map((ym) => (
                  <button
                    key={ym}
                    type="button"
                    className={`preset-pill ${revMonth === ym ? "active" : ""}`}
                    onClick={() => setRevMonth(ym)}
                  >
                    {ym}
                    {ym >= curYm ? "（待解锁）" : ""}
                  </button>
                ))}
                <input
                  type="month"
                  className="select-pill"
                  value={revMonth}
                  onChange={(e) => {
                    if (e.target.value) setRevMonth(e.target.value);
                  }}
                />
              </div>
              {monthData && !monthData.locked && aiConfig.enabled && (
                <button
                  type="button"
                  className="btn btn-dark"
                  disabled={generating}
                  style={{ height: 34, fontSize: 12.5 }}
                  onClick={() => void handleGenerateMonthly()}
                >
                  {generating ? "正在深度推演…" : monthData.overview ? "↻ 重新生成本月复盘" : "✦ 生成本月深度复盘"}
                </button>
              )}
            </div>

            {monthData?.locked ? (
              <div className="lock-banner">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: "var(--ink)" }}>
                    🔒 本自然月尚未结束 · 将于 {monthData.unlockDate}（次月 1 日）解锁
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.6 }}>
                    {monthData.hint}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: 36, fontSize: 12.5 }}
                  onClick={() => setRevMonth(lastYm)}
                >
                  查看已解锁的 {lastYm} →
                </button>
              </div>
            ) : !monthData?.overview ? (
              <div className="card" style={{ padding: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 700 }}>
                  {aiConfig.enabled
                    ? `${revMonth} 月已解锁，尚未生成深度复盘缓存，点击右侧按钮开始深度四维盘点与时间簿交叉对比。`
                    : "模型服务当前未开启，开启后可生成四维深度月度复盘与月度高光时间轴；基础统计功能不受影响。"}
                </div>
                {aiConfig.enabled ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={generating}
                    style={{ height: 38, fontSize: 13 }}
                    onClick={() => void handleGenerateMonthly()}
                  >
                    {generating ? "正在深度生成…" : "✦ 立即生成本月深度复盘"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-soft" onClick={() => onOpenSettings("ai")}>
                    去开启模型服务
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="card" style={{ padding: "20px 22px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 17, fontWeight: 900 }}>📅 {revMonth} · 客观月度复盘</div>
                    <span className="badge-count" style={{ fontSize: 11.5 }}>{monthData.overview.contextNote}</span>
                  </div>
                  <div className="kpi-strip" style={{ margin: "10px 0 14px" }}>
                    <div className="kpi-mini"><div className="k-label">本月记录</div><div className="k-val num" style={{ fontSize: 18 }}>{monthData.overview.days}</div></div>
                    <div className="kpi-mini"><div className="k-label">本月字数</div><div className="k-val num" style={{ fontSize: 18 }}>{monthData.overview.words}</div></div>
                    <div className="kpi-mini"><div className="k-label">主导心情</div><div className="k-val" style={{ fontSize: 14, marginTop: 7 }}>{monthData.overview.mood}</div></div>
                    <div className="kpi-mini">
                      <div className="k-label">{monthData.withTimebook ? "时间簿投入 / 待办" : "时间簿联动"}</div>
                      <div className="k-val num" style={{ fontSize: 15, marginTop: 6 }}>
                        {monthData.withTimebook ? `${monthData.overview.tbHours} · ${monthData.overview.todoRate}` : "已平滑降级（纯日记）"}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--ink-2)" }}>{monthData.overview.summary}</div>
                </div>

                {monthData.withTimebook ? (
                  <div className="tb-cross-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 16, fontWeight: 900 }}>⏱ 主观日记 × 时间簿客观耗时交叉洞察</div>
                      <span className="ai-badge">只读同步 · 零改动时间簿</span>
                    </div>
                    <div className="dual-col">
                      <div className="dual-box">
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>本月各模块真实耗时分布（合计 {monthData.overview.tbHours}）</div>
                        {(monthData.timebookMix ?? []).map((row) => (
                          <div key={row.name} className="tb-bar-row">
                            <span className="tb-bar-name">{row.name}</span>
                            <div className="tb-bar-track">
                              <div className="tb-bar-fill" style={{ width: `${row.pct}%`, background: row.color }} />
                            </div>
                            <span className="tb-bar-meta num">{row.hours}h（{row.delta}）</span>
                          </div>
                        ))}
                      </div>
                      <div className="dual-box">
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>时间投入与情绪状态的客观对照</div>
                        {(monthData.crossInsights ?? []).map((line, i) => (
                          <div key={i} style={{ fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)" }}>• {line}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: "var(--surface-hover)" }}>
                    <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                      时间簿未开启或处于离线状态，本期月报已自动平滑降级为纯日记深度复盘。
                    </span>
                    <button type="button" className="btn btn-soft" style={{ height: 30, fontSize: 12 }} onClick={() => onOpenSettings("ai")}>
                      查看联动配置
                    </button>
                  </div>
                )}

                {monthData.dimensions && (
                  <div className="dim-grid">
                    <div className="dim-box">
                      <div style={{ fontSize: 14, fontWeight: 900 }}>💼 工作与事务深度盘点</div>
                      <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--ink-2)" }}>{monthData.dimensions.work}</div>
                    </div>
                    <div className="dim-box">
                      <div style={{ fontSize: 14, fontWeight: 900 }}>🌿 生活与健康深度盘点</div>
                      <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--ink-2)" }}>{monthData.dimensions.life}</div>
                    </div>
                    <div className="dim-box">
                      <div style={{ fontSize: 14, fontWeight: 900 }}>📖 娱乐与成长深度盘点</div>
                      <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--ink-2)" }}>{monthData.dimensions.leisure}</div>
                    </div>
                    <div className="dim-box">
                      <div style={{ fontSize: 14, fontWeight: 900 }}>🧭 情绪波动与恢复规律</div>
                      <div style={{ fontSize: 13, lineHeight: 1.75, color: "var(--ink-2)" }}>{monthData.dimensions.emotion}</div>
                    </div>
                  </div>
                )}

                {(monthData.nextActions ?? []).length > 0 && (
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>🎯 下月可执行小建议</div>
                    {(monthData.nextActions ?? []).map((act, idx) => (
                      <div key={idx} style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-2)" }}>
                        {idx + 1}. {act}
                      </div>
                    ))}
                  </div>
                )}

                <HighlightTimelineCard
                  title="✨ 月度高光时间轴（每月精选 4～6 条）"
                  subDesc="规则初筛（重要事件保送 · 篇幅 ≥ 均值 1.4 倍 · 情绪峰值）+ 同次模型精选 + 日期溯源校验"
                  list={monthData.highlights ?? []}
                  scope="monthly"
                  periodKey={revMonth}
                  onOpenEntry={onOpenEntryId}
                  onUpdated={(next) => setMonthData((prev) => (prev ? { ...prev, highlights: next } : prev))}
                  onNotify={onNotify}
                />
              </>
            )}
          </>
        ) : (
          <>
            <div className="review-controls">
              <div className="period-pills">
                {[curYear, lastYear, String(Number(lastYear) - 1), String(Number(lastYear) - 2)].map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`preset-pill ${revYear === y ? "active" : ""}`}
                    onClick={() => setRevYear(y)}
                  >
                    {y} 年{y >= curYear ? "（待解锁）" : ""}
                  </button>
                ))}
              </div>
              {yearData && !yearData.locked && aiConfig.enabled && (
                <button
                  type="button"
                  className="btn btn-dark"
                  disabled={generating}
                  style={{ height: 34, fontSize: 12.5 }}
                  onClick={() => void handleGenerateYearly()}
                >
                  {generating ? "正在深度推演…" : yearData.overview ? "↻ 重新生成年度复盘" : "✦ 生成年度深度复盘"}
                </button>
              )}
            </div>

            {yearData?.locked ? (
              <div className="lock-banner">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: "var(--ink)" }}>
                    🔒 {revYear} 自然年尚未结束 · 将于 {yearData.unlockDate}（次年 1 月 1 日）解锁
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.6 }}>
                    {yearData.hint}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: 36, fontSize: 12.5 }}
                  onClick={() => setRevYear(lastYear)}
                >
                  查看 {lastYear} 年度复盘 →
                </button>
              </div>
            ) : !yearData?.overview ? (
              <div className="card" style={{ padding: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 700 }}>
                  {aiConfig.enabled
                    ? `${revYear} 年已解锁，点击右侧按钮汇总全年日记与月度复盘，生成三线深度年度复盘与年度高光时间轴。`
                    : "模型服务当前未开启，开启后可生成工作/生活/成长三线深度年度复盘与年度高光时间轴。"}
                </div>
                {aiConfig.enabled ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={generating}
                    style={{ height: 38, fontSize: 13 }}
                    onClick={() => void handleGenerateYearly()}
                  >
                    {generating ? "正在深度生成…" : "✦ 立即生成年度深度复盘"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-soft" onClick={() => onOpenSettings("ai")}>
                    去开启模型服务
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="card" style={{ padding: "20px 22px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 17, fontWeight: 900 }}>🗓 {revYear} 年度客观复盘</div>
                    <span className="badge-count" style={{ fontSize: 11.5 }}>{yearData.overview.contextNote}</span>
                  </div>
                  <div className="kpi-strip" style={{ margin: "10px 0 14px" }}>
                    <div className="kpi-mini"><div className="k-label">全年记录</div><div className="k-val num" style={{ fontSize: 17 }}>{yearData.overview.days}</div></div>
                    <div className="kpi-mini"><div className="k-label">全年总字数</div><div className="k-val num" style={{ fontSize: 17 }}>{yearData.overview.words}</div></div>
                    <div className="kpi-mini"><div className="k-label">同比变化</div><div className="k-val num" style={{ fontSize: 15 }}>{yearData.overview.delta}</div></div>
                    <div className="kpi-mini"><div className="k-label">{yearData.withTimebook ? "时间簿全年投入" : "时间簿联动"}</div><div className="k-val num" style={{ fontSize: 15 }}>{yearData.overview.tbHours}</div></div>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--ink-2)" }}>{yearData.overview.summary}</div>
                </div>

                {(yearData.quarters ?? []).length > 0 && (
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>🍂 四季节奏与重心迁移</div>
                    <div className="quarter-grid">
                      {(yearData.quarters ?? []).map((q, idx) => (
                        <div key={idx} className="quarter-box">
                          <div style={{ fontSize: 13, fontWeight: 900 }}>{q.q}</div>
                          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>{q.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {yearData.threeLines && (
                  <div className="dim-grid" style={{ gridTemplateColumns: "1fr" }}>
                    <div className="dim-box">
                      <div style={{ fontSize: 15, fontWeight: 900 }}>💼 工作积累主线深度盘点</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "var(--ink-2)" }}>{yearData.threeLines.work}</div>
                    </div>
                    <div className="dim-box">
                      <div style={{ fontSize: 15, fontWeight: 900 }}>🌿 生活秩序主线深度盘点</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "var(--ink-2)" }}>{yearData.threeLines.life}</div>
                    </div>
                    <div className="dim-box">
                      <div style={{ fontSize: 15, fontWeight: 900 }}>🌱 个人成长主线深度盘点</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.8, color: "var(--ink-2)" }}>{yearData.threeLines.growth}</div>
                    </div>
                  </div>
                )}

                <div className="dim-grid">
                  <div className="dim-box">
                    <div style={{ fontSize: 14, fontWeight: 900 }}>🔁 跨月重复出现的行为模式</div>
                    {(yearData.patterns ?? []).map((p, idx) => (
                      <div key={idx} style={{ fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)" }}>• {p}</div>
                    ))}
                  </div>
                  <div className="dim-box">
                    <div style={{ fontSize: 14, fontWeight: 900 }}>⚓ 来年 3 条锚点建议</div>
                    {(yearData.anchors ?? []).map((a, idx) => (
                      <div key={idx} style={{ fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)" }}>{idx + 1}. {a}</div>
                    ))}
                  </div>
                </div>

                <HighlightTimelineCard
                  title="🏆 年度高光时间轴（每年收敛 8～12 条）"
                  subDesc="汇总各月高光 + 全年重要/节点/复盘防漏兜底 → 平衡四季分布 + 强日期溯源校验"
                  list={yearData.highlights ?? []}
                  scope="yearly"
                  periodKey={revYear}
                  onOpenEntry={onOpenEntryId}
                  onUpdated={(next) => setYearData((prev) => (prev ? { ...prev, highlights: next } : prev))}
                  onNotify={onNotify}
                />
              </>
            )}
          </>
        )}
      </section>

      {/* 内容规律洞察：快乐触发器/精力消耗点 & 主题词云 */}
      <section className="insight-sec" aria-label="内容规律洞察">
        <div className="sec-head">
          <div>
            <h2 className="sec-title">
              <span className="ai-badge">✦ 内容规律洞察</span>
              <span>情绪触发器与生活重心词云</span>
            </h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginTop: 4 }}>
              直接复用已缓存的单篇结构化日概要主题词与反思，日常翻看零模型消耗
            </div>
          </div>
        </div>

        <div className="insight-grid">
          <div className="card insight-card">
            <div style={{ fontSize: 16, fontWeight: 900 }}>⚡ 快乐触发器 &amp; 精力消耗点</div>
            <div className="dual-col">
              <div className="dual-box">
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ok-ink)" }}>☀ 快速回血的正向记录</div>
                {(insights?.positiveTriggers ?? []).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>暂无足够正向记录样本</div>
                ) : (
                  insights!.positiveTriggers.map((it) => (
                    <button
                      key={it.entryId}
                      type="button"
                      className="cite-chip"
                      style={{ textAlign: "left", justifyContent: "flex-start", borderRadius: 10, padding: "6px 10px" }}
                      onClick={() => onOpenEntryId(it.entryId)}
                    >
                      <span className="num">{it.date}</span>
                      <span>· {it.text.slice(0, 34)}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="dual-box">
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--warn-ink)" }}>🪫 消耗精力的低电量信号</div>
                {(insights?.drainSignals ?? []).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>暂无足够消耗信号样本</div>
                ) : (
                  insights!.drainSignals.map((it) => (
                    <button
                      key={it.entryId}
                      type="button"
                      className="cite-chip"
                      style={{ textAlign: "left", justifyContent: "flex-start", borderRadius: 10, padding: "6px 10px" }}
                      onClick={() => onOpenEntryId(it.entryId)}
                    >
                      <span className="num">{it.date}</span>
                      <span>· {it.text.slice(0, 34)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card insight-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>☁ 生活重心主题词云</div>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700 }}>点击词条直达历史全文检索</span>
            </div>
            {topTopics.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)", padding: 12 }}>
                生成单篇智能概要后，此处将自动聚合展示高频主题词云。
              </div>
            ) : (
              <div className="topic-cloud">
                {topTopics.map((tp) => (
                  <button
                    key={tp.word}
                    type="button"
                    className="topic-pill"
                    style={{ fontSize: Math.min(16, 12 + Math.floor(tp.count / 3)) }}
                    onClick={() => onSearchTopic(tp.word)}
                  >
                    <span>#{tp.word}</span>
                    <span className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{tp.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

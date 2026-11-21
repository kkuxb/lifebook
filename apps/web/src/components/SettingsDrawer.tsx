import { useEffect, useState } from "react";
import {
  TAG_PALETTE,
  type AiConfigPublic,
  type AiProviderType,
  type MoodItem,
  type TagItem,
  type TemplateItem,
  type TimebookConfigPublic
} from "@lifebook/core";
import { api } from "../lib/api";
import { TagBadge } from "./TagBadge";

export type SettingsTab = "ai" | "tags" | "templates" | "import" | "backup";

const PROVIDER_PRESETS: Record<AiProviderType, { label: string; url: string; model: string }> = {
  openai: { label: "OpenAI 兼容", url: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  gemini: { label: "Gemini 原生", url: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  anthropic: { label: "Anthropic 原生", url: "https://api.anthropic.com", model: "claude-3-7-sonnet" }
};

export function SettingsDrawer({
  open,
  initialTab,
  theme,
  tags,
  moods,
  templates,
  aiConfig,
  timebookConfig,
  onClose,
  onRefreshAll,
  onNotify
}: {
  open: boolean;
  initialTab: SettingsTab;
  theme: "light" | "dark";
  tags: TagItem[];
  moods: MoodItem[];
  templates: TemplateItem[];
  aiConfig: AiConfigPublic;
  timebookConfig: TimebookConfigPublic;
  onClose: () => void;
  onRefreshAll: () => Promise<void>;
  onNotify: (msg: string) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // AI & 时间簿表单态
  const [aiEnabled, setAiEnabled] = useState(aiConfig.enabled);
  const [provider, setProvider] = useState<AiProviderType>(aiConfig.provider);
  const [baseUrl, setBaseUrl] = useState(aiConfig.baseUrl);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelId, setModelId] = useState(aiConfig.modelId);
  const [aiConnRes, setAiConnRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aiTesting, setAiTesting] = useState(false);

  const [batchStatus, setBatchStatus] = useState<{
    running: boolean;
    paused: boolean;
    total: number;
    done: number;
    failed: number;
    lastError: string;
    currentDate: string;
    failedItems?: Array<{ date: string; entryId: string; error: string }>;
  } | null>(null);

  const [tbEnabled, setTbEnabled] = useState(timebookConfig.enabled);
  const [tbUrl, setTbUrl] = useState(timebookConfig.url);
  const [tbPwdInput, setTbPwdInput] = useState("");
  const [tbConnRes, setTbConnRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tbTesting, setTbTesting] = useState(false);

  // 标签 & 心情管理态
  const [newTagName, setNewTagName] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [migrateTagTarget, setMigrateTagTarget] = useState<{ tag: TagItem; targetId: string } | null>(null);

  const [newMoodEmoji, setNewMoodEmoji] = useState("🌟");
  const [newMoodName, setNewMoodName] = useState("");
  const [editingMoodId, setEditingMoodId] = useState<string | null>(null);
  const [editingMoodEmoji, setEditingMoodEmoji] = useState("");
  const [editingMoodName, setEditingMoodName] = useState("");
  const [migrateMoodTarget, setMigrateMoodTarget] = useState<{ mood: MoodItem; targetId: string } | null>(null);

  // 模板态
  const [tplSections, setTplSections] = useState<string[]>(templates[0]?.sections ?? []);
  const [newSecText, setNewSecText] = useState("");

  // 导入态
  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof api.previewImportZip>> | null>(null);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string, "skip" | "overwrite" | "merge">>({});
  const [customMoodMap, setCustomMoodMap] = useState<Record<string, string>>({});
  const [importBatches, setImportBatches] = useState<Awaited<ReturnType<typeof api.listImportBatches>>["items"]>([]);
  const [importing, setImporting] = useState(false);

  // 备份 & 回收站态
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof api.getBackupStatus>>["items"]>([]);
  const [trashItems, setTrashItems] = useState<Awaited<ReturnType<typeof api.listTrash>>["items"]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    setAiEnabled(aiConfig.enabled);
    setProvider(aiConfig.provider);
    setBaseUrl(aiConfig.baseUrl);
    setModelId(aiConfig.modelId);
    setApiKeyInput("");
  }, [aiConfig]);

  useEffect(() => {
    setTbEnabled(timebookConfig.enabled);
    setTbUrl(timebookConfig.url);
    setTbPwdInput("");
  }, [timebookConfig]);

  useEffect(() => {
    if (templates[0]) setTplSections(templates[0].sections);
  }, [templates]);

  useEffect(() => {
    if (!open) return;
    if (tab === "ai") {
      void api.getBatchStatus().then(setBatchStatus).catch(() => {});
    } else if (tab === "import") {
      void api.listImportBatches().then((r) => setImportBatches(r.items)).catch(() => {});
    } else if (tab === "backup") {
      void api.getBackupStatus().then((r) => setBackups(r.items)).catch(() => {});
      void api.listTrash().then((r) => setTrashItems(r.items)).catch(() => {});
    }
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== "ai" || !batchStatus?.running) return;
    const t = window.setInterval(() => {
      void api.getBatchStatus().then((s) => {
        setBatchStatus(s);
        if (!s.running) void onRefreshAll();
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [open, tab, batchStatus?.running]);

  if (!open) return null;

  async function handleSaveAi(nextEnabled?: boolean) {
    try {
      await api.saveAiConfig({
        enabled: nextEnabled ?? aiEnabled,
        provider,
        baseUrl,
        apiKey: apiKeyInput || undefined,
        modelId
      });
      await onRefreshAll();
      onNotify("模型配置已加密保存");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "保存模型配置失败");
    }
  }

  async function handleTestAi() {
    setAiTesting(true);
    setAiConnRes(null);
    try {
      const res = await api.testAiConnection({
        provider,
        baseUrl,
        apiKey: apiKeyInput || undefined,
        modelId
      });
      setAiConnRes({ ok: true, msg: res.message });
    } catch (err) {
      setAiConnRes({ ok: false, msg: err instanceof Error ? err.message : "连通测试失败" });
    } finally {
      setAiTesting(false);
    }
  }

  async function handleSaveTimebook(nextEnabled?: boolean) {
    try {
      await api.saveTimebookConfig({
        enabled: nextEnabled ?? tbEnabled,
        url: tbUrl,
        password: tbPwdInput || undefined
      });
      await onRefreshAll();
      onNotify("时间簿只读联动配置已加密保存");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "保存时间簿配置失败");
    }
  }

  async function handleTestTimebook() {
    setTbTesting(true);
    setTbConnRes(null);
    try {
      const res = await api.testTimebookConnection({
        url: tbUrl,
        password: tbPwdInput || undefined
      });
      setTbConnRes({ ok: true, msg: res.message });
    } catch (err) {
      setTbConnRes({ ok: false, msg: err instanceof Error ? err.message : "时间簿连接失败" });
    } finally {
      setTbTesting(false);
    }
  }

  async function handleAttemptDeleteTag(tag: TagItem) {
    if ((tag.count ?? 0) > 0) {
      setMigrateTagTarget({ tag, targetId: "" });
      return;
    }
    try {
      await api.deleteTag(tag.id);
      await onRefreshAll();
      onNotify(`已删除未关联日记的标签「${tag.name}」`);
    } catch {
      setMigrateTagTarget({ tag, targetId: "" });
    }
  }

  async function handleConfirmTagMigrate() {
    if (!migrateTagTarget || !migrateTagTarget.targetId) return;
    try {
      const res = await api.deleteTag(migrateTagTarget.tag.id, migrateTagTarget.targetId);
      setMigrateTagTarget(null);
      await onRefreshAll();
      onNotify(`已将 ${res.migratedCount} 篇日记无损迁移并删除标签`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "删除迁移失败");
    }
  }

  async function handleAttemptDeleteMood(mood: MoodItem) {
    if ((mood.count ?? 0) > 0) {
      setMigrateMoodTarget({ mood, targetId: "" });
      return;
    }
    try {
      await api.deleteMood(mood.id);
      await onRefreshAll();
      onNotify(`已删除未关联日记的心情「${mood.label}」`);
    } catch {
      setMigrateMoodTarget({ mood, targetId: "" });
    }
  }

  async function handleConfirmMoodMigrate() {
    if (!migrateMoodTarget || !migrateMoodTarget.targetId) return;
    try {
      const res = await api.deleteMood(migrateMoodTarget.mood.id, migrateMoodTarget.targetId);
      setMigrateMoodTarget(null);
      await onRefreshAll();
      onNotify(`已将 ${res.migratedCount} 篇日记心情无损迁移并删除`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "删除迁移失败");
    }
  }

  async function handleZipUpload(file: File) {
    setImporting(true);
    try {
      const prev = await api.previewImportZip(file);
      setImportPreview(prev);
      const initDecisions: Record<string, "skip" | "overwrite" | "merge"> = {};
      for (const c of prev.conflicts) initDecisions[c.date] = c.defaultStrategy;
      setConflictDecisions(initDecisions);
      const initMoodMap: Record<string, string> = {};
      for (const ms of prev.moodStats) initMoodMap[ms.oldLabel] = ms.defaultNewLabel;
      setCustomMoodMap(initMoodMap);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "压缩包解析失败");
    } finally {
      setImporting(false);
    }
  }

  async function handleCommitImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const res = await api.commitImportZip({
        previewId: importPreview.previewId,
        conflictDecisions,
        moodMapping: customMoodMap
      });
      setImportPreview(null);
      const b = await api.listImportBatches();
      setImportBatches(b.items);
      await onRefreshAll();
      onNotify(
        `导入完成：新增 ${res.importedCount} 篇，跳过 ${res.skippedCount} 篇，覆盖 ${res.overwrittenCount} 篇，合并 ${res.mergedCount} 篇`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "提交导入失败");
    } finally {
      setImporting(false);
    }
  }

  const batchPct =
    batchStatus && batchStatus.total > 0
      ? Math.min(100, Math.round((batchStatus.done / batchStatus.total) * 100))
      : 0;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>设置与数据管理</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>
              绿联家庭服务器容器端口默认 3220 · 单人加密访问
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-tabs">
          {(
            [
              ["ai", "✦ 模型与联动"],
              ["tags", "标签与心情"],
              ["templates", "日记模板"],
              ["import", "历史搬家"],
              ["backup", "备份与回收站"]
            ] as Array<[SettingsTab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`drawer-tab ${tab === k ? "active" : ""}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === "ai" && (
            <>
              <div className="sub-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>启用智能摘要与回忆问答</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
                      关闭后自动平滑降级展示原标题与原文，不阻断日常写日记
                    </div>
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setAiEnabled(v);
                        void handleSaveAi(v);
                      }}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>{aiEnabled ? "已开启" : "已关闭"}</span>
                  </label>
                </div>
              </div>

              <div className="sub-card">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>模型接口参数配置</div>
                <div className="form-field">
                  <span className="form-label">接口协议类型</span>
                  <div className="seg-mini" style={{ width: "100%", justifyContent: "space-between" }}>
                    {(Object.entries(PROVIDER_PRESETS) as Array<[AiProviderType, { label: string; url: string; model: string }]>).map(
                      ([k, v]) => (
                        <button
                          key={k}
                          type="button"
                          className={provider === k ? "active" : ""}
                          style={{ flex: 1 }}
                          onClick={() => {
                            setProvider(k);
                            setBaseUrl(v.url);
                            setModelId(v.model);
                            setAiConnRes(null);
                          }}
                        >
                          {v.label}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="aiBaseUrlInput">接口地址</label>
                  <input
                    id="aiBaseUrlInput"
                    className="form-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={PROVIDER_PRESETS[provider].url}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="aiKeyInput">
                    接口密钥（AES-256-GCM 服务端加密存储，不回传明文）
                  </label>
                  <input
                    id="aiKeyInput"
                    type="password"
                    className="form-input"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={aiConfig.hasApiKey ? `已保存密钥（${aiConfig.apiKeyMasked}），留空保持不变` : "请输入接口密钥"}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="aiModelInput">模型标识</label>
                  <input
                    id="aiModelInput"
                    className="form-input"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    placeholder={PROVIDER_PRESETS[provider].model}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={aiTesting}
                    onClick={() => void handleTestAi()}
                  >
                    {aiTesting ? "正在握手检测…" : "⚡ 检测连通性"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: 36, fontSize: 13 }}
                    onClick={() => void handleSaveAi()}
                  >
                    保存模型配置
                  </button>
                </div>
                {aiConnRes && (
                  <div className={`conn-result ${aiConnRes.ok ? "ok" : "err"}`}>
                    {aiConnRes.ok ? "✓ " : "✕ "}
                    {aiConnRes.msg}
                  </div>
                )}
              </div>

              <div className="sub-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>批量补齐历史智能摘要</div>
                  <span className="badge-count num">
                    {batchStatus?.done ?? 0} / {batchStatus?.total ?? 0} 篇（{batchPct}%）
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>
                  补齐任务运行在服务端后台，关闭网页不会中断；单篇遇到格式波动会自动重试最多 2 次，仍失败时暂跳过并记录日期，可随时点击继续重跑。
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${batchPct}%` }} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {batchStatus?.running ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void api.pauseBatch().then(setBatchStatus)}
                    >
                      ⏸ 暂停补齐（正在处理 {batchStatus.currentDate}）
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-dark"
                      style={{ height: 36 }}
                      onClick={() =>
                        void api
                          .startBatch()
                          .then(setBatchStatus)
                          .catch((e) => onNotify(e instanceof Error ? e.message : "启动失败"))
                      }
                    >
                      ▶ {batchStatus && batchStatus.done > 0 && batchStatus.done < batchStatus.total ? "继续断点补齐" : "开始批量补齐"}
                    </button>
                  )}
                  {batchStatus && batchStatus.failed > 0 && (
                    <span className="badge-count num" style={{ color: "#DC2626" }}>
                      本轮暂跳过 {batchStatus.failed} 篇
                    </span>
                  )}
                </div>
                {batchStatus?.failedItems && batchStatus.failedItems.length > 0 ? (
                  <div className="conn-result err" style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 700 }}>
                      以下日期尝试 3 次后仍暂未通过格式校验，已自动跳过，再次点击「继续断点补齐」即可重跑：
                    </div>
                    {batchStatus.failedItems.slice(0, 8).map((item) => (
                      <div key={item.entryId} style={{ fontSize: 12 }}>
                        • {item.date}：{item.error}
                      </div>
                    ))}
                    {batchStatus.failedItems.length > 8 && (
                      <div style={{ fontSize: 12 }}>…另有 {batchStatus.failedItems.length - 8} 篇跳过记录</div>
                    )}
                  </div>
                ) : (
                  batchStatus?.lastError && (
                    <div className="conn-result err">最近异常：{batchStatus.lastError}</div>
                  )
                )}
              </div>

              <div className="sub-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>⏱ 时间簿只读联动</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>
                      零改动时间簿源码，按需拉取月/年耗时；离线时自动降级为纯日记复盘
                    </div>
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={tbEnabled}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setTbEnabled(v);
                        void handleSaveTimebook(v);
                      }}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>{tbEnabled ? "已联动" : "已关闭"}</span>
                  </label>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="tbUrlInput">时间簿局域网地址</label>
                  <input
                    id="tbUrlInput"
                    className="form-input"
                    value={tbUrl}
                    onChange={(e) => setTbUrl(e.target.value)}
                    placeholder="例如 http://nas-server:3210"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="tbPwdInput">时间簿访问口令（加密保存，不回传明文）</label>
                  <input
                    id="tbPwdInput"
                    type="password"
                    className="form-input"
                    value={tbPwdInput}
                    onChange={(e) => setTbPwdInput(e.target.value)}
                    placeholder={timebookConfig.hasPassword ? `已保存口令（${timebookConfig.passwordMasked}），留空保持不变` : "请输入时间簿口令"}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={tbTesting}
                    onClick={() => void handleTestTimebook()}
                  >
                    {tbTesting ? "正在测试读取…" : "⚡ 检测时间簿连通性"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-dark"
                    style={{ height: 36 }}
                    onClick={() => void handleSaveTimebook()}
                  >
                    保存联动配置
                  </button>
                </div>
                {tbConnRes && (
                  <div className={`conn-result ${tbConnRes.ok ? "ok" : "err"}`}>
                    {tbConnRes.ok ? "✓ " : "✕ "}
                    {tbConnRes.msg}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "tags" && (
            <>
              <div className="sub-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>标签管理（{tags.length} 个）</div>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700 }}>
                    删除关联标签强制选替换目标 · 绝不删日记
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <input
                    className="form-input"
                    style={{ height: 34 }}
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="输入新标签名，如：家庭时光"
                  />
                  <button
                    type="button"
                    className="btn btn-dark"
                    style={{ height: 34 }}
                    onClick={() => {
                      const name = newTagName.trim();
                      if (!name) return;
                      void api
                        .createTag({ name })
                        .then(async () => {
                          setNewTagName("");
                          await onRefreshAll();
                          onNotify(`已新增标签「${name}」`);
                        })
                        .catch((e) => onNotify(e instanceof Error ? e.message : "新增失败"));
                    }}
                  >
                    + 新增标签
                  </button>
                </div>

                {tags.map((t) => (
                  <div key={t.id} className="manage-row">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {editingTagId === t.id ? (
                        <>
                          <input
                            className="form-input"
                            style={{ height: 28, width: 120 }}
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ height: 28, padding: "0 10px", fontSize: 12 }}
                            onClick={() => {
                              void api
                                .updateTag(t.id, { name: editingTagName })
                                .then(async () => {
                                  setEditingTagId(null);
                                  await onRefreshAll();
                                })
                                .catch((e) => onNotify(e instanceof Error ? e.message : "改名失败"));
                            }}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ height: 28, padding: "0 8px", fontSize: 12 }}
                            onClick={() => setEditingTagId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <TagBadge tagName={t.name} tags={tags} theme={theme} />
                          <span className="num" style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>
                            {t.count ?? 0} 篇
                          </span>
                          {!t.enabled && <span className="raw-badge">已停用</span>}
                        </>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <div className="color-dots">
                        {TAG_PALETTE.map((pal) => (
                          <button
                            key={pal.key}
                            type="button"
                            className={`color-dot-btn ${t.colorKey === pal.key ? "active" : ""}`}
                            style={{ background: pal.color }}
                            title={pal.name}
                            onClick={() =>
                              void api.updateTag(t.id, { colorKey: pal.key }).then(() => onRefreshAll())
                            }
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                        onClick={() => {
                          setEditingTagId(t.id);
                          setEditingTagName(t.name);
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                        onClick={() =>
                          void api.updateTag(t.id, { enabled: !t.enabled }).then(() => onRefreshAll())
                        }
                      >
                        {t.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                        onClick={() => void handleAttemptDeleteTag(t)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sub-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>心情字典管理（{moods.length} 档核心心情）</div>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700 }}>支持单选与多选</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <input
                    className="form-input"
                    style={{ height: 34, width: 62, textAlign: "center" }}
                    value={newMoodEmoji}
                    onChange={(e) => setNewMoodEmoji(e.target.value)}
                  />
                  <input
                    className="form-input"
                    style={{ height: 34 }}
                    value={newMoodName}
                    onChange={(e) => setNewMoodName(e.target.value)}
                    placeholder="心情词，如：期待"
                  />
                  <button
                    type="button"
                    className="btn btn-dark"
                    style={{ height: 34 }}
                    onClick={() => {
                      const name = newMoodName.trim();
                      if (!name) return;
                      void api
                        .createMood({ emoji: newMoodEmoji || "🌟", name })
                        .then(async () => {
                          setNewMoodName("");
                          await onRefreshAll();
                          onNotify(`已新增心情「${newMoodEmoji} ${name}」`);
                        })
                        .catch((e) => onNotify(e instanceof Error ? e.message : "新增失败"));
                    }}
                  >
                    + 新增心情
                  </button>
                </div>

                {moods.map((m) => (
                  <div key={m.id} className="manage-row">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: m.tone, display: "inline-block" }} />
                      {editingMoodId === m.id ? (
                        <>
                          <input
                            className="form-input"
                            style={{ height: 28, width: 52, textAlign: "center" }}
                            value={editingMoodEmoji}
                            onChange={(e) => setEditingMoodEmoji(e.target.value)}
                          />
                          <input
                            className="form-input"
                            style={{ height: 28, width: 92 }}
                            value={editingMoodName}
                            onChange={(e) => setEditingMoodName(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ height: 28, padding: "0 9px", fontSize: 12 }}
                            onClick={() => {
                              void api
                                .updateMood(m.id, { emoji: editingMoodEmoji, name: editingMoodName })
                                .then(async () => {
                                  setEditingMoodId(null);
                                  await onRefreshAll();
                                })
                                .catch((e) => onNotify(e instanceof Error ? e.message : "修改失败"));
                            }}
                          >
                            保存
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 13.5, fontWeight: 800 }}>{m.label}</span>
                          <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{m.count ?? 0} 次</span>
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                        onClick={() => {
                          setEditingMoodId(m.id);
                          setEditingMoodEmoji(m.emoji);
                          setEditingMoodName(m.name);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                        onClick={() => void handleAttemptDeleteMood(m)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "templates" && (
            <div className="sub-card">
              <div style={{ fontSize: 15, fontWeight: 800 }}>
                {templates[0]?.name || "标准四段日记"}（每天新建默认套用）
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", margin: "4px 0 12px" }}>
                增删下方分段标题并保存后，在写作页新建或点「套用模板」立即生效。
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tplSections.map((sec, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "8px 12px"
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800 }}>H3 · {sec}</span>
                    <button
                      type="button"
                      className="btn btn-soft"
                      style={{ height: 26, padding: "0 8px", fontSize: 12 }}
                      onClick={() => setTplSections((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input
                  className="form-input"
                  value={newSecText}
                  onChange={(e) => setNewSecText(e.target.value)}
                  placeholder="添加新分段，如：今日运动"
                />
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    const v = newSecText.trim();
                    if (!v) return;
                    setTplSections((prev) => [...prev, v]);
                    setNewSecText("");
                  }}
                >
                  添加
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: 36, fontSize: 13 }}
                  onClick={() => {
                    const tplId = templates[0]?.id || "tpl-daily";
                    void api.updateTemplate(tplId, { sections: tplSections }).then(async () => {
                      await onRefreshAll();
                      onNotify("默认写作分段模板已保存");
                    });
                  }}
                >
                  保存默认模板
                </button>
              </div>
            </div>
          )}

          {tab === "import" && (
            <>
              <div className="sub-card">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>原平台导出 ZIP 一键搬家</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6, marginBottom: 12 }}>
                  自动过滤空白占位草稿、剥离标题重复日期前缀、归并旧 12 项心情到新 8 档，并检出同日冲突供你逐条决定跳过、覆盖或合并追加。
                </div>
                <label className="btn btn-primary" style={{ height: 38, fontSize: 13, cursor: "pointer" }}>
                  {importing ? "正在解析压缩包…" : "📦 选择原平台导出 ZIP 预览"}
                  <input
                    type="file"
                    accept=".zip"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleZipUpload(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {importPreview && (
                <div className="sub-card">
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>
                    导入预览：{importPreview.filename}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    <span className="badge-count num">有效日记 {importPreview.totalParsed} 篇</span>
                    <span className="badge-count num">过滤空白草稿 {importPreview.blankDraftsFiltered} 条</span>
                    <span className="badge-count num">本地图片 {importPreview.attachmentCount} 张</span>
                    <span className="badge-count num">同日冲突 {importPreview.conflicts.length} 条</span>
                  </div>

                  {importPreview.moodStats.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div className="form-label" style={{ marginBottom: 6 }}>旧 12 项 → 新 8 档心情归并映射（可微调）：</div>
                      {importPreview.moodStats.map((ms) => (
                        <div key={ms.oldLabel} className="manage-row">
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {ms.oldLabel}（{ms.count} 次）
                          </span>
                          <select
                            className="select-pill"
                            style={{ height: 30, fontSize: 12 }}
                            value={customMoodMap[ms.oldLabel] ?? ms.defaultNewLabel}
                            onChange={(e) =>
                              setCustomMoodMap((prev) => ({ ...prev, [ms.oldLabel]: e.target.value }))
                            }
                          >
                            {moods.map((m) => (
                              <option key={m.id} value={m.label}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {importPreview.conflicts.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div className="form-label" style={{ marginBottom: 6 }}>
                        同日冲突清单（默认跳过并保留已有日记）：
                      </div>
                      {importPreview.conflicts.map((c) => (
                        <div key={c.date} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 800 }}>
                            <span className="num">{c.date}</span>
                            <select
                              className="select-pill"
                              style={{ height: 28, fontSize: 12 }}
                              value={conflictDecisions[c.date] ?? "skip"}
                              onChange={(e) =>
                                setConflictDecisions((prev) => ({
                                  ...prev,
                                  [c.date]: e.target.value as "skip" | "overwrite" | "merge"
                                }))
                              }
                            >
                              <option value="skip">跳过（保留已有）</option>
                              <option value="merge">合并追加正文</option>
                              <option value="overwrite">覆盖已有日记</option>
                            </select>
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                            已有：《{c.existingTitle}》（{c.existingWords}字） ｜ 导入：《{c.incomingTitle}》（{c.incomingWords}字）
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => setImportPreview(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={importing}
                      style={{ height: 36, fontSize: 13 }}
                      onClick={() => void handleCommitImport()}
                    >
                      {importing ? "正在入库…" : "确认导入入库"}
                    </button>
                  </div>
                </div>
              )}

              <div className="sub-card">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>历史导入批次（支持一键无损撤销）</div>
                {importBatches.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>暂无导入记录</div>
                ) : (
                  importBatches.map((b) => (
                    <div key={b.id} className="manage-row">
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{b.filename}</div>
                        <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          新增 {b.importedCount} · 跳过 {b.skippedCount} · 覆盖 {b.overwrittenCount} · 合并 {b.mergedCount}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger-soft"
                        style={{ height: 28, fontSize: 11.5 }}
                        onClick={() =>
                          void api.undoImportBatch(b.id).then(async (r) => {
                            const next = await api.listImportBatches();
                            setImportBatches(next.items);
                            await onRefreshAll();
                            onNotify(`已撤销导入批次：清理 ${r.deletedEntries} 篇，还原 ${r.restoredEntries} 篇`);
                          })
                        }
                      >
                        撤销此批次
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {tab === "backup" && (
            <>
              <div className="sub-card">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>每日热备与全量导出</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
                  自动热备保存在数据目录 /data/backups（执行热备时同步清理过期跨日快照与 30 天过期回收站）。
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: 36, fontSize: 13 }}
                    onClick={() =>
                      void api.runBackup().then(async (r) => {
                        const s = await api.getBackupStatus();
                        setBackups(s.items);
                        onNotify(`热备完成：${r.filename}（${Math.round(r.sizeBytes / 1024)} KB）`);
                      })
                    }
                  >
                    🛡 立即执行热备
                  </button>
                  <a
                    className="btn btn-soft"
                    href="/api/export?format=json"
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    ⬇ 导出 JSON
                  </a>
                  <a
                    className="btn btn-soft"
                    href="/api/export?format=markdown"
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    ⬇ 导出 Markdown 压缩包
                  </a>
                </div>
                {backups.map((bk) => (
                  <div key={bk.filename} className="manage-row">
                    <div>
                      <div className="num" style={{ fontSize: 12.5, fontWeight: 800 }}>{bk.filename}</div>
                      <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {Math.round(bk.sizeBytes / 1024)} KB · {bk.createdAt.slice(0, 19).replace("T", " ")}
                      </div>
                    </div>
                    <a
                      className="btn btn-soft"
                      style={{ height: 28, fontSize: 11.5, textDecoration: "none" }}
                      href={`/api/backup/download/${encodeURIComponent(bk.filename)}`}
                    >
                      下载
                    </a>
                  </div>
                ))}
              </div>

              <div className="sub-card">
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
                  30 天回收站（{trashItems.length} 篇）
                </div>
                {trashItems.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>回收站为空</div>
                ) : (
                  trashItems.map((tr) => (
                    <div key={tr.id} className="manage-row">
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {tr.date} · {tr.title || "无标题日记"}
                        </div>
                        <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {tr.wordCount} 字 · 删除于 {tr.deletedAt.slice(0, 10)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-soft"
                          style={{ height: 28, fontSize: 11.5 }}
                          onClick={() =>
                            void api
                              .restoreTrash(tr.id)
                              .then(async () => {
                                const r = await api.listTrash();
                                setTrashItems(r.items);
                                await onRefreshAll();
                                onNotify("已还原日记");
                              })
                              .catch((e) => onNotify(e instanceof Error ? e.message : "还原失败"))
                          }
                        >
                          还原
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-soft"
                          style={{ height: 28, fontSize: 11.5 }}
                          onClick={() =>
                            void api.deleteTrashPermanent(tr.id).then(async () => {
                              const r = await api.listTrash();
                              setTrashItems(r.items);
                              onNotify("已彻底删除");
                            })
                          }
                        >
                          彻底删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 标签安全删除强制替换弹窗 */}
      {migrateTagTarget && (
        <div className="center-modal-mask" onClick={() => setMigrateTagTarget(null)}>
          <div className="center-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>安全删除标签「{migrateTagTarget.tag.name}」</div>
              <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setMigrateTagTarget(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--warn-bg)", border: "1px solid var(--warn-line)", color: "var(--warn-ink)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.6, marginBottom: 14 }}>
              删除标签绝不会删除任何一篇日记。当前有 {migrateTagTarget.tag.count ?? 0} 篇日记关联此标签，请先选择一个替换目标标签（未选前禁止确认删除）：
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto", marginBottom: 16 }}>
              {tags
                .filter((x) => x.id !== migrateTagTarget.tag.id)
                .map((c) => (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 11px",
                      borderRadius: 11,
                      border: `1.5px solid ${migrateTagTarget.targetId === c.id ? "var(--ink)" : "var(--border)"}`,
                      cursor: "pointer"
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="radio"
                        name="tagMigrateTarget"
                        checked={migrateTagTarget.targetId === c.id}
                        onChange={() => setMigrateTagTarget({ ...migrateTagTarget, targetId: c.id })}
                      />
                      <TagBadge tagName={c.name} tags={tags} theme={theme} />
                    </span>
                    <span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.count ?? 0} 篇</span>
                  </label>
                ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-soft" onClick={() => setMigrateTagTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                disabled={!migrateTagTarget.targetId}
                style={{ height: 36, padding: "0 14px", background: "var(--danger)", color: "#FFFFFF" }}
                onClick={() => void handleConfirmTagMigrate()}
              >
                确认替换并删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 心情安全删除强制替换弹窗 */}
      {migrateMoodTarget && (
        <div className="center-modal-mask" onClick={() => setMigrateMoodTarget(null)}>
          <div className="center-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>安全删除心情「{migrateMoodTarget.mood.label}」</div>
              <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setMigrateMoodTarget(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--warn-bg)", border: "1px solid var(--warn-line)", color: "var(--warn-ink)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.6, marginBottom: 14 }}>
              不会删除任何日记。请先选择将关联的 {migrateMoodTarget.mood.count ?? 0} 篇日记归并到哪一个现有心情（未选前禁止确认删除）：
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {moods
                .filter((x) => x.id !== migrateMoodTarget.mood.id)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`pick-opt ${migrateMoodTarget.targetId === c.id ? "selected" : ""}`}
                    onClick={() => setMigrateMoodTarget({ ...migrateMoodTarget, targetId: c.id })}
                  >
                    {c.label}
                  </button>
                ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-soft" onClick={() => setMigrateMoodTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                disabled={!migrateMoodTarget.targetId}
                style={{ height: 36, padding: "0 14px", background: "var(--danger)", color: "#FFFFFF" }}
                onClick={() => void handleConfirmMoodMigrate()}
              >
                确认迁移并删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

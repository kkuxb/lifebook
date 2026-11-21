import { useCallback, useEffect, useState } from "react";
import {
  getShanghaiNowParts,
  type AiConfigPublic,
  type EntryKind,
  type EntryRecord,
  type MoodItem,
  type TagItem,
  type TemplateItem,
  type TimebookConfigPublic
} from "@lifebook/core";
import { api } from "./lib/api";
import { flushOfflineQueue, readOfflineQueue } from "./lib/offlineQueue";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { EditorPage } from "./pages/EditorPage";
import { CalendarPage } from "./pages/CalendarPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsDrawer, type SettingsTab } from "./components/SettingsDrawer";

type ViewType = "home" | "editor" | "calendar" | "history" | "stats";

export function App() {
  const [authState, setAuthState] = useState<{
    checking: boolean;
    initialized: boolean;
    authenticated: boolean;
  }>({ checking: true, initialized: true, authenticated: false });

  const [view, setView] = useState<ViewType>("home");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("lifebook_theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [syncMode, setSyncMode] = useState<"ok" | "syncing" | "offline">("ok");
  const [toastMsg, setToastMsg] = useState("");

  const [tags, setTags] = useState<TagItem[]>([]);
  const [moods, setMoods] = useState<MoodItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [aiConfig, setAiConfig] = useState<AiConfigPublic>({
    enabled: false,
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    hasApiKey: false,
    apiKeyMasked: "",
    modelId: "gpt-4.1-mini"
  });
  const [timebookConfig, setTimebookConfig] = useState<TimebookConfigPublic>({
    enabled: false,
    url: "",
    hasPassword: false,
    passwordMasked: ""
  });

  // 编辑器传参
  const [editorParams, setEditorParams] = useState<{
    entryId: string | null;
    date: string;
    kind: EntryKind;
    tag?: string;
  }>({
    entryId: null,
    date: getShanghaiNowParts().date,
    kind: "daily"
  });

  // 历史检索初始筛选
  const [histInitQuery, setHistInitQuery] = useState("");
  const [histInitTag, setHistInitTag] = useState("all");

  // 设置抽屉
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("ai");
  const [offlineSyncSignal, setOfflineSyncSignal] = useState<{
    tick: number;
    entries: EntryRecord[];
  }>({ tick: 0, entries: [] });

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(""), 2800);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("lifebook_theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const refreshMetadata = useCallback(async () => {
    const [tRes, mRes, tplRes, aiRes, tbRes] = await Promise.all([
      api.listTags(),
      api.listMoods(),
      api.listTemplates(),
      api.getAiConfig(),
      api.getTimebookConfig()
    ]);
    setTags(tRes.items);
    setMoods(mRes.items);
    setTemplates(tplRes.items);
    setAiConfig(aiRes);
    setTimebookConfig(tbRes);
  }, []);

  const checkAuthAndLoad = useCallback(async () => {
    try {
      const me = await api.authMe();
      setAuthState({
        checking: false,
        initialized: me.initialized,
        authenticated: me.authenticated
      });
      if (me.authenticated) {
        await refreshMetadata();
      }
    } catch {
      setAuthState({ checking: false, initialized: true, authenticated: false });
    }
  }, [refreshMetadata]);

  useEffect(() => {
    void checkAuthAndLoad();
  }, [checkAuthAndLoad]);

  // 监听断网恢复与离线防丢队列自动同步
  const handleSyncOfflineQueue = useCallback(async () => {
    const q = readOfflineQueue();
    if (!q.length) {
      setSyncMode(navigator.onLine ? "ok" : "offline");
      return;
    }
    setSyncMode("syncing");
    const res = await flushOfflineQueue();
    if (res.remainingCount === 0) {
      setSyncMode("ok");
      if (res.syncedCount > 0) {
        setOfflineSyncSignal((prev) => ({ tick: prev.tick + 1, entries: res.syncedEntries }));
        showToast(`已自动恢复并同步 ${res.syncedCount} 条离线暂存日记`);
        void refreshMetadata();
      }
    } else {
      setSyncMode("offline");
    }
  }, [refreshMetadata, showToast]);

  useEffect(() => {
    const onOnline = () => void handleSyncOfflineQueue();
    const onOffline = () => setSyncMode("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (readOfflineQueue().length > 0 && navigator.onLine) {
      void handleSyncOfflineQueue();
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [handleSyncOfflineQueue]);

  function openEditorForDate(date: string, tag?: string) {
    setEditorParams({ entryId: null, date, kind: "daily", tag });
    setView("editor");
  }

  function openEditorById(entryId: string) {
    setEditorParams({ entryId, date: getShanghaiNowParts().date, kind: "daily" });
    setView("editor");
  }

  function openNewSpecial() {
    setEditorParams({ entryId: null, date: getShanghaiNowParts().date, kind: "special" });
    setView("editor");
  }

  if (authState.checking) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontWeight: 700 }}>
        正在加载人生簿…
      </div>
    );
  }

  if (!authState.authenticated) {
    return (
      <LoginPage
        initialized={authState.initialized}
        onSuccess={() => {
          void checkAuthAndLoad();
        }}
      />
    );
  }

  const pendingOfflineCount = readOfflineQueue().length;

  return (
    <div className="app-shell">
      <header className="topbar-wrap">
        <div className="topbar">
          <button type="button" className="brand" onClick={() => setView("home")}>
            <span className="brand-logo" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                <path d="M9 7h6" />
                <path d="M9 11h4" />
              </svg>
            </span>
            <span>
              <div className="brand-name">人生簿</div>
              <div className="brand-sub">私密每日日记与人生回顾</div>
            </span>
          </button>

          <nav className="nav-pills desktop-nav" aria-label="主导航">
            {(
              [
                ["home", "首页"],
                ["calendar", "日历"],
                ["history", "历史"],
                ["stats", "统计"]
              ] as Array<[ViewType, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`nav-pill ${view === k ? "active" : ""}`}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="top-actions">
            <button
              type="button"
              className="icon-btn"
              title="切换浅色护眼 / 夜间深色模式"
              aria-label="切换主题"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            >
              {theme === "light" ? "🌙" : "☀"}
            </button>

            <button
              type="button"
              className={`sync-pill ${syncMode}`}
              onClick={() => void handleSyncOfflineQueue()}
              title="点击检查并同步本地暂存队列"
            >
              <span className="sync-dot" />
              <span className="sync-text-full">
                {syncMode === "offline"
                  ? `离线暂存中${pendingOfflineCount ? `（${pendingOfflineCount}）` : ""}`
                  : syncMode === "syncing"
                    ? "正在同步…"
                    : "数据已同步"}
              </span>
            </button>

            <button
              type="button"
              className="icon-btn"
              title="设置与数据管理"
              aria-label="打开设置"
              onClick={() => {
                setSettingsTab("ai");
                setSettingsOpen(true);
              }}
            >
              ⚙
            </button>
          </div>
        </div>
      </header>

      <main className="main-wrap">
        {view === "home" && (
          <HomePage
            theme={theme}
            tags={tags}
            moods={moods}
            aiConfig={aiConfig}
            onWriteToday={() => openEditorForDate(getShanghaiNowParts().date)}
            onNewSpecial={openNewSpecial}
            onOpenEntryId={openEditorById}
            onOpenDate={(d) => openEditorForDate(d)}
            onFilterByTag={(tagName) => {
              setHistInitQuery("");
              setHistInitTag(tagName);
              setView("history");
            }}
            onQuickTagToday={(tagName) => openEditorForDate(getShanghaiNowParts().date, tagName)}
            onOpenHistory={() => setView("history")}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setSettingsOpen(true);
            }}
            onNotify={showToast}
          />
        )}

        {view === "editor" && (
          <EditorPage
            theme={theme}
            entryId={editorParams.entryId}
            initialDate={editorParams.date}
            initialKind={editorParams.kind}
            initialTag={editorParams.tag}
            tags={tags}
            moods={moods}
            templates={templates}
            aiConfig={aiConfig}
            offlineSyncSignal={offlineSyncSignal}
            onBack={() => {
              void refreshMetadata();
              setView("home");
            }}
            onOpenEntryId={openEditorById}
            onSyncChange={setSyncMode}
            onNotify={showToast}
          />
        )}

        {view === "calendar" && (
          <CalendarPage
            tags={tags}
            aiConfig={aiConfig}
            onOpenDate={(d) => openEditorForDate(d)}
            onNotify={showToast}
          />
        )}

        {view === "history" && (
          <HistoryPage
            theme={theme}
            tags={tags}
            moods={moods}
            initialQuery={histInitQuery}
            initialTag={histInitTag}
            onOpenEntryId={openEditorById}
          />
        )}

        {view === "stats" && (
          <StatsPage
            aiConfig={aiConfig}
            timebookConfig={timebookConfig}
            onOpenEntryId={openEditorById}
            onSearchTopic={(topic) => {
              setHistInitQuery(topic);
              setHistInitTag("all");
              setView("history");
            }}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setSettingsOpen(true);
            }}
            onNotify={showToast}
          />
        )}
      </main>

      <nav className="mobile-bottom-nav" aria-label="手机端导航">
        {(
          [
            ["home", "🏠", "首页"],
            ["calendar", "📅", "日历"],
            ["history", "🔎", "历史"],
            ["stats", "📊", "统计"]
          ] as Array<[ViewType, string, string]>
        ).map(([k, icon, label]) => (
          <button
            key={k}
            type="button"
            className={`mnav-btn ${view === k ? "active" : ""}`}
            onClick={() => setView(k)}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <SettingsDrawer
        open={settingsOpen}
        initialTab={settingsTab}
        theme={theme}
        tags={tags}
        moods={moods}
        templates={templates}
        aiConfig={aiConfig}
        timebookConfig={timebookConfig}
        onClose={() => setSettingsOpen(false)}
        onRefreshAll={refreshMetadata}
        onNotify={showToast}
      />

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

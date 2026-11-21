import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

export function LoginPage({
  initialized,
  onSuccess
}: {
  initialized: boolean;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("请输入访问口令");
      return;
    }
    if (!initialized && password !== confirmPwd) {
      setError("两次输入的口令不一致");
      return;
    }
    setLoading(true);
    try {
      if (!initialized) {
        await api.setupPassword(password);
      } else {
        await api.login(password);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--bg)"
      }}
    >
      <form
        className="card"
        onSubmit={(e) => void handleSubmit(e)}
        style={{ width: 420, maxWidth: "100%", padding: "32px 28px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <span className="brand-logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              <path d="M9 7h6" />
              <path d="M9 11h4" />
            </svg>
          </span>
          <div>
            <div className="brand-name" style={{ fontSize: 22 }}>人生簿</div>
            <div className="brand-sub">私密每日日记与人生回顾 · 单人加密空间</div>
          </div>
        </div>

        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
          {initialized ? "输入访问口令解锁" : "首次使用 · 设置私人访问口令"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 18, lineHeight: 1.6 }}>
          {initialized
            ? "所有日记与图片附件均安全保存在本地容器数据卷，连续 5 次输错口令将触发 60 秒限流保护。"
            : "当前尚未设置口令，请先设置至少 4 位私人访问口令以保护你的日记数据。"}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="loginPasswordInput">访问口令</label>
          <input
            id="loginPasswordInput"
            type="password"
            className="form-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入访问口令"
            autoFocus
          />
        </div>

        {!initialized && (
          <div className="form-field">
            <label className="form-label" htmlFor="loginConfirmInput">确认口令</label>
            <input
              id="loginConfirmInput"
              type="password"
              className="form-input"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="请再次输入口令"
            />
          </div>
        )}

        {error && <div className="conn-result err" style={{ marginBottom: 14 }}>{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ width: "100%", marginTop: 6 }}
        >
          {loading ? "正在验证…" : initialized ? "解锁进入人生簿" : "完成设置并进入"}
        </button>
      </form>
    </div>
  );
}

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hashPassword, verifyPassword } from "./crypto.js";

const COOKIE_NAME = "lifebook_token";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

interface RateLimitState {
  failures: number;
  lockedUntil: number;
}

export class AuthService {
  private readonly rateLimits = new Map<string, RateLimitState>();
  private readonly masterKey: Buffer;
  private readonly db: Database.Database;

  constructor(db: Database.Database, masterKey: Buffer) {
    this.db = db;
    this.masterKey = masterKey;
  }

  private getStoredHash(): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'auth_password_hash'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  public isInitialized(): boolean {
    if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0) {
      return true;
    }
    return this.getStoredHash() !== null;
  }

  public setupPassword(password: string): void {
    if (this.isInitialized()) {
      throw new Error("口令已初始化，请直接登录");
    }
    const clean = password.trim();
    if (clean.length < 4) {
      throw new Error("访问口令至少需要 4 位字符");
    }
    const hashed = hashPassword(clean);
    this.db
      .prepare(
        `INSERT INTO settings (key, value, encrypted, updated_at)
         VALUES ('auth_password_hash', ?, 0, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(hashed, new Date().toISOString());
  }

  public checkPassword(password: string): boolean {
    const envPwd = process.env.APP_PASSWORD?.trim();
    if (envPwd && envPwd.length > 0) {
      const a = Buffer.from(password, "utf8");
      const b = Buffer.from(envPwd, "utf8");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const stored = this.getStoredHash();
    if (!stored) return false;
    return verifyPassword(password, stored);
  }

  public checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
    const entry = this.rateLimits.get(ip);
    if (!entry) return { allowed: true, retryAfterSec: 0 };
    const now = Date.now();
    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000))
      };
    }
    if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
      this.rateLimits.delete(ip);
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  public recordFailure(ip: string): { locked: boolean; failures: number; retryAfterSec: number } {
    const now = Date.now();
    const cur = this.rateLimits.get(ip);
    const failures = (cur && cur.lockedUntil <= now ? cur.failures : cur?.failures ?? 0) + 1;
    if (failures >= 5) {
      const lockedUntil = now + 60_000;
      this.rateLimits.set(ip, { failures, lockedUntil });
      return { locked: true, failures, retryAfterSec: 60 };
    }
    this.rateLimits.set(ip, { failures, lockedUntil: 0 });
    return { locked: false, failures, retryAfterSec: 0 };
  }

  public clearFailures(ip: string): void {
    this.rateLimits.delete(ip);
  }

  public signToken(): string {
    const payload = Buffer.from(
      JSON.stringify({ sub: "owner", exp: Date.now() + TOKEN_TTL_MS }),
      "utf8"
    ).toString("base64url");
    const sig = crypto
      .createHmac("sha256", this.masterKey)
      .update(payload)
      .digest("base64url");
    return `${payload}.${sig}`;
  }

  public verifyToken(token: string | undefined): boolean {
    if (!token || !token.includes(".")) return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = crypto
      .createHmac("sha256", this.masterKey)
      .update(payload)
      .digest("base64url");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        exp?: number;
      };
      return typeof parsed.exp === "number" && parsed.exp > Date.now();
    } catch {
      return false;
    }
  }

  public extractToken(c: Context): string | undefined {
    const authHeader = c.req.header("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }
    return getCookie(c, COOKIE_NAME);
  }

  public setSessionCookie(c: Context, token: string): void {
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(TOKEN_TTL_MS / 1000)
    });
  }

  public clearSessionCookie(c: Context): void {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
  }

  public requireAuth = async (c: Context, next: Next) => {
    const token = this.extractToken(c);
    if (!this.verifyToken(token)) {
      return c.json({ error: "未登录或登录态已失效，请重新验证口令" }, 401);
    }
    await next();
  };
}

export function getClientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

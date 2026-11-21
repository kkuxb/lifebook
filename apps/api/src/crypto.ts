import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 获取用于 AES-256-GCM 加解密的 32 字节主密钥。
 * 优先使用环境变量 APP_SECRET；若未设置则在 dataDir/.master.key 自动生成并持久化。
 */
export function resolveMasterKey(dataDir: string): Buffer {
  const envSecret = process.env.APP_SECRET?.trim();
  if (envSecret) {
    return crypto.createHash("sha256").update(envSecret, "utf8").digest();
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, ".master.key");
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      return Buffer.from(hex, "hex");
    }
  }
  const raw = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, raw.toString("hex"), { mode: 0o600 });
  return raw;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  if (!ciphertext) return "";
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("无效的密文格式");
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const data = Buffer.from(parts[3], "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function maskSecret(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 6) return "••••••";
  return `${raw.slice(0, 3)}••••••${raw.slice(-4)}`;
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

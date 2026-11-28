import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { AuthService, getClientIp } from "./auth.js";
import { resolveMasterKey } from "./crypto.js";
import { initDatabase } from "./db/schema.js";
import {
  getEntryAndOtdByDate,
  getEntryById,
  listEntries,
  listEntrySnapshots,
  listTrashEntries,
  permanentDeleteTrashEntry,
  restoreEntrySnapshot,
  restoreTrashEntry,
  softDeleteEntry,
  upsertEntry
} from "./services/entries.js";
import {
  createMood,
  createTag,
  deleteMoodSafely,
  deleteTagSafely,
  listMoods,
  listTags,
  listTemplates,
  updateMood,
  updateTag,
  updateTemplate,
  ValidationError
} from "./services/tags-moods.js";
import { getHeatmap, getOverviewStats } from "./services/stats.js";
import {
  commitZipImport,
  exportAllJson,
  exportAllMarkdownZip,
  listBackups,
  listImportBatches,
  previewZipImport,
  runHotBackup,
  undoImportBatch
} from "./services/import-export.js";
import {
  getAiConfigPublic,
  saveAiConfig,
  testAiConnection
} from "./services/ai-client.js";
import { runMemoryQa } from "./services/ai-qa.js";
import {
  getTimebookConfigPublic,
  saveTimebookConfig,
  testTimebookConnection
} from "./services/timebook-sync.js";
import {
  generateAndCacheEntryDigest,
  generateMonthlyReview,
  generateYearlyReview,
  getBatchDigestStatus,
  getCachedMonthlyReview,
  getCachedYearlyReview,
  getContentInsights,
  pauseBatchDigest,
  setHighlightAction,
  startBatchDigest
} from "./services/reviews.js";

const ALLOWED_IMAGE_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface AppInstance {
  app: Hono;
  db: Database.Database;
  dataDir: string;
  masterKey: Buffer;
  auth: AuthService;
  close: () => void;
}

export function createLifebookApp(options?: {
  dataDir?: string;
  webDistDir?: string;
}): AppInstance {
  const dataDir = path.resolve(
    options?.dataDir || process.env.DATA_DIR || "./workspace-data/lifebook"
  );
  const db = initDatabase(dataDir);
  const masterKey = resolveMasterKey(dataDir);
  const auth = new AuthService(db, masterKey);
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof z.ZodError) {
      return c.json({ error: err.issues[0]?.message || "请求参数校验失败" }, 400);
    }
    const msg = err instanceof Error ? err.message : "服务内部错误";
    return c.json({ error: msg }, 500);
  });

  // 1. 健康检查与认证接口（公开）
  app.get("/api/health", (c) => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO heartbeat (id, updated_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    ).run(now);
    const row = db.prepare("SELECT updated_at FROM heartbeat WHERE id = 1").get() as {
      updated_at: string;
    };
    return c.json({ ok: true, status: "healthy", time: row.updated_at });
  });

  app.get("/api/auth/me", (c) => {
    const token = auth.extractToken(c);
    return c.json({
      initialized: auth.isInitialized(),
      authenticated: auth.verifyToken(token)
    });
  });

  app.post("/api/auth/setup", async (c) => {
    const body = z
      .object({ password: z.string().min(4, "访问口令至少需要 4 位字符") })
      .parse(await c.req.json());
    try {
      auth.setupPassword(body.password);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "初始化失败" }, 400);
    }
    const token = auth.signToken();
    auth.setSessionCookie(c, token);
    return c.json({ ok: true, token });
  });

  app.post("/api/login", async (c) => {
    const ip = getClientIp(c);
    const rate = auth.checkRateLimit(ip);
    if (!rate.allowed) {
      return c.json(
        {
          error: `尝试次数过多，请 ${rate.retryAfterSec} 秒后再试`,
          retryAfterSec: rate.retryAfterSec
        },
        429
      );
    }

    const body = z.object({ password: z.string() }).parse(await c.req.json());
    if (!auth.isInitialized()) {
      return c.json({ error: "尚未设置访问口令，请先初始化口令" }, 400);
    }

    if (!auth.checkPassword(body.password)) {
      const fail = auth.recordFailure(ip);
      if (fail.locked) {
        return c.json(
          {
            error: `口令连续错误 ${fail.failures} 次，已触发限流锁定 ${fail.retryAfterSec} 秒`,
            retryAfterSec: fail.retryAfterSec
          },
          429
        );
      }
      return c.json(
        { error: `访问口令错误（第 ${fail.failures} 次，连续 5 次错误将锁定 60 秒）` },
        401
      );
    }

    auth.clearFailures(ip);
    const token = auth.signToken();
    auth.setSessionCookie(c, token);
    return c.json({ ok: true, token });
  });

  app.post("/api/logout", (c) => {
    auth.clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // 2. 以下全部 /api/* 路由强制鉴权
  app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (
      p === "/api/health" ||
      p === "/api/auth/me" ||
      p === "/api/auth/setup" ||
      p === "/api/login" ||
      p === "/api/logout"
    ) {
      return next();
    }
    return auth.requireAuth(c, next);
  });

  // 3. 日记 CRUD 与快照
  app.get("/api/entries", (c) => {
    const q = c.req.query("q");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const kind = c.req.query("kind");
    const tag = c.req.query("tagId") || c.req.query("tag");
    const mood = c.req.query("moodId") || c.req.query("mood");
    const page = Number(c.req.query("page") || "1");
    const pageSize = Number(c.req.query("pageSize") || "50");

    const res = listEntries(db, { q, startDate, endDate, kind, tag, mood, page, pageSize });
    return c.json(res);
  });

  app.get("/api/entries/by-date/:date", (c) => {
    const date = c.req.param("date");
    return c.json(getEntryAndOtdByDate(db, date));
  });

  app.get("/api/entries/:id", (c) => {
    const entry = getEntryById(db, c.req.param("id"));
    if (!entry) return c.json({ error: "日记不存在" }, 404);
    return c.json(entry);
  });

  const upsertEntrySchema = z.object({
    id: z.string().optional(),
    kind: z.enum(["daily", "special"]).default("daily"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式须为 YYYY-MM-DD"),
    title: z.string().optional().default(""),
    contentHtml: z.string().default(""),
    tags: z.array(z.string()).optional(),
    moods: z.array(z.string()).optional(),
    createSnapshot: z.boolean().optional().default(true),
    triggerDigest: z.boolean().optional().default(false)
  });

  app.post("/api/entries", async (c) => {
    const body = upsertEntrySchema.parse(await c.req.json());
    const saved = upsertEntry(db, body);
    if (body.triggerDigest) {
      void generateAndCacheEntryDigest(db, masterKey, saved.id, false).catch(() => {});
    }
    return c.json(saved);
  });

  app.put("/api/entries/:id", async (c) => {
    const body = upsertEntrySchema.parse(await c.req.json());
    const saved = upsertEntry(db, { ...body, id: c.req.param("id") });
    if (body.triggerDigest) {
      void generateAndCacheEntryDigest(db, masterKey, saved.id, false).catch(() => {});
    }
    return c.json(saved);
  });

  app.delete("/api/entries/:id", (c) => {
    const ok = softDeleteEntry(db, c.req.param("id"));
    if (!ok) return c.json({ error: "日记不存在" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/entries/:id/snapshots", (c) => {
    const id = c.req.param("id");
    return c.json({ items: listEntrySnapshots(db, id) });
  });

  app.post("/api/entries/:id/snapshots/:snapId/restore", (c) => {
    const restored = restoreEntrySnapshot(db, c.req.param("id"), c.req.param("snapId"));
    if (!restored) return c.json({ error: "快照或日记不存在" }, 404);
    return c.json(restored);
  });

  // 4. 图片上传与回收站
  app.post("/api/uploads", async (c) => {
    const ct = c.req.header("content-type") || "";
    const uploadsDir = path.join(dataDir, "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });

    if (ct.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "请上传有效的图片文件" }, 400);
      }
      const ext = ALLOWED_IMAGE_MIME[file.type.toLowerCase()];
      if (!ext) {
        return c.json({ error: `不支持的图片类型：${file.type || "未知"}` }, 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json({ error: "图片大小不能超过 10MB" }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const filename = `img-${ulid()}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buf);
      return c.json({ url: `/api/uploads/${filename}`, filename, size: buf.length });
    }

    const body = z
      .object({
        dataUrl: z.string().min(10),
        filename: z.string().optional()
      })
      .parse(await c.req.json());

    const m = body.dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!m) return c.json({ error: "无效的图片数据" }, 400);
    const ext = ALLOWED_IMAGE_MIME[m[1].toLowerCase()];
    if (!ext) return c.json({ error: `不支持的图片类型：${m[1]}` }, 400);
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_UPLOAD_BYTES) {
      return c.json({ error: "图片大小不能超过 10MB" }, 400);
    }
    const filename = `img-${ulid()}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    return c.json({ url: `/api/uploads/${filename}`, filename, size: buf.length });
  });

  app.get("/api/uploads/:filename", (c) => {
    const safeName = path.basename(c.req.param("filename"));
    const full = path.join(dataDir, "uploads", safeName);
    if (!fs.existsSync(full)) return c.json({ error: "附件不存在" }, 404);
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "application/octet-stream";
    const buf = fs.readFileSync(full);
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  });

  app.get("/api/trash", (c) => {
    return c.json({ items: listTrashEntries(db) });
  });

  app.post("/api/trash/:id/restore", (c) => {
    try {
      const item = restoreTrashEntry(db, c.req.param("id"));
      if (!item) return c.json({ error: "回收站记录不存在" }, 404);
      return c.json(item);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "恢复失败" }, 409);
    }
  });

  app.delete("/api/trash/:id", (c) => {
    const ok = permanentDeleteTrashEntry(db, c.req.param("id"));
    if (!ok) return c.json({ error: "回收站记录不存在" }, 404);
    return c.json({ ok: true });
  });

  // 5. 标签、心情与模板
  app.get("/api/tags", (c) => c.json({ items: listTags(db) }));

  app.post("/api/tags", async (c) => {
    const body = z
      .object({ name: z.string().min(1), colorKey: z.string().optional() })
      .parse(await c.req.json());
    return c.json(createTag(db, body), 201);
  });

  app.patch("/api/tags/:id", async (c) => {
    const body = z
      .object({
        name: z.string().optional(),
        colorKey: z.string().optional(),
        enabled: z.boolean().optional()
      })
      .parse(await c.req.json());
    return c.json(updateTag(db, c.req.param("id"), body));
  });

  app.delete("/api/tags/:id", async (c) => {
    let replaceWithId = c.req.query("replaceWithId");
    if (!replaceWithId) {
      const body = await c.req.json().catch(() => ({})) as { replaceWithId?: string };
      replaceWithId = body.replaceWithId;
    }
    return c.json(deleteTagSafely(db, c.req.param("id"), replaceWithId));
  });

  app.get("/api/moods", (c) => c.json({ items: listMoods(db) }));

  app.post("/api/moods", async (c) => {
    const body = z
      .object({
        emoji: z.string().min(1),
        name: z.string().min(1),
        tone: z.string().optional(),
        level: z.number().optional()
      })
      .parse(await c.req.json());
    return c.json(createMood(db, body), 201);
  });

  app.patch("/api/moods/:id", async (c) => {
    const body = z
      .object({
        emoji: z.string().optional(),
        name: z.string().optional(),
        tone: z.string().optional(),
        level: z.number().optional()
      })
      .parse(await c.req.json());
    return c.json(updateMood(db, c.req.param("id"), body));
  });

  app.delete("/api/moods/:id", async (c) => {
    let replaceWithId = c.req.query("replaceWithId");
    if (!replaceWithId) {
      const body = await c.req.json().catch(() => ({})) as { replaceWithId?: string };
      replaceWithId = body.replaceWithId;
    }
    return c.json(deleteMoodSafely(db, c.req.param("id"), replaceWithId));
  });

  app.get("/api/templates", (c) => c.json({ items: listTemplates(db) }));

  app.put("/api/templates/:id", async (c) => {
    const body = z
      .object({
        name: z.string().optional(),
        desc: z.string().optional(),
        sections: z.array(z.string())
      })
      .parse(await c.req.json());
    return c.json(updateTemplate(db, c.req.param("id"), body));
  });

  // 6. 热力图与基础统计
  app.get("/api/stats/heatmap", (c) => {
    const year = c.req.query("year") || "all";
    return c.json(getHeatmap(db, year));
  });

  app.get("/api/stats/overview", (c) => {
    const year = c.req.query("year") || "all";
    return c.json(getOverviewStats(db, year));
  });

  app.get("/api/stats/insights", (c) => {
    return c.json(getContentInsights(db));
  });

  // 7. 导入预览、提交、按批次撤销、热备与导出
  app.post("/api/import/preview", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "请上传 ZIP 压缩包文件" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const preview = await previewZipImport(db, buf, file.name);
    return c.json(preview);
  });

  app.post("/api/import/commit", async (c) => {
    const body = z
      .object({
        previewId: z.string().min(1),
        conflictDecisions: z.record(z.enum(["skip", "overwrite", "merge"])).optional(),
        moodMapping: z.record(z.string()).optional()
      })
      .parse(await c.req.json());
    const result = commitZipImport(db, dataDir, body);
    return c.json(result);
  });

  app.get("/api/import/batches", (c) => {
    return c.json({ items: listImportBatches(db) });
  });

  app.delete("/api/import/batches/:batchId", (c) => {
    const res = undoImportBatch(db, dataDir, c.req.param("batchId"));
    return c.json({ ok: true, ...res });
  });

  app.get("/api/backup/status", (c) => {
    return c.json({
      backupsDir: "/data/backups",
      items: listBackups(dataDir)
    });
  });

  app.post("/api/backup/run", async (c) => {
    const res = await runHotBackup(db, dataDir);
    return c.json({
      ok: true,
      filename: res.filename,
      sizeBytes: res.sizeBytes,
      cleanedSnapshots: res.cleanedSnapshots,
      purgedTrash: res.purgedTrash
    });
  });

  app.get("/api/backup/download/:filename", (c) => {
    const safeName = path.basename(c.req.param("filename"));
    const full = path.join(dataDir, "backups", safeName);
    if (!fs.existsSync(full)) return c.json({ error: "备份文件不存在" }, 404);
    const buf = fs.readFileSync(full);
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`
      }
    });
  });

  app.get("/api/export", async (c) => {
    const format = c.req.query("format") || "json";
    if (format === "markdown") {
      const zipBuf = await exportAllMarkdownZip(db, dataDir);
      return new Response(new Uint8Array(zipBuf), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="lifebook-markdown-export.zip"`
        }
      });
    }
    const json = exportAllJson(db);
    return new Response(JSON.stringify(json, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="lifebook-export.json"`
      }
    });
  });

  // 8. 模型配置、单篇补算、批量补齐、回忆问答
  app.get("/api/settings/ai", (c) => {
    return c.json(getAiConfigPublic(db, masterKey));
  });

  app.put("/api/settings/ai", async (c) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        provider: z.enum(["openai", "gemini", "anthropic"]).optional(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        modelId: z.string().optional()
      })
      .parse(await c.req.json());
    return c.json(saveAiConfig(db, masterKey, body));
  });

  app.post("/api/settings/ai/test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: "openai" | "gemini" | "anthropic";
      baseUrl?: string;
      apiKey?: string;
      modelId?: string;
    };
    try {
      const res = await testAiConnection(db, masterKey, body);
      return c.json(res);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "连接失败" }, 400);
    }
  });

  app.get("/api/ai/batch/status", (c) => {
    return c.json(getBatchDigestStatus(db));
  });

  app.post("/api/ai/batch/start", (c) => {
    try {
      return c.json(startBatchDigest(db, masterKey));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "启动失败" }, 400);
    }
  });

  app.post("/api/ai/batch/pause", (c) => {
    return c.json(pauseBatchDigest(db));
  });

  app.post("/api/entries/:id/digest/refresh", async (c) => {
    try {
      const digest = await generateAndCacheEntryDigest(db, masterKey, c.req.param("id"), true);
      if (!digest) return c.json({ error: "模型未开启或日记为空，已平滑保留原文" }, 400);
      return c.json(digest);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "摘要生成失败" }, 400);
    }
  });

  app.post("/api/ai/qa", async (c) => {
    const body = z.object({ question: z.string().min(1) }).parse(await c.req.json());
    try {
      const res = await runMemoryQa(db, masterKey, body.question);
      return c.json(res);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "回忆问答执行失败" }, 400);
    }
  });

  // 9. 时间簿只读联动与深度月/年复盘 & 双高光时间轴
  app.get("/api/settings/timebook", (c) => {
    return c.json(getTimebookConfigPublic(db, masterKey));
  });

  app.put("/api/settings/timebook", async (c) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        url: z.string().optional(),
        password: z.string().optional()
      })
      .parse(await c.req.json());
    return c.json(saveTimebookConfig(db, masterKey, body));
  });

  app.post("/api/settings/timebook/test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      url?: string;
      password?: string;
    };
    try {
      const res = await testTimebookConnection(db, masterKey, body);
      return c.json(res);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "时间簿连接失败" }, 400);
    }
  });

  app.get("/api/reviews/monthly/:ym", (c) => {
    return c.json(getCachedMonthlyReview(db, c.req.param("ym")));
  });

  app.post("/api/reviews/monthly/:ym/generate", async (c) => {
    const ym = c.req.param("ym");
    const cached = getCachedMonthlyReview(db, ym);
    if (cached.locked) {
      return c.json(cached, 403);
    }
    try {
      const rev = await generateMonthlyReview(db, masterKey, ym);
      return c.json(rev);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "月报生成失败" }, 400);
    }
  });

  app.get("/api/reviews/yearly/:year", (c) => {
    return c.json(getCachedYearlyReview(db, c.req.param("year")));
  });

  app.post("/api/reviews/yearly/:year/generate", async (c) => {
    const year = c.req.param("year");
    const cached = getCachedYearlyReview(db, year);
    if (cached.locked) {
      return c.json(cached, 403);
    }
    try {
      const rev = await generateYearlyReview(db, masterKey, year);
      return c.json(rev);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "年报生成失败" }, 400);
    }
  });

  app.post("/api/reviews/:scope/:periodKey/highlights/pin", async (c) => {
    const scope = c.req.param("scope") === "yearly" ? "yearly" : "monthly";
    const periodKey = c.req.param("periodKey");
    const body = z.object({ entryId: z.string().min(1) }).parse(await c.req.json());
    const highlights = setHighlightAction(db, {
      scope,
      periodKey,
      entryId: body.entryId,
      action: "pin"
    });
    return c.json({ ok: true, highlights });
  });

  app.post("/api/reviews/:scope/:periodKey/highlights/unpin", async (c) => {
    const scope = c.req.param("scope") === "yearly" ? "yearly" : "monthly";
    const periodKey = c.req.param("periodKey");
    const body = z.object({ entryId: z.string().min(1) }).parse(await c.req.json());
    const highlights = setHighlightAction(db, {
      scope,
      periodKey,
      entryId: body.entryId,
      action: "unpin"
    });
    return c.json({ ok: true, highlights });
  });

  app.post("/api/reviews/:scope/:periodKey/highlights/exclude", async (c) => {
    const scope = c.req.param("scope") === "yearly" ? "yearly" : "monthly";
    const periodKey = c.req.param("periodKey");
    const body = z.object({ entryId: z.string().min(1) }).parse(await c.req.json());
    const highlights = setHighlightAction(db, {
      scope,
      periodKey,
      entryId: body.entryId,
      action: "exclude"
    });
    return c.json({ ok: true, highlights });
  });

  // 10. 托管前端构建产物（跨平台安全静态文件 + SPA 回落）
  const resolvedWebDist = options?.webDistDir
    ? path.resolve(options.webDistDir)
    : process.env.WEB_DIST_DIR
      ? path.resolve(process.env.WEB_DIST_DIR)
      : path.resolve(import.meta.dirname, "../../web/dist");

  const STATIC_MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
  };

  if (fs.existsSync(resolvedWebDist)) {
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "接口不存在" }, 404);
      }
      const reqRel = c.req.path === "/" ? "index.html" : c.req.path.replace(/^\/+/, "");
      const candidate = path.resolve(resolvedWebDist, reqRel);
      if (
        candidate.startsWith(resolvedWebDist + path.sep) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        const ext = path.extname(candidate).toLowerCase();
        const mime = STATIC_MIME[ext] || "application/octet-stream";
        const buf = fs.readFileSync(candidate);
        return new Response(buf, { status: 200, headers: { "Content-Type": mime } });
      }
      const indexHtml = path.join(resolvedWebDist, "index.html");
      if (fs.existsSync(indexHtml)) {
        return c.html(fs.readFileSync(indexHtml, "utf8"));
      }
      return c.text("人生簿前端未构建", 404);
    });
  }

  return {
    app,
    db,
    dataDir,
    masterKey,
    auth,
    close: () => {
      db.close();
    }
  };
}

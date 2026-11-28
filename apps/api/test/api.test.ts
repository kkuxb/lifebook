import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getShanghaiNowParts } from "@lifebook/core";
import { createLifebookApp, type AppInstance } from "../src/app.js";
import { initDatabase } from "../src/db/schema.js";
import { resolveMasterKey } from "../src/crypto.js";
import { extractJsonFromAiText } from "../src/services/ai-client.js";
import { upsertEntry } from "../src/services/entries.js";
import { computeDigestHash, generateAndCacheEntryDigest } from "../src/services/reviews.js";
import { clearTimebookCache } from "../src/services/timebook-sync.js";

describe("@lifebook/api 全链路集成测试", () => {
  let tmpDir: string;
  let instance: AppInstance;
  let token = "";

  // 本地模拟 HTTP 服务：大模型三协议 + 时间簿
  let mockServer: http.Server;
  let mockBaseUrl = "";
  let mockAiMode: "normal" | "loop_tools" | "auth_error" | "stats_qa" | "digest_flaky_json" | "timebook_qa" = "normal";
  let mockTbOnline = true;
  let mockTbSchemaMode: "legacy" | "four_layer" = "legacy";
  let tbSyncCallCount = 0;
  let lastSeenToolNames: string[] = [];
  let lastSeenQaSystemPrompt = "";
  let flakyDigestAttempt = 0;
  let digestCallCount = 0;
  let digestDelayMs = 0;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifebook-api-test-"));
    process.env.APP_PASSWORD = "test-pass-only";
    instance = createLifebookApp({ dataDir: tmpDir });

    mockServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = req.url || "";

      // 时间簿模拟接口
      if (url === "/tb/api/login") {
        if (!mockTbOnline) {
          res.writeHead(503);
          res.end("offline");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: "tb-mock-token" }));
        return;
      }
      if (url.startsWith("/tb/api/sync")) {
        if (!mockTbOnline) {
          res.writeHead(503);
          res.end("offline");
          return;
        }
        tbSyncCallCount += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        if (mockTbSchemaMode === "four_layer") {
          // 上海 2026-09-12 10:00~13:00 (3h 原神), 2026-09-20 14:00~16:00 (2h 原神), 2026-09-20 09:00~12:00 (3h 编码)
          // 跨月边界：2026-09-30T22:00:00Z = 上海 2026-10-01 06:00:00 (应算入 2026-10 而非 2026-09)
          const t1Start = Date.parse("2026-09-12T10:00:00+08:00");
          const t1End = Date.parse("2026-09-12T13:00:00+08:00");
          const t2Start = Date.parse("2026-09-20T14:00:00+08:00");
          const t2End = Date.parse("2026-09-20T16:00:00+08:00");
          const t3Start = Date.parse("2026-09-20T09:00:00+08:00");
          const t3End = Date.parse("2026-09-20T12:00:00+08:00");
          const octStart = Date.parse("2026-09-30T22:00:00Z");
          const octEnd = octStart + 3600_000;

          res.end(
            JSON.stringify({
              modules: [
                { id: "m-ent", name: "娱乐休息", color_key: "purple", sort: 1, deleted_at: null },
                { id: "m-work", name: "工作学习", color_key: "blue", sort: 2, deleted_at: null }
              ],
              tags: [
                { id: "tg-ys", module_id: "m-ent", name: "原神", sort: 1, deleted_at: null },
                { id: "tg-code", module_id: "m-work", name: "编码", sort: 2, deleted_at: null }
              ],
              sessions: [
                { id: "ses1", tag_id: "tg-ys", title: "枫丹探索", start_at: t1Start, end_at: t1End, deleted_at: null },
                { id: "ses2", tag_id: "tg-ys", title: "深渊活动", start_at: t2Start, end_at: t2End, deleted_at: null },
                { id: "ses3", tag_id: "tg-code", title: "写桌面端", start_at: t3Start, end_at: t3End, deleted_at: null },
                { id: "ses-oct", tag_id: "tg-code", title: "十月晨练编码", start_at: octStart, end_at: octEnd, deleted_at: null },
                { id: "ses-del", tag_id: "tg-ys", title: "已删计时", start_at: t1Start, end_at: t1End, deleted_at: 1790000000000 }
              ],
              todos: [
                { id: "td-1", title: "原神版本任务", tag_id: "tg-ys", plan_date: "2026-09-12", done_at: t1End, deleted_at: null },
                { id: "td-2", title: "补单测", tag_id: "tg-code", plan_date: "2026-09-20", done_at: null, deleted_at: null },
                { id: "td-rec", title: "每日委托", tag_id: "tg-ys", recur: "daily", done_at: null, deleted_at: null }
              ],
              todo_checks: [
                { todo_id: "td-rec", date: "2026-09-12", done_at: t1End, deleted_at: null },
                { todo_id: "td-rec", date: "2026-09-13", done_at: null, deleted_at: null }
              ]
            })
          );
          return;
        }
        res.end(
          JSON.stringify({
            modules: [
              { id: "mod-work", name: "工作推进", color: "#4F7BFF" },
              { id: "mod-life", name: "居家生活", color: "#14B8A6" }
            ],
            sessions: [
              { id: "s1", moduleId: "mod-work", startedAt: "2026-10-03T09:00:00Z", durationSeconds: 36000 },
              { id: "s2", moduleId: "mod-life", startedAt: "2026-10-05T18:00:00Z", durationSeconds: 18000 },
              { id: "s3", moduleId: "mod-work", startedAt: "2025-05-03T09:00:00Z", durationSeconds: 72000 }
            ],
            todos: [
              { id: "td1", dueDate: "2026-10-10", completed: true },
              { id: "td2", dueDate: "2026-10-12", completed: false }
            ],
            todoChecks: []
          })
        );
        return;
      }

      // 模型模拟鉴权失败
      if (mockAiMode === "auth_error") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

      // OpenAI 兼容
      if (url.includes("/chat/completions")) {
        const tools = (body.tools as Array<{ function?: { name?: string } }> | undefined) ?? [];
        if (tools.length > 0) {
          lastSeenToolNames = tools.map((t) => t.function?.name || "");
        }
        const messages = (body.messages as Array<{ role: string; content?: string }>) ?? [];
        const sysMsg = messages.find((m) => m.role === "system")?.content || "";
        const lastMsg = messages[messages.length - 1];

        // 测通请求
        if (sysMsg.includes("连通正常")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "连通正常" } }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            })
          );
          return;
        }

        // 回忆问答工具循环
        if (tools.length > 0) {
          lastSeenQaSystemPrompt = sysMsg;
          if (mockAiMode === "loop_tools") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: `call_${Date.now()}`,
                          type: "function",
                          function: { name: "search_entries_fts", arguments: JSON.stringify({ q: "海风" }) }
                        }
                      ]
                    }
                  }
                ],
                usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
              })
            );
            return;
          }

          if (mockAiMode === "stats_qa") {
            if (lastMsg?.role !== "tool") {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_stats_1",
                            type: "function",
                            function: {
                              name: "aggregate_entry_stats",
                              arguments: JSON.stringify({ tag: "重要", groupBy: "year" })
                            }
                          },
                          {
                            id: "call_list_1",
                            type: "function",
                            function: {
                              name: "list_entry_digests",
                              arguments: JSON.stringify({ mood: "平静", sortBy: "words_desc", limit: 3 })
                            }
                          }
                        ]
                      }
                    }
                  ]
                })
              );
              return;
            }
            const toolResults = messages
              .filter((m) => m.role === "tool")
              .map((m) => m.content || "")
              .join(" | ");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [{ message: { content: `统计结果确认：${toolResults}` } }],
                usage: { prompt_tokens: 80, completion_tokens: 45, total_tokens: 125 }
              })
            );
            return;
          }

          if (mockAiMode === "timebook_qa") {
            const toolCount = messages.filter((m) => m.role === "tool").length;
            if (toolCount === 0) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_tb_1",
                            type: "function",
                            function: {
                              name: "query_timebook_stats",
                              arguments: JSON.stringify({
                                startDate: "2026-09-01",
                                endDate: "2026-09-30",
                                keyword: "原神",
                                groupBy: "day"
                              })
                            }
                          }
                        ]
                      }
                    }
                  ]
                })
              );
              return;
            }
            if (toolCount === 1) {
              const tbResult = JSON.parse(lastMsg?.content || "{}") as {
                topDays?: Array<{ date: string }>;
              };
              const topDate = tbResult.topDays?.[0]?.date || "2026-09-12";
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_read_1",
                            type: "function",
                            function: {
                              name: "read_entry_full",
                              arguments: JSON.stringify({ date: topDate })
                            }
                          }
                        ]
                      }
                    }
                  ]
                })
              );
              return;
            }
            const tbMsg = messages.find((m) => m.role === "tool" && m.content?.includes("totalHours"));
            const entryMsg = messages.find((m) => m.role === "tool" && m.content?.includes("contentText"));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: `时间簿统计：${tbMsg?.content || ""}；当天日记详情：${entryMsg?.content || ""}`
                    }
                  }
                ]
              })
            );
            return;
          }

          if (lastMsg?.role !== "tool") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "call_1",
                          type: "function",
                          function: { name: "search_entries_fts", arguments: JSON.stringify({ q: "海风" }) }
                        }
                      ]
                    }
                  }
                ]
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "你在 2026-10-03 去海边吹海风散步，心情非常开心。" } }],
              usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
            })
          );
          return;
        }

        // 单篇结构化日概要
        if (sysMsg.includes("shortTitle")) {
          digestCallCount += 1;
          if (digestDelayMs > 0) {
            await new Promise((r) => setTimeout(r, digestDelayMs));
          }
          if (mockAiMode === "digest_flaky_json") {
            flakyDigestAttempt++;
            if (flakyDigestAttempt === 1) {
              // 模拟第 1 次模型生成未转义逗号错误导致 JSON.parse 失败
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: `{"shortTitle": "首次报错" "summary": "这里缺逗号将触发重试",}`
                      }
                    }
                  ]
                })
              );
              return;
            }
            // 第 2 次重试返回带 <think> 与尾逗号的合法容错 JSON
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: `<think>思考内容应被自动清除</think>\n\`\`\`json\n{\n  "shortTitle": "重试容错成功摘要",\n  "summary": "第2次自动重试并通过容错解析保存。",\n  "dimLife": "生活有序",\n  "dimWork": "无明显记录",\n  "dimLeisure": "夜间散步",\n  "dimPeopleNotes": "无明显记录",\n  "keyEvents": [{ "title": "夜游放松", "importance": 3, "nature": "生活" },],\n  "topics": ["重试", "散步",],\n  "reflection": "容错可靠。",\n}\n\`\`\``
                    }
                  }
                ]
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      shortTitle: "海岸吹海风散步与复盘",
                      summary: "下午收工后沿海岸吹海风步行四公里，傍晚看落日心情舒畅。",
                      dimLife: "沿海步行四公里放松肩颈，规律作息。",
                      dimWork: "完成产品清单对齐。",
                      dimLeisure: "欣赏海岸橘子海落日。",
                      dimPeopleNotes: "与团队顺利演示。",
                      keyEvents: [{ title: "海岸吹海风散步", importance: 4, nature: "生活" }],
                      topics: ["海风", "散步", "落日"],
                      reflection: "户外散步是快速恢复精力的有效方式。"
                    })
                  }
                }
              ]
            })
          );
          return;
        }

        // 月度复盘
        if (sysMsg.includes("月度复盘")) {
          const long180 = (prefix: string) =>
            `${prefix}在 2026-10-03、2026-10-15 等多个节点呈现出清晰的推进节奏，结合时间簿投入占比与日记具体事实例证，可以看到整块专注时段带来的稳步收获与连续多线切换造成的效率折损，月末通过户外快走与早睡重新建立起稳定的作息基线。`.repeat(2);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      overviewSummary: "2026年10月整体节奏稳健，主观记录与客观耗时相互印证。",
                      crossInsights: ["工作投入 10 小时配合日记复盘，专注度高于平均水平。"],
                      dimensions: {
                        work: long180("工作与事务方面，"),
                        life: long180("生活与健康方面，"),
                        leisure: long180("娱乐与成长方面，"),
                        emotion: long180("情绪波动与恢复规律方面，")
                      },
                      nextActions: ["每天锁定一个核心推进节点", "保持每周户外散步"],
                      highlights: [
                        { date: "2026-10-03", title: "海岸吹海风散步", reason: "高光节点" },
                        { date: "2026-10-99", title: "假日期测试", reason: "应被服务端过滤" }
                      ]
                    })
                  }
                }
              ],
              usage: { prompt_tokens: 400, completion_tokens: 600, total_tokens: 1000 }
            })
          );
          return;
        }

        // 年度复盘
        if (sysMsg.includes("年度复盘")) {
          const long340 = (prefix: string) =>
            `${prefix}贯穿 2025 年四个季度的跨月实践与记录显示，从 Q1 奠定基础到 Q2 深度执行再到 Q3/Q4 稳健收口，结合 2025-05-03 等真实日期事实与全年字数累计统计，能够清晰看到长期积累形成的正反馈，同时也暴露出多线并行时体力分配不均的瓶颈。`.repeat(3);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      overviewSummary: "2025 全年节奏清晰，持续记录形成稳固坐标。",
                      quarters: [
                        { q: "Q1", desc: "夯实基线" },
                        { q: "Q2", desc: "重点突破" },
                        { q: "Q3", desc: "稳步沉淀" },
                        { q: "Q4", desc: "复盘收口" }
                      ],
                      threeLines: {
                        work: long340("工作积累主线："),
                        life: long340("生活秩序主线："),
                        growth: long340("个人成长主线：")
                      },
                      patterns: ["整块专注效率显著高于碎片切换"],
                      anchors: ["早睡", "单任务聚焦", "每周复盘"],
                      highlights: [{ date: "2025-05-03", title: "2025春季节点", reason: "跨月关键节点" }]
                    })
                  }
                }
              ]
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "好的" } }] }));
        return;
      }

      // Gemini 原生模拟
      if (url.includes(":generateContent")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Gemini 连通正常" }] } }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 }
          })
        );
        return;
      }

      // Anthropic 原生模拟
      if (url.includes("/messages")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            content: [{ type: "text", text: "Anthropic 连通正常" }],
            usage: { input_tokens: 8, output_tokens: 5 }
          })
        );
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as { port: number };
        mockBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    instance.close();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.APP_PASSWORD;
  });

  async function req(p: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return instance.app.request(`http://localhost${p}`, { ...init, headers });
  }

  it("V1: 健康检查、5次错误口令触发429限流、正确登录、当日5份快照与跨自然日清理", async () => {
    const health = await req("/api/health");
    expect(health.status).toBe(200);

    // 5次错误密码限流
    for (let i = 1; i <= 4; i++) {
      const fail = await req("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.88" },
        body: JSON.stringify({ password: "wrong" })
      });
      expect(fail.status).toBe(401);
    }
    const fifth = await req("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.88" },
      body: JSON.stringify({ password: "wrong" })
    });
    expect(fifth.status).toBe(429);

    // 正确登录
    const okLogin = await req("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.99" },
      body: JSON.stringify({ password: "test-pass-only" })
    });
    expect(okLogin.status).toBe(200);
    const loginJson = (await okLogin.json()) as { token: string };
    token = loginJson.token;

    // 写入昨日遗留快照并连续保存 7 次今日日记
    const todayShanghai = getShanghaiNowParts().date;
    const savedPrev = upsertEntry(instance.db, {
      kind: "daily",
      date: "2026-10-03",
      title: "昨日初版",
      contentHtml: "<p>昨日海风记录</p>",
      tags: ["重要事件"],
      moods: ["😄 开心"],
      snapshotDateOverride: "2020-01-01"
    });
    expect(
      instance.db
        .prepare("SELECT COUNT(*) as c FROM entry_snapshots WHERE entry_id = ? AND snapshot_date = '2020-01-01'")
        .get(savedPrev.id)
    ).toEqual({ c: 1 });

    // 连续通过接口保存 7 次
    for (let i = 1; i <= 7; i++) {
      const r = await req(`/api/entries/${savedPrev.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "daily",
          date: "2026-10-03",
          title: `海边吹海风散步 v${i}`,
          contentHtml: `<p>第${i}次保存，沿着海岸吹海风散步。</p>`,
          tags: ["重要事件", "旅行游玩"],
          moods: ["😄 开心"]
        })
      });
      expect(r.status).toBe(200);
    }

    // 核验：昨日遗留快照已被自动删除，今日快照最多保留 5 份
    const oldSnapCount = instance.db
      .prepare("SELECT COUNT(*) as c FROM entry_snapshots WHERE snapshot_date < ?")
      .get(todayShanghai) as { c: number };
    expect(oldSnapCount.c).toBe(0);

    const snapRes = await req(`/api/entries/${savedPrev.id}/snapshots`);
    const snapJson = (await snapRes.json()) as { items: Array<{ title: string }> };
    expect(snapJson.items).toHaveLength(5);
    expect(snapJson.items[0].title).toBe("海边吹海风散步 v7");
  });

  it("V3: 标签与 8 档核心心情安全删除（未传 replaceWithId 返回 400、迁移去重、零删除日记）", async () => {
    const tagsRes = await req("/api/tags");
    const tags = ((await tagsRes.json()) as { items: Array<{ id: string; name: string }> }).items;
    const importantTag = tags.find((t) => t.name === "重要事件")!;
    const travelTag = tags.find((t) => t.name === "旅行游玩")!;

    // 不带 replaceWithId 尝试删除关联标签 -> 400
    const badDel = await req(`/api/tags/${travelTag.id}`, { method: "DELETE" });
    expect(badDel.status).toBe(400);

    // 指定 replaceWithId=importantTag.id -> 自动迁移并去重（该日记原本同时带两个标签）
    const goodDel = await req(`/api/tags/${travelTag.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replaceWithId: importantTag.id })
    });
    expect(goodDel.status).toBe(200);

    // 核验日记一篇未丢且标签已去重
    const checkEntries = await req("/api/entries?tag=重要事件");
    const checkJson = (await checkEntries.json()) as { total: number };
    expect(checkJson.total).toBeGreaterThanOrEqual(1);

    // 心情同样包含 8 档（含生气）且安全删除受保护
    const moodsRes = await req("/api/moods");
    const moods = ((await moodsRes.json()) as { items: Array<{ id: string; name: string }> }).items;
    expect(moods.some((m) => m.name === "生气")).toBe(true);
    const happyMood = moods.find((m) => m.name === "开心")!;
    const calmMood = moods.find((m) => m.name === "平静")!;
    const badMoodDel = await req(`/api/moods/${happyMood.id}`, { method: "DELETE" });
    expect(badMoodDel.status).toBe(400);
    const goodMoodDel = await req(`/api/moods/${happyMood.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replaceWithId: calmMood.id })
    });
    expect(goodMoodDel.status).toBe(200);
  });

  it("V2: 原平台 ZIP 导入预览（过滤空白草稿、去日期前缀、旧12→新8映射、同日冲突与批次撤销）", async () => {
    const zip = new JSZip();
    const csv = [
      "日期,标题,心情,标签,正文",
      `"2026-10-03","2026-10-03 冲突的旧导入","😷 不爽","日常记录","冲突内容"`,
      `"2026-10-04","2026年10月04日：银杏树下读书","🙃 一般","休闲躺平","在公园银杏树下安静阅读一小时。"`,
      `"","","","日常记录",""`
    ].join("\n");
    zip.file("index.csv", csv);
    // 附带 1 张子目录图片，验证 attachmentCount 精确统计为 1
    zip.file("assets/photo.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(zipBuf)], { type: "application/zip" }), "export.zip");

    const prevRes = await req("/api/import/preview", { method: "POST", body: form });
    expect(prevRes.status).toBe(200);
    const prevJson = (await prevRes.json()) as {
      previewId: string;
      blankDraftsFiltered: number;
      attachmentCount: number;
      conflicts: Array<{ date: string; defaultStrategy: string }>;
      sampleItems: Array<{ cleanTitle: string; mappedMoods: string[] }>;
    };
    expect(prevJson.blankDraftsFiltered).toBe(1);
    expect(prevJson.attachmentCount).toBe(1);
    expect(prevJson.conflicts.some((c) => c.date === "2026-10-03" && c.defaultStrategy === "skip")).toBe(true);
    expect(prevJson.sampleItems.some((s) => s.cleanTitle === "银杏树下读书")).toBe(true);

    // 默认策略提交：2026-10-03 跳过保留原文，2026-10-04 新增入库
    const commitRes = await req("/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: prevJson.previewId })
    });
    expect(commitRes.status).toBe(200);
    const commitJson = (await commitRes.json()) as {
      batchId: string;
      importedCount: number;
      skippedCount: number;
    };
    expect(commitJson.importedCount).toBe(1);
    expect(commitJson.skippedCount).toBe(1);

    // 确认 2026-10-04 入库成功
    const oct4 = await (await req("/api/entries/by-date/2026-10-04")).json() as { entry: { title: string } | null };
    expect(oct4.entry?.title).toBe("银杏树下读书");

    // 撤销批次后 2026-10-04 被干净回滚，2026-10-03 原日记完好无损
    const undoRes = await req(`/api/import/batches/${commitJson.batchId}`, { method: "DELETE" });
    expect(undoRes.status).toBe(200);
    const oct4After = await (await req("/api/entries/by-date/2026-10-04")).json() as { entry: unknown };
    expect(oct4After.entry).toBeNull();
    const oct3After = await (await req("/api/entries/by-date/2026-10-03")).json() as { entry: { title: string } | null };
    expect(oct3After.entry?.title).toContain("海边吹海风散步");
  });

  it("V4: 1,250 篇规模下 FTS5 中文检索响应 < 100ms", () => {
    const tx = instance.db.transaction(() => {
      for (let i = 0; i < 1250; i++) {
        const y = 2023 + Math.floor(i / 365);
        const m = String((i % 12) + 1).padStart(2, "0");
        const d = String((i % 28) + 1).padStart(2, "0");
        const kw = i % 250 === 0 ? "银杏落叶与阅读时光" : "普通日常散步煮茶";
        upsertEntry(instance.db, {
          kind: "special",
          date: `${y}-${m}-${d}`,
          title: `测试日记 #${i}`,
          contentHtml: `<p>第 ${i} 篇模拟内容：${kw}。</p>`,
          createSnapshot: false
        });
      }
    });
    tx();

    return req("/api/entries?q=银杏").then(async (r) => {
      expect(r.status).toBe(200);
      const json = (await r.json()) as { total: number; elapsedMs: number };
      expect(json.total).toBeGreaterThanOrEqual(5);
      expect(json.elapsedMs).toBeLessThan(100);
    });
  });

  it("V5 & V6: 三协议测通、密钥掩码保护、日概要生成与 4 只读工具问答（含超4轮截断）", async () => {
    // 1. 测试三协议连通（OpenAI / Gemini / Anthropic）
    for (const provider of ["openai", "gemini", "anthropic"] as const) {
      const tRes = await req("/api/settings/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: `${mockBaseUrl}/${provider}`,
          apiKey: "mock-secret-value-123456",
          modelId: "mock-model"
        })
      });
      expect(tRes.status).toBe(200);
    }

    // 保存 OpenAI 配置并确认 GET 接口不回传明文密钥
    const saveAi = await req("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        provider: "openai",
        baseUrl: `${mockBaseUrl}/openai`,
        apiKey: "mock-secret-value-123456",
        modelId: "mock-model"
      })
    });
    expect(saveAi.status).toBe(200);
    const savedPub = (await saveAi.json()) as { apiKeyMasked: string; hasApiKey: boolean };
    expect(savedPub.hasApiKey).toBe(true);
    expect(savedPub.apiKeyMasked).not.toContain("mock-secret-value-123456");

    // 2. 正常 4 只读工具回忆问答
    const qaRes = await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "我什么时候去吹过海风？" })
    });
    expect(qaRes.status).toBe(200);
    const qaJson = (await qaRes.json()) as {
      answer: string;
      traces: Array<{ tool: string }>;
      citations: Array<{ date: string }>;
      truncatedAtMaxRounds: boolean;
    };
    expect(lastSeenToolNames).toEqual([
      "search_entries_fts",
      "list_entry_digests",
      "read_entry_full",
      "aggregate_entry_stats"
    ]);
    expect(qaJson.answer).toContain("海风");
    expect(qaJson.citations.some((c) => c.date === "2026-10-03")).toBe(true);
    expect(qaJson.truncatedAtMaxRounds).toBe(false);

    // 3. 模拟模型持续试图超过 4 轮调用 -> 强制截断收敛
    mockAiMode = "loop_tools";
    const loopRes = await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "无限循环测试" })
    });
    expect(loopRes.status).toBe(200);
    const loopJson = (await loopRes.json()) as {
      roundsUsed: number;
      truncatedAtMaxRounds: boolean;
      traces: unknown[];
    };
    expect(loopJson.roundsUsed).toBe(4);
    expect(loopJson.truncatedAtMaxRounds).toBe(true);
    expect(loopJson.traces).toHaveLength(4);
    mockAiMode = "normal";
  });

  it("V7: 自然周期锁、时间簿联动（及离线降级）、深度月/年复盘、双高光手动钉选保留与热备导出", async () => {
    // 1. 当前上海自然月与当前自然年应处于锁定状态
    const curParts = getShanghaiNowParts();
    const curMonthLock = await (await req(`/api/reviews/monthly/${curParts.month}`)).json() as { locked: boolean };
    expect(curMonthLock.locked).toBe(true);
    const curYearLock = await (await req(`/api/reviews/yearly/${curParts.year}`)).json() as { locked: boolean };
    expect(curYearLock.locked).toBe(true);

    // 2. 配置并测通模拟时间簿
    await req("/api/settings/timebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        url: `${mockBaseUrl}/tb`,
        password: "tb-mock-password"
      })
    });
    const tbTest = await req("/api/settings/timebook/test", { method: "POST" });
    expect(tbTest.status).toBe(200);

    // 3. 生成已结束月 2026-10 深度月报（融合时间簿）
    const mGen = await req("/api/reviews/monthly/2026-10/generate", { method: "POST" });
    expect(mGen.status).toBe(200);
    const mJson = (await mGen.json()) as {
      locked: boolean;
      withTimebook: boolean;
      dimensions: { work: string; life: string; leisure: string; emotion: string };
      highlights: Array<{ entryId: string; date: string; pinned: boolean }>;
    };
    expect(mJson.locked).toBe(false);
    expect(mJson.withTimebook).toBe(true);
    expect(mJson.dimensions.work.length).toBeGreaterThanOrEqual(150);
    // 假日期 2026-10-99 已被过滤
    expect(mJson.highlights.some((h) => h.date === "2026-10-99")).toBe(false);

    // 手动钉选一条高光并确认重算后依然保留
    const targetEntryId = mJson.highlights[0].entryId;
    const pinRes = await req("/api/reviews/monthly/2026-10/highlights/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: targetEntryId })
    });
    expect(pinRes.status).toBe(200);

    // 4. 模拟时间簿离线后重新生成 -> 平滑降级为纯日记复盘且手动钉选仍保留
    clearTimebookCache();
    mockTbOnline = false;
    const mReGen = await req("/api/reviews/monthly/2026-10/generate", { method: "POST" });
    expect(mReGen.status).toBe(200);
    const mReJson = (await mReGen.json()) as {
      withTimebook: boolean;
      highlights: Array<{ entryId: string; pinned: boolean }>;
    };
    expect(mReJson.withTimebook).toBe(false);
    expect(mReJson.highlights.find((h) => h.entryId === targetEntryId)?.pinned).toBe(true);
    mockTbOnline = true;
    clearTimebookCache();

    // 5. 生成已结束年 2025 深度年报
    upsertEntry(instance.db, {
      kind: "daily",
      date: "2025-05-03",
      title: "2025 春季节点",
      contentHtml: "<p>2025 年春季重要节点记录</p>",
      tags: ["节点事件"],
      moods: ["😌 平静"],
      createSnapshot: false
    });
    const yGen = await req("/api/reviews/yearly/2025/generate", { method: "POST" });
    expect(yGen.status).toBe(200);
    const yJson = (await yGen.json()) as {
      threeLines: { work: string; life: string; growth: string };
    };
    expect(yJson.threeLines.work.length).toBeGreaterThanOrEqual(300);

    // 6. 热备与 JSON / Markdown 导出
    const bkRes = await req("/api/backup/run", { method: "POST" });
    expect(bkRes.status).toBe(200);
    const bkJson = (await bkRes.json()) as { filename: string; sizeBytes: number };
    expect(bkJson.sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, "backups", bkJson.filename))).toBe(true);

    const jsonExport = await req("/api/export?format=json");
    expect(jsonExport.status).toBe(200);
    const mdExport = await req("/api/export?format=markdown");
    expect(mdExport.status).toBe(200);
  });

  it("v0.1.1: 老库默认心情色平滑迁移、多词空格检索、问答元数据统计及 JSON 容错重试", async () => {
    // 1. 老库旧色自动迁移，保留手工自定义色
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifebook-legacy-mood-"));
    try {
      const db1 = initDatabase(legacyDir);
      db1.prepare("DELETE FROM settings WHERE key = 'mood_palette_v011_migrated'").run();
      db1.prepare("UPDATE moods SET tone = '#64748B' WHERE name = '平静'").run();
      db1.prepare("UPDATE moods SET tone = '#22C55E' WHERE name = '开心'").run();
      db1.prepare("UPDATE moods SET tone = '#123456' WHERE name = '烦躁'").run(); // 模拟用户改过自定义色
      db1.close();

      const db2 = initDatabase(legacyDir);
      const calm = db2.prepare("SELECT tone FROM moods WHERE name = '平静'").get() as { tone: string };
      const happy = db2.prepare("SELECT tone FROM moods WHERE name = '开心'").get() as { tone: string };
      const annoyed = db2.prepare("SELECT tone FROM moods WHERE name = '烦躁'").get() as { tone: string };
      expect(calm.tone).toBe("#7DD3FC");
      expect(happy.tone).toBe("#34D399");
      expect(annoyed.tone).toBe("#123456");
      db2.close();
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }

    // 2. 空格多词联合跨段检索与日期混搜
    const multiWordEntry = upsertEntry(instance.db, {
      kind: "daily",
      date: "2026-07-11",
      title: "夏日出差行程记",
      contentHtml: "<p>上午抵达杭州会场对齐进度。</p><p>傍晚去西溪湿地走了走吹吹风。</p>",
      tags: ["重要事件"],
      moods: ["😌 平静"],
      createSnapshot: false
    });
    const multiRes = await req(`/api/entries?q=${encodeURIComponent("杭州 西溪")}`);
    expect(multiRes.status).toBe(200);
    const multiJson = (await multiRes.json()) as { items: Array<{ id: string }> };
    expect(multiJson.items.some((e) => e.id === multiWordEntry.id)).toBe(true);

    const dateWordRes = await req(`/api/entries?q=${encodeURIComponent("2026 西溪")}`);
    const dateWordJson = (await dateWordRes.json()) as { items: Array<{ id: string }> };
    expect(dateWordJson.items.some((e) => e.id === multiWordEntry.id)).toBe(true);

    // 3. 回忆问答：注入真实标签/心情清单 + 模糊标签与字数统计分组
    mockAiMode = "stats_qa";
    const qaStatsRes = await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "统计带有重要标签的日记有几篇以及最长的是哪天？" })
    });
    expect(qaStatsRes.status).toBe(200);
    const qaStatsJson = (await qaStatsRes.json()) as { answer: string; citations: Array<{ date: string }> };
    expect(lastSeenQaSystemPrompt).toContain("重要事件");
    expect(lastSeenQaSystemPrompt).toContain("😌 平静");
    expect(qaStatsJson.answer).toContain("timeline");
    expect(qaStatsJson.answer).toContain("longestEntries");
    expect(qaStatsJson.citations.length).toBeGreaterThan(0);

    // 4. extractJsonFromAiText 清洗思考块、尾逗号、裸换行与对象漏逗号容错
    const dirty = `<think>分析一下</think>\n\`\`\`json\n{\n  "title": "第一行\n第二行",\n  "items": [{"a": 1} {"a": 2},],\n}\n\`\`\``;
    const parsedDirty = extractJsonFromAiText<{ title: string; items: Array<{ a: number }> }>(dirty);
    expect(parsedDirty.title).toContain("第一行");
    expect(parsedDirty.items).toHaveLength(2);

    // 5. generateAndCacheEntryDigest 首次返回语法错误 JSON 时自动重试第 2 次成功保存
    flakyDigestAttempt = 0;
    mockAiMode = "digest_flaky_json";
    const digestRes = await generateAndCacheEntryDigest(
      instance.db,
      resolveMasterKey(tmpDir),
      multiWordEntry.id,
      true
    );
    expect(flakyDigestAttempt).toBe(2);
    expect(digestRes?.shortTitle).toBe("重试容错成功摘要");
    expect(digestRes?.topics).toEqual(["重试", "散步"]);
    mockAiMode = "normal";
  });

  it("V8 & V9: 时间簿四层真实结构兼容、60s缓存与首页问答动态第5工具跨库协同", async () => {
    // 准备 2026-09-12 同期日记（对应玩原神最多那天）
    upsertEntry(instance.db, {
      kind: "daily",
      date: "2026-09-12",
      title: "周末打原神放松",
      contentHtml: "<p>周末玩原神探索枫丹，心情特别开心放松。</p>",
      tags: ["休闲躺平"],
      moods: ["😄 开心"],
      createSnapshot: false
    });
    upsertEntry(instance.db, {
      kind: "daily",
      date: "2026-09-20",
      title: "推进桌面端编码",
      contentHtml: "<p>下午推进编码并在休息时打了会儿深渊。</p>",
      tags: ["日常记录"],
      moods: ["😌 平静"],
      createSnapshot: false
    });

    // 1. 先确认关闭时间簿联动时，首页问答传给模型的 tools 严格只有 4 个
    await req("/api/settings/timebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, url: `${mockBaseUrl}/tb`, password: "tb-mock-password" })
    });
    mockAiMode = "normal";
    await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "测试未开时间簿工具数" })
    });
    expect(lastSeenToolNames).toEqual([
      "search_entries_fts",
      "list_entry_digests",
      "read_entry_full",
      "aggregate_entry_stats"
    ]);

    // 2. 开启时间簿并切换为真实四层数据结构模式
    clearTimebookCache();
    mockTbSchemaMode = "four_layer";
    tbSyncCallCount = 0;
    await req("/api/settings/timebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, url: `${mockBaseUrl}/tb`, password: "tb-mock-password" })
    });

    // V8: 生成 2026-09 深度月报，校验 tag_id -> module_id 精确归并、上海跨月边界、待办率与 60s 缓存
    const m09Res = await req("/api/reviews/monthly/2026-09/generate", { method: "POST" });
    expect(m09Res.status).toBe(200);
    const m09 = (await m09Res.json()) as {
      withTimebook: boolean;
      overview: { tbHours: string; todoRate: string };
      timebookMix: Array<{ name: string; hours: number; pct: number }>;
    };
    expect(m09.withTimebook).toBe(true);
    // 2026-09 共 3h+2h(原神->娱乐休息) + 3h(编码->工作学习) = 8小时；9月30日22:00Z=上海10月1日不计入9月；已删不计入
    expect(m09.overview.tbHours).toBe("8 小时");
    // 待办：td-1(done) + td-2(undone) + td-rec 09-12(done) + td-rec 09-13(undone) = 2/4 = 50%
    expect(m09.overview.todoRate).toBe("50%");
    expect(m09.timebookMix.find((x) => x.name === "娱乐休息")?.hours).toBe(5);
    expect(m09.timebookMix.find((x) => x.name === "工作学习")?.hours).toBe(3);
    const callsAfterFirst = tbSyncCallCount;
    expect(callsAfterFirst).toBe(1);

    // 3. V9: 开启时间簿后首页问答动态注册第 5 工具 query_timebook_stats，且 60s 内命中缓存不额外刷 /api/sync
    mockAiMode = "timebook_qa";
    const qaTbRes = await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "上个月玩原神花了多长时间，玩得最多的那天日记心情怎么样？" })
    });
    expect(qaTbRes.status).toBe(200);
    const qaTb = (await qaTbRes.json()) as {
      answer: string;
      traces: Array<{ tool: string; summary: string }>;
      citations: Array<{ date: string }>;
    };
    expect(lastSeenToolNames).toEqual([
      "search_entries_fts",
      "list_entry_digests",
      "read_entry_full",
      "aggregate_entry_stats",
      "query_timebook_stats"
    ]);
    expect(tbSyncCallCount).toBe(callsAfterFirst); // 命中 60s 只读缓存
    expect(qaTb.traces.some((t) => t.tool === "query_timebook_stats" && t.summary.includes("5 小时"))).toBe(true);
    expect(qaTb.traces.some((t) => t.tool === "read_entry_full")).toBe(true);
    expect(qaTb.answer).toContain('"totalHours":5');
    expect(qaTb.answer).toContain('"sessionCount":2');
    expect(qaTb.citations.some((c) => c.date === "2026-09-12")).toBe(true);

    // 4. clearTimebookCache 后模拟时间簿离线 -> 问答与复盘均优雅降级不崩溃
    clearTimebookCache();
    mockTbOnline = false;
    const qaDegradeRes = await req("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "时间簿离线降级测试" })
    });
    expect(qaDegradeRes.status).toBe(200);
    const qaDegrade = (await qaDegradeRes.json()) as { traces: Array<{ summary: string }> };
    expect(qaDegrade.traces.some((t) => t.summary.includes("降级"))).toBe(true);

    mockTbOnline = true;
    mockTbSchemaMode = "legacy";
    mockAiMode = "normal";
    clearTimebookCache();
  });

  it("v0.2.1: 默认与 triggerDigest:false 不触发摘要模型调用，仅 triggerDigest:true 触发 1 次且支持同内容跳过与并发去重", async () => {
    // 确认模型开关处于开启状态并重置计数器
    const saveAi = await req("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        provider: "openai",
        baseUrl: `${mockBaseUrl}/openai`,
        apiKey: "mock-secret-value-123456",
        modelId: "mock-model"
      })
    });
    expect(saveAi.status).toBe(200);

    mockAiMode = "normal";
    digestCallCount = 0;
    digestDelayMs = 0;

    // 1. POST 不传 triggerDigest 与 PUT 显式传 triggerDigest: false -> 0 次模型调用，正文与快照正常落库
    const postRes = await req("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "daily",
        date: "2026-11-28",
        title: "初冬散步记录",
        contentHtml: "<p>第一段自动保存内容。</p>",
        tags: ["日常记录"],
        moods: ["😌 平静"]
      })
    });
    expect(postRes.status).toBe(200);
    const created = (await postRes.json()) as { id: string };

    const putFalseRes = await req(`/api/entries/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "daily",
        date: "2026-11-28",
        title: "初冬散步记录",
        contentHtml: "<p>第一段自动保存内容。</p><p>第二段继续编辑并触发返回兜底保存。</p>",
        tags: ["日常记录"],
        moods: ["😌 平静"],
        triggerDigest: false
      })
    });
    expect(putFalseRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 120));
    expect(digestCallCount).toBe(0);

    const entryAfterAuto = (await (await req(`/api/entries/${created.id}`)).json()) as {
      contentText: string;
      digest?: unknown;
    };
    expect(entryAfterAuto.contentText).toContain("第二段继续编辑");
    expect(entryAfterAuto.digest ?? null).toBeNull();
    const snapsAfterAuto = (await (await req(`/api/entries/${created.id}/snapshots`)).json()) as {
      items: unknown[];
    };
    expect(snapsAfterAuto.items.length).toBeGreaterThanOrEqual(2);

    // 2. PUT 显式传 triggerDigest: true -> 立刻返回成功，后台精确产生 1 次模型调用并落库摘要
    const putTrueRes = await req(`/api/entries/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "daily",
        date: "2026-11-28",
        title: "初冬散步记录",
        contentHtml: "<p>第一段自动保存内容。</p><p>第二段继续编辑并触发返回兜底保存。</p>",
        tags: ["日常记录"],
        moods: ["😌 平静"],
        triggerDigest: true
      })
    });
    expect(putTrueRes.status).toBe(200);

    let entryWithDigest: { digest?: { contentHash: string; summary: string } | null } = {};
    for (let i = 0; i < 40; i++) {
      entryWithDigest = (await (await req(`/api/entries/${created.id}`)).json()) as typeof entryWithDigest;
      if (entryWithDigest.digest?.summary) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(digestCallCount).toBe(1);
    expect(entryWithDigest.digest?.summary).toBeTruthy();

    // 3. 标题与正文未变化时再次传 triggerDigest: true -> 命中哈希缓存，增量为 0
    const repeatRes = await req(`/api/entries/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "daily",
        date: "2026-11-28",
        title: "初冬散步记录",
        contentHtml: "<p>第一段自动保存内容。</p><p>第二段继续编辑并触发返回兜底保存。</p>",
        tags: ["日常记录"],
        moods: ["😌 平静"],
        triggerDigest: true
      })
    });
    expect(repeatRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 120));
    expect(digestCallCount).toBe(1);

    // 4. 修改正文后并发两次 triggerDigest: true（配合短暂模拟延迟）-> 并发去重仅新增 1 次模型调用
    digestDelayMs = 150;
    const updatedPayload = {
      kind: "daily" as const,
      date: "2026-11-28",
      title: "初冬散步记录",
      contentHtml: "<p>更新后的晚间散步与复盘正文，验证并发去重生效。</p>",
      tags: ["日常记录"],
      moods: ["😌 平静"],
      triggerDigest: true
    };
    const [c1, c2] = await Promise.all([
      req(`/api/entries/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPayload)
      }),
      req(`/api/entries/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPayload)
      })
    ]);
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);

    const expectedHash = computeDigestHash({
      title: "初冬散步记录",
      contentText: "更新后的晚间散步与复盘正文，验证并发去重生效。"
    });
    let finalEntry: { digest?: { contentHash: string } | null } = {};
    for (let i = 0; i < 60; i++) {
      finalEntry = (await (await req(`/api/entries/${created.id}`)).json()) as typeof finalEntry;
      if (finalEntry.digest?.contentHash === expectedHash) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 120));
    digestDelayMs = 0;

    expect(finalEntry.digest?.contentHash).toBe(expectedHash);
    expect(digestCallCount).toBe(2);
  });
});

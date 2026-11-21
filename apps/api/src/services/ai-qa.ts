import type Database from "better-sqlite3";
import {
  QA_MAX_CONTEXT_CHARS,
  QA_MAX_TOOL_ROUNDS,
  type QaCitation,
  type QaResponse,
  type QaTraceStep
} from "@lifebook/core";
import {
  callAiCompletion,
  getAiConfigFull,
  type AiConversationMessage,
  type AiToolDeclaration
} from "./ai-client.js";
import { getEntryById, listEntries } from "./entries.js";

export const READONLY_QA_TOOLS: AiToolDeclaration[] = [
  {
    name: "search_entries_fts",
    description: "按关键词与可选日期范围全文检索日记，返回匹配的日记 id、日期、标题与摘要片段（只读）。",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "检索关键词，如 海风、散步、出差" },
        startDate: { type: "string", description: "可选起始日期 YYYY-MM-DD" },
        endDate: { type: "string", description: "可选结束日期 YYYY-MM-DD" },
        limit: { type: "number", description: "返回条数上限，默认 8，最大 15" }
      },
      required: ["q"]
    }
  },
  {
    name: "list_entry_digests",
    description: "按时间范围、标签或心情列出日记目录与结构化概要，用于快速筛查候选日期（只读）。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "可选起始日期 YYYY-MM-DD" },
        endDate: { type: "string", description: "可选结束日期 YYYY-MM-DD" },
        tag: { type: "string", description: "可选标签名称" },
        mood: { type: "string", description: "可选心情名称" },
        limit: { type: "number", description: "返回条数上限，默认 15，最大 30" }
      }
    }
  },
  {
    name: "read_entry_full",
    description: "精读指定 entryId 或指定 date（YYYY-MM-DD）的完整日记正文（只读）。",
    parameters: {
      type: "object",
      properties: {
        entryId: { type: "string", description: "日记 ID" },
        date: { type: "string", description: "日记日期 YYYY-MM-DD" }
      }
    }
  },
  {
    name: "aggregate_entry_stats",
    description: "精确统计指定时间范围内的日记篇数、总字数、均值、心情分布与标签分布（只读）。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "可选起始日期 YYYY-MM-DD" },
        endDate: { type: "string", description: "可选结束日期 YYYY-MM-DD" }
      }
    }
  }
];

function executeReadonlyTool(
  db: Database.Database,
  toolName: string,
  args: Record<string, unknown>,
  citationMap: Map<string, QaCitation>
): { outputJson: string; summary: string } {
  if (toolName === "search_entries_fts") {
    const q = String(args.q ?? "").trim();
    const startDate = args.startDate ? String(args.startDate) : undefined;
    const endDate = args.endDate ? String(args.endDate) : undefined;
    const limit = Math.min(15, Math.max(1, Number(args.limit ?? 8)));
    const res = listEntries(db, { q, startDate, endDate, page: 1, pageSize: limit });
    const items = res.items.map((e) => {
      citationMap.set(e.id, {
        entryId: e.id,
        date: e.date,
        title: e.digest?.shortTitle || e.title || `${e.date} 日记`
      });
      return {
        entryId: e.id,
        date: e.date,
        kind: e.kind,
        title: e.title || `${e.date} 日记`,
        moods: e.moods,
        tags: e.tags,
        wordCount: e.wordCount,
        snippet: e.digest?.summary || e.contentText.slice(0, 180)
      };
    });
    return {
      outputJson: JSON.stringify({ total: res.total, items }),
      summary: `关键词「${q}」命中 ${res.total} 篇（返回 ${items.length} 篇）`
    };
  }

  if (toolName === "list_entry_digests") {
    const startDate = args.startDate ? String(args.startDate) : undefined;
    const endDate = args.endDate ? String(args.endDate) : undefined;
    const tag = args.tag ? String(args.tag) : undefined;
    const mood = args.mood ? String(args.mood) : undefined;
    const limit = Math.min(30, Math.max(1, Number(args.limit ?? 15)));
    const res = listEntries(db, { startDate, endDate, tag, mood, page: 1, pageSize: limit });
    const items = res.items.map((e) => {
      citationMap.set(e.id, {
        entryId: e.id,
        date: e.date,
        title: e.digest?.shortTitle || e.title || `${e.date} 日记`
      });
      return {
        entryId: e.id,
        date: e.date,
        title: e.title || `${e.date} 日记`,
        shortTitle: e.digest?.shortTitle || "",
        summary: e.digest?.summary || e.contentText.slice(0, 120),
        moods: e.moods,
        tags: e.tags,
        wordCount: e.wordCount
      };
    });
    return {
      outputJson: JSON.stringify({ total: res.total, items }),
      summary: `筛查目录共 ${res.total} 篇（返回 ${items.length} 篇）`
    };
  }

  if (toolName === "read_entry_full") {
    const entryId = args.entryId ? String(args.entryId).trim() : "";
    const date = args.date ? String(args.date).trim() : "";
    let entry = entryId ? getEntryById(db, entryId) : null;
    if (!entry && date) {
      const row = db
        .prepare("SELECT id FROM entries WHERE date = ? AND deleted_at IS NULL ORDER BY kind ASC LIMIT 1")
        .get(date) as { id: string } | undefined;
      if (row) entry = getEntryById(db, row.id);
    }
    if (!entry) {
      return {
        outputJson: JSON.stringify({ found: false, message: "未找到对应日记" }),
        summary: `精读失败：未找到日记 (${entryId || date})`
      };
    }
    citationMap.set(entry.id, {
      entryId: entry.id,
      date: entry.date,
      title: entry.digest?.shortTitle || entry.title || `${entry.date} 日记`
    });
    return {
      outputJson: JSON.stringify({
        found: true,
        entryId: entry.id,
        date: entry.date,
        kind: entry.kind,
        title: entry.title,
        moods: entry.moods,
        tags: entry.tags,
        wordCount: entry.wordCount,
        contentText: entry.contentText.slice(0, 3500)
      }),
      summary: `已精读 ${entry.date} 《${entry.title || "无标题"}》（${entry.wordCount}字）`
    };
  }

  if (toolName === "aggregate_entry_stats") {
    const startDate = args.startDate ? String(args.startDate) : "";
    const endDate = args.endDate ? String(args.endDate) : "";
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (startDate) {
      where.push("date >= ?");
      params.push(startDate);
    }
    if (endDate) {
      where.push("date <= ?");
      params.push(endDate);
    }
    const whereSql = where.join(" AND ");
    const agg = db
      .prepare(
        `SELECT COUNT(*) as total, COALESCE(SUM(word_count), 0) as totalWords, COALESCE(MAX(word_count), 0) as maxWords
         FROM entries WHERE ${whereSql}`
      )
      .get(...params) as { total: number; totalWords: number; maxWords: number };

    const moodRows = db
      .prepare(
        `SELECT m.label, COUNT(*) as cnt FROM entry_moods em
         JOIN moods m ON m.id = em.mood_id
         JOIN entries e ON e.id = em.entry_id
         WHERE e.${whereSql.replace(/deleted_at/g, "deleted_at")}
         GROUP BY m.id ORDER BY cnt DESC`
      )
      .all(...params) as Array<{ label: string; cnt: number }>;

    const tagRows = db
      .prepare(
        `SELECT t.name, COUNT(*) as cnt FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         JOIN entries e ON e.id = et.entry_id
         WHERE e.${whereSql.replace(/deleted_at/g, "deleted_at")}
         GROUP BY t.id ORDER BY cnt DESC`
      )
      .all(...params) as Array<{ name: string; cnt: number }>;

    return {
      outputJson: JSON.stringify({
        totalEntries: agg.total,
        totalWords: agg.totalWords,
        avgWords: agg.total ? Math.round(agg.totalWords / agg.total) : 0,
        maxWords: agg.maxWords,
        moods: moodRows,
        tags: tagRows
      }),
      summary: `统计共 ${agg.total} 篇，总计 ${agg.totalWords} 字`
    };
  }

  return {
    outputJson: JSON.stringify({ error: `禁止或未知的工具调用: ${toolName}` }),
    summary: `拦截未知工具 ${toolName}`
  };
}

export async function runMemoryQa(
  db: Database.Database,
  masterKey: Buffer,
  question: string
): Promise<QaResponse> {
  const cleanQ = question.trim();
  if (!cleanQ) {
    throw new Error("请输入你想回顾的问题");
  }

  const cfg = getAiConfigFull(db, masterKey);
  if (!cfg.enabled || !cfg.apiKey) {
    // 模型未开启时平滑降级为本地 FTS5 关键词检索
    const localHits = listEntries(db, { q: cleanQ, page: 1, pageSize: 5 });
    const citations: QaCitation[] = localHits.items.map((e) => ({
      entryId: e.id,
      date: e.date,
      title: e.digest?.shortTitle || e.title || `${e.date} 日记`
    }));
    const answer = localHits.items.length
      ? `模型服务当前未开启，已为你通过本地全文索引找到 ${localHits.total} 篇相关日记：\n` +
        localHits.items.map((e) => `• ${e.date}《${e.title || "日记"}》：${e.contentText.slice(0, 80)}…`).join("\n")
      : "模型服务当前未开启，且本地全文检索未找到直接包含该关键词的日记。你可以前往设置开启模型服务，或在「历史」页尝试更短的关键词。";
    return {
      answer,
      traces: [
        {
          round: 1,
          tool: "local_fts_fallback",
          args: { q: cleanQ },
          durationMs: localHits.elapsedMs,
          summary: `本地降级检索命中 ${localHits.total} 篇`
        }
      ],
      citations,
      roundsUsed: 1,
      truncatedAtMaxRounds: false,
      tokenUsage: null
    };
  }

  const systemPrompt = [
    "你是个人日记工具「人生簿」的回忆问答助手。请严格用中文简体回答用户的回忆提问。",
    "你只能调用提供的 4 个只读本地数据库工具检索与精读真实日记，严禁编造任何日期或日记细节；每次回答必须给出基于真实日期与内容的回答。",
    `每次回答最多允许进行 ${QA_MAX_TOOL_ROUNDS} 轮工具调用，检索充分后请立即停止调工具并总结作答。`
  ].join("\n");

  const messages: AiConversationMessage[] = [{ role: "user", content: cleanQ }];
  const traces: QaTraceStep[] = [];
  const citationMap = new Map<string, QaCitation>();
  let totalContextChars = cleanQ.length;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalAnswer = "";
  let roundsUsed = 0;
  let truncatedAtMaxRounds = false;

  for (let round = 1; round <= QA_MAX_TOOL_ROUNDS; round++) {
    roundsUsed = round;
    const res = await callAiCompletion(cfg, {
      system: systemPrompt,
      messages,
      tools: READONLY_QA_TOOLS,
      maxTokens: 1500,
      temperature: 0.2
    });

    if (res.usage) {
      promptTokens += res.usage.promptTokens ?? 0;
      completionTokens += res.usage.completionTokens ?? 0;
    }

    if (!res.toolCalls || res.toolCalls.length === 0) {
      finalAnswer = res.contentText.trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: res.contentText || "",
      toolCalls: res.toolCalls
    });

    for (const tc of res.toolCalls) {
      const t0 = performance.now();
      const exec = executeReadonlyTool(db, tc.name, tc.args, citationMap);
      const durationMs = Math.max(1, Math.round(performance.now() - t0));
      traces.push({
        round,
        tool: tc.name,
        args: tc.args,
        durationMs,
        summary: exec.summary
      });

      let payload = exec.outputJson;
      if (totalContextChars + payload.length > QA_MAX_CONTEXT_CHARS) {
        const remain = Math.max(400, QA_MAX_CONTEXT_CHARS - totalContextChars);
        payload = payload.slice(0, remain) + "...(已达单次上下文安全上限，截断其余内容)";
      }
      totalContextChars += payload.length;

      messages.push({
        role: "tool",
        toolCallId: tc.id,
        name: tc.name,
        content: payload
      });
    }

    // 若已到达硬限第 4 轮且本轮仍发起了工具调用，立即终止工具循环并收敛
    if (round === QA_MAX_TOOL_ROUNDS) {
      truncatedAtMaxRounds = true;
      try {
        const finalAttempt = await callAiCompletion(cfg, {
          system: systemPrompt + "\n【系统强制指令】已达最多 4 轮只读工具调用上限，禁止再调用任何工具，请立刻基于已收集的日记内容给出中文最终回答。",
          messages,
          tools: undefined,
          maxTokens: 1200,
          temperature: 0.2
        });
        if (finalAttempt.usage) {
          promptTokens += finalAttempt.usage.promptTokens ?? 0;
          completionTokens += finalAttempt.usage.completionTokens ?? 0;
        }
        finalAnswer = finalAttempt.contentText.trim();
      } catch {
        // 忽略收敛请求报错，走下方安全提示兜底
      }
      if (!finalAnswer) {
        const citeList = [...citationMap.values()]
          .slice(0, 6)
          .map((c) => `${c.date}《${c.title}》`)
          .join("、");
        finalAnswer =
          `已达单次回忆问答最多 ${QA_MAX_TOOL_ROUNDS} 轮只读检索硬限，系统已自动安全截断工具循环。` +
          (citeList
            ? `基于前 4 轮已检索到的日记出处（${citeList}），请点击下方出处胶囊直接查看对应日记原文。`
            : "请尝试缩小日期范围或更换更具体的关键词再次提问。");
      }
    }
  }

  return {
    answer: finalAnswer || "未能从日记中生成有效回答，请尝试更具体的问题。",
    traces,
    citations: [...citationMap.values()],
    roundsUsed,
    truncatedAtMaxRounds,
    tokenUsage:
      promptTokens > 0 || completionTokens > 0
        ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
        : null
  };
}

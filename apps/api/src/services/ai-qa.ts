import type Database from "better-sqlite3";
import {
  getShanghaiNowParts,
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
import { getEntryById, hydrateEntries, listEntries } from "./entries.js";
import { listMoods, listTags } from "./tags-moods.js";

export const READONLY_QA_TOOLS: AiToolDeclaration[] = [
  {
    name: "search_entries_fts",
    description: "按关键词与可选日期范围全文检索日记正文与标题（支持空格多词联合查询），返回匹配的日记 id、日期、标签、心情与摘要片段（只读）。",
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
    description: "按时间范围、类型、标签、心情与字数条件列出日记目录与结构化概要，并支持按日期或字数排序（标签与心情支持模糊匹配，只读）。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "可选起始日期 YYYY-MM-DD" },
        endDate: { type: "string", description: "可选结束日期 YYYY-MM-DD" },
        kind: { type: "string", enum: ["daily", "special"], description: "可选日记类型：daily 每日日记，special 专项复盘" },
        tag: { type: "string", description: "可选标签名称（支持精确或模糊子串匹配，如 旅行、出差）" },
        mood: { type: "string", description: "可选心情名称（支持精确或模糊子串匹配，如 开心、低落）" },
        sortBy: {
          type: "string",
          enum: ["date_desc", "date_asc", "words_desc", "words_asc"],
          description: "可选排序方式，默认 date_desc；查字数最多用 words_desc，字数最少用 words_asc"
        },
        minWords: { type: "number", description: "可选最小正文字数过滤" },
        maxWords: { type: "number", description: "可选最大正文字数过滤" },
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
    description: "精确统计符合条件（时间范围、标签、心情、类型）的日记篇数、总字数、均字数、起止日期、最长/最短篇具体记录及心情标签分布，并支持按年或按月分组（只读）。",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "可选起始日期 YYYY-MM-DD" },
        endDate: { type: "string", description: "可选结束日期 YYYY-MM-DD" },
        kind: { type: "string", enum: ["daily", "special"], description: "可选日记类型过滤" },
        tag: { type: "string", description: "可选标签名称过滤（支持精确或模糊匹配）" },
        mood: { type: "string", description: "可选心情名称过滤（支持精确或模糊匹配）" },
        groupBy: {
          type: "string",
          enum: ["none", "year", "month"],
          description: "可选按年(year)或按月(month)分组汇总趋势，默认 none"
        }
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
      outputJson: JSON.stringify({ total: res.total, totalWords: res.totalWords, items }),
      summary: `关键词「${q}」命中 ${res.total} 篇（返回 ${items.length} 篇）`
    };
  }

  if (toolName === "list_entry_digests") {
    const startDate = args.startDate ? String(args.startDate) : undefined;
    const endDate = args.endDate ? String(args.endDate) : undefined;
    const kind = args.kind ? String(args.kind) : undefined;
    const tag = args.tag ? String(args.tag) : undefined;
    const mood = args.mood ? String(args.mood) : undefined;
    const sortBy =
      args.sortBy === "date_asc" || args.sortBy === "words_desc" || args.sortBy === "words_asc"
        ? args.sortBy
        : "date_desc";
    const minWords = typeof args.minWords === "number" ? args.minWords : undefined;
    const maxWords = typeof args.maxWords === "number" ? args.maxWords : undefined;
    const limit = Math.min(30, Math.max(1, Number(args.limit ?? 15)));
    const res = listEntries(db, {
      startDate,
      endDate,
      kind,
      tag,
      mood,
      sortBy,
      minWords,
      maxWords,
      fuzzyTagMood: true,
      page: 1,
      pageSize: limit
    });
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
        shortTitle: e.digest?.shortTitle || "",
        summary: e.digest?.summary || e.contentText.slice(0, 120),
        moods: e.moods,
        tags: e.tags,
        wordCount: e.wordCount
      };
    });
    return {
      outputJson: JSON.stringify({ total: res.total, totalWords: res.totalWords, items }),
      summary: `筛查目录共 ${res.total} 篇（累计 ${res.totalWords} 字，返回 ${items.length} 篇）`
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
    const startDate = args.startDate ? String(args.startDate).trim() : "";
    const endDate = args.endDate ? String(args.endDate).trim() : "";
    const kind = args.kind ? String(args.kind).trim() : "";
    const tag = args.tag ? String(args.tag).trim() : "";
    const mood = args.mood ? String(args.mood).trim() : "";
    const groupBy = args.groupBy === "year" || args.groupBy === "month" ? args.groupBy : "none";

    const where: string[] = ["e.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (startDate) {
      where.push("e.date >= ?");
      params.push(startDate);
    }
    if (endDate) {
      where.push("e.date <= ?");
      params.push(endDate);
    }
    if (kind && kind !== "all") {
      where.push("e.kind = ?");
      params.push(kind);
    }
    if (tag && tag !== "all") {
      where.push(
        "EXISTS (SELECT 1 FROM entry_tags et2 JOIN tags t2 ON t2.id = et2.tag_id WHERE et2.entry_id = e.id AND (t2.name = ? OR t2.id = ? OR t2.name LIKE ?))"
      );
      params.push(tag, tag, `%${tag}%`);
    }
    if (mood && mood !== "all") {
      where.push(
        "EXISTS (SELECT 1 FROM entry_moods em2 JOIN moods m2 ON m2.id = em2.mood_id WHERE em2.entry_id = e.id AND (m2.label = ? OR m2.id = ? OR m2.name = ? OR m2.label LIKE ?))"
      );
      params.push(mood, mood, mood, `%${mood}%`);
    }

    const whereSql = where.join(" AND ");
    const agg = db
      .prepare(
        `SELECT COUNT(*) as total,
                COALESCE(SUM(e.word_count), 0) as totalWords,
                COALESCE(MAX(e.word_count), 0) as maxWords,
                COALESCE(MIN(e.word_count), 0) as minWords,
                MIN(e.date) as earliest,
                MAX(e.date) as latest
         FROM entries e WHERE ${whereSql}`
      )
      .get(...params) as {
      total: number;
      totalWords: number;
      maxWords: number;
      minWords: number;
      earliest: string | null;
      latest: string | null;
    };

    const longestRows = db
      .prepare(
        `SELECT e.* FROM entries e
         WHERE ${whereSql}
         ORDER BY e.word_count DESC, e.date DESC
         LIMIT 3`
      )
      .all(...params) as Parameters<typeof hydrateEntries>[1];
    const longestEntries = hydrateEntries(db, longestRows).map((e) => {
      citationMap.set(e.id, {
        entryId: e.id,
        date: e.date,
        title: e.digest?.shortTitle || e.title || `${e.date} 日记`
      });
      return {
        entryId: e.id,
        date: e.date,
        title: e.title || `${e.date} 日记`,
        wordCount: e.wordCount,
        moods: e.moods,
        tags: e.tags
      };
    });

    const shortestRow = db
      .prepare(
        `SELECT e.id, e.date, e.title, e.word_count as wordCount FROM entries e
         WHERE ${whereSql}
         ORDER BY e.word_count ASC, e.date DESC
         LIMIT 1`
      )
      .get(...params) as { id: string; date: string; title: string; wordCount: number } | undefined;

    const moodRows = db
      .prepare(
        `SELECT m.label, COUNT(DISTINCT e.id) as cnt FROM entry_moods em
         JOIN moods m ON m.id = em.mood_id
         JOIN entries e ON e.id = em.entry_id
         WHERE ${whereSql}
         GROUP BY m.id ORDER BY cnt DESC`
      )
      .all(...params) as Array<{ label: string; cnt: number }>;

    const tagRows = db
      .prepare(
        `SELECT t.name, COUNT(DISTINCT e.id) as cnt FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         JOIN entries e ON e.id = et.entry_id
         WHERE ${whereSql}
         GROUP BY t.id ORDER BY cnt DESC`
      )
      .all(...params) as Array<{ name: string; cnt: number }>;

    let timeline: Array<{ period: string; count: number; totalWords: number; avgWords: number; maxWords: number }> | undefined;
    if (groupBy === "year" || groupBy === "month") {
      const len = groupBy === "year" ? 4 : 7;
      timeline = db
        .prepare(
          `SELECT substr(e.date, 1, ${len}) as period,
                  COUNT(*) as count,
                  COALESCE(SUM(e.word_count), 0) as totalWords,
                  CAST(ROUND(AVG(e.word_count)) AS INTEGER) as avgWords,
                  COALESCE(MAX(e.word_count), 0) as maxWords
           FROM entries e
           WHERE ${whereSql}
           GROUP BY period
           ORDER BY period DESC
           LIMIT 60`
        )
        .all(...params) as Array<{ period: string; count: number; totalWords: number; avgWords: number; maxWords: number }>;
    }

    return {
      outputJson: JSON.stringify({
        totalEntries: agg.total,
        totalWords: agg.totalWords,
        avgWords: agg.total ? Math.round(agg.totalWords / agg.total) : 0,
        maxWords: agg.maxWords,
        minWords: agg.minWords,
        dateRange: { earliest: agg.earliest, latest: agg.latest },
        longestEntries,
        shortestEntry: shortestRow
          ? { entryId: shortestRow.id, date: shortestRow.date, title: shortestRow.title || `${shortestRow.date} 日记`, wordCount: shortestRow.wordCount }
          : null,
        moods: moodRows,
        tags: tagRows,
        ...(timeline ? { timeline } : {})
      }),
      summary: `统计共 ${agg.total} 篇，总计 ${agg.totalWords} 字`
    };
  }

  return {
    outputJson: JSON.stringify({ error: `禁止或未知的工具调用: ${toolName}` }),
    summary: `拦截未知工具 ${toolName}`
  };
}

function buildQaSystemPrompt(db: Database.Database): string {
  const today = getShanghaiNowParts().date;
  const overview = db
    .prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(word_count), 0) as words, MIN(date) as minDate, MAX(date) as maxDate
       FROM entries WHERE deleted_at IS NULL`
    )
    .get() as { total: number; words: number; minDate: string | null; maxDate: string | null };

  const tagsText = listTags(db)
    .map((t) => `${t.name}(${t.count ?? 0}篇)`)
    .join("、");
  const moodsText = listMoods(db)
    .map((m) => `${m.label}(${m.count ?? 0}篇)`)
    .join("、");

  return [
    "你是个人日记工具「人生簿」的回忆问答助手。请严格用中文简体回答用户的回忆提问。",
    `当前日期（上海时区）：${today}。日记库总规模：共 ${overview.total} 篇、${overview.words.toLocaleString()} 字（时间跨度 ${overview.minDate || "暂无"} 至 ${overview.maxDate || "暂无"}）。`,
    `库中现有真实标签清单：${tagsText || "暂无"}。`,
    `库中现有真实心情清单：${moodsText || "暂无"}。`,
    "工具选择策略：",
    "• 涉及篇数、总字数、均字数、最长/最短篇、按年/月变化趋势，或统计特定标签/心情的字数与数量时，优先调用 `aggregate_entry_stats`（善用 tag/mood 过滤与 groupBy）。",
    "• 涉及查找属于某标签、某心情、或按字数排序（如字数最多的几篇/超过某字数）的日记清单时，请调用 `list_entry_digests`（勿把标签名或心情名直接丢进关键词全文检索）。",
    "• 涉及正文具体事件或词语搜索时，调用 `search_entries_fts`；需要核实某一天完整细节时，再调用 `read_entry_full`。",
    `严禁编造任何日期或日记细节；每次回答最多允许进行 ${QA_MAX_TOOL_ROUNDS} 轮工具调用，检索充分后请立即停止调工具并给出清晰准确的中文回答。`
  ].join("\n");
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

  const systemPrompt = buildQaSystemPrompt(db);

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

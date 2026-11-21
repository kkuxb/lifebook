import type Database from "better-sqlite3";
import type { AiConfigPublic, AiProviderType } from "@lifebook/core";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto.js";

export interface AiConfigFull {
  enabled: boolean;
  provider: AiProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface AiToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AiConversationMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface AiCompletionResult {
  contentText: string;
  toolCalls: AiToolCall[];
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
}

const DEFAULT_AI_CONFIG: AiConfigFull = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  modelId: "gpt-4.1-mini"
};

export function getAiConfigFull(db: Database.Database, masterKey: Buffer): AiConfigFull {
  const row = db.prepare("SELECT value, encrypted FROM settings WHERE key = 'ai_config'").get() as
    | { value: string; encrypted: number }
    | undefined;
  if (!row) return { ...DEFAULT_AI_CONFIG };
  try {
    const raw = row.encrypted ? decryptSecret(row.value, masterKey) : row.value;
    const parsed = JSON.parse(raw) as Partial<AiConfigFull>;
    return {
      enabled: Boolean(parsed.enabled),
      provider: (parsed.provider as AiProviderType) || "openai",
      baseUrl: parsed.baseUrl || DEFAULT_AI_CONFIG.baseUrl,
      apiKey: parsed.apiKey || "",
      modelId: parsed.modelId || DEFAULT_AI_CONFIG.modelId
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function getAiConfigPublic(db: Database.Database, masterKey: Buffer): AiConfigPublic {
  const cfg = getAiConfigFull(db, masterKey);
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    hasApiKey: cfg.apiKey.length > 0,
    apiKeyMasked: maskSecret(cfg.apiKey),
    modelId: cfg.modelId
  };
}

export function saveAiConfig(
  db: Database.Database,
  masterKey: Buffer,
  input: {
    enabled?: boolean;
    provider?: AiProviderType;
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
  }
): AiConfigPublic {
  const current = getAiConfigFull(db, masterKey);
  const nextApiKey =
    input.apiKey !== undefined && input.apiKey.trim() !== "" && !input.apiKey.includes("••••")
      ? input.apiKey.trim()
      : current.apiKey;

  const merged: AiConfigFull = {
    enabled: input.enabled ?? current.enabled,
    provider: input.provider ?? current.provider,
    baseUrl: (input.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: nextApiKey,
    modelId: (input.modelId ?? current.modelId).trim()
  };

  const encrypted = encryptSecret(JSON.stringify(merged), masterKey);
  db.prepare(
    `INSERT INTO settings (key, value, encrypted, updated_at)
     VALUES ('ai_config', ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 1, updated_at = excluded.updated_at`
  ).run(encrypted, new Date().toISOString());

  return getAiConfigPublic(db, masterKey);
}

export async function callAiCompletion(
  cfg: AiConfigFull,
  params: {
    system?: string;
    messages: AiConversationMessage[];
    tools?: AiToolDeclaration[];
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }
): Promise<AiCompletionResult> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.modelId) {
    throw new Error("模型配置不完整，请填写接口地址、接口密钥与模型标识");
  }

  const timeoutMs = params.timeoutMs ?? 45_000;

  if (cfg.provider === "openai") {
    return callOpenAiCompatible(cfg, params, timeoutMs);
  }
  if (cfg.provider === "gemini") {
    return callGeminiNative(cfg, params, timeoutMs);
  }
  if (cfg.provider === "anthropic") {
    return callAnthropicNative(cfg, params, timeoutMs);
  }
  throw new Error(`不支持的模型协议类型：${String(cfg.provider)}`);
}

function buildFriendlyFetchError(provider: string, status: number, bodyText: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`「${provider}」接口鉴权失败（HTTP ${status}），请检查接口密钥与访问权限`);
  }
  if (status === 404) {
    return new Error(`「${provider}」接口路径或模型标识不存在（HTTP 404），请核对接口地址与模型名`);
  }
  if (status === 429) {
    return new Error(`「${provider}」请求频次或配额受限（HTTP 429），请稍后再试`);
  }
  return new Error(`「${provider}」接口返回异常（HTTP ${status}）：${bodyText.slice(0, 160)}`);
}

async function safeFetch(url: string, init: RequestInit, timeoutMs: number, providerLabel: string): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Timeout") || msg.includes("AbortError") || msg.includes("aborted")) {
      throw new Error(`「${providerLabel}」接口请求超时（>${Math.round(timeoutMs / 1000)}秒），请检查网络连通性`);
    }
    throw new Error(`「${providerLabel}」网络请求失败：${msg}`);
  }
}

async function callOpenAiCompatible(
  cfg: AiConfigFull,
  params: {
    system?: string;
    messages: AiConversationMessage[];
    tools?: AiToolDeclaration[];
    maxTokens?: number;
    temperature?: number;
  },
  timeoutMs: number
): Promise<AiCompletionResult> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  const oaiMessages: Array<Record<string, unknown>> = [];
  if (params.system) {
    oaiMessages.push({ role: "system", content: params.system });
  }
  for (const m of params.messages) {
    if (m.role === "assistant" && "toolCalls" in m && m.toolCalls.length > 0) {
      oaiMessages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args)
          }
        }))
      });
    } else if (m.role === "tool") {
      oaiMessages.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content
      });
    } else {
      oaiMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: cfg.modelId,
    messages: oaiMessages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxTokens ?? 1500
  };
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
    body.tool_choice = "auto";
  }

  const resp = await safeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body)
    },
    timeoutMs,
    "OpenAI 兼容"
  );

  if (!resp.ok) {
    throw buildFriendlyFetchError("OpenAI 兼容", resp.status, await resp.text());
  }

  const json = (await resp.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const msg = json.choices?.[0]?.message;
  const toolCalls: AiToolCall[] = (msg?.tool_calls ?? []).map((tc, idx) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    return {
      id: tc.id || `tc_${idx}`,
      name: tc.function?.name || "",
      args
    };
  });

  return {
    contentText: msg?.content ?? "",
    toolCalls,
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens
        }
      : null
  };
}

async function callGeminiNative(
  cfg: AiConfigFull,
  params: {
    system?: string;
    messages: AiConversationMessage[];
    tools?: AiToolDeclaration[];
    maxTokens?: number;
    temperature?: number;
  },
  timeoutMs: number
): Promise<AiCompletionResult> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const versionPrefix = base.endsWith("/v1beta") || base.endsWith("/v1") ? base : `${base}/v1beta`;
  const endpoint = `${versionPrefix}/models/${encodeURIComponent(cfg.modelId)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  const contents: Array<Record<string, unknown>> = [];
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && "toolCalls" in m && m.toolCalls.length > 0) {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } });
      }
      contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      let parsedResp: unknown = m.content;
      try {
        parsedResp = JSON.parse(m.content);
      } catch {
        parsedResp = { result: m.content };
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name,
              response: typeof parsedResp === "object" && parsedResp !== null ? parsedResp : { result: parsedResp }
            }
          }
        ]
      });
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      });
    }
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: params.temperature ?? 0.3,
      maxOutputTokens: params.maxTokens ?? 1500
    }
  };
  if (params.system) {
    body.systemInstruction = { parts: [{ text: params.system }] };
  }
  if (params.tools && params.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }
    ];
  }

  const resp = await safeFetch(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    timeoutMs,
    "Gemini 原生"
  );

  if (!resp.ok) {
    throw buildFriendlyFetchError("Gemini 原生", resp.status, await resp.text());
  }

  const json = (await resp.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const textParts: string[] = [];
  const toolCalls: AiToolCall[] = [];
  parts.forEach((p, idx) => {
    if (p.text) textParts.push(p.text);
    if (p.functionCall?.name) {
      toolCalls.push({
        id: `gem_${idx}`,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {}
      });
    }
  });

  return {
    contentText: textParts.join("\n"),
    toolCalls,
    usage: json.usageMetadata
      ? {
          promptTokens: json.usageMetadata.promptTokenCount,
          completionTokens: json.usageMetadata.candidatesTokenCount,
          totalTokens: json.usageMetadata.totalTokenCount
        }
      : null
  };
}

async function callAnthropicNative(
  cfg: AiConfigFull,
  params: {
    system?: string;
    messages: AiConversationMessage[];
    tools?: AiToolDeclaration[];
    maxTokens?: number;
    temperature?: number;
  },
  timeoutMs: number
): Promise<AiCompletionResult> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/messages")
    ? base
    : base.endsWith("/v1")
      ? `${base}/messages`
      : `${base}/v1/messages`;

  const messages: Array<Record<string, unknown>> = [];
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && "toolCalls" in m && m.toolCalls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args
        });
      }
      messages.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content
          }
        ]
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: cfg.modelId,
    max_tokens: params.maxTokens ?? 1500,
    temperature: params.temperature ?? 0.3,
    messages
  };
  if (params.system) {
    body.system = params.system;
  }
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
  }

  const resp = await safeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    },
    timeoutMs,
    "Anthropic 原生"
  );

  if (!resp.ok) {
    throw buildFriendlyFetchError("Anthropic 原生", resp.status, await resp.text());
  }

  const json = (await resp.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const blocks = json.content ?? [];
  const textParts: string[] = [];
  const toolCalls: AiToolCall[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) textParts.push(b.text);
    if (b.type === "tool_use" && b.name) {
      toolCalls.push({
        id: b.id || `ant_${toolCalls.length}`,
        name: b.name,
        args: b.input ?? {}
      });
    }
  }

  return {
    contentText: textParts.join("\n"),
    toolCalls,
    usage: json.usage
      ? {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
          totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0)
        }
      : null
  };
}

export async function testAiConnection(
  db: Database.Database,
  masterKey: Buffer,
  override?: Partial<AiConfigFull>
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const saved = getAiConfigFull(db, masterKey);
  const cfg: AiConfigFull = {
    enabled: true,
    provider: override?.provider ?? saved.provider,
    baseUrl: (override?.baseUrl ?? saved.baseUrl).trim(),
    apiKey:
      override?.apiKey && override.apiKey.trim() !== "" && !override.apiKey.includes("••••")
        ? override.apiKey.trim()
        : saved.apiKey,
    modelId: (override?.modelId ?? saved.modelId).trim()
  };

  const t0 = performance.now();
  const res = await callAiCompletion(cfg, {
    system: "请用简体中文简短回复「连通正常」。",
    messages: [{ role: "user", content: "测试连接" }],
    maxTokens: 32,
    timeoutMs: 12_000
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - t0));
  return {
    ok: true,
    latencyMs,
    message: `握手成功！已通过「${cfg.provider}」连通模型 ${cfg.modelId}（耗时 ${latencyMs} ms，回复：${res.contentText.slice(0, 30) || "OK"}）`
  };
}

function extractBalancedJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  const end = raw.lastIndexOf("}");
  return end > start ? raw.slice(start, end + 1) : null;
}

function sanitizeJsonText(raw: string): string {
  // 1. 将字符串字面量内部的裸换行替换为空格，保留合法转义
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n" || ch === "\r") {
        out += " ";
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  // 2. 修复相邻对象之间漏写逗号以及对象/数组末尾多余逗号
  return out
    .replace(/\}\s*\{/g, "},{")
    .replace(/,\s*([}\]])/g, "$1");
}

export function extractJsonFromAiText<T>(text: string): T {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const cleaned = withoutThink
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidate = extractBalancedJsonObject(cleaned) ?? cleaned;
  for (const attempt of [cleaned, candidate, sanitizeJsonText(candidate)]) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // 依次回退到平衡提取与轻量安全修复
    }
  }
  throw new Error("模型返回内容不是合法 JSON 格式（已尝试容错解析）");
}

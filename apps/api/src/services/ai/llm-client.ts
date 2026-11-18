// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSafePublicUrl, isAllowedIntranetHost, isAllowedIntranetIp } from "../../util/ssrf.js";
import { isStrictAirgapEnv } from "../../util/tier-presets.js";

export function isLocalOrIntranetLLMUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = (
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]") ? parsed.hostname.slice(1, -1) : parsed.hostname
  ).toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    host === "ollama" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".corp") ||
    host.endsWith(".intranet") ||
    host.endsWith(".svc.cluster.local") ||
    isAllowedIntranetHost(host) ||
    isAllowedIntranetIp(host)
  );
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMToolCall {
  id?: string | undefined;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string | undefined;
  name?: string | undefined;
  toolCalls?: LLMToolCall[] | undefined;
}

export interface LLMCompletionOptions {
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  systemPrompt?: string | undefined;
  reasoningEffort?: "none" | "low" | "medium" | "high" | undefined;
  tools?: LLMToolDefinition[] | undefined;
  toolChoice?: "auto" | "none" | undefined;
}

export interface LLMResponse {
  content: string;
  model: string;
  toolCalls?: LLMToolCall[] | undefined;
}

export type LLMStreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool_calls"; toolCalls: LLMToolCall[] }
  | { type: "done"; model: string };

export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse>;
  completeStream?(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMStreamChunk>;
}

export function stripLLMThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
}

/**
 * Mock / Deterministic Provider for CI and testing when no live API keys are provided.
 */
export class DeterministicEngineeringProvider implements LLMProvider {
  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1]?.content || "";

    // Check if user is asking for simulation or model synthesis
    if (/pendulum|oscillator|circuit|modelica|synthesize|simulate/i.test(lastMessage)) {
      return {
        model: options?.model || "modelscript-engineering-v1",
        content: `I've analyzed your physical modeling inquiry.\n\nHere is the verified Modelica model for this system:\n\n\`\`\`modelica\nmodel DynamicSystem\n  parameter Real J = 1.0 "Inertia";\n  parameter Real d = 0.1 "Damping";\n  Real w(start = 1.0) "Angular velocity";\n  Real phi(start = 0.0) "Angle";\nequation\n  der(phi) = w;\n  J * der(w) + d * w = 0;\nend DynamicSystem;\n\`\`\`\n\nThis continuous DAE has been verified and produces asymptotically stable trajectories under standard damping.`,
      };
    }

    return {
      model: options?.model || "modelscript-engineering-v1",
      content: `I have received your request: "${lastMessage.trim()}". As an engineering bot on Ansatz (powered by ModelScript), I can verify equations, run DAE simulations, and analyze multi-domain digital twins.`,
    };
  }
}

function parseJsonArgs(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toOpenAIMessages(messages: LLMMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc, idx) => ({
          id: tc.id || `call_${idx}`,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Pluggable OpenAI-compatible HTTP client (works with Gemini OpenAI endpoint, Ollama, vLLM, OpenRouter, OpenAI).
 */
export class OpenAICompatibleProvider implements LLMProvider {
  #apiKey: string;
  #baseUrl: string;
  #allowInternalHost: boolean;

  constructor(apiKey: string, baseUrl: string = "https://api.openai.com/v1", allowInternalHost: boolean = false) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#allowInternalHost = allowInternalHost;
  }

  #prepareRequest(
    messages: LLMMessage[],
    options: LLMCompletionOptions | undefined,
    stream: boolean,
  ): { targetUrl: string; headers: Record<string, string>; payload: Record<string, unknown>; model: string } {
    const model = options?.model || "gpt-4o-mini";
    const payload: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 1024,
      ...(stream ? { stream: true } : {}),
    };
    if (options?.reasoningEffort) {
      payload["reasoning_effort"] = options.reasoningEffort;
    }
    if (options?.tools && options.tools.length > 0) {
      payload["tools"] = options.tools;
      payload["tool_choice"] = options.toolChoice ?? "auto";
    }

    const targetUrl = `${this.#baseUrl}/chat/completions`;
    if (isStrictAirgapEnv()) {
      if (!isLocalOrIntranetLLMUrl(targetUrl)) {
        throw new Error(
          `Air-Gap Egress Blocked: Cloud LLM endpoint '${this.#baseUrl}' is forbidden in corporate air-gapped mode. Configure a local/intranet Ollama or vLLM endpoint via AI_BASE_URL or OLLAMA_BASE_URL.`,
        );
      }
    } else if (process.env["NODE_ENV"] === "production" && !this.#allowInternalHost) {
      assertSafePublicUrl(targetUrl);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.#apiKey}`,
    };
    if (process.env["NODE_ENV"] === "test") {
      headers["Connection"] = "close";
    }

    return { targetUrl, headers, payload, model };
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const { targetUrl, headers, payload, model } = this.#prepareRequest(messages, options, false);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 512);
      throw new Error(`LLM provider error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null | undefined;
          tool_calls?: {
            id?: string | undefined;
            function?: { name?: string | undefined; arguments?: string | Record<string, unknown> | undefined };
          }[];
        };
      }[];
      model?: string | undefined;
    };
    const choice = data.choices?.[0]?.message;
    const toolCalls: LLMToolCall[] | undefined = choice?.tool_calls?.length
      ? choice.tool_calls
          .filter((tc) => Boolean(tc.function?.name))
          .map((tc) => ({
            id: tc.id,
            name: tc.function!.name!,
            arguments: parseJsonArgs(tc.function!.arguments),
          }))
      : undefined;

    return {
      content: stripLLMThinkBlocks(choice?.content || ""),
      model: data.model || model,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  async *completeStream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMStreamChunk> {
    const { targetUrl, headers, payload, model } = this.#prepareRequest(messages, options, true);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok || !res.body) {
      const errText = (await res.text().catch(() => "")).slice(0, 512);
      throw new Error(`LLM provider error (${res.status}): ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resolvedModel = model;
    const pendingTools = new Map<number, { id?: string | undefined; name: string; argsText: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === "[DONE]") continue;

          let parsed: {
            model?: string;
            choices?: {
              delta?: {
                content?: string | null;
                tool_calls?: {
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
            }[];
          };
          try {
            parsed = JSON.parse(payloadStr);
          } catch {
            continue;
          }
          if (parsed.model) resolvedModel = parsed.model;
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield { type: "text", delta: delta.content };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = pendingTools.get(idx) ?? { id: tc.id, name: "", argsText: "" };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.argsText += tc.function.arguments;
              pendingTools.set(idx, existing);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (pendingTools.size > 0) {
      const toolCalls: LLMToolCall[] = Array.from(pendingTools.entries())
        .sort(([a], [b]) => a - b)
        .filter(([, tc]) => Boolean(tc.name))
        .map(([, tc]) => ({
          id: tc.id,
          name: tc.name,
          arguments: parseJsonArgs(tc.argsText),
        }));
      if (toolCalls.length > 0) {
        yield { type: "tool_calls", toolCalls };
      }
    }

    yield { type: "done", model: resolvedModel };
  }
}

/**
 * Standard Anthropic Messages API (`/v1/messages`) client for 3rd-party Claude BYOK.
 */
export class AnthropicProvider implements LLMProvider {
  #apiKey: string;
  #baseUrl: string;

  constructor(apiKey: string, baseUrl: string = "https://api.anthropic.com/v1") {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  #prepareRequest(
    messages: LLMMessage[],
    options: LLMCompletionOptions | undefined,
    stream: boolean,
  ): { targetUrl: string; headers: Record<string, string>; payload: Record<string, unknown>; model: string } {
    const model = options?.model || "claude-sonnet-4-5";
    const systemParts: string[] = [];
    const wireMessages: Record<string, unknown>[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === "tool") {
        wireMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId || "tool_0",
              content: m.content,
            },
          ],
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Record<string, unknown>[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const [idx, tc] of m.toolCalls.entries()) {
          blocks.push({
            type: "tool_use",
            id: tc.id || `toolu_${idx}`,
            name: tc.name,
            input: tc.arguments ?? {},
          });
        }
        wireMessages.push({ role: "assistant", content: blocks });
        continue;
      }
      wireMessages.push({ role: m.role, content: m.content });
    }

    const targetUrl = `${this.#baseUrl}/messages`;
    if (isStrictAirgapEnv() && !isLocalOrIntranetLLMUrl(targetUrl)) {
      throw new Error(
        `Air-Gap Egress Blocked: Cloud LLM endpoint '${this.#baseUrl}' is forbidden in corporate air-gapped mode.`,
      );
    } else if (process.env["NODE_ENV"] === "production") {
      assertSafePublicUrl(targetUrl);
    }

    const payload: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 1024,
      messages: wireMessages,
      ...(stream ? { stream: true } : {}),
      ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.tools && options.tools.length > 0
        ? {
            tools: options.tools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters,
            })),
          }
        : {}),
    };

    return {
      targetUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01",
      },
      payload,
      model,
    };
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const { targetUrl, headers, payload, model } = this.#prepareRequest(messages, options, false);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 512);
      throw new Error(`Anthropic provider error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      model?: string;
      content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    };
    const text = (data.content || [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("");
    const toolCalls: LLMToolCall[] = (data.content || [])
      .filter((b) => b.type === "tool_use" && b.name)
      .map((b) => ({
        id: b.id,
        name: b.name!,
        arguments: b.input ?? {},
      }));

    return {
      content: text.trim(),
      model: data.model || model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  async *completeStream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMStreamChunk> {
    const { targetUrl, headers, payload, model } = this.#prepareRequest(messages, options, true);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok || !res.body) {
      const errText = (await res.text()).slice(0, 512);
      throw new Error(`Anthropic provider error (${res.status}): ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resolvedModel = model;
    const toolBlocks = new Map<number, { id?: string | undefined; name: string; jsonText: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) continue;

          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(payloadStr) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (evt["type"] === "message_start") {
            const msg = evt["message"] as { model?: string } | undefined;
            if (msg?.model) resolvedModel = msg.model;
          } else if (evt["type"] === "content_block_start") {
            const idx = Number(evt["index"] ?? 0);
            const block = evt["content_block"] as { type?: string; id?: string; name?: string } | undefined;
            if (block?.type === "tool_use" && block.name) {
              toolBlocks.set(idx, { id: block.id, name: block.name, jsonText: "" });
            }
          } else if (evt["type"] === "content_block_delta") {
            const idx = Number(evt["index"] ?? 0);
            const delta = evt["delta"] as { type?: string; text?: string; partial_json?: string } | undefined;
            if (delta?.type === "text_delta" && delta.text) {
              yield { type: "text", delta: delta.text };
            } else if (delta?.type === "input_json_delta" && delta.partial_json) {
              const block = toolBlocks.get(idx);
              if (block) block.jsonText += delta.partial_json;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (toolBlocks.size > 0) {
      const toolCalls: LLMToolCall[] = Array.from(toolBlocks.entries())
        .sort(([a], [b]) => a - b)
        .map(([, b]) => ({
          id: b.id,
          name: b.name,
          arguments: parseJsonArgs(b.jsonText),
        }));
      if (toolCalls.length > 0) {
        yield { type: "tool_calls", toolCalls };
      }
    }

    yield { type: "done", model: resolvedModel };
  }
}

export function getDefaultCloudModelId(): string {
  return process.env["AI_MODEL"] || (process.env["OPENAI_API_KEY"] ? "gpt-4o-mini" : "gemini-2.5-flash");
}

let cachedOllamaDiscovery: {
  provider: OpenAICompatibleProvider;
  baseUrl: string;
  warmModel?: string | undefined;
  installedModels: string[];
  checkedAt: number;
} | null = null;
let lastFailedOllamaCheckAt = 0;

const FAST_MODEL_SIZE_RE = /(?:^|[:\-_])(0\.6b|1\.5b|1\.7b|2b|3b|4b|7b|8b|mini|flash)(?:$|[:\-_])/i;
const QUALITY_MODEL_SIZE_RE = /(?:^|[:\-_])(14b|27b|30b|32b|70b)(?:$|[:\-_])/i;

function pickOllamaModel(
  installedModels: string[],
  warmModel: string | undefined,
  preferTier: "fast" | "quality" = "fast",
): string | undefined {
  const envModel = process.env["OLLAMA_MODEL"];
  if (envModel && (installedModels.includes(envModel) || warmModel === envModel)) {
    return envModel;
  }
  if (preferTier === "quality") {
    return (
      installedModels.find((n) => QUALITY_MODEL_SIZE_RE.test(n)) ||
      warmModel ||
      installedModels.find((n) => FAST_MODEL_SIZE_RE.test(n)) ||
      installedModels[0]
    );
  }
  // For interactive "fast" mode, prefer a fast model already warm in GPU/RAM, or an installed <=8B model
  if (warmModel && FAST_MODEL_SIZE_RE.test(warmModel)) {
    return warmModel;
  }
  return installedModels.find((n) => FAST_MODEL_SIZE_RE.test(n)) || warmModel || installedModels[0];
}

/**
 * Probes local/configured Ollama servers (`OLLAMA_BASE_URL`, `127.0.0.1:11434`,
 * `host.docker.internal:11434`, `ollama:11434`) and returns an OpenAICompatibleProvider
 * bound to the best available model.
 */
export async function discoverOllamaProvider(options?: {
  preferTier?: "fast" | "quality";
}): Promise<{ provider: OpenAICompatibleProvider; model: string } | null> {
  const preferTier = options?.preferTier || "fast";
  const now = Date.now();
  if (cachedOllamaDiscovery && now - cachedOllamaDiscovery.checkedAt < 60_000) {
    const model = pickOllamaModel(cachedOllamaDiscovery.installedModels, cachedOllamaDiscovery.warmModel, preferTier);
    if (model) {
      return { provider: cachedOllamaDiscovery.provider, model };
    }
  }
  if (now - lastFailedOllamaCheckAt < 15_000) {
    return null;
  }

  const configuredBase = (process.env["OLLAMA_BASE_URL"] || process.env["OLLAMA_HOST"] || "").replace(/\/+$/, "");
  const candidateBases = configuredBase
    ? [configuredBase]
    : ["http://127.0.0.1:11434", "http://host.docker.internal:11434", "http://ollama:11434"];

  for (const ollamaBase of candidateBases) {
    try {
      let warmModel: string | undefined;
      let installedModels: string[] = [];

      // 1. Check /api/ps to see if a model is already warm in memory
      const psRes = await fetch(`${ollamaBase}/api/ps`, { signal: AbortSignal.timeout(800) });
      if (psRes.ok) {
        const psData = (await psRes.json()) as { models?: { name?: string | undefined }[] | undefined };
        warmModel = psData.models?.[0]?.name;
      }

      // 2. Check /api/tags for installed models
      const tagsRes = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(800) });
      if (tagsRes.ok) {
        const tagsData = (await tagsRes.json()) as { models?: { name?: string | undefined }[] | undefined };
        installedModels = (tagsData.models || []).map((m) => m.name).filter((n): n is string => Boolean(n));
      }

      const chosen = pickOllamaModel(installedModels, warmModel, preferTier);
      if (chosen) {
        const provider = new OpenAICompatibleProvider("ollama", `${ollamaBase}/v1`, true);
        cachedOllamaDiscovery = {
          provider,
          baseUrl: ollamaBase,
          warmModel,
          installedModels,
          checkedAt: now,
        };
        return { provider, model: chosen };
      }
    } catch {
      // Try next candidate base URL
    }
  }

  lastFailedOllamaCheckAt = now;
  return null;
}

export function createDefaultLLMProvider(): LLMProvider {
  const apiKey = process.env["OPENAI_API_KEY"] || process.env["GEMINI_API_KEY"];
  const baseUrl = process.env["AI_BASE_URL"];

  if (isStrictAirgapEnv()) {
    if (baseUrl && isLocalOrIntranetLLMUrl(baseUrl)) {
      return new OpenAICompatibleProvider(apiKey || "airgap-local", baseUrl, true);
    }
    return new DeterministicEngineeringProvider();
  }

  if (apiKey) {
    return new OpenAICompatibleProvider(
      apiKey,
      baseUrl ||
        (process.env["GEMINI_API_KEY"] ? "https://generativelanguage.googleapis.com/v1beta/openai" : undefined),
      true,
    );
  }

  return new DeterministicEngineeringProvider();
}

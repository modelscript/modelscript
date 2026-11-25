// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ensureSharedLocalAiEngine,
  getLastLocalAiError,
  isSharedLocalWebLLMLoaded,
  isWebGpuAvailable,
} from "../../internal/local-ai-runtime";
import {
  ANSATZ_CORE_TOOLS,
  ANSATZ_EXTENDED_TOOLS,
  executeAnsatzToolCall,
  type AnsatzDiagnosticSummary,
  type AnsatzToolCall,
  type AnsatzToolDefinition,
  type AnsatzToolHost,
  type AnsatzToolResult,
} from "./ansatz-tool-bridge";

export type AnsatzAiProviderMode = "auto" | "local" | "local-endpoint" | "ansatz" | "custom";
export type AnsatzCustomProtocol = "openai" | "anthropic";

export interface AnsatzAiSettings {
  mode: AnsatzAiProviderMode;
  localEndpointUrl: string;
  localEndpointModel: string;
  customProtocol: AnsatzCustomProtocol;
  customBaseUrl: string;
  customApiKey: string;
  customModel: string;
  directBrowserCustom: boolean;
}

const SETTINGS_STORAGE_KEY = "modelscript:ansatz_ai_settings";

export const DEFAULT_ANSATZ_AI_SETTINGS: AnsatzAiSettings = {
  mode: "auto",
  localEndpointUrl: "http://127.0.0.1:11434/v1",
  localEndpointModel: "qwen2.5-coder:7b",
  customProtocol: "openai",
  customBaseUrl: "https://api.openai.com/v1",
  customApiKey: "",
  customModel: "gpt-4o-mini",
  directBrowserCustom: false,
};

export function loadAnsatzAiSettings(): AnsatzAiSettings {
  if (typeof window === "undefined") return DEFAULT_ANSATZ_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_ANSATZ_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AnsatzAiSettings>;
    return { ...DEFAULT_ANSATZ_AI_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_ANSATZ_AI_SETTINGS;
  }
}

export function saveAnsatzAiSettings(settings: AnsatzAiSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export interface AnsatzChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string | undefined;
  name?: string | undefined;
  toolCalls?: AnsatzToolCall[] | undefined;
}

export interface AnsatzAiContextSnapshot {
  fileName: string;
  dialect: string;
  code: string;
  selectedComponent?: string | undefined;
  diagnostics: AnsatzDiagnosticSummary[];
}

export interface AnsatzAiTurnCallbacks {
  onTextDelta?: ((delta: string) => void) | undefined;
  onToolCall?: ((call: AnsatzToolCall) => void) | undefined;
  onToolResult?: ((result: AnsatzToolResult) => void) | undefined;
  onLocalProgress?: ((message: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface AnsatzAiTurnResult {
  content: string;
  model: string;
  providerUsed: AnsatzAiProviderMode;
  toolResults: AnsatzToolResult[];
}

export interface AnsatzProvidersInfo {
  ansatzAvailable: boolean;
  airgapMode: boolean;
  defaultModel: string;
  supportedProtocols: ("openai" | "anthropic" | "mcp-sse")[];
  ollamaQualityModel?: string | undefined;
}

export async function fetchAnsatzProvidersInfo(signal?: AbortSignal): Promise<AnsatzProvidersInfo | null> {
  try {
    const res = await fetch("/api/v1/ai/providers", { signal });
    if (!res.ok) return null;
    return (await res.json()) as AnsatzProvidersInfo;
  } catch {
    return null;
  }
}

export function isAnsatzLocalWebGpuAvailable(): boolean {
  return isWebGpuAvailable();
}

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
}

function buildLocalToolPrompt(context: AnsatzAiContextSnapshot, tools: AnsatzToolDefinition[]): string {
  const toolDesc = tools
    .map((t) => `- ${t.function.name}: ${t.function.description} params=${JSON.stringify(t.function.parameters)}`)
    .join("\n");
  const diags = context.diagnostics
    .slice(0, 8)
    .map((d) => `[${d.severity}] L${d.line ?? "?"}: ${d.message}`)
    .join("\n");

  return [
    "You are Ansatz AI, an expert physical modeling assistant.",
    `Active file: ${context.fileName} (${context.dialect})`,
    diags ? `Diagnostics:\n${diags}` : "Diagnostics: none",
    `Source:\n\`\`\`${context.dialect}\n${context.code.slice(0, 4000)}\n\`\`\``,
    'Available tools (to call a tool, respond ONLY with JSON: {"tool":"<name>","arguments":{...}}):',
    toolDesc,
  ].join("\n\n");
}

function tryParseLocalToolCall(text: string): AnsatzToolCall | null {
  const trimmed = stripThinkBlocks(text);
  const match = trimmed.match(/\{[\s\S]*"tool"\s*:\s*"([^"]+)"[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { tool?: string; arguments?: Record<string, unknown> };
    if (typeof parsed.tool === "string" && parsed.tool.length > 0) {
      return {
        id: `local_${Date.now()}`,
        name: parsed.tool,
        arguments: parsed.arguments ?? {},
      };
    }
  } catch {
    return null;
  }
  return null;
}

interface StreamTurnResponse {
  content: string;
  toolCalls: AnsatzToolCall[];
  model: string;
}

async function consumeSseResponse(
  res: Response,
  defaultModel: string,
  onTextDelta?: (delta: string) => void,
): Promise<StreamTurnResponse> {
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model = defaultModel;
  const toolCalls: AnsatzToolCall[] = [];
  const openAiPendingTools = new Map<number, { id?: string | undefined; name: string; argsText: string }>();

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
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        // 1. Ansatz SSE format
        if (parsed["type"] === "text" && typeof parsed["delta"] === "string") {
          content += parsed["delta"];
          onTextDelta?.(parsed["delta"]);
          continue;
        }
        if (parsed["type"] === "tool_calls" && Array.isArray(parsed["toolCalls"])) {
          for (const tc of parsed["toolCalls"] as AnsatzToolCall[]) {
            toolCalls.push(tc);
          }
          continue;
        }
        if (parsed["type"] === "done" && typeof parsed["model"] === "string") {
          model = parsed["model"];
          continue;
        }
        if (parsed["type"] === "error" && typeof parsed["message"] === "string") {
          throw new Error(parsed["message"]);
        }

        // 2. Direct OpenAI SSE format (local-endpoint / directBrowserCustom)
        if (typeof parsed["model"] === "string") {
          model = parsed["model"];
        }
        const choices = parsed["choices"] as
          | {
              delta?: {
                content?: string | null;
                tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
              };
            }[]
          | undefined;
        const delta = choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          onTextDelta?.(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const entry = openAiPendingTools.get(idx) ?? { id: tc.id, name: "", argsText: "" };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.argsText += tc.function.arguments;
            openAiPendingTools.set(idx, entry);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (openAiPendingTools.size > 0) {
    for (const [, tc] of Array.from(openAiPendingTools.entries()).sort(([a], [b]) => a - b)) {
      if (!tc.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsText || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }
  }

  return { content, toolCalls, model };
}

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const token = window.localStorage.getItem("token") || window.localStorage.getItem("auth_token");
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // ignore
  }
  return {};
}

export async function runAnsatzAiTurn(
  history: AnsatzChatMessage[],
  host: AnsatzToolHost,
  settings: AnsatzAiSettings,
  callbacks: AnsatzAiTurnCallbacks = {},
): Promise<AnsatzAiTurnResult> {
  const MAX_TOOL_ROUNDS = 6;
  const toolResults: AnsatzToolResult[] = [];
  const context: AnsatzAiContextSnapshot = {
    fileName: host.getFileName(),
    dialect: host.getDialect(),
    code: host.getCode(),
    selectedComponent: host.getSelectedComponent(),
    diagnostics: host.getDiagnostics(),
  };

  let effectiveMode: AnsatzAiProviderMode = settings.mode;
  if (effectiveMode === "auto") {
    effectiveMode = isSharedLocalWebLLMLoaded() ? "local" : "ansatz";
  }

  // 1. Local browser mode (WebLLM / Prompt API)
  if (effectiveMode === "local") {
    const localEngine = await ensureSharedLocalAiEngine(
      callbacks.onLocalProgress,
      "You are Ansatz AI, an engineering modeling assistant.",
    );
    if (!localEngine) {
      if (settings.mode === "local") {
        const detail = getLastLocalAiError();
        throw new Error(
          detail
            ? `Local browser AI unavailable: ${detail}`
            : "Local browser AI (WebGPU or Chrome Prompt API) is unavailable in this browser.",
        );
      }
      effectiveMode = "ansatz";
    } else {
      const systemPrompt = buildLocalToolPrompt(context, ANSATZ_CORE_TOOLS);
      const loopMessages = [...history];
      let finalContent = "";

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let replyText = "";
        if (localEngine.kind === "prompt-api") {
          const promptInput = [systemPrompt, ...loopMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`)].join(
            "\n\n",
          );
          replyText = await localEngine.session.prompt(promptInput);
        } else {
          const res = await localEngine.engine.chat.completions.create({
            messages: [
              { role: "system", content: `${systemPrompt}\n/no_think` },
              ...loopMessages.map((m) => ({
                role: (m.role === "tool" ? "user" : m.role) as "system" | "user" | "assistant",
                content: m.content,
              })),
            ],
            temperature: 0.2,
            max_tokens: 1024,
            stream: false,
            extra_body: { enable_thinking: false },
          });
          replyText = res.choices?.[0]?.message?.content || "";
        }

        const cleaned = stripThinkBlocks(replyText);
        const maybeTool = tryParseLocalToolCall(cleaned);
        if (!maybeTool) {
          finalContent = cleaned;
          callbacks.onTextDelta?.(cleaned);
          break;
        }

        callbacks.onToolCall?.(maybeTool);
        const toolRes = await executeAnsatzToolCall(host, maybeTool);
        toolResults.push(toolRes);
        callbacks.onToolResult?.(toolRes);

        loopMessages.push({ role: "assistant", content: cleaned, toolCalls: [maybeTool] });
        loopMessages.push({
          role: "tool",
          toolCallId: maybeTool.id,
          name: maybeTool.name,
          content: toolRes.output,
        });
      }

      return {
        content: finalContent,
        model: localEngine.kind === "webllm" ? localEngine.model : "browser-prompt-api",
        providerUsed: "local",
        toolResults,
      };
    }
  }

  // 2. Remote / Local-Endpoint / Ansatz / Custom OpenAI-or-Anthropic loop
  const workingMessages: AnsatzChatMessage[] = [...history];
  let finalContent = "";
  let resolvedModel =
    effectiveMode === "local-endpoint"
      ? settings.localEndpointModel
      : effectiveMode === "custom"
        ? settings.customModel
        : "ansatz-auto";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let turnRes: StreamTurnResponse;

    if (
      effectiveMode === "local-endpoint" ||
      (effectiveMode === "custom" && settings.directBrowserCustom && settings.customProtocol === "openai")
    ) {
      const baseUrl = (effectiveMode === "local-endpoint" ? settings.localEndpointUrl : settings.customBaseUrl).replace(
        /\/+$/,
        "",
      );
      const apiKey = effectiveMode === "local-endpoint" ? "ollama" : settings.customApiKey;
      const model = effectiveMode === "local-endpoint" ? settings.localEndpointModel : settings.customModel;

      const systemMsg: AnsatzChatMessage = {
        role: "system",
        content: buildLocalToolPrompt(context, ANSATZ_EXTENDED_TOOLS),
      };
      const wireMessages = [systemMsg, ...workingMessages].map((m) => {
        if (m.role === "tool") {
          return { role: "tool", content: m.content, tool_call_id: m.toolCallId, name: m.name };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc, i) => ({
              id: tc.id || `call_${i}`,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      });

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: wireMessages,
          tools: ANSATZ_EXTENDED_TOOLS,
          tool_choice: "auto",
          stream: true,
        }),
        signal: callbacks.signal,
      });
      turnRes = await consumeSseResponse(res, model, callbacks.onTextDelta);
    } else {
      // Ansatz Cloud or Backend-proxied Custom BYOK
      const res = await fetch("/api/v1/ai/ansatz/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          messages: workingMessages,
          tools: ANSATZ_EXTENDED_TOOLS,
          context: {
            fileName: host.getFileName(),
            dialect: host.getDialect(),
            code: host.getCode(),
            selectedComponent: host.getSelectedComponent(),
            diagnostics: host.getDiagnostics(),
          },
          providerMode: effectiveMode === "custom" ? "custom" : "ansatz",
          ...(effectiveMode === "custom"
            ? {
                customProvider: {
                  protocol: settings.customProtocol,
                  baseUrl: settings.customBaseUrl,
                  apiKey: settings.customApiKey,
                  model: settings.customModel,
                },
              }
            : {}),
        }),
        signal: callbacks.signal,
      });
      turnRes = await consumeSseResponse(res, resolvedModel, callbacks.onTextDelta);
    }

    resolvedModel = turnRes.model;
    if (turnRes.content) {
      finalContent += (finalContent ? "\n" : "") + turnRes.content;
    }

    if (turnRes.toolCalls.length === 0) {
      break;
    }

    workingMessages.push({
      role: "assistant",
      content: turnRes.content,
      toolCalls: turnRes.toolCalls,
    });

    for (const tc of turnRes.toolCalls) {
      callbacks.onToolCall?.(tc);
      const toolRes = await executeAnsatzToolCall(host, tc);
      toolResults.push(toolRes);
      callbacks.onToolResult?.(toolRes);
      workingMessages.push({
        role: "tool",
        toolCallId: tc.id,
        name: tc.name,
        content: toolRes.output,
      });
    }
  }

  return {
    content: finalContent.trim(),
    model: resolvedModel,
    providerUsed: effectiveMode,
    toolResults,
  };
}

export function fallbackTaskTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New AI Task";
  return cleaned.length > 42 ? `${cleaned.slice(0, 39)}…` : cleaned;
}

function sanitizeGeneratedTitle(raw: string, prompt: string): string {
  const cleaned = stripThinkBlocks(raw)
    .replace(/^["'`“”]+|["'`“”.!?:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 72) {
    return fallbackTaskTitle(prompt);
  }
  return cleaned;
}

export async function generateAnsatzTaskTitle(
  prompt: string,
  settings: AnsatzAiSettings,
  signal?: AbortSignal,
): Promise<string> {
  const instruction =
    "Generate a concise 3 to 6 word title for this engineering modeling task. Reply with ONLY the title, no quotes or trailing punctuation.";
  const userContent = prompt.slice(0, 500);

  let effectiveMode: AnsatzAiProviderMode = settings.mode;
  if (effectiveMode === "auto") {
    effectiveMode = isSharedLocalWebLLMLoaded() ? "local" : "ansatz";
  }

  try {
    if (effectiveMode === "local") {
      const localEngine = await ensureSharedLocalAiEngine(undefined, instruction);
      if (localEngine?.kind === "prompt-api") {
        const text = await localEngine.session.prompt(`${instruction}\n\n${userContent}`);
        return sanitizeGeneratedTitle(text, prompt);
      }
      if (localEngine?.kind === "webllm") {
        const res = await localEngine.engine.chat.completions.create({
          messages: [
            { role: "system", content: `${instruction}\n/no_think` },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 32,
          stream: false,
          extra_body: { enable_thinking: false },
        });
        return sanitizeGeneratedTitle(res.choices?.[0]?.message?.content || "", prompt);
      }
      return fallbackTaskTitle(prompt);
    }

    if (
      effectiveMode === "local-endpoint" ||
      (effectiveMode === "custom" && settings.directBrowserCustom && settings.customProtocol === "openai")
    ) {
      const baseUrl = (effectiveMode === "local-endpoint" ? settings.localEndpointUrl : settings.customBaseUrl).replace(
        /\/+$/,
        "",
      );
      const apiKey = effectiveMode === "local-endpoint" ? "ollama" : settings.customApiKey;
      const model = effectiveMode === "local-endpoint" ? settings.localEndpointModel : settings.customModel;
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 32,
          stream: false,
        }),
        signal,
      });
      if (!res.ok) return fallbackTaskTitle(prompt);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return sanitizeGeneratedTitle(data.choices?.[0]?.message?.content || "", prompt);
    }

    const res = await fetch("/api/v1/ai/ansatz/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `${instruction}\n\nTask prompt: ${userContent}`,
          },
        ],
        maxTokens: 32,
        temperature: 0.2,
        providerMode: effectiveMode === "custom" ? "custom" : "ansatz",
        ...(effectiveMode === "custom"
          ? {
              customProvider: {
                protocol: settings.customProtocol,
                baseUrl: settings.customBaseUrl,
                apiKey: settings.customApiKey,
                model: settings.customModel,
              },
            }
          : {}),
      }),
      signal,
    });
    const streamRes = await consumeSseResponse(res, "title");
    return sanitizeGeneratedTitle(streamRes.content, prompt);
  } catch {
    return fallbackTaskTitle(prompt);
  }
}

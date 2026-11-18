// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ensureSharedLocalAiEngine,
  isSharedLocalWebLLMLoaded,
  isWebGpuAvailable,
} from "../../../util/local-ai-runtime";
import {
  executeMorselToolCall,
  MORSEL_CORE_TOOLS,
  MORSEL_EXTENDED_TOOLS,
  type MorselDiagnosticSummary,
  type MorselToolCall,
  type MorselToolDefinition,
  type MorselToolHost,
  type MorselToolResult,
} from "./morsel-tool-bridge";

export type MorselAiProviderMode = "auto" | "local" | "local-endpoint" | "ansatz" | "custom";
export type MorselCustomProtocol = "openai" | "anthropic";

export interface MorselAiSettings {
  mode: MorselAiProviderMode;
  localEndpointUrl: string;
  localEndpointModel: string;
  customProtocol: MorselCustomProtocol;
  customBaseUrl: string;
  customApiKey: string;
  customModel: string;
  directBrowserCustom: boolean;
}

const SETTINGS_STORAGE_KEY = "modelscript:morsel_ai_settings";

export const DEFAULT_MORSEL_AI_SETTINGS: MorselAiSettings = {
  mode: "auto",
  localEndpointUrl: "http://127.0.0.1:11434/v1",
  localEndpointModel: "qwen2.5-coder:7b",
  customProtocol: "openai",
  customBaseUrl: "https://api.openai.com/v1",
  customApiKey: "",
  customModel: "gpt-4o-mini",
  directBrowserCustom: false,
};

export function loadMorselAiSettings(): MorselAiSettings {
  if (typeof window === "undefined") return DEFAULT_MORSEL_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_MORSEL_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MorselAiSettings>;
    return { ...DEFAULT_MORSEL_AI_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_MORSEL_AI_SETTINGS;
  }
}

export function saveMorselAiSettings(settings: MorselAiSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export interface MorselChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string | undefined;
  name?: string | undefined;
  toolCalls?: MorselToolCall[] | undefined;
}

export interface MorselAiContextSnapshot {
  fileName: string;
  dialect: string;
  code: string;
  selectedComponent?: string | undefined;
  diagnostics: MorselDiagnosticSummary[];
}

export interface MorselAiTurnCallbacks {
  onTextDelta?: ((delta: string) => void) | undefined;
  onToolCall?: ((call: MorselToolCall) => void) | undefined;
  onToolResult?: ((result: MorselToolResult) => void) | undefined;
  onLocalProgress?: ((message: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface MorselAiTurnResult {
  content: string;
  model: string;
  providerUsed: MorselAiProviderMode;
  toolResults: MorselToolResult[];
}

export interface MorselProvidersInfo {
  ansatzAvailable: boolean;
  airgapMode: boolean;
  defaultModel: string;
  supportedProtocols: ("openai" | "anthropic" | "mcp-sse")[];
  ollamaQualityModel?: string | undefined;
}

export async function fetchMorselProvidersInfo(signal?: AbortSignal): Promise<MorselProvidersInfo | null> {
  try {
    const res = await fetch("/api/v1/ai/providers", { signal });
    if (!res.ok) return null;
    return (await res.json()) as MorselProvidersInfo;
  } catch {
    return null;
  }
}

export function isMorselLocalWebGpuAvailable(): boolean {
  return isWebGpuAvailable();
}

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
}

function buildLocalToolPrompt(context: MorselAiContextSnapshot, tools: MorselToolDefinition[]): string {
  const toolDesc = tools
    .map((t) => `- ${t.function.name}: ${t.function.description} params=${JSON.stringify(t.function.parameters)}`)
    .join("\n");
  const diags = context.diagnostics
    .slice(0, 8)
    .map((d) => `[${d.severity}] L${d.line ?? "?"}: ${d.message}`)
    .join("\n");

  return [
    "You are Morsel AI, an expert physical modeling assistant.",
    `Active file: ${context.fileName} (${context.dialect})`,
    diags ? `Diagnostics:\n${diags}` : "Diagnostics: none",
    `Source:\n\`\`\`${context.dialect}\n${context.code.slice(0, 4000)}\n\`\`\``,
    'Available tools (to call a tool, respond ONLY with JSON: {"tool":"<name>","arguments":{...}}):',
    toolDesc,
  ].join("\n\n");
}

function tryParseLocalToolCall(text: string): MorselToolCall | null {
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
  toolCalls: MorselToolCall[];
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
  const toolCalls: MorselToolCall[] = [];
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
          for (const tc of parsed["toolCalls"] as MorselToolCall[]) {
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

export async function runMorselAiTurn(
  history: MorselChatMessage[],
  host: MorselToolHost,
  settings: MorselAiSettings,
  callbacks: MorselAiTurnCallbacks = {},
): Promise<MorselAiTurnResult> {
  const MAX_TOOL_ROUNDS = 6;
  const toolResults: MorselToolResult[] = [];
  const context: MorselAiContextSnapshot = {
    fileName: host.getFileName(),
    dialect: host.getDialect(),
    code: host.getCode(),
    selectedComponent: host.getSelectedComponent(),
    diagnostics: host.getDiagnostics(),
  };

  let effectiveMode: MorselAiProviderMode = settings.mode;
  if (effectiveMode === "auto") {
    effectiveMode = isSharedLocalWebLLMLoaded() ? "local" : "ansatz";
  }

  // 1. Local browser mode (WebLLM / Prompt API)
  if (effectiveMode === "local") {
    const localEngine = await ensureSharedLocalAiEngine(
      callbacks.onLocalProgress,
      "You are Morsel AI, an engineering modeling assistant.",
    );
    if (!localEngine) {
      if (settings.mode === "local") {
        throw new Error("Local browser AI (WebGPU or Chrome Prompt API) is unavailable in this browser.");
      }
      effectiveMode = "ansatz";
    } else {
      const systemPrompt = buildLocalToolPrompt(context, MORSEL_CORE_TOOLS);
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
              { role: "system", content: systemPrompt },
              ...loopMessages.map((m) => ({
                role: (m.role === "tool" ? "user" : m.role) as "system" | "user" | "assistant",
                content: m.content,
              })),
            ],
            temperature: 0.2,
            max_tokens: 1024,
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
        const toolRes = await executeMorselToolCall(host, maybeTool);
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
  const workingMessages: MorselChatMessage[] = [...history];
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

      const systemMsg: MorselChatMessage = {
        role: "system",
        content: buildLocalToolPrompt(context, MORSEL_EXTENDED_TOOLS),
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
          tools: MORSEL_EXTENDED_TOOLS,
          tool_choice: "auto",
          stream: true,
        }),
        signal: callbacks.signal,
      });
      turnRes = await consumeSseResponse(res, model, callbacks.onTextDelta);
    } else {
      // Ansatz Cloud or Backend-proxied Custom BYOK
      const res = await fetch("/api/v1/ai/morsel/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          messages: workingMessages,
          tools: MORSEL_EXTENDED_TOOLS,
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
      const toolRes = await executeMorselToolCall(host, tc);
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

// SPDX-License-Identifier: AGPL-3.0-or-later

import { isStrictAirgapEnv } from "../../util/tier-presets.js";
import {
  AnthropicProvider,
  createDefaultLLMProvider,
  DeterministicEngineeringProvider,
  discoverOllamaProvider,
  getDefaultCloudModelId,
  isLocalOrIntranetLLMUrl,
  OpenAICompatibleProvider,
  type LLMMessage,
  type LLMProvider,
  type LLMStreamChunk,
  type LLMToolDefinition,
} from "./llm-client.js";

export type AnsatzBackendProviderMode = "ansatz" | "custom";
export type AnsatzCustomProtocol = "openai" | "anthropic";

export interface AnsatzContextSnapshot {
  fileName?: string | undefined;
  dialect?: string | undefined;
  code?: string | undefined;
  selectedComponent?: string | undefined;
  diagnostics?:
    | {
        severity: string;
        message: string;
        line?: number | undefined;
        column?: number | undefined;
      }[]
    | undefined;
}

export interface AnsatzCustomProviderConfig {
  protocol?: AnsatzCustomProtocol | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export interface AnsatzChatRequest {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[] | undefined;
  context?: AnsatzContextSnapshot | undefined;
  providerMode?: AnsatzBackendProviderMode | undefined;
  customProvider?: AnsatzCustomProviderConfig | undefined;
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}

export interface AnsatzProvidersInfo {
  ansatzAvailable: boolean;
  airgapMode: boolean;
  defaultModel: string;
  supportedProtocols: ("openai" | "anthropic" | "mcp-sse")[];
  ollamaQualityModel?: string | undefined;
}

function buildAnsatzSystemPrompt(context?: AnsatzContextSnapshot): string {
  const parts = [
    "You are Ansatz AI, an expert physical-modeling and systems engineering assistant inside ModelScript / Ansatz.",
    "You help users author, debug, flatten, and simulate models across Modelica, SysML v2, CAD/STEP, power grids, fluid networks, and other engineering DSLs.",
    "When tools are available, prefer inspecting diagnostics or flattening/simulating to verify changes before claiming a fix works.",
    "Keep explanations concise and technically accurate.",
  ];

  if (context) {
    const meta: string[] = [];
    if (context.fileName) meta.push(`Active file: ${context.fileName}`);
    if (context.dialect) meta.push(`Language/dialect: ${context.dialect}`);
    if (context.selectedComponent) meta.push(`Selected component: ${context.selectedComponent}`);
    if (meta.length > 0) {
      parts.push(`\nWorkspace Context:\n${meta.join("\n")}`);
    }
    if (context.diagnostics && context.diagnostics.length > 0) {
      const diagLines = context.diagnostics
        .slice(0, 15)
        .map((d) => `- [${d.severity}]${d.line ? ` L${d.line}` : ""}: ${d.message}`);
      parts.push(`\nCurrent Diagnostics:\n${diagLines.join("\n")}`);
    }
    if (context.code) {
      const trimmedCode =
        context.code.length > 12_000 ? `${context.code.slice(0, 12_000)}\n... (truncated)` : context.code;
      parts.push(`\nActive Source:\n\`\`\`${context.dialect || "modelica"}\n${trimmedCode}\n\`\`\``);
    }
  }

  return parts.join("\n");
}

import { createBackendMcpSession, type BackendMcpSession } from "./ansatz-mcp-runner.js";

export class AnsatzAiService {
  async getProvidersInfo(): Promise<AnsatzProvidersInfo> {
    const airgap = isStrictAirgapEnv();
    const ollama = await discoverOllamaProvider({ preferTier: "quality" });
    const hasCloudKey = Boolean(
      process.env["OPENAI_API_KEY"] || process.env["GEMINI_API_KEY"] || process.env["AI_BASE_URL"],
    );
    return {
      ansatzAvailable: Boolean(ollama) || hasCloudKey || process.env["NODE_ENV"] !== "production",
      airgapMode: airgap,
      defaultModel: ollama?.model || getDefaultCloudModelId(),
      supportedProtocols: ["openai", "anthropic", "mcp-sse"],
      ...(ollama?.model ? { ollamaQualityModel: ollama.model } : {}),
    };
  }

  async resolveProvider(req: AnsatzChatRequest): Promise<{ provider: LLMProvider; model: string }> {
    if (req.providerMode === "custom") {
      const cfg = req.customProvider;
      if (!cfg?.apiKey && !isLocalOrIntranetLLMUrl(cfg?.baseUrl || "")) {
        throw new Error("Custom provider requires an API key (or a local/intranet baseUrl).");
      }
      const protocol = cfg?.protocol ?? "openai";
      if (protocol === "anthropic") {
        const baseUrl = cfg?.baseUrl || "https://api.anthropic.com/v1";
        if (isStrictAirgapEnv() && !isLocalOrIntranetLLMUrl(baseUrl)) {
          throw new Error(`Air-Gap Egress Blocked: External provider '${baseUrl}' is forbidden.`);
        }
        return {
          provider: new AnthropicProvider(cfg?.apiKey || "", baseUrl),
          model: cfg?.model || req.model || "claude-sonnet-4-5",
        };
      }
      const baseUrl = cfg?.baseUrl || "https://api.openai.com/v1";
      const isLocal = isLocalOrIntranetLLMUrl(baseUrl);
      if (isStrictAirgapEnv() && !isLocal) {
        throw new Error(`Air-Gap Egress Blocked: External provider '${baseUrl}' is forbidden.`);
      }
      return {
        provider: new OpenAICompatibleProvider(cfg?.apiKey || "local", baseUrl, isLocal),
        model: cfg?.model || req.model || "gpt-4o-mini",
      };
    }

    // Ansatz backend: prefer heavier quality-tier Ollama/vLLM model if available, else configured cloud provider
    const ollama = await discoverOllamaProvider({ preferTier: "quality" });
    if (ollama) {
      return { provider: ollama.provider, model: req.model || ollama.model };
    }

    const fallback = createDefaultLLMProvider();
    if (fallback instanceof DeterministicEngineeringProvider) {
      return { provider: fallback, model: req.model || "modelscript-engineering-v1" };
    }
    return { provider: fallback, model: req.model || getDefaultCloudModelId() };
  }

  async *streamChat(req: AnsatzChatRequest, userId?: number): AsyncIterable<LLMStreamChunk> {
    const { provider, model } = await this.resolveProvider(req);
    const systemMessage: LLMMessage = {
      role: "system",
      content: buildAnsatzSystemPrompt(req.context),
    };
    const workingMessages: LLMMessage[] = [systemMessage, ...req.messages.filter((m) => m.role !== "system")];

    let mcpSession: BackendMcpSession | null = null;
    const isDeterministic = provider instanceof DeterministicEngineeringProvider;
    if (!isDeterministic && req.providerMode !== "custom") {
      try {
        mcpSession = await createBackendMcpSession(userId);
      } catch {
        mcpSession = null;
      }
    }

    const clientTools = req.tools ?? [];
    const seenToolNames = new Set(clientTools.map((t) => t.function.name));
    const mergedTools = [
      ...clientTools,
      ...(mcpSession ? mcpSession.tools.filter((t) => !seenToolNames.has(t.function.name)) : []),
    ];

    try {
      const MAX_SERVER_TOOL_ROUNDS = 4;
      for (let round = 0; round < MAX_SERVER_TOOL_ROUNDS; round++) {
        const options = {
          model,
          temperature: req.temperature ?? 0.2,
          maxTokens: req.maxTokens ?? 2048,
          tools: mergedTools.length > 0 ? mergedTools : undefined,
          toolChoice: mergedTools.length > 0 ? ("auto" as const) : undefined,
        };

        let roundText = "";
        let roundToolCalls: { id?: string | undefined; name: string; arguments: Record<string, unknown> }[] = [];
        let resolvedModel = model;

        if (provider.completeStream) {
          for await (const chunk of provider.completeStream(workingMessages, options)) {
            if (chunk.type === "text") {
              roundText += chunk.delta;
              yield chunk;
            } else if (chunk.type === "tool_calls") {
              roundToolCalls = chunk.toolCalls;
            } else if (chunk.type === "done") {
              resolvedModel = chunk.model;
            }
          }
        } else {
          const res = await provider.complete(workingMessages, options);
          resolvedModel = res.model;
          if (res.content) {
            roundText = res.content;
            yield { type: "text", delta: res.content };
          }
          if (res.toolCalls) {
            roundToolCalls = res.toolCalls;
          }
        }

        if (roundToolCalls.length === 0) {
          yield { type: "done", model: resolvedModel };
          return;
        }

        const backendCalls = mcpSession ? roundToolCalls.filter((tc) => mcpSession!.toolNames.has(tc.name)) : [];
        const browserCalls = roundToolCalls.filter((tc) => !mcpSession || !mcpSession.toolNames.has(tc.name));

        if (backendCalls.length === 0) {
          yield { type: "tool_calls", toolCalls: browserCalls };
          yield { type: "done", model: resolvedModel };
          return;
        }

        // Execute server-side @modelscript/mcp tools and feed results back to the LLM
        workingMessages.push({
          role: "assistant",
          content: roundText,
          toolCalls: backendCalls,
        });
        for (const tc of backendCalls) {
          let output: string;
          try {
            output = await mcpSession!.callTool(tc.name, tc.arguments);
          } catch (err) {
            output = err instanceof Error ? err.message : String(err);
          }
          workingMessages.push({
            role: "tool",
            toolCallId: tc.id,
            name: tc.name,
            content: output,
          });
        }

        if (browserCalls.length > 0) {
          yield { type: "tool_calls", toolCalls: browserCalls };
          yield { type: "done", model: resolvedModel };
          return;
        }
      }
    } finally {
      await mcpSession?.close();
    }
  }
}

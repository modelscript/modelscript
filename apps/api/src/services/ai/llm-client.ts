// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSafePublicUrl } from "../../util/ssrf.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

export interface LLMResponse {
  content: string;
  model: string;
  toolCalls?: {
    name: string;
    arguments: Record<string, unknown>;
  }[];
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse>;
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
      content: `I have received your request: "${lastMessage.trim()}". As an engineering bot on ModelScript, I can verify equations, run DAE simulations, and analyze multi-domain digital twins.`,
    };
  }
}

/**
 * Pluggable Open-AI compatible HTTP client (works with Gemini OpenAI endpoint, Ollama, vLLM, OpenAI).
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

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const model = options?.model || "gpt-4o-mini";
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 1024,
    };
    if (options?.reasoningEffort) {
      payload["reasoning_effort"] = options.reasoningEffort;
    }

    const targetUrl = `${this.#baseUrl}/chat/completions`;
    if (process.env["NODE_ENV"] === "production" && !this.#allowInternalHost) {
      assertSafePublicUrl(targetUrl);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.#apiKey}`,
    };
    if (process.env["NODE_ENV"] === "test") {
      headers["Connection"] = "close";
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM provider error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | undefined } | undefined }[] | undefined;
      model?: string | undefined;
    };
    const choice = data.choices?.[0]?.message;
    return {
      content: stripLLMThinkBlocks(choice?.content || ""),
      model: data.model || model,
    };
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

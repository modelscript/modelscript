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

  constructor(apiKey: string, baseUrl: string = "https://api.openai.com/v1") {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMResponse> {
    const model = options?.model || "gpt-4o-mini";
    const payload = {
      model,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 1024,
    };

    const targetUrl = `${this.#baseUrl}/chat/completions`;
    if (process.env["NODE_ENV"] === "production") {
      assertSafePublicUrl(targetUrl);
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify(payload),
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
      content: choice?.content || "",
      model: data.model || model,
    };
  }
}

export function createDefaultLLMProvider(): LLMProvider {
  const apiKey = process.env["OPENAI_API_KEY"] || process.env["GEMINI_API_KEY"];
  const baseUrl = process.env["AI_BASE_URL"];

  if (apiKey) {
    return new OpenAICompatibleProvider(
      apiKey,
      baseUrl ||
        (process.env["GEMINI_API_KEY"] ? "https://generativelanguage.googleapis.com/v1beta/openai" : undefined),
    );
  }

  return new DeterministicEngineeringProvider();
}

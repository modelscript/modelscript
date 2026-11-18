// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BrowserPromptSession {
  prompt(input: string): Promise<string>;
}

interface BrowserLanguageModelFactory {
  create(options?: { systemPrompt?: string | undefined }): Promise<BrowserPromptSession>;
  availability?: (() => Promise<string>) | undefined;
  capabilities?: (() => Promise<{ available?: string | undefined }>) | undefined;
}

interface WindowWithBuiltInAi {
  ai?: { languageModel?: BrowserLanguageModelFactory | undefined };
  LanguageModel?: BrowserLanguageModelFactory | undefined;
}

export interface SharedWebLLMEngine {
  chat: {
    completions: {
      create(params: {
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        temperature?: number;
        max_tokens?: number;
        stream?: false;
        extra_body?: Record<string, unknown>;
      }): Promise<{ choices?: { message?: { content?: string | null | undefined } }[] }>;
    };
  };
}

export type SharedLocalAiEngine =
  | { kind: "webllm"; engine: SharedWebLLMEngine; model: string }
  | { kind: "prompt-api"; session: BrowserPromptSession };

const WEBLLM_MODEL_CANDIDATES: readonly {
  modelId: string;
  wasmFiles: readonly string[];
}[] = [
  {
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    wasmFiles: ["Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm", "Qwen3-1.7B-q4f16_1-ctx4k_cs1k-webgpu.wasm"],
  },
  {
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    wasmFiles: ["Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm", "Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm"],
  },
];

let cachedBrowserSession: BrowserPromptSession | null = null;
let cachedWebLLM: SharedWebLLMEngine | null = null;
let cachedWebLLMModel = WEBLLM_MODEL_CANDIDATES[0]!.modelId;
let loadingPromise: Promise<SharedWebLLMEngine | null> | null = null;

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function isSharedLocalWebLLMLoaded(): boolean {
  return cachedWebLLM !== null;
}

export function isSharedLocalAiLoaded(): boolean {
  return cachedWebLLM !== null || cachedBrowserSession !== null;
}

export function getActiveWebLLMModelId(): string {
  return cachedWebLLMModel;
}

export async function getSharedBrowserBuiltInSession(systemPrompt: string): Promise<BrowserPromptSession | null> {
  if (typeof window === "undefined") return null;
  const win = window as unknown as WindowWithBuiltInAi;
  const factory = win.ai?.languageModel || win.LanguageModel;
  if (!factory || typeof factory.create !== "function") return null;

  try {
    if (typeof factory.availability === "function") {
      const avail = await factory.availability();
      if (avail === "no" || avail === "unavailable") return null;
    } else if (typeof factory.capabilities === "function") {
      const caps = await factory.capabilities();
      if (caps?.available === "no") return null;
    }
    const session = await factory.create({ systemPrompt });
    cachedBrowserSession = session;
    return session;
  } catch {
    return null;
  }
}

export async function ensureSharedWebLLMEngine(onProgress?: (msg: string) => void): Promise<SharedWebLLMEngine | null> {
  if (cachedWebLLM) return cachedWebLLM;
  if (loadingPromise) return loadingPromise;
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;

  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!nav.gpu) return null;

  loadingPromise = (async () => {
    try {
      const adapter = await nav.gpu!.requestAdapter();
      if (!adapter) return null;

      onProgress?.("Loading local WebGPU model…");
      const webllm = await import("@mlc-ai/web-llm");
      const origin = window.location.origin;

      for (const candidate of WEBLLM_MODEL_CANDIDATES) {
        try {
          const prebuiltModel = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === candidate.modelId);
          let modelUrl = prebuiltModel?.model || `https://huggingface.co/mlc-ai/${candidate.modelId}`;
          let modelLibUrl = prebuiltModel?.model_lib || `${origin}/api/models/${candidate.wasmFiles[0]}`;

          // Check if model weights are self-hosted at /api/models/<modelId>
          try {
            const localConfigRes = await fetch(`${origin}/api/models/${candidate.modelId}/mlc-chat-config.json`, {
              method: "HEAD",
            });
            if (localConfigRes.ok) {
              modelUrl = `${origin}/api/models/${candidate.modelId}`;
            }
          } catch {
            // Fall back to HuggingFace CDN URL
          }

          // Check if WASM runtime is self-hosted at /api/models/<wasmFile>
          for (const wasmFile of candidate.wasmFiles) {
            try {
              const localWasmUrl = `${origin}/api/models/${wasmFile}`;
              const localWasmRes = await fetch(localWasmUrl, { method: "HEAD" });
              if (localWasmRes.ok) {
                modelLibUrl = localWasmUrl;
                break;
              }
            } catch {
              // Ignore and try next or use prebuiltModel.model_lib
            }
          }

          const engine = (await webllm.CreateMLCEngine(candidate.modelId, {
            initProgressCallback: (report: { text?: string }) => {
              if (report?.text) onProgress?.(report.text);
            },
            appConfig: {
              model_list: [
                {
                  model: modelUrl,
                  model_id: candidate.modelId,
                  model_lib: modelLibUrl,
                  overrides: prebuiltModel?.overrides,
                },
              ],
            },
          })) as unknown as SharedWebLLMEngine;

          cachedWebLLM = engine;
          cachedWebLLMModel = candidate.modelId;
          return engine;
        } catch {
          // Try next smaller candidate
        }
      }

      return null;
    } catch {
      return null;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export async function ensureSharedLocalAiEngine(
  onProgress?: (msg: string) => void,
  systemPrompt = "You are ModelScript AI, an engineering modeling assistant.",
): Promise<SharedLocalAiEngine | null> {
  const session = await getSharedBrowserBuiltInSession(systemPrompt);
  if (session) {
    return { kind: "prompt-api", session };
  }
  const engine = await ensureSharedWebLLMEngine(onProgress);
  if (engine) {
    return { kind: "webllm", engine, model: cachedWebLLMModel };
  }
  return null;
}

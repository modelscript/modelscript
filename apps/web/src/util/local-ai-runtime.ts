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

interface WebLLMModelCandidate {
  modelId: string;
  requiresF16: boolean;
  wasmFiles: readonly string[];
}

const WEBLLM_MODEL_CANDIDATES: readonly WebLLMModelCandidate[] = [
  {
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    requiresF16: true,
    wasmFiles: ["Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm", "Qwen3-1.7B-q4f16_1-ctx4k_cs1k-webgpu.wasm"],
  },
  {
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    requiresF16: true,
    wasmFiles: ["Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm", "Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm"],
  },
  {
    modelId: "Qwen3-1.7B-q4f32_1-MLC",
    requiresF16: false,
    wasmFiles: ["Qwen3-1.7B-q4f32_1_cs1k-webgpu.wasm"],
  },
  {
    modelId: "Qwen3-0.6B-q4f32_1-MLC",
    requiresF16: false,
    wasmFiles: ["Qwen3-0.6B-q4f32_1_cs1k-webgpu.wasm"],
  },
];

let cachedBrowserSession: BrowserPromptSession | null = null;
let cachedWebLLM: SharedWebLLMEngine | null = null;
let cachedWebLLMModel = WEBLLM_MODEL_CANDIDATES[0]!.modelId;
let loadingPromise: Promise<SharedWebLLMEngine | null> | null = null;
let lastLocalAiError: string | null = null;

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

export function getLastLocalAiError(): string | null {
  return lastLocalAiError;
}

async function hasSelfHostedJson(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    return ct.includes("json") && !ct.includes("text/html");
  } catch {
    return false;
  }
}

async function hasSelfHostedWasm(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) return false;
    return ct.includes("wasm") || ct.includes("octet-stream") || ct === "";
  } catch {
    return false;
  }
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
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    lastLocalAiError = "WebGPU is only available in a browser context.";
    return null;
  }

  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<{ features?: { has(name: string): boolean } } | null> };
  };
  if (!nav.gpu) {
    lastLocalAiError = "navigator.gpu is unavailable (WebGPU requires a supported browser over HTTPS or localhost).";
    return null;
  }

  loadingPromise = (async () => {
    try {
      const adapter = await nav.gpu!.requestAdapter();
      if (!adapter) {
        lastLocalAiError = "WebGPU requestAdapter() returned null (no compatible GPU adapter found).";
        return null;
      }

      const hasF16 = Boolean(adapter.features?.has?.("shader-f16"));
      const orderedCandidates = [
        ...WEBLLM_MODEL_CANDIDATES.filter((c) => (hasF16 ? c.requiresF16 : !c.requiresF16)),
        ...WEBLLM_MODEL_CANDIDATES.filter((c) => (hasF16 ? !c.requiresF16 : c.requiresF16)),
      ];

      onProgress?.("Loading local WebGPU model…");
      const webllm = await import("@mlc-ai/web-llm");
      const origin = window.location.origin;
      let attemptError: string | null = null;

      for (const candidate of orderedCandidates) {
        try {
          const prebuiltModel = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === candidate.modelId);
          let modelUrl = prebuiltModel?.model || `https://huggingface.co/mlc-ai/${candidate.modelId}`;
          let modelLibUrl = prebuiltModel?.model_lib || `${origin}/api/models/${candidate.wasmFiles[0]}`;
          let hasSelfHostedOverride = false;

          if (await hasSelfHostedJson(`${origin}/api/models/${candidate.modelId}/mlc-chat-config.json`)) {
            modelUrl = `${origin}/api/models/${candidate.modelId}`;
            hasSelfHostedOverride = true;
          }

          for (const wasmFile of candidate.wasmFiles) {
            const localWasmUrl = `${origin}/api/models/${wasmFile}`;
            if (await hasSelfHostedWasm(localWasmUrl)) {
              modelLibUrl = localWasmUrl;
              hasSelfHostedOverride = true;
              break;
            }
          }

          const engine = (await webllm.CreateMLCEngine(candidate.modelId, {
            initProgressCallback: (report: { text?: string }) => {
              if (report?.text) onProgress?.(report.text);
            },
            ...(hasSelfHostedOverride || !prebuiltModel
              ? {
                  appConfig: {
                    model_list: [
                      {
                        model: modelUrl,
                        model_id: candidate.modelId,
                        model_lib: modelLibUrl,
                        vram_required_MB: prebuiltModel?.vram_required_MB,
                        low_resource_required: prebuiltModel?.low_resource_required,
                        overrides: prebuiltModel?.overrides,
                      },
                    ],
                  },
                }
              : {}),
          })) as unknown as SharedWebLLMEngine;

          cachedWebLLM = engine;
          cachedWebLLMModel = candidate.modelId;
          lastLocalAiError = null;
          return engine;
        } catch (err) {
          attemptError = err instanceof Error ? err.message : String(err);
        }
      }

      lastLocalAiError = attemptError || "Failed to initialize any WebGPU model candidate.";
      return null;
    } catch (err) {
      lastLocalAiError = err instanceof Error ? err.message : String(err);
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
    lastLocalAiError = null;
    return { kind: "prompt-api", session };
  }
  const engine = await ensureSharedWebLLMEngine(onProgress);
  if (engine) {
    return { kind: "webllm", engine, model: cachedWebLLMModel };
  }
  return null;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dedicated web worker for WebLLM chat completions.
// Created from the webview iframe via blob: URL, this worker has native
// (unpatched) fetch and WebGPU access.
// Model files are self-hosted from the IDE server at /api/models/ to avoid
// COEP issues with external CDNs (HuggingFace, GitHub).

import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
let loading = false;

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

// Build the local model URL base from the worker's location.
// The worker is loaded via blob: URL, so self.location won't help.
// Instead, we derive the server origin from the importScripts URL.
// The model files are served at /api/models/ on the same server.
function getModelBaseUrl(): string {
  // In dev: http://localhost:3200/api/models
  // In static: https://modelscript.github.io/api/models (or similar)
  // We can't use self.location (blob: URL), so we use a well-known path.
  // The IDE server always serves model files at /api/models/.
  // We derive the origin from the referring page or use a hardcoded fallback.

  // Try to extract origin from the script URL that loaded us via importScripts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scripts = (self as any).__importScriptsOrigin;
  if (scripts) return scripts + "/api/models";

  // Fallback: use the page origin. In a worker context, we can try performance API
  // to get the page URL, but simplest is to use a message from the main thread.
  return "/api/models";
}

// Build custom appConfig pointing to local model files
function getAppConfig() {
  const modelBaseUrl = getModelBaseUrl();

  // Find the model in the prebuilt config to get the model_lib info
  const prebuiltModel = prebuiltAppConfig.model_list.find((m) => m.model_id === MODEL_ID);

  return {
    model_list: [
      {
        model: `${modelBaseUrl}/${MODEL_ID}`,
        model_id: MODEL_ID,
        // Always use the locally-hosted WASM — external GitHub URLs are
        // blocked by VS Code's COEP (require-corp).
        model_lib: `${modelBaseUrl}/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        overrides: prebuiltModel?.overrides,
      },
    ],
  };
}

async function ensureEngine(): Promise<void> {
  if (engine) return;
  if (loading) {
    while (loading) await new Promise((r) => setTimeout(r, 200));
    return;
  }

  loading = true;
  try {
    // Check WebGPU
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.gpu) throw new Error("WebGPU not available in this worker");
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");

    engine = await CreateMLCEngine(MODEL_ID, {
      appConfig: getAppConfig(),
      initProgressCallback: (report: { text: string; progress: number }) => {
        self.postMessage({ type: "progress", text: report.text, progress: report.progress });
      },
    });

    self.postMessage({ type: "ready" });
  } catch (e) {
    self.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    loading = false;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === "setOrigin") {
    // Main thread tells us the server origin so we can build model URLs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).__importScriptsOrigin = msg.origin;
    return;
  }

  if (msg.type === "chatComplete") {
    try {
      await ensureEngine();
      const completion = await engine.chat.completions.create({
        messages: msg.messages,
        temperature: msg.temperature ?? 0.7,
        max_tokens: msg.maxTokens ?? 4096,
        stream: false,
      });
      const text = completion.choices?.[0]?.message?.content ?? "";
      self.postMessage({ type: "chatResponse", id: msg.id, text });
    } catch (e) {
      self.postMessage({
        type: "chatResponse",
        id: msg.id,
        text: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
};

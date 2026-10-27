// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

interface WebLLMEngine {
  chat: {
    completions: {
      create(opts: {
        messages: { role: string; content: string }[];
        temperature?: number | undefined;
        max_tokens?: number | undefined;
        stream: boolean;
      }): Promise<AsyncIterable<{ choices?: { delta?: { content?: string | undefined } | undefined }[] | undefined }>>;
    };
  };
}

interface WebLLMModule {
  CreateMLCEngine(
    modelId: string,
    opts: { initProgressCallback: (report: { text: string; progress: number }) => void },
  ): Promise<WebLLMEngine>;
}

let webllm: WebLLMModule | null = null;

let engine: WebLLMEngine | null = null;

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

/**
 * Load the WebLLM engine lazily on first use.
 * Shows download progress via VS Code progress notification.
 */
async function ensureEngine(): Promise<void> {
  if (engine) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "ModelScript AI",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Loading WebLLM runtime..." });

      // Dynamic import — WebLLM is an ESM package bundled by webpack
      webllm = (await import("@mlc-ai/web-llm").catch(() => null)) as WebLLMModule | null;
      if (!webllm) {
        throw new Error("Failed to load @mlc-ai/web-llm");
      }

      progress.report({ message: `Downloading ${MODEL_ID}...` });

      engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report: { text: string; progress: number }) => {
          const pct = Math.round(report.progress * 100);
          progress.report({ message: report.text, increment: pct });
        },
      });

      progress.report({ message: "Model ready!" });
    },
  );
}

/**
 * Register a LanguageModelChat provider backed by WebLLM.
 * This makes the local Qwen model available to all extensions via vscode.lm.
 *
 * Note: `registerChatModelProvider` is a proposed API (VS Code 1.104+).
 */
export function registerLLMProvider(context: vscode.ExtensionContext): void {
  const lm = vscode.lm as unknown as {
    registerChatModelProvider?: (
      id: string,
      provider: {
        provideChatResponse: (
          messages: vscode.LanguageModelChatMessage[],
          options: {
            modelOptions?: { temperature?: number | undefined; maxOutputTokens?: number | undefined } | undefined;
          },
          extensionId: string,
          progress: vscode.Progress<{ index: number; part: vscode.LanguageModelTextPart }>,
          token: vscode.CancellationToken,
        ) => Promise<void>;
        provideTokenCount: (text: string | vscode.LanguageModelChatMessage[]) => Promise<number>;
      },
      metadata: {
        name: string;
        family: string;
        version: string;
        maxInputTokens: number;
        maxOutputTokens: number;
        isDefault: boolean;
      },
    ) => vscode.Disposable;
  };
  if (!lm || typeof lm.registerChatModelProvider !== "function") {
    console.log("[llm-provider] vscode.lm.registerChatModelProvider not available — skipping local model registration");
    return;
  }

  const disposable = lm.registerChatModelProvider(
    "modelscript.qwen",
    {
      provideChatResponse: async (
        messages: vscode.LanguageModelChatMessage[],
        options: {
          modelOptions?: { temperature?: number | undefined; maxOutputTokens?: number | undefined } | undefined;
        },
        _extensionId: string,
        progress: vscode.Progress<{ index: number; part: vscode.LanguageModelTextPart }>,
        token: vscode.CancellationToken,
      ) => {
        await ensureEngine();
        if (!engine) throw new Error("Failed to initialize WebLLM engine");

        // Convert VS Code messages to OpenAI format

        const openaiMessages: { role: string; content: string }[] = messages.map((msg) => {
          let role: string;
          switch (msg.role) {
            case vscode.LanguageModelChatMessageRole.User:
              role = "user";
              break;
            case vscode.LanguageModelChatMessageRole.Assistant:
              role = "assistant";
              break;
            default:
              role = "user";
          }
          // Extract text from message parts
          let content = "";
          for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
              content += part.value;
            }
          }
          return { role, content };
        });

        // Stream completion
        const completion = await engine.chat.completions.create({
          messages: openaiMessages,
          temperature: options?.modelOptions?.temperature ?? 0.7,
          max_tokens: options?.modelOptions?.maxOutputTokens ?? 4096,
          stream: true,
        });

        for await (const chunk of completion) {
          if (token.isCancellationRequested) break;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            progress.report({ index: 0, part: new vscode.LanguageModelTextPart(delta) });
          }
        }
      },

      provideTokenCount: async (text: string | vscode.LanguageModelChatMessage[]) => {
        // Approximate token count (4 chars per token is a reasonable heuristic)
        if (typeof text === "string") {
          return Math.ceil(text.length / 4);
        }
        // For message arrays, sum up content
        let total = 0;

        for (const msg of text) {
          for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
              total += Math.ceil(part.value.length / 4);
            }
          }
        }
        return total;
      },
    },
    {
      name: "Qwen3.5-0.8B (Local)",
      family: "qwen3.5",
      version: "0.8B-q4f16",
      maxInputTokens: 32768,
      maxOutputTokens: 8192,
      isDefault: false,
    },
  );

  context.subscriptions.push(disposable);
  console.log("[llm-provider] Registered local Qwen3.5-0.8B model provider");
}

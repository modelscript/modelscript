// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webllm: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;

const MODEL_ID = "Qwen/Qwen3.5-0.8B-q4f16_1-MLC";

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
      if (!webllm) {
        webllm = await import("@mlc-ai/web-llm");
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
 * We check for its existence at runtime and use `any` casts to avoid
 * type errors with current @types/vscode.
 */
export function registerLLMProvider(context: vscode.ExtensionContext): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lm = vscode.lm as any;
  if (!lm || typeof lm.registerChatModelProvider !== "function") {
    console.log("[llm-provider] vscode.lm.registerChatModelProvider not available — skipping local model registration");
    return;
  }

  const disposable = lm.registerChatModelProvider(
    "modelscript.qwen",
    {
      provideChatResponse: async (
        messages: vscode.LanguageModelChatMessage[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: Record<string, any>,
        _extensionId: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress: vscode.Progress<any>,
        token: vscode.CancellationToken,
      ) => {
        await ensureEngine();
        if (!engine) throw new Error("Failed to initialize WebLLM engine");

        // Convert VS Code messages to OpenAI format
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openaiMessages: any[] = messages.map((msg: any) => {
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of completion as AsyncIterable<any>) {
          if (token.isCancellationRequested) break;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            progress.report({ index: 0, part: new vscode.LanguageModelTextPart(delta) });
          }
        }
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideTokenCount: async (text: any) => {
        // Approximate token count (4 chars per token is a reasonable heuristic)
        if (typeof text === "string") {
          return Math.ceil(text.length / 4);
        }
        // For message arrays, sum up content
        let total = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const msg of text as any[]) {
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

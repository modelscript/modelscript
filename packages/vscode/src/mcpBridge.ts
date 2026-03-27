// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * MCP Bridge — registers VS Code Language Model Tools that route through
 * the LSP server's custom handlers. This enables the chat participant
 * (and any other LLM consumer) to call Modelica compiler tools.
 */
export function registerMCPTools(context: vscode.ExtensionContext, client: LanguageClient): void {
  // Runtime guard — lm.registerTool is a proposed API, only available with Copilot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (vscode.lm as any)?.registerTool !== "function") {
    console.log("[mcp-bridge] vscode.lm.registerTool not available — skipping");
    return;
  }

  // modelscript_flatten
  context.subscriptions.push(
    vscode.lm.registerTool("modelscript_flatten", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ name: string }>,
      ): Promise<vscode.LanguageModelToolResult> {
        const name = options.input.name;
        const result = await client.sendRequest<{ text: string | null; error?: string }>("modelscript/flatten", {
          name,
        });
        if (result.error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${result.error}`)]);
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.text ?? "")]);
      },
    }),
  );

  // modelscript_simulate
  context.subscriptions.push(
    vscode.lm.registerTool("modelscript_simulate", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
          name: string;
          startTime?: number;
          stopTime?: number;
          solver?: string;
          format?: string;
        }>,
      ): Promise<vscode.LanguageModelToolResult> {
        const result = await client.sendRequest<{ text: string | null; error?: string }>(
          "modelscript/simulate",
          options.input,
        );
        if (result.error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${result.error}`)]);
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.text ?? "")]);
      },
    }),
  );

  // modelscript_query
  context.subscriptions.push(
    vscode.lm.registerTool("modelscript_query", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ name: string }>,
      ): Promise<vscode.LanguageModelToolResult> {
        const result = await client.sendRequest<{
          name: string;
          kind: string;
          description: string;
          components: { name: string; type: string; description: string }[];
          childClasses: { name: string; kind: string }[];
        } | null>("modelscript/query", { name: options.input.name });
        if (!result) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Class '${options.input.name}' not found.`),
          ]);
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))]);
      },
    }),
  );

  // modelscript_parse
  context.subscriptions.push(
    vscode.lm.registerTool("modelscript_parse", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ code: string }>,
      ): Promise<vscode.LanguageModelToolResult> {
        const result = await client.sendRequest<{
          classes: { name: string; kind: string }[];
          syntaxErrors: string[];
        }>("modelscript/parse", { code: options.input.code });
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))]);
      },
    }),
  );
}

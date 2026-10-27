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

  if (typeof (vscode.lm as any)?.registerTool !== "function") {
    console.log("[mcp-bridge] vscode.lm.registerTool not available — skipping");
    return;
  }

  // modelscript_flatten
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_flatten", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{
            name: string;
            languageId?: string | undefined;
            uri?: string | undefined;
          }>,
        ): Promise<vscode.LanguageModelToolResult> {
          const name = options.input.name;
          const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
          let result: { text?: string | null | undefined; error?: string | undefined };
          try {
            result = await client.sendRequest<{ text?: string | null | undefined; error?: string | undefined }>(
              "modelscript/executeAction",
              {
                actionId: "flatten",
                languageId: lang,
                inputs: { name },
              },
            );
          } catch {
            result = await client.sendRequest<{ text?: string | null | undefined; error?: string | undefined }>(
              "modelscript/flatten",
              {
                name,
              },
            );
          }
          if (result?.error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${result.error}`)]);
          }
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result?.text ?? "")]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_simulate
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_simulate", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{
            name: string;
            languageId?: string | undefined;
            uri?: string | undefined;
            startTime?: number | undefined;
            stopTime?: number | undefined;
            solver?: string | undefined;
            format?: string | undefined;
          }>,
        ): Promise<vscode.LanguageModelToolResult> {
          const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
          let result: any;
          try {
            result = await client.sendRequest<any>("modelscript/executeAction", {
              actionId: "simulate",
              languageId: lang,
              inputs: options.input,
            });
          } catch {
            result = await client.sendRequest<any>("modelscript/simulate", options.input);
          }
          if (result?.error) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${result.error}`)]);
          }
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(result?.text ?? JSON.stringify(result ?? {})),
          ]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_query
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_query", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{
            name: string;
            languageId?: string | undefined;
            uri?: string | undefined;
          }>,
        ): Promise<vscode.LanguageModelToolResult> {
          const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
          let result: any;
          try {
            result = await client.sendRequest<any>("modelscript/executeAction", {
              actionId: "query",
              languageId: lang,
              inputs: { name: options.input.name },
            });
          } catch {
            result = await client.sendRequest<any>("modelscript/query", { name: options.input.name });
          }
          if (!result || result.error) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(result?.error ?? `Class '${options.input.name}' not found.`),
            ]);
          }
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_parse
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_parse", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{ code: string; languageId?: string | undefined }>,
        ): Promise<vscode.LanguageModelToolResult> {
          const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
          let result: any;
          try {
            result = await client.sendRequest<any>("modelscript/executeAction", {
              actionId: "parse",
              languageId: lang,
              inputs: { code: options.input.code },
            });
          } catch {
            result = await client.sendRequest<any>("modelscript/parse", { code: options.input.code });
          }
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_add_component (not in package.json languageModelTools — register defensively)
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_add_component", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{ className: string; classKind?: string | undefined }>,
        ): Promise<vscode.LanguageModelToolResult> {
          try {
            await vscode.commands.executeCommand(
              "modelscript.addToDiagram",
              options.input.className,
              options.input.classKind,
            );
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`Added ${options.input.className} to the active model.`),
            ]);
          } catch (e) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${e}`)]);
          }
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_simulate_and_plot (not in package.json languageModelTools — register defensively)
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_simulate_and_plot", {
        async invoke(): Promise<vscode.LanguageModelToolResult> {
          try {
            await vscode.commands.executeCommand("modelscript.runSimulation");
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                "Simulation triggered successfully. The results will appear in the simulation panel plot.",
              ),
            ]);
          } catch (e) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${e}`)]);
          }
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // modelscript_closed_loop_synthesize
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("modelscript_closed_loop_synthesize", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
        ): Promise<vscode.LanguageModelToolResult> {
          const result = await client.sendRequest<any>("modelscript/closedLoopSynthesize", options.input);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }

  // tgg_reconcile_slot
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("tgg_reconcile_slot", {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
        ): Promise<vscode.LanguageModelToolResult> {
          const result = await client.sendRequest<any>("modelscript/reconcileConflict", options.input);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
        },
      }),
    );
  } catch {
    /* tool not contributed in package.json */
  }
}

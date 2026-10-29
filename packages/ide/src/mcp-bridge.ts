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

  if (typeof vscode.lm?.registerTool !== "function") {
    console.log("[mcp-bridge] vscode.lm.registerTool not available — skipping");
    return;
  }

  const contributedList = context.extension?.packageJSON?.contributes?.languageModelTools as
    | { name?: string | undefined }[]
    | undefined;
  const contributedTools = Array.isArray(contributedList)
    ? new Set(contributedList.map((t) => t.name).filter((n): n is string => Boolean(n)))
    : null;

  function safeRegisterTool<T>(name: string, tool: vscode.LanguageModelTool<T>): void {
    if (contributedTools && !contributedTools.has(name)) {
      return;
    }
    try {
      context.subscriptions.push(vscode.lm.registerTool(name, tool));
    } catch {
      /* tool not contributed in package.json */
    }
  }

  interface ToolActionResult {
    text?: string | null | undefined;
    error?: string | undefined;
    [key: string]: unknown;
  }

  // modelscript_flatten
  safeRegisterTool("modelscript_flatten", {
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
  });

  // modelscript_simulate
  safeRegisterTool("modelscript_simulate", {
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
      let result: ToolActionResult | null | undefined;
      try {
        result = await client.sendRequest<ToolActionResult>("modelscript/executeAction", {
          actionId: "simulate",
          languageId: lang,
          inputs: options.input,
        });
      } catch {
        result = await client.sendRequest<ToolActionResult>("modelscript/simulate", options.input);
      }
      if (result?.error) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${result.error}`)]);
      }
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result?.text ?? JSON.stringify(result ?? {})),
      ]);
    },
  });

  // modelscript_query
  safeRegisterTool("modelscript_query", {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{
        name: string;
        languageId?: string | undefined;
        uri?: string | undefined;
      }>,
    ): Promise<vscode.LanguageModelToolResult> {
      const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
      let result: ToolActionResult | null | undefined;
      try {
        result = await client.sendRequest<ToolActionResult>("modelscript/executeAction", {
          actionId: "query",
          languageId: lang,
          inputs: { name: options.input.name },
        });
      } catch {
        result = await client.sendRequest<ToolActionResult>("modelscript/query", { name: options.input.name });
      }
      if (!result || result.error) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(result?.error ?? `Class '${options.input.name}' not found.`),
        ]);
      }
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    },
  });

  // modelscript_parse
  safeRegisterTool("modelscript_parse", {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{ code: string; languageId?: string | undefined }>,
    ): Promise<vscode.LanguageModelToolResult> {
      const lang = options.input.languageId || vscode.window.activeTextEditor?.document.languageId || "modelscript";
      let result: unknown;
      try {
        result = await client.sendRequest<unknown>("modelscript/executeAction", {
          actionId: "parse",
          languageId: lang,
          inputs: { code: options.input.code },
        });
      } catch {
        result = await client.sendRequest<unknown>("modelscript/parse", { code: options.input.code });
      }
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
    },
  });

  // modelscript_add_component
  safeRegisterTool("modelscript_add_component", {
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
  });

  // modelscript_simulate_and_plot
  safeRegisterTool("modelscript_simulate_and_plot", {
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
  });

  // modelscript_closed_loop_synthesize
  safeRegisterTool("modelscript_closed_loop_synthesize", {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    ): Promise<vscode.LanguageModelToolResult> {
      const result = await client.sendRequest<unknown>("modelscript/closedLoopSynthesize", options.input);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
    },
  });

  // tgg_reconcile_slot
  safeRegisterTool("tgg_reconcile_slot", {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    ): Promise<vscode.LanguageModelToolResult> {
      const result = await client.sendRequest<unknown>("modelscript/reconcileConflict", options.input);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result ?? {}))]);
    },
  });
}

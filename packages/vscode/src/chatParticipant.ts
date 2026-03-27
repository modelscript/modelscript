// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

const SYSTEM_PROMPT = `You are ModelScript AI, an expert Modelica language assistant integrated into the ModelScript IDE.

You help users with:
- Writing and debugging Modelica models, packages, functions, and connectors
- Understanding the Modelica Standard Library (MSL) components
- Setting up simulations and interpreting results
- Explaining compiler diagnostics and suggesting fixes
- Modelica language concepts: equations vs algorithms, inheritance, modifications, annotations

You have access to the following tools:
- modelscript_flatten: Flatten a Modelica class to its DAE (equation system) form
- modelscript_simulate: Simulate a model and get time-series results
- modelscript_query: Inspect a class's components, equations, and hierarchy
- modelscript_parse: Parse inline Modelica code and check for syntax errors

When referencing Modelica code, use proper syntax. When the user asks about a specific class, use the query tool first to understand it before generating explanations.`;

/**
 * Register the @modelscript chat participant.
 */
export function registerChatParticipant(context: vscode.ExtensionContext): void {
  // Runtime guard — chat API is only available with Copilot on desktop
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (vscode.chat as any)?.createChatParticipant !== "function") {
    console.log("[chat-participant] vscode.chat.createChatParticipant not available — skipping");
    return;
  }

  const participant = vscode.chat.createChatParticipant(
    "modelscript.chat",
    async (request, chatContext, stream, token) => {
      // Collect tool references
      const tools = vscode.lm.tools.filter((t) => t.name.startsWith("modelscript_"));

      // Build messages
      const messages = [vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)];

      // Add conversation history
      for (const turn of chatContext.history) {
        if (turn instanceof vscode.ChatResponseTurn) {
          let text = "";
          for (const part of turn.response) {
            if (part instanceof vscode.ChatResponseMarkdownPart) {
              text += part.value.value;
            }
          }
          if (text) messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        } else if (turn instanceof vscode.ChatRequestTurn) {
          messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        }
      }

      // Add current user message
      messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

      // Select model — prefer our local model, fall back to any available
      const models = await vscode.lm.selectChatModels({ family: "qwen3.5" });
      const model = models[0] ?? (await vscode.lm.selectChatModels())[0];

      if (!model) {
        stream.markdown(
          "No language model available. Please install a language model extension or wait for the local model to load.",
        );
        return;
      }

      try {
        const response = await model.sendRequest(
          messages,
          { tools, justification: "Modelica development assistance" },
          token,
        );

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            stream.markdown(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            // Execute tool call
            const toolResult = await vscode.lm.invokeTool(
              part.name,
              { input: part.input, toolInvocationToken: request.toolInvocationToken },
              token,
            );
            // Feed result back to the model
            stream.markdown(`\n\n**Tool: ${part.name}**\n\`\`\`\n`);
            for (const resultPart of toolResult.content) {
              if (resultPart instanceof vscode.LanguageModelTextPart) {
                stream.markdown(resultPart.value);
              }
            }
            stream.markdown("\n```\n\n");
          }
        }
      } catch (e) {
        if (e instanceof vscode.LanguageModelError) {
          stream.markdown(`Language model error: ${e.message}`);
        } else {
          throw e;
        }
      }
    },
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "images", "icon.png");

  context.subscriptions.push(participant);
}

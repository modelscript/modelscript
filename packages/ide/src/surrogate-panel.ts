// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the surrogate training webview panel lifecycle.
// Sends requests to the LSP server to train neural networks and export ROMs to WebAssembly.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export class SurrogatePanel extends BaseWebviewPanel {
  static currentPanel: SurrogatePanel | undefined;
  static readonly viewType = "modelscript.surrogate";

  public sourceUri?: string | undefined;
  private client?: LanguageClient | undefined;

  private currentSurrogate?:
    | {
        modelId: string;
        wasmC: string;
        emccFlags: string[];
        exportedFunctions: string[];
      }
    | undefined;

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to train a surrogate model.");
      return;
    }

    if (SurrogatePanel.currentPanel) {
      SurrogatePanel.currentPanel.sourceUri = sourceUri;
      SurrogatePanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SurrogatePanel.viewType,
      "Surrogate Editor",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    SurrogatePanel.currentPanel = new SurrogatePanel(panel, extensionUri, client, sourceUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.html = this.getHtmlShell({
      title: "Surrogate Editor",
      scriptName: "surrogate-webview.js",
    });

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "trainSurrogate" && this.client) {
          const uri = this.sourceUri;
          if (!uri) return;

          this._panel.webview.postMessage({
            type: "surrogateTrainingProgress",
            progress: 10,
            message: "Running Design of Experiments...",
          });

          try {
            const result = await this.client.sendRequest<{
              success: boolean;
              metrics?: { trainMSE: number; valMSE: number; r2: number } | undefined;
              wasmC: string;
              emccFlags: string[];
              exportedFunctions: string[];
              error?: string | undefined;
            }>("modelscript/trainSurrogate", {
              uri,
              ...msg.payload,
            });

            if (result.success && result.metrics) {
              this.currentSurrogate = {
                modelId: (uri.split("/").pop() ?? "Surrogate").replace(".mo", ""),
                wasmC: result.wasmC,
                emccFlags: result.emccFlags,
                exportedFunctions: result.exportedFunctions,
              };

              this._panel.webview.postMessage({
                type: "surrogateTrainingComplete",
                metrics: result.metrics,
              });
            } else {
              this._panel.webview.postMessage({
                type: "surrogateTrainingError",
                error: result.error || "Unknown error occurred during training.",
              });
            }
          } catch (e) {
            this._panel.webview.postMessage({
              type: "surrogateTrainingError",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else if (msg.type === "exportSurrogate") {
          if (!this.currentSurrogate) return;
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
          const modelName = this.currentSurrogate.modelId;
          const cUri = vscode.Uri.joinPath(folder, `${modelName}_wasm.c`);
          const buildUri = vscode.Uri.joinPath(folder, `BUILD_WASM.md`);

          try {
            await vscode.workspace.fs.writeFile(cUri, new TextEncoder().encode(this.currentSurrogate.wasmC));

            const buildCmd = `emcc ${modelName}_wasm.c ${this.currentSurrogate.emccFlags.join(" ")} -o ${modelName}.js`;
            await vscode.workspace.fs.writeFile(
              buildUri,
              new TextEncoder().encode(
                [
                  `# WebAssembly Surrogate Build Instructions`,
                  ``,
                  `## Prerequisites`,
                  `- Install [Emscripten](https://emscripten.org/)`,
                  `- Activate the Emscripten environment: \`source emsdk_env.sh\``,
                  ``,
                  `## Build Command`,
                  `\`\`\`bash`,
                  buildCmd,
                  `\`\`\``,
                  ``,
                  `## Output`,
                  `- \`${modelName}.js\` — Emscripten JS glue code`,
                  `- \`${modelName}.wasm\` — WebAssembly binary`,
                  ``,
                  `## Exported Functions`,
                  ...this.currentSurrogate.exportedFunctions.map((f: string) => `- \`${f}\``),
                ].join("\n"),
              ),
            );

            vscode.window.showInformationMessage(`Exported surrogate WASM source to ${modelName}_wasm.c`);
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to export surrogate WASM: ${e}`);
          }
        }
      },
      null,
      this._disposables,
    );
  }

  public override dispose(): void {
    SurrogatePanel.currentPanel = undefined;
    super.dispose();
  }
}

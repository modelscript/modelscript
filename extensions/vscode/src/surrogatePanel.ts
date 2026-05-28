// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the surrogate training webview panel lifecycle.
// Sends requests to the LSP server to train neural networks and export ROMs to WebAssembly.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class SurrogatePanel {
  static currentPanel: SurrogatePanel | undefined;
  static readonly viewType = "modelscript.surrogate";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  public sourceUri?: string;
  private client?: LanguageClient;
  private disposables: vscode.Disposable[] = [];

  private currentSurrogate?: {
    modelId: string;
    wasmC: string;
    emccFlags: string[];
    exportedFunctions: string[];
  };

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to train a surrogate model.");
      return;
    }

    if (SurrogatePanel.currentPanel) {
      SurrogatePanel.currentPanel.sourceUri = sourceUri;
      SurrogatePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
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

    SurrogatePanel.currentPanel = new SurrogatePanel(panel, extensionUri);
    SurrogatePanel.currentPanel.client = client;
    SurrogatePanel.currentPanel.sourceUri = sourceUri;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "trainSurrogate" && this.client) {
          const uri = this.sourceUri;
          if (!uri) return;

          this.panel.webview.postMessage({
            type: "surrogateTrainingProgress",
            progress: 10,
            message: "Running Design of Experiments...",
          });

          try {
            const result = await this.client.sendRequest<{
              success: boolean;
              metrics?: { trainMSE: number; valMSE: number; r2: number };
              wasmC: string;
              emccFlags: string[];
              exportedFunctions: string[];
              error?: string;
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

              this.panel.webview.postMessage({
                type: "surrogateTrainingComplete",
                metrics: result.metrics,
              });
            } else {
              this.panel.webview.postMessage({
                type: "surrogateTrainingError",
                error: result.error || "Unknown error occurred during training.",
              });
            }
          } catch (e) {
            this.panel.webview.postMessage({
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
      this.disposables,
    );
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "surrogateWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Surrogate Editor</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    SurrogatePanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

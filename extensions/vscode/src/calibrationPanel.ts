// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the calibration webview panel lifecycle.
// Sends calibration requests to the LSP server, receives live progress telemetry,
// and supports the "Extend Pattern" for persisting optimized parameters.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface CalibrationProgress {
  iteration: number;
  cost: number;
  parameters: Record<string, number>;
}

export class CalibrationPanel {
  static currentPanel: CalibrationPanel | undefined;
  static readonly viewType = "modelscript.calibration";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  public sourceUri?: string;
  private client?: LanguageClient;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run calibration.");
      return;
    }

    if (CalibrationPanel.currentPanel) {
      CalibrationPanel.currentPanel.sourceUri = sourceUri;
      CalibrationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CalibrationPanel.viewType,
      "Calibration Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    CalibrationPanel.currentPanel = new CalibrationPanel(panel, extensionUri);
    CalibrationPanel.currentPanel.client = client;
    CalibrationPanel.currentPanel.sourceUri = sourceUri;

    // Register progress listener and track its disposal
    const progressDisposable = client.onNotification(
      "modelscript/calibrationProgress",
      (params: CalibrationProgress) => {
        CalibrationPanel.currentPanel?.panel.webview.postMessage({
          type: "calibrationProgress",
          data: params,
        });
      },
    );
    CalibrationPanel.currentPanel.disposables.push(progressDisposable);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "webviewReady") {
          if (this.client && this.sourceUri) {
            this.client
              .sendRequest<{ parameters: string[]; error?: string }>("modelscript/getParameters", {
                uri: this.sourceUri,
              })
              .then((res) => {
                if (res && res.parameters) {
                  this.panel.webview.postMessage({
                    type: "modelParameters",
                    parameters: res.parameters,
                  });
                } else {
                  this.panel.webview.postMessage({
                    type: "modelParameters",
                    parameters: [],
                  });
                }
              })
              .catch((e) => {
                console.error("Failed to fetch parameters:", e);
                this.panel.webview.postMessage({
                  type: "modelParameters",
                  parameters: [],
                });
              });
          } else {
            this.panel.webview.postMessage({
              type: "modelParameters",
              parameters: [],
            });
          }
        } else if (msg.type === "calibrateRequest") {
          try {
            if (!this.client) return;
            const result = await this.client.sendRequest("modelscript/calibrate", {
              uri: this.sourceUri,
              method: msg.payload?.method || "lm",
              maxIterations: msg.payload?.maxIterations || 100,
              tolerance: msg.payload?.tolerance || 1e-8,
              csvData: msg.payload?.csvData,
              timeColumn: msg.payload?.timeColumn,
              columnMapping: msg.payload?.columnMapping,
              parameters: msg.payload?.parameters,
              parameterBounds: msg.payload?.parameterBounds,
            });
            const isDark =
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
            this.panel.webview.postMessage({
              type: "calibrationResult",
              data: result,
              isDark,
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Calibration failed: ${errMsg}`);
            this.panel.webview.postMessage({ type: "calibrationError", error: errMsg });
          }
        } else if (msg.type === "saveResultRequest") {
          this.saveResult(msg.payload);
        } else if (msg.type === "pickFile") {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Select CSV Data",
            filters: { CSV: ["csv", "txt"] },
          });
          if (uris && uris[0]) {
            try {
              const fileData = await vscode.workspace.fs.readFile(uris[0]);
              const csvData = new TextDecoder().decode(fileData);
              this.panel.webview.postMessage({
                type: "filePicked",
                path: uris[0].fsPath,
                csvData,
              });
            } catch (e) {
              vscode.window.showErrorMessage(`Failed to read file: ${e}`);
            }
          }
        }
      },
      null,
      this.disposables,
    );
  }

  private async saveResult(payload: { className: string; optimizedParameters: Record<string, number> }) {
    if (!this.sourceUri) return;

    // Generate a Modelica class that extends the original with optimized parameters
    const date = new Date().toISOString().split("T")[0]?.replace(/-/g, "") ?? "unknown";
    const baseName = payload.className.split(".").pop() ?? payload.className;
    const derivedName = `${baseName}_Optimized_${date}`;

    const modifiers = Object.entries(payload.optimizedParameters)
      .map(([name, value]) => `    ${name} = ${value}`)
      .join(",\n");

    const code = `\nmodel ${derivedName}\n  extends ${payload.className}(\n${modifiers}\n  );\n  annotation(experiment(__ModelScript_CalibrationResult(date = "${date}")));\nend ${derivedName};\n`;

    // Apply as workspace edit at the end of the source file
    const uri = vscode.Uri.parse(this.sourceUri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const lastLine = doc.lineCount;

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(lastLine, 0), code);
    await vscode.workspace.applyEdit(edit);

    // Trigger experiments tree refresh so the new derived class appears
    vscode.commands.executeCommand("modelscript.refreshExperiments");

    vscode.window.showInformationMessage(`Saved calibration result as ${derivedName}`);
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "calibrationWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Calibration Dashboard</title>
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
    CalibrationPanel.currentPanel = undefined;
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

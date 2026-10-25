// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the calibration webview panel lifecycle.
// Sends calibration requests to the LSP server, receives live progress telemetry,
// and supports the "Extend Pattern" for persisting optimized parameters.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

interface CalibrationProgress {
  iteration: number;
  cost: number;
  parameters: Record<string, number>;
}

export class CalibrationPanel extends BaseWebviewPanel {
  static currentPanel: CalibrationPanel | undefined;
  static readonly viewType = "modelscript.calibration";

  public sourceUri?: string | undefined;
  private client?: LanguageClient | undefined;

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a model file to run calibration.");
      return;
    }

    if (CalibrationPanel.currentPanel) {
      CalibrationPanel.currentPanel.sourceUri = sourceUri;
      CalibrationPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
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

    CalibrationPanel.currentPanel = new CalibrationPanel(panel, extensionUri, client, sourceUri);

    // Register progress listener and track its disposal
    const progressDisposable = client.onNotification(
      "modelscript/calibrationProgress",
      (params: CalibrationProgress) => {
        CalibrationPanel.currentPanel?._panel.webview.postMessage({
          type: "calibrationProgress",
          data: params,
        });
      },
    );
    CalibrationPanel.currentPanel._disposables.push(progressDisposable);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.html = this.getHtmlShell({
      title: "Calibration Dashboard",
      scriptName: "calibration-webview.js",
    });

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "webviewReady") {
          if (this.client && this.sourceUri) {
            this.client
              .sendRequest<{ parameters: string[]; error?: string | undefined }>("modelscript/getParameters", {
                uri: this.sourceUri,
              })
              .then((res) => {
                if (res && res.parameters) {
                  this._panel.webview.postMessage({
                    type: "modelParameters",
                    parameters: res.parameters,
                  });
                } else {
                  this._panel.webview.postMessage({
                    type: "modelParameters",
                    parameters: [],
                  });
                }
              })
              .catch((e) => {
                console.error("Failed to fetch parameters:", e);
                this._panel.webview.postMessage({
                  type: "modelParameters",
                  parameters: [],
                });
              });
          } else {
            this._panel.webview.postMessage({
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
            this._panel.webview.postMessage({
              type: "calibrationResult",
              data: result,
              isDark,
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Calibration failed: ${errMsg}`);
            this._panel.webview.postMessage({ type: "calibrationError", error: errMsg });
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
              this._panel.webview.postMessage({
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
      this._disposables,
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

  public override dispose(): void {
    CalibrationPanel.currentPanel = undefined;
    super.dispose();
  }
}

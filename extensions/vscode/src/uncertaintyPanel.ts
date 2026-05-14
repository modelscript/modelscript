// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the uncertainty (Monte Carlo) webview panel lifecycle.
// Sends uncertainty requests to the LSP server and displays results
// in a professional dashboard with per-parameter distribution configuration,
// statistical summary tables, and convergence diagnostics.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { SimulationPanel } from "./simulationPanel";

interface SimulationResult {
  t: number[];
  y: number[][];
  states: string[];
  parameters?: {
    name: string;
    type: "real" | "integer" | "boolean" | "enumeration";
    defaultValue: number;
    min?: number;
    max?: number;
    step: number;
    unit?: string;
  }[];
  experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
  error?: string;
}

export class UncertaintyPanel {
  static currentPanel: UncertaintyPanel | undefined;
  static readonly viewType = "modelscript.uncertainty";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  public sourceUri?: string;
  private client?: LanguageClient;
  private disposables: vscode.Disposable[] = [];

  static async createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run uncertainty analysis.");
      return;
    }

    if (UncertaintyPanel.currentPanel) {
      UncertaintyPanel.currentPanel.sourceUri = sourceUri;
      UncertaintyPanel.currentPanel.client = client;
      UncertaintyPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      // Re-fetch parameters for the (possibly new) source URI
      await UncertaintyPanel.currentPanel.fetchAndSendParameters();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      UncertaintyPanel.viewType,
      "Uncertainty Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    UncertaintyPanel.currentPanel = new UncertaintyPanel(panel, extensionUri);
    UncertaintyPanel.currentPanel.client = client;
    UncertaintyPanel.currentPanel.sourceUri = sourceUri;

    // Fetch parameters from the model and send to the webview
    await UncertaintyPanel.currentPanel.fetchAndSendParameters();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "montecarloRequest") {
          await this.handleMonteCarloRequest(msg.payload);
        }
      },
      null,
      this.disposables,
    );
  }

  /**
   * Fetch model parameters from the LSP and send them to the webview
   * for the distribution configuration form.
   */
  private async fetchAndSendParameters(): Promise<void> {
    if (!this.client || !this.sourceUri) return;
    try {
      const result: SimulationResult = await this.client.sendRequest("modelscript/simulate", {
        uri: this.sourceUri,
        startTime: 0,
        stopTime: 0,
        interval: 1,
      });
      if (result.parameters && result.parameters.length > 0) {
        this.panel.webview.postMessage({
          type: "modelParameters",
          parameters: result.parameters,
        });
      }
    } catch {
      // Ignore — parameters will need to be entered manually
    }
  }

  private async handleMonteCarloRequest(payload: {
    numSamples: number;
    confidenceLevel: number;
    method: string;
    parameters: {
      name: string;
      distribution: string;
      mean?: number;
      stddev?: number;
      lo?: number;
      hi?: number;
    }[];
    startTime?: number;
    stopTime?: number;
    interval?: number;
  }): Promise<void> {
    if (!this.client) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running Monte Carlo (${payload.numSamples} samples)...`,
        cancellable: false,
      },
      async () => {
        try {
          this.panel.webview.postMessage({ type: "montecarloRunning" });

          if (!this.client) return;
          const result = await this.client.sendRequest("modelscript/montecarlo", {
            uri: this.sourceUri,
            numSamples: payload.numSamples,
            confidenceLevel: payload.confidenceLevel,
            method: payload.method,
            parameters: payload.parameters,
            startTime: payload.startTime,
            stopTime: payload.stopTime,
            interval: payload.interval,
          });

          const isDark =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

          this.panel.webview.postMessage({
            type: "montecarloResult",
            data: result,
            isDark,
          });

          // Forward MC results to the SimulationPanel for fan-chart overlay
          const mcData = result as {
            success: boolean;
            numSamples: number;
            statistics: Record<
              string,
              {
                mean: number[];
                stddev: number[];
                ciLo: number[];
                ciHi: number[];
                percentiles: Record<string, number[]>;
              }
            >;
            t: number[];
            convergence: { coeffOfVariation: number; effectiveSampleSize: number };
          };

          if (mcData.success && mcData.t.length > 0) {
            SimulationPanel.postMonteCarloData(mcData, isDark);
          }
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Uncertainty analysis failed: ${errMsg}`);
          this.panel.webview.postMessage({ type: "montecarloError", error: errMsg });
        }
      },
    );
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "uncertaintyWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Uncertainty Dashboard</title>
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
    UncertaintyPanel.currentPanel = undefined;
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

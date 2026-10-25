// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the uncertainty (Monte Carlo) webview panel lifecycle.
// Sends uncertainty requests to the LSP server and displays results
// in a professional dashboard with per-parameter distribution configuration,
// statistical summary tables, and convergence diagnostics.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { SimulationPanel } from "./simulation-panel.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

interface SimulationResult {
  t: number[];
  y: number[][];
  states: string[];
  parameters?:
    | {
        name: string;
        type: "real" | "integer" | "boolean" | "enumeration";
        defaultValue: number;
        min?: number | undefined;
        max?: number | undefined;
        step: number;
        unit?: string | undefined;
      }[]
    | undefined;
  experiment?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  error?: string | undefined;
}

export class UncertaintyPanel extends BaseWebviewPanel {
  static currentPanel: UncertaintyPanel | undefined;
  static readonly viewType = "modelscript.uncertainty";

  public sourceUri?: string | undefined;
  private client?: LanguageClient | undefined;

  static async createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run uncertainty analysis.");
      return;
    }

    if (UncertaintyPanel.currentPanel) {
      UncertaintyPanel.currentPanel.sourceUri = sourceUri;
      UncertaintyPanel.currentPanel.client = client;
      UncertaintyPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
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

    UncertaintyPanel.currentPanel = new UncertaintyPanel(panel, extensionUri, client, sourceUri);

    // Fetch parameters from the model and send to the webview
    await UncertaintyPanel.currentPanel.fetchAndSendParameters();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.html = this.getHtmlShell({
      title: "Uncertainty Dashboard",
      scriptName: "uncertainty-webview.js",
    });

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "montecarloRequest") {
          await this.handleMonteCarloRequest(msg.payload);
        }
      },
      null,
      this._disposables,
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
      });

      if (result && result.parameters && result.parameters.length > 0) {
        this._panel.webview.postMessage({
          type: "modelParameters",
          parameters: result.parameters,
        });
      }
    } catch {
      // Non-fatal: user can still enter parameter names manually
    }
  }

  private async handleMonteCarloRequest(payload: {
    samples: number;
    distributions: Record<string, { type: string; mean: number; stdDev: number; min: number; max: number }>;
    seed?: number;
    parallel?: boolean;
    sysmlUri?: string;
    sysmlFilter?: string;
    constraintsUri?: string;
    constraintsFilter?: string;
  }) {
    if (!this.client || !this.sourceUri) return;

    const sourceUri = this.sourceUri;

    // Use withProgress to show a notification in VS Code
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running Monte Carlo (${payload.samples} samples)...`,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ increment: 10, message: "Sampling distributions..." });

          const constraintsUri = payload.constraintsUri ?? payload.sysmlUri;
          const constraintsFilter = payload.constraintsFilter ?? payload.sysmlFilter;

          const result = await this.client!.sendRequest("modelscript/montecarlo", {
            uri: sourceUri,
            samples: payload.samples,
            distributions: payload.distributions,
            seed: payload.seed,
            parallel: payload.parallel ?? true,
            constraintsUri,
            constraintsFilter,
            sysmlUri: constraintsUri,
            sysmlFilter: constraintsFilter,
          });

          progress.report({ increment: 80, message: "Computing statistics..." });

          const isDark =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

          this._panel.webview.postMessage({
            type: "montecarloResult",
            data: result,
            isDark,
          });

          // If SimulationPanel is open, update its trajectory chart with the MC envelope
          const simPanel = SimulationPanel.currentPanel;
          if (simPanel && (result as { runs?: unknown[] }).runs) {
            (simPanel as any).postResults?.(result as any);
          }

          progress.report({ increment: 10, message: "Done" });
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Monte Carlo simulation failed: ${errMsg}`);
          this._panel.webview.postMessage({ type: "montecarloError", error: errMsg });
        }
      },
    );
  }

  public override dispose(): void {
    UncertaintyPanel.currentPanel = undefined;
    super.dispose();
  }
}

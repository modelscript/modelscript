// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export interface ReplaySignalPoint {
  time: number;
  value: number;
}

export interface ReplayTraceData {
  id: string;
  source: "bmc" | "ic3" | "falsification" | "flowpipe_escape";
  status: "FALSIFIED" | "UNSAT" | "CERTIFIED_SAFE";
  times: number[];
  continuousSignals: Record<string, number[]>;
  discreteSignals?: Record<string, (string | number | boolean)[]> | undefined;
  violatingTimeIndex?: number | undefined;
  violatingProperty?: string | undefined;
  parameters?: Record<string, number> | undefined;
  nominalSignals?: Record<string, number[]> | undefined;
  divergenceTime?: number | undefined;
  divergingVariable?: string | undefined;
}

export class TraceReplayPanel extends BaseWebviewPanel {
  public static currentPanel: TraceReplayPanel | undefined;
  public static readonly viewType = "modelscript.traceReplay";

  private readonly _client?: LanguageClient | undefined;
  private _currentTrace?: ReplayTraceData | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, trace?: ReplayTraceData): void {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (TraceReplayPanel.currentPanel) {
      TraceReplayPanel.currentPanel._panel.reveal(column);
      if (trace) {
        TraceReplayPanel.currentPanel.loadTrace(trace);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TraceReplayPanel.viewType,
      "Formal Trace & Counterexample Replayer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    TraceReplayPanel.currentPanel = new TraceReplayPanel(panel, extensionUri, client, trace);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    initialTrace?: ReplayTraceData,
  ) {
    super(panel, extensionUri);
    this._client = client;
    this._currentTrace = initialTrace ?? this._getSampleTrace();

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "ready":
            this._sendTraceToWebview();
            break;

          case "requestDiff": {
            if (this._client && this._currentTrace) {
              try {
                const diffResult = await this._client.sendRequest<any>("modelscript/getCounterexampleDiff", {
                  counterexample: this._currentTrace,
                });
                if (diffResult?.success) {
                  this._panel.webview.postMessage({
                    type: "diffData",
                    divergenceTime: diffResult.divergenceTime,
                    divergingVariable: diffResult.divergingVariable,
                    diffSignals: diffResult.diffSignals,
                    nominalSignals: diffResult.syncedNom?.continuousSignals,
                  });
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Failed to calculate trace diff: ${e}`);
              }
            }
            break;
          }

          case "openTraceFile": {
            const files = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: "Load Trace File",
              filters: { "Simulation Traces": ["json", "csv"] },
            });
            if (files && files[0]) {
              try {
                const raw = await vscode.workspace.fs.readFile(files[0]);
                const text = new TextDecoder().decode(raw);
                if (files[0].path.endsWith(".json")) {
                  const parsed = JSON.parse(text);
                  this.loadTrace(parsed);
                } else {
                  const lines = text.trim().split(/\r?\n/);
                  const headers = lines[0]!.split(",").map((h) => h.trim());
                  const times: number[] = [];
                  const signals: Record<string, number[]> = {};
                  headers.slice(1).forEach((h) => (signals[h] = []));
                  for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i]!.split(",").map((p) => parseFloat(p.trim()));
                    times.push(parts[0] ?? 0);
                    headers.slice(1).forEach((h, idx) => {
                      signals[h]?.push(parts[idx + 1] ?? 0);
                    });
                  }
                  this.loadTrace({
                    id: files[0].path.split("/").pop() ?? "custom-trace",
                    source: "falsification",
                    status: "FALSIFIED",
                    times,
                    continuousSignals: signals,
                  });
                }
                vscode.window.showInformationMessage(`Loaded trace file: ${files[0].fsPath || files[0].path}`);
              } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to parse trace file: ${e?.message || e}`);
              }
            }
            break;
          }

          case "tokenStep": {
            // Scrubbing token position - navigate editor if target source position available
            if (msg.uri) {
              const docUri = vscode.Uri.parse(msg.uri);
              const doc = await vscode.workspace.openTextDocument(docUri);
              const line = Math.max(0, (msg.line || 1) - 1);
              const col = Math.max(0, (msg.column || 1) - 1);
              const pos = new vscode.Position(line, col);
              vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(pos, pos),
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
              });
            }
            break;
          }

          case "exportVcd": {
            const vcdText = this._generateVcd(this._currentTrace);
            const doc = await vscode.workspace.openTextDocument({
              content: vcdText,
              language: "vcd",
            });
            vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage("Generated IEEE 1364 VCD Waveform dump.");
            break;
          }

          case "exportCsv": {
            const csvText = this._generateCsv(this._currentTrace);
            const doc = await vscode.workspace.openTextDocument({
              content: csvText,
              language: "csv",
            });
            vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage("Exported trace CSV.");
            break;
          }
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell({
      scriptName: "trace-replay-webview.js",
      title: "Formal Trace & Counterexample Replayer",
    });
  }

  public loadTrace(trace: ReplayTraceData): void {
    this._currentTrace = trace;
    this._sendTraceToWebview();
  }

  private _sendTraceToWebview(): void {
    if (this._currentTrace) {
      this._panel.webview.postMessage({
        type: "loadTrace",
        trace: this._currentTrace,
        isSampleTrace: this._currentTrace.id === "trace-cex-overspeed-01",
      });
    }
  }

  private _getSampleTrace(): ReplayTraceData {
    const times: number[] = [];
    const speedCex: number[] = [];
    const speedNom: number[] = [];
    const pressureCex: number[] = [];
    const pressureNom: number[] = [];
    const modeState: string[] = [];

    const numPoints = 80;
    const dt = 0.05;

    for (let i = 0; i < numPoints; i++) {
      const t = Number((i * dt).toFixed(2));
      times.push(t);

      // Nominal speed accelerates then caps safely at 45 m/s
      const nomSpd = 10 + 35 * (1 - Math.exp(-t / 1.5));
      speedNom.push(Number(nomSpd.toFixed(2)));

      // Violating speed runaway past t = 2.1s
      let cexSpd = nomSpd;
      if (t >= 1.8) {
        cexSpd = nomSpd + 20 * Math.pow(t - 1.8, 1.4);
      }
      speedCex.push(Number(cexSpd.toFixed(2)));

      // Pressure signal
      const nomP = 1.0 + 0.3 * Math.sin(t * 2);
      pressureNom.push(Number(nomP.toFixed(2)));
      pressureCex.push(Number((nomP + (t >= 2.0 ? 0.6 : 0)).toFixed(2)));

      // State mode
      if (t < 1.0) {
        modeState.push("STARTUP");
      } else if (t < 2.2) {
        modeState.push("ACCELERATING");
      } else {
        modeState.push(cexSpd > 60 ? "OVERSPEED_TRIP" : "CRUISE");
      }
    }

    return {
      id: "trace-cex-overspeed-01",
      source: "falsification",
      status: "FALSIFIED",
      times,
      continuousSignals: {
        speed: speedCex,
        pressure: pressureCex,
      },
      nominalSignals: {
        speed: speedNom,
        pressure: pressureNom,
      },
      discreteSignals: {
        mode: modeState,
      },
      violatingTimeIndex: 44, // t = 2.20s
      violatingProperty: "MaxSpeedLimit (speed <= 60.0 m/s)",
      divergenceTime: 1.8,
      divergingVariable: "speed",
      parameters: { kp: 1.85, mass: 1250, dragCoeff: 0.28 },
    };
  }

  private _generateVcd(trace?: ReplayTraceData): string {
    if (!trace) return "";
    const lines: string[] = [];
    lines.push("$date\n  " + new Date().toISOString() + "\n$end");
    lines.push("$version\n  ModelScript Formal Verification VCD Generator\n$end");
    lines.push("$timescale 1us $end");
    lines.push("$scope module Counterexample $end");

    const varKeys = Object.keys(trace.continuousSignals);
    varKeys.forEach((key, idx) => {
      const id = String.fromCharCode(33 + idx);
      lines.push(`$var real 64 ${id} ${key} $end`);
    });
    lines.push("$upscope $end");
    lines.push("$enddefinitions $end");
    lines.push("$dumpvars");

    trace.times.forEach((t, tIdx) => {
      lines.push(`#${Math.round(t * 1e6)}`);
      varKeys.forEach((key, kIdx) => {
        const id = String.fromCharCode(33 + kIdx);
        const val = trace.continuousSignals[key]?.[tIdx] ?? 0;
        lines.push(`r${val} ${id}`);
      });
    });

    return lines.join("\n");
  }

  private _generateCsv(trace?: ReplayTraceData): string {
    if (!trace) return "";
    const contKeys = Object.keys(trace.continuousSignals);
    const discKeys = trace.discreteSignals ? Object.keys(trace.discreteSignals) : [];
    const headers = ["time", ...contKeys, ...discKeys];

    const rows = [headers.join(",")];
    for (let i = 0; i < trace.times.length; i++) {
      const row: (string | number | boolean)[] = [trace.times[i]!];
      for (const k of contKeys) row.push(trace.continuousSignals[k]?.[i] ?? "");
      for (const k of discKeys) row.push(trace.discreteSignals?.[k]?.[i] ?? "");
      rows.push(row.join(","));
    }
    return rows.join("\n");
  }

  public override dispose(): void {
    TraceReplayPanel.currentPanel = undefined;
    super.dispose();
  }
}

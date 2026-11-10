// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ISO 23952 / ANSI DMSC QIF (Quality Information Framework) Visual Custom Editor Provider.
 *
 * Provides a comprehensive Model-Based Enterprise (MBE) & Dimensional Metrology Workbench:
 *   1. 3D-Projected MBD Callout & CMM Deviation Heatmap with ASME Y14.5 Feature Control Frames.
 *   2. Statistical Process Control (SPC) Capability Studio (Cp, Cpk, Pp, Ppk, TUR & Bonus Tolerance).
 *   3. Interactive Bill of Characteristics (BoC) & CMM Inspection Actuals Table.
 *   4. Live synchronization with the 3D CAD Viewer (CadViewerPanel.sendQifInspectionOverlay).
 *   5. One-click projections to SysML v2 and Modelica 3.x As-Manufactured Digital Twins.
 */

import {
  renderQifMbdHeatmapSvg,
  renderQifSpcChartSvg,
  type QifSpcSummaryLike,
} from "@modelscript/diagram/qif-diagram-builder";
import {
  evaluateQifSpc,
  lintQifDocument,
  parseQif,
  qifToModelica,
  qifToSysML2,
  type QifDiagnostic,
  type QifDocument,
  type QifSpcSummary,
} from "@modelscript/qif";
import * as vscode from "vscode";
import { CadViewerPanel } from "./cad-viewer-panel.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class QifEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.qifEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const doc: QifDocument = parseQif(text, document.uri.toString());
        const diagnostics: QifDiagnostic[] = lintQifDocument(doc);
        const spc: QifSpcSummary = evaluateQifSpc(doc);

        const spcSummaryLike: QifSpcSummaryLike = {
          overallPassRate: spc.overallPassRate,
          minCpk: spc.characteristics.length > 0 ? Math.min(...spc.characteristics.map((c) => c.cpk)) : 0,
          metrics: spc.characteristics.map((c) => ({
            characteristicId: c.characteristicId,
            characteristicName: c.characteristicName,
            nominalValue: (c.lsl + c.usl) / 2,
            toleranceZone: c.baseTolerance,
            effectiveTolerance: c.effectiveTolerance,
            bonusTolerance: c.meanBonusTolerance,
            mean: c.mean,
            stdDev: c.stdDev,
            cp: c.cp,
            cpk: c.cpk,
            tur: c.tur,
            passRate: c.passRate,
            sampleCount: c.sampleCount,
          })),
        };

        const heatmapSvg: string = renderQifMbdHeatmapSvg(doc, spcSummaryLike);
        const spcChartSvg: string = renderQifSpcChartSvg(spcSummaryLike);
        const sysml2Code: string = qifToSysML2(doc);
        const modelicaCode: string = qifToModelica(doc);

        if (CadViewerPanel.currentPanel) {
          CadViewerPanel.currentPanel.sendQifInspectionOverlay({
            qpId: doc.qpId,
            features: doc.features,
            characteristics: doc.characteristics,
            actuals: doc.actuals,
            spc: spcSummaryLike,
          });
        }

        webviewPanel.webview.postMessage({
          type: "update",
          qpId: doc.qpId,
          version: doc.version,
          featureCount: doc.features.length,
          charCount: doc.characteristics.length,
          actualCount: doc.actuals.length,
          overallPassRate: spc.overallPassRate,
          heatmapSvg,
          spcChartSvg,
          diagnostics,
          spc,
          sysml2Code,
          modelicaCode,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse QIF model: ${message}`,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;
        case "exportSysml2": {
          try {
            const doc = parseQif(document.getText());
            const sysml = qifToSysML2(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SysML v2 Files": ["sysml"] },
              defaultUri: vscode.Uri.file("qif-metrology.sysml"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(sysml, "utf8"));
              void vscode.window.showInformationMessage(`Exported SysML v2 to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export SysML v2: ${String(err)}`);
          }
          break;
        }
        case "exportModelica": {
          try {
            const doc = parseQif(document.getText());
            const mo = qifToModelica(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "Modelica Files": ["mo"] },
              defaultUri: vscode.Uri.file("AsManufacturedPart.mo"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(mo, "utf8"));
              void vscode.window.showInformationMessage(`Exported Modelica to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export Modelica: ${String(err)}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src 'self' data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIST QIF Metrology &amp; MBD Workbench</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #151d2f;
      --border: #23314d;
      --accent: #38bdf8;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; padding: 16px; height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--card); border: 1px solid var(--border); color: var(--accent); margin-left: 8px; }
    .tabs { display: flex; gap: 6px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    .tab { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--muted); background: transparent; border: none; cursor: pointer; }
    .tab.active { color: #fff; background: var(--card); border: 1px solid var(--border); border-bottom: 2px solid var(--accent); }
    .panel { display: none; flex: 1; overflow: auto; }
    .panel.active { display: flex; flex-direction: column; gap: 12px; }
    .svg-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; overflow: auto; display: flex; align-items: center; justify-content: center; }
    .code-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; padding: 14px; font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow: auto; color: #e2e8f0; }
    button.action-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong>ISO 23952 QIF Metrology Inspector</strong>
      <span id="versionBadge" class="badge">QIF 3.0</span>
      <span id="passRateBadge" class="badge">Pass Rate: 100%</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportSysml2">Export SysML v2</button>
      <button class="action-btn" id="btnExportModelica">Export Modelica Twin</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="heatmap">3D MBD Callout &amp; CMM Heatmap</button>
    <button class="tab" data-tab="spc">SPC Capability (Cp / Cpk &amp; TUR)</button>
    <button class="tab" data-tab="boc">Bill of Characteristics &amp; Monte Carlo</button>
    <button class="tab" data-tab="projections">SysML v2 &amp; Modelica Twin</button>
  </div>
  <div id="tab-heatmap" class="panel active"><div id="heatmapBox" class="svg-box"></div></div>
  <div id="tab-spc" class="panel"><div id="spcBox" class="svg-box"></div></div>
  <div id="tab-boc" class="panel"><div id="bocBox" class="code-box"></div></div>
  <div id="tab-projections" class="panel"><div id="projectionsBox" class="code-box"></div></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
    document.getElementById('btnExportSysml2').addEventListener('click', () => vscode.postMessage({ type: 'exportSysml2' }));
    document.getElementById('btnExportModelica').addEventListener('click', () => vscode.postMessage({ type: 'exportModelica' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('versionBadge').textContent = 'QIF ' + msg.version;
        document.getElementById('passRateBadge').textContent = 'Pass Rate: ' + (msg.overallPassRate * 100).toFixed(1) + '%';
        document.getElementById('heatmapBox').innerHTML = msg.heatmapSvg;
        document.getElementById('spcBox').innerHTML = msg.spcChartSvg;
        document.getElementById('bocBox').textContent = JSON.stringify(msg.spc, null, 2);
        document.getElementById('projectionsBox').textContent = '// --- SysML v2 ---\\n' + msg.sysml2Code + '\\n\\n// --- Modelica 3.x As-Manufactured Twin ---\\n' + msg.modelicaCode;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 62714 AutomationML / CAEX Visual Custom Editor Provider.
 *
 * Provides an interactive Smart Manufacturing & Virtual Commissioning workbench:
 *   1. Plant Topology & PPR (Product-Process-Resource) Schematic with directed ports & InternalLinks.
 *   2. 3D Workcell 6-DOF Spatial Frame & Kinematic Hierarchy Viewer.
 *   3. Closed-Loop Virtual Commissioning Runner (VirtualPlc + Mechatronic Plant DAE).
 *   4. IEC 62714 Semantic Compliance Diagnostics (M8301–M8307).
 *   5. One-click projections to SSP (.ssd), SysML v2, and Modelica 3.x.
 */

import {
  amlToModelica,
  amlToSsp,
  amlToSysML2,
  lintAutomationML,
  parseAutomationML,
  runAmlVirtualCommissioning,
  type AmlDiagnostic,
  type AmlDocument,
  type AmlVirtualCommissioningResult,
} from "@modelscript/automationml";
import { renderAmlTopologySvg, renderAmlWorkcell3dSvg } from "@modelscript/diagram/aml-diagram-builder";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class AmlEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.amlEditor";

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
        const doc: AmlDocument = parseAutomationML(text, document.uri.toString());
        const diagnostics: AmlDiagnostic[] = lintAutomationML(doc);
        const sim: AmlVirtualCommissioningResult = runAmlVirtualCommissioning(doc, { cycles: 15, dtMs: 10 });
        const topologySvg: string = renderAmlTopologySvg(doc, {
          cycles: sim.cycles,
          dtMs: sim.dtMs,
          activeSignals: sim.finalSignals,
          interlocksOk: sim.interlockHealthy,
        });
        const workcell3dSvg: string = renderAmlWorkcell3dSvg(doc);
        const sspXml: string = amlToSsp(doc);
        const sysml2Code: string = amlToSysML2(doc);
        const modelicaCode: string = amlToModelica(doc);

        webviewPanel.webview.postMessage({
          type: "update",
          fileName: doc.fileName || "AutomationML Plant",
          schemaVersion: doc.schemaVersion,
          hierarchyCount: doc.instanceHierarchies.length,
          sucCount: doc.systemUnitClassLibs.length,
          roleLibCount: doc.roleClassLibs.length,
          ifaceLibCount: doc.interfaceClassLibs.length,
          topologySvg,
          workcell3dSvg,
          diagnostics,
          sim,
          sspXml,
          sysml2Code,
          modelicaCode,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse AutomationML model: ${message}`,
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
        case "exportSsp": {
          try {
            const doc = parseAutomationML(document.getText());
            const ssd = amlToSsp(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SSP System Structure (.ssd)": ["ssd", "xml"] },
              defaultUri: vscode.Uri.file("SystemStructure.ssd"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(ssd, "utf8"));
              void vscode.window.showInformationMessage(`Exported SSP to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export SSP: ${String(err)}`);
          }
          break;
        }
        case "exportSysml2": {
          try {
            const doc = parseAutomationML(document.getText());
            const sysml = amlToSysML2(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SysML v2 Files": ["sysml"] },
              defaultUri: vscode.Uri.file("workcell.sysml"),
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
  <title>AutomationML Smart Manufacturing Workbench</title>
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
      <strong id="fileName">AutomationML Plant</strong>
      <span id="caexBadge" class="badge">CAEX 3.0</span>
      <span id="interlockBadge" class="badge">INTERLOCKS OK</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportSsp">Export SSP (.ssd)</button>
      <button class="action-btn" id="btnExportSysml2">Export SysML v2</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="topology">PPR Plant Topology</button>
    <button class="tab" data-tab="workcell3d">3D Workcell Kinematics</button>
    <button class="tab" data-tab="commissioning">Virtual Commissioning</button>
    <button class="tab" data-tab="projections">SSP / SysML v2 / Modelica</button>
  </div>
  <div id="tab-topology" class="panel active"><div id="topologyBox" class="svg-box"></div></div>
  <div id="tab-workcell3d" class="panel"><div id="workcell3dBox" class="svg-box"></div></div>
  <div id="tab-commissioning" class="panel"><div id="commissioningBox" class="code-box"></div></div>
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
    document.getElementById('btnExportSsp').addEventListener('click', () => vscode.postMessage({ type: 'exportSsp' }));
    document.getElementById('btnExportSysml2').addEventListener('click', () => vscode.postMessage({ type: 'exportSysml2' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('fileName').textContent = msg.fileName;
        document.getElementById('caexBadge').textContent = 'CAEX ' + msg.schemaVersion;
        document.getElementById('interlockBadge').textContent = msg.sim.interlockStatus;
        document.getElementById('topologyBox').innerHTML = msg.topologySvg;
        document.getElementById('workcell3dBox').innerHTML = msg.workcell3dSvg;
        document.getElementById('commissioningBox').textContent = JSON.stringify(msg.sim, null, 2);
        document.getElementById('projectionsBox').textContent = '// --- SysML v2 ---\\n' + msg.sysml2Code + '\\n\\n// --- Modelica 3.x ---\\n' + msg.modelicaCode;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NIST OSCAL (Open Security Controls Assessment Language) Visual Custom Editor Provider.
 *
 * Provides an interactive Continuous Authority to Operate (cATO) & CPS Security Workbench:
 *   1. Authorization Boundary & NIST SP 800-82 Cyber-Physical Security Zones Schematic.
 *   2. NIST SP 800-53 Rev 5 Control Family Implementation & POA&M Risk Posture Heatmap.
 *   3. Live Profile Resolution & Parameter Substitution Inspector.
 *   4. Cyber-Physical Architecture Coverage Audit & M8201–M8208 Diagnostics.
 *   5. Projections to SysML v2 Security Requirements and OMG ReqIF.
 */

import { renderOscalBoundarySvg, renderOscalControlMatrixSvg } from "@modelscript/diagram/oscal-diagram-builder";
import {
  auditCpsArchitectureCompliance,
  lintOscalDocument,
  oscalToReqif,
  oscalToSysML2,
  parseOscal,
  resolveOscalProfile,
  type OscalDiagnostic,
  type OscalDocument,
} from "@modelscript/oscal";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class OscalEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.oscalEditor";

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
        const doc: OscalDocument = parseOscal(text, document.uri.toString());
        const diagnostics: OscalDiagnostic[] = lintOscalDocument(doc);
        const resolved = resolveOscalProfile(doc);
        const components = doc.systemImplementation?.components ?? doc.components ?? [];
        const implementedRequirements = doc.controlImplementation?.implementedRequirements ?? [];
        const archComponents = components.map((c) => ({
          name: c.title,
          kind: c.type,
          isSafetyCritical: c.type === "plc" || c.type === "ied" || c.type === "ot-controller",
        }));
        const cpsAudit = auditCpsArchitectureCompliance(doc, archComponents);

        const boundarySvg: string = renderOscalBoundarySvg({
          kind: doc.kind,
          uuid: doc.uuid,
          title: doc.metadata.title,
          systemName: doc.systemCharacteristics?.systemName,
          securitySensitivityLevel: doc.systemCharacteristics?.securitySensitivityLevel,
          components,
          implementedRequirements,
          findings: doc.findings,
          poamItems: doc.poamItems,
        });
        const matrixSvg: string = renderOscalControlMatrixSvg({
          kind: doc.kind,
          uuid: doc.uuid,
          title: doc.metadata.title,
          components,
          implementedRequirements,
          findings: doc.findings,
          poamItems: doc.poamItems,
        });
        const sysml2Code: string = oscalToSysML2(doc);
        const reqifXml: string = oscalToReqif(doc);

        webviewPanel.webview.postMessage({
          type: "update",
          title: doc.metadata.title,
          kind: doc.kind,
          oscalVersion: doc.metadata.oscalVersion,
          boundarySvg,
          matrixSvg,
          diagnostics,
          resolved,
          cpsAudit,
          sysml2Code,
          reqifXml,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse OSCAL model: ${message}`,
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
            const doc = parseOscal(document.getText());
            const sysml = oscalToSysML2(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SysML v2 Files": ["sysml"] },
              defaultUri: vscode.Uri.file("security-controls.sysml"),
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
        case "exportReqif": {
          try {
            const doc = parseOscal(document.getText());
            const reqif = oscalToReqif(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "ReqIF Files": ["reqif", "xml"] },
              defaultUri: vscode.Uri.file("security-controls.reqif"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(reqif, "utf8"));
              void vscode.window.showInformationMessage(`Exported ReqIF to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export ReqIF: ${String(err)}`);
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
  <title>NIST OSCAL Continuous ATO Workbench</title>
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
      <strong id="docTitle">NIST OSCAL Model</strong>
      <span id="kindBadge" class="badge">SSP</span>
      <span id="verBadge" class="badge">OSCAL 1.1.2</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportSysml2">Export SysML v2</button>
      <button class="action-btn" id="btnExportReqif">Export ReqIF</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="boundary">Authorization Boundary &amp; Zones</button>
    <button class="tab" data-tab="matrix">SP 800-53 Family Matrix</button>
    <button class="tab" data-tab="resolved">Resolved Profile &amp; CPS Audit</button>
    <button class="tab" data-tab="projections">SysML v2 &amp; ReqIF</button>
  </div>
  <div id="tab-boundary" class="panel active"><div id="boundaryBox" class="svg-box"></div></div>
  <div id="tab-matrix" class="panel"><div id="matrixBox" class="svg-box"></div></div>
  <div id="tab-resolved" class="panel"><div id="resolvedBox" class="code-box"></div></div>
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
    document.getElementById('btnExportReqif').addEventListener('click', () => vscode.postMessage({ type: 'exportReqif' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('docTitle').textContent = msg.title;
        document.getElementById('kindBadge').textContent = msg.kind.toUpperCase();
        document.getElementById('verBadge').textContent = 'OSCAL ' + msg.oscalVersion;
        document.getElementById('boundaryBox').innerHTML = msg.boundarySvg;
        document.getElementById('matrixBox').innerHTML = msg.matrixSvg;
        document.getElementById('resolvedBox').textContent = JSON.stringify({ cpsAudit: msg.cpsAudit, resolvedControls: msg.resolved.controls }, null, 2);
        document.getElementById('projectionsBox').textContent = msg.sysml2Code;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

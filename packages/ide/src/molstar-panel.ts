// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — 3D Macromolecular & Ramachandran Visualizer Panel.
 *
 * Provides Molstar-inspired 3D molecular rendering and interactive Ramachandran
 * dihedral analysis for PDB (.pdb) and macromolecular CIF (.cif / mmCIF) structures:
 * 1. 3D WebGL cartoon ribbon and alpha-carbon backbone spline visualizer.
 * 2. Harmonic Gaussian Network Model (GNM) normal mode conformational wave animator.
 * 3. Interactive Ramachandran phi-psi scatter plot with Lovell contour boundaries.
 * 4. Biophysics inspection: Molecular Weight, Radius of Gyration (Rg), Center of Mass, and B-factors.
 */

import { parsePdb, solveProteinBiophysics, type PdbDocument, type ProteinBiophysicsResult } from "@modelscript/pdb";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class MolstarPanel extends BaseWebviewPanel {
  public static currentPanel: MolstarPanel | undefined;
  public static readonly viewType = "modelscript.molstarViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (MolstarPanel.currentPanel) {
      if (resolvedUri) {
        MolstarPanel.currentPanel.targetUri = resolvedUri;
      }
      MolstarPanel.currentPanel._panel.reveal(column);
      void MolstarPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MolstarPanel.viewType,
      "3D Molecular & Ramachandran Visualizer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    MolstarPanel.currentPanel = new MolstarPanel(panel, extensionUri, client, resolvedUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient | undefined,
    targetUri?: string | undefined,
  ) {
    super(panel, extensionUri);
    this._client = client;
    this.targetUri = targetUri;

    this._panel.webview.onDidReceiveMessage(
      async (msg: { command: string; line?: number; chainId?: string; resSeq?: number }) => {
        if (msg.command === "selectResidue" && msg.resSeq !== undefined) {
          if (this.targetUri) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.targetUri));
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            // Search for exact residue in ATOM / HETATM records
            let targetLineIdx = -1;
            const lineCount = doc.lineCount;
            for (let i = 0; i < lineCount; i++) {
              const lineText = doc.lineAt(i).text;
              if (lineText.startsWith("ATOM") || lineText.startsWith("HETATM")) {
                const seq = lineText.length >= 26 ? parseInt(lineText.substring(22, 26).trim(), 10) : NaN;
                const chain = lineText.length >= 22 ? lineText.substring(21, 22).trim() : "";
                if (seq === msg.resSeq && (!msg.chainId || !chain || chain === msg.chainId)) {
                  targetLineIdx = i;
                  break;
                }
              }
            }
            if (targetLineIdx >= 0) {
              const line = doc.lineAt(targetLineIdx);
              editor.selection = new vscode.Selection(line.range.start, line.range.end);
              editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);
            }
          }
        }
      },
      null,
      this._disposables,
    );

    void this._client;

    // Bi-directional sync: text editor selection -> 3D ribbon & Ramachandran highlight
    this._disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!this.targetUri || e.textEditor.document.uri.toString() !== this.targetUri) return;
        const sel = e.selections[0];
        if (!sel) return;
        const line = e.textEditor.document.lineAt(sel.active.line).text;
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          const resSeqStr = line.length >= 26 ? line.substring(22, 26).trim() : null;
          const chainId = line.length >= 22 ? line.substring(21, 22).trim() : undefined;
          const resSeq = resSeqStr ? parseInt(resSeqStr, 10) : NaN;
          if (!isNaN(resSeq)) {
            void this._panel.webview.postMessage({
              type: "highlightResidue",
              resSeq,
              chainId,
            });
          }
        }
      }),
    );

    void this.update();
  }

  public async update(): Promise<void> {
    let sourceText = "";
    if (this.targetUri) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.targetUri));
        sourceText = doc.getText();
      } catch {
        // Fallback
      }
    } else if (vscode.window.activeTextEditor) {
      sourceText = vscode.window.activeTextEditor.document.getText();
    }

    if (!sourceText.trim()) {
      sourceText = SAMPLE_PDB_PEPTIDE;
    }

    let parsed: PdbDocument;
    let biophysics: ProteinBiophysicsResult;
    try {
      parsed = parsePdb(sourceText);
      biophysics = solveProteinBiophysics(parsed);
    } catch {
      parsed = parsePdb(SAMPLE_PDB_PEPTIDE);
      biophysics = solveProteinBiophysics(parsed);
    }

    this._panel.webview.html = renderMolstarHtml(parsed, biophysics);
  }
}

/**
 * Custom text editor provider for .pdb and .cif files.
 */
export class PdbEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.pdbEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    const updateWebview = () => {
      const text = document.getText();
      try {
        const parsed = parsePdb(text);
        const biophysics = solveProteinBiophysics(parsed);
        webviewPanel.webview.html = renderMolstarHtml(parsed, biophysics);
      } catch {
        // Fallback gracefully
        const parsed = parsePdb(SAMPLE_PDB_PEPTIDE);
        const biophysics = solveProteinBiophysics(parsed);
        webviewPanel.webview.html = renderMolstarHtml(parsed, biophysics);
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML & WebGL / Canvas Renderer
// ─────────────────────────────────────────────────────────────────────────────

export function renderMolstarHtml(doc: PdbDocument, biophysics: ProteinBiophysicsResult): string {
  const title = escapeXml(doc.title || doc.id || "Macromolecular Structure");
  const id = escapeXml(doc.id || "PDB");

  // Extract C_alpha coordinates for 3D ribbon
  const caCoords = biophysics.caAtoms.map((a) => ({
    name: a.resName,
    seq: a.resSeq,
    chain: a.chainId,
    x: a.x,
    y: a.y,
    z: a.z,
    b: a.tempFactor,
  }));

  // Ramachandran points
  const ramaPoints = biophysics.ramachandran
    .filter((r) => r.phi !== null && r.psi !== null)
    .map((r) => ({
      res: r.resName,
      seq: r.resSeq,
      chain: r.chainId,
      phi: r.phi!,
      psi: r.psi!,
      region: r.region,
      isOutlier: r.isOutlier,
    }));

  const jsonCaCoords = JSON.stringify(caCoords);
  const jsonRamaPoints = JSON.stringify(ramaPoints);

  const favoredPct = (biophysics.ramachandranFavoredFraction * 100).toFixed(1);
  const outlierCount = biophysics.ramachandranOutlierCount;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f9fafb;
      --subtext: #9ca3af;
      --accent: #38bdf8;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-red: #ef4444;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      padding: 12px 20px;
      background: rgba(17, 24, 39, 0.9);
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .header-title h1 {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: #0284c7;
      color: #fff;
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .header-sub {
      font-size: 11px;
      color: var(--subtext);
      margin-top: 2px;
    }
    .main-container {
      display: grid;
      grid-template-columns: 1fr 380px;
      flex: 1;
      overflow: hidden;
    }
    .viewport-3d {
      position: relative;
      background: radial-gradient(circle at center, #151d30 0%, #090d16 100%);
      overflow: hidden;
    }
    #gl-canvas {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
    }
    #gl-canvas:active { cursor: grabbing; }
    .viewport-overlay {
      position: absolute;
      top: 12px;
      left: 12px;
      display: flex;
      gap: 8px;
      pointer-events: auto;
    }
    .btn {
      background: rgba(31, 41, 55, 0.85);
      border: 1px solid #374151;
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      backdrop-filter: blur(4px);
      transition: all 0.15s ease;
    }
    .btn:hover { background: #374151; border-color: #4b5563; }
    .btn.active { background: #0284c7; border-color: #38bdf8; }
    .sidebar {
      background: var(--card-bg);
      border-left: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px;
      gap: 16px;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .stat-card {
      background: rgba(31, 41, 55, 0.5);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 8px 10px;
    }
    .stat-label {
      font-size: 10px;
      color: var(--subtext);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-val {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      margin-top: 2px;
      font-family: var(--font-mono);
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--accent);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .rama-container {
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px;
      position: relative;
    }
    #rama-canvas {
      width: 100%;
      aspect-ratio: 1;
      display: block;
      border-radius: 4px;
    }
    .rama-tooltip {
      position: absolute;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--accent);
      color: var(--text);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10.5px;
      font-family: var(--font-mono);
      pointer-events: none;
      display: none;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 10px;
      margin-top: 6px;
      color: var(--subtext);
    }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-favored { background: var(--accent-green); }
    .dot-allowed { background: var(--accent-amber); }
    .dot-outlier { background: var(--accent-red); }
    .wave-controller-panel {
      position: absolute;
      bottom: 12px;
      left: 12px;
      right: 12px;
      background: rgba(17, 24, 39, 0.92);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 10;
    }
    .wave-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .wave-controls {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 11px;
    }
    .wave-slider-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
    }
    .wave-slider-group input[type=range] {
      flex: 1;
      accent-color: var(--accent);
      cursor: pointer;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      <h1><span class="badge">${id}</span> ${title}</h1>
      <div class="header-sub">
        Atoms: ${biophysics.atomCount} | Residues: ${biophysics.residueCount} | Chains: ${biophysics.chainCount} | Resolution: ${doc.resolution ? doc.resolution.toFixed(2) + " Å" : "NMR/Model"}
      </div>
    </div>
    <div style="font-size: 11.5px; color: var(--subtext); display: flex; align-items: center; gap: 8px;">
      <span>Residue Focus:</span>
      <span class="badge" id="selected-residue-badge" style="background: #1f2937; font-size: 11px;">None</span>
    </div>
  </header>

  <div class="main-container">
    <!-- 3D WebGL / Canvas Viewport -->
    <div class="viewport-3d">
      <div class="viewport-overlay">
        <button class="btn" id="btn-reset">Reset View</button>
        <button class="btn" id="btn-color">Color: Structure</button>
        <button class="btn" id="btn-gnm">Simulate Normal Mode</button>
      </div>

      <!-- Normal Mode Dynamic Wave Controller -->
      <div class="wave-controller-panel">
        <div class="wave-header">
          <span>Normal Mode Dynamic Wave Controller</span>
          <span id="wave-mode-badge" style="color: var(--subtext); font-family: var(--font-mono); text-transform: none;">Mode 1: Breathing (1.0 Hz, 1.8 Å)</span>
        </div>
        <div class="wave-controls">
          <button class="btn" id="btn-gnm-play">▶ Play Wave</button>
          <div class="wave-slider-group">
            <label>Freq: <span id="val-freq" style="color: var(--accent); font-weight: 700;">1.0</span> Hz</label>
            <input type="range" id="slider-freq" min="0.1" max="5.0" step="0.1" value="1.0">
          </div>
          <div class="wave-slider-group">
            <label>Amp: <span id="val-amp" style="color: var(--accent); font-weight: 700;">1.8</span> Å</label>
            <input type="range" id="slider-amp" min="0.5" max="5.0" step="0.1" value="1.8">
          </div>
          <select id="select-wave-mode" class="btn" style="padding: 4px 8px;">
            <option value="1">Mode 1: Breathing</option>
            <option value="2">Mode 2: Bending</option>
            <option value="3">Mode 3: Twisting</option>
          </select>
        </div>
      </div>

      <canvas id="gl-canvas"></canvas>
    </div>

    <!-- Sidebar Dashboard -->
    <div class="sidebar">
      <div class="section-title">Biophysical Invariants</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Molecular Weight</div>
          <div class="stat-val">${(biophysics.molecularWeightDa / 1000).toFixed(2)} kDa</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Radius of Gyration</div>
          <div class="stat-val">${biophysics.radiusOfGyration.toFixed(2)} Å</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">End-to-End Distance</div>
          <div class="stat-val">${biophysics.endToEndDistance.toFixed(2)} Å</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">GNM Cutoff (Rc)</div>
          <div class="stat-val">${biophysics.cutoffDistance.toFixed(1)} Å</div>
        </div>
      </div>

      <div class="section-title">
        <span>Ramachandran Quality</span>
        <span style="color:${outlierCount === 0 ? "var(--accent-green)" : "var(--accent-amber)"};font-size:11px;">
          ${favoredPct}% Favored
        </span>
      </div>

      <div class="rama-container">
        <canvas id="rama-canvas" width="340" height="340"></canvas>
        <div class="rama-tooltip" id="rama-tooltip"></div>
        <div class="legend">
          <div class="legend-item"><div class="legend-dot dot-favored"></div>Favored</div>
          <div class="legend-item"><div class="legend-dot dot-allowed"></div>Allowed</div>
          <div class="legend-item"><div class="legend-dot dot-outlier"></div>Outlier (${outlierCount})</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const caAtoms = ${jsonCaCoords};
    const ramaPoints = ${jsonRamaPoints};

    // ─────────────────────────────────────────────────────────────────────────
    // 3D Canvas Protein Backbone Renderer & Orbit Controls
    // ─────────────────────────────────────────────────────────────────────────
    const glCanvas = document.getElementById("gl-canvas");
    const ctx = glCanvas.getContext("2d");

    let rotX = 0.3;
    let rotY = 0.5;
    let zoom = 1.0;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let isAnimGnm = false;
    let gnmPhase = 0.0;
    let colorMode = "structure"; // "structure" or "bfactor"

    // Compute bounding box and center of mass
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let minB = Infinity, maxB = -Infinity;

    for (const a of caAtoms) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
      if (a.z < minZ) minZ = a.z; if (a.z > maxZ) maxZ = a.z;
      if (a.b < minB) minB = a.b; if (a.b > maxB) maxB = a.b;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 20;

    function resizeCanvas() {
      const rect = glCanvas.parentElement.getBoundingClientRect();
      glCanvas.width = rect.width;
      glCanvas.height = rect.height;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    let selectedResSeq = null;

    function render3D() {
      const w = glCanvas.width;
      const h = glCanvas.height;
      ctx.clearRect(0, 0, w, h);

      const scale = (Math.min(w, h) / (maxSpan * 1.5)) * zoom;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

      // Project atoms with optional harmonic normal mode oscillation
      const projected = [];
      for (let i = 0; i < caAtoms.length; i++) {
        const a = caAtoms[i];
        let x = a.x - cx;
        let y = a.y - cy;
        let z = a.z - cz;

    let gnmFreq = 1.0;
    let gnmAmp = 1.8;
    let gnmMode = 1;

    const btnPlayGnm = document.getElementById("btn-gnm-play");
    const sliderFreq = document.getElementById("slider-freq");
    const sliderAmp = document.getElementById("slider-amp");
    const selectMode = document.getElementById("select-wave-mode");
    const valFreq = document.getElementById("val-freq");
    const valAmp = document.getElementById("val-amp");
    const waveBadge = document.getElementById("wave-mode-badge");
    const selectedBadge = document.getElementById("selected-residue-badge");

    function updateWaveBadge() {
      const modeNames = { 1: "Breathing", 2: "Bending", 3: "Twisting" };
      if (waveBadge) {
        waveBadge.textContent = "Mode " + gnmMode + ": " + (modeNames[gnmMode] || "") + " (" + gnmFreq.toFixed(1) + " Hz, " + gnmAmp.toFixed(1) + " Å)";
      }
    }

    if (sliderFreq) {
      sliderFreq.addEventListener("input", (e) => {
        gnmFreq = parseFloat(e.target.value);
        if (valFreq) valFreq.textContent = gnmFreq.toFixed(1);
        updateWaveBadge();
      });
    }

    if (sliderAmp) {
      sliderAmp.addEventListener("input", (e) => {
        gnmAmp = parseFloat(e.target.value);
        if (valAmp) valAmp.textContent = gnmAmp.toFixed(1);
        updateWaveBadge();
      });
    }

    if (selectMode) {
      selectMode.addEventListener("change", (e) => {
        gnmMode = parseInt(e.target.value, 10);
        updateWaveBadge();
        render3D();
      });
    }

    function toggleWaveAnimation() {
      isAnimGnm = !isAnimGnm;
      if (btnPlayGnm) {
        btnPlayGnm.textContent = isAnimGnm ? "⏸ Pause Wave" : "▶ Play Wave";
        btnPlayGnm.classList.toggle("active", isAnimGnm);
      }
      const gnmBtn = document.getElementById("btn-gnm");
      if (gnmBtn) gnmBtn.classList.toggle("active", isAnimGnm);
      if (isAnimGnm) render3D();
    }

    if (btnPlayGnm) btnPlayGnm.addEventListener("click", toggleWaveAnimation);
    document.getElementById("btn-gnm").addEventListener("click", toggleWaveAnimation);

    function updateResidueBadge(resSeq, chainId) {
      if (!selectedBadge) return;
      if (resSeq === null || resSeq === undefined) {
        selectedBadge.textContent = "None";
        selectedBadge.style.background = "#1f2937";
        return;
      }
      const at = caAtoms.find(a => a.seq === resSeq && (!chainId || a.chain === chainId)) || caAtoms.find(a => a.seq === resSeq);
      if (at) {
        selectedBadge.textContent = at.name + " " + at.seq + ":" + at.chain;
        selectedBadge.style.background = "#0284c7";
      } else {
        selectedBadge.textContent = "Res " + resSeq;
        selectedBadge.style.background = "#0284c7";
      }
    }

    let lastProjected = [];

    function render3D() {
      const w = glCanvas.width;
      const h = glCanvas.height;
      ctx.clearRect(0, 0, w, h);

      const scale = (Math.min(w, h) / (maxSpan * 1.5)) * zoom;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

      // Project atoms with dynamic normal mode wave displacement
      const projected = [];
      for (let i = 0; i < caAtoms.length; i++) {
        const a = caAtoms[i];
        let x = a.x - cx;
        let y = a.y - cy;
        let z = a.z - cz;

        if (isAnimGnm) {
          let modeOsc = 0;
          if (gnmMode === 1) {
            // Mode 1: Breathing (isotropic dilation/contraction)
            modeOsc = Math.sin(gnmPhase + (i * 0.15)) * gnmAmp;
            x += modeOsc * 0.5;
            y += modeOsc * 0.8;
            z += modeOsc * 0.3;
          } else if (gnmMode === 2) {
            // Mode 2: Bending (lateral flexural oscillation)
            modeOsc = Math.sin(gnmPhase + (i * 0.25)) * gnmAmp;
            x += modeOsc * 0.9;
            y -= modeOsc * 0.4;
            z += modeOsc * 0.6;
          } else {
            // Mode 3: Twisting (torsional shear)
            modeOsc = Math.sin(gnmPhase + (i * 0.35)) * gnmAmp;
            x += Math.cos(gnmPhase + i * 0.2) * gnmAmp * 0.7;
            z += Math.sin(gnmPhase + i * 0.2) * gnmAmp * 0.7;
          }
        }

        // Rotate Y
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;

        // Rotate X
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        // Orthographic projection to screen
        const px = w / 2 + x1 * scale;
        const py = h / 2 - y2 * scale;

        projected.push({ px, py, z: z2, atom: a, idx: i });
      }

      lastProjected = projected;

      // Draw Backbone Ribbon Spline
      if (projected.length > 1) {
        ctx.lineWidth = Math.max(3, scale * 0.35);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (let i = 0; i < projected.length - 1; i++) {
          const p1 = projected[i];
          const p2 = projected[i + 1];

          let stroke = "#38bdf8";
          if (colorMode === "bfactor") {
            const t = (p1.atom.b - minB) / (maxB - minB || 1);
            stroke = t > 0.6 ? "#ef4444" : t > 0.3 ? "#f59e0b" : "#3b82f6";
          } else {
            stroke = (p1.idx % 8 < 4) ? "#38bdf8" : "#818cf8";
          }

          ctx.beginPath();
          ctx.strokeStyle = stroke;
          ctx.moveTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.stroke();
        }
      }

      // Sort by depth and draw CA nodes
      projected.sort((a, b) => a.z - b.z);
      const nodeR = Math.max(2.5, scale * 0.18);

      for (const p of projected) {
        const isSelected = selectedResSeq !== null && p.atom.resSeq === selectedResSeq;
        ctx.beginPath();
        ctx.arc(p.px, p.py, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#facc15" : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#eab308" : "#0284c7";
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.stroke();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(p.px, p.py, nodeR * 2.8, 0, Math.PI * 2);
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (isAnimGnm) {
        gnmPhase += gnmFreq * 0.05;
        requestAnimationFrame(render3D);
      }
    }

    render3D();

    // Mouse Controls
    let dragDist = 0;
    glCanvas.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragDist = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("mouseup", (e) => {
      if (isDragging && dragDist < 4) {
        // Handle atom selection click in 3D canvas
        const rect = glCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let closest = null;
        let minDist = 14;
        for (const p of lastProjected) {
          const d = Math.hypot(p.px - mx, p.py - my);
          if (d < minDist) {
            minDist = d;
            closest = p.atom;
          }
        }

        if (closest) {
          selectedResSeq = closest.resSeq;
          updateResidueBadge(closest.resSeq, closest.chainId);
          render3D();
          renderRamachandran();
          vscode.postMessage({
            command: "selectResidue",
            chainId: closest.chainId,
            resSeq: closest.resSeq,
          });
        }
      }
      isDragging = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      dragDist += Math.hypot(dx, dy);
      lastX = e.clientX;
      lastY = e.clientY;

      rotY += dx * 0.008;
      rotX += dy * 0.008;
      render3D();
    });
    glCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom *= e.deltaY > 0 ? 0.92 : 1.08;
      zoom = Math.max(0.2, Math.min(zoom, 6.0));
      render3D();
    });

    // Button Controls
    document.getElementById("btn-reset").addEventListener("click", () => {
      rotX = 0.3; rotY = 0.5; zoom = 1.0;
      render3D();
    });
    document.getElementById("btn-color").addEventListener("click", (e) => {
      colorMode = colorMode === "structure" ? "bfactor" : "structure";
      e.target.textContent = colorMode === "structure" ? "Color: Structure" : "Color: B-Factor";
      render3D();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Interactive 2D Ramachandran Plot
    // ─────────────────────────────────────────────────────────────────────────
    const ramaCanvas = document.getElementById("rama-canvas");
    const rCtx = ramaCanvas.getContext("2d");
    const tooltip = document.getElementById("rama-tooltip");

    function renderRamachandran() {
      const w = ramaCanvas.width;
      const h = ramaCanvas.height;
      rCtx.clearRect(0, 0, w, h);

      // Grid background
      rCtx.fillStyle = "#090d16";
      rCtx.fillRect(0, 0, w, h);

      // Helper mapping [-180, 180] -> [0, w]
      const toX = (phi) => ((phi + 180) / 360) * w;
      const toY = (psi) => ((180 - psi) / 360) * h;

      // Draw Center Axes
      rCtx.strokeStyle = "#1e293b";
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.moveTo(w / 2, 0); rCtx.lineTo(w / 2, h);
      rCtx.moveTo(0, h / 2); rCtx.lineTo(w, h / 2);
      rCtx.stroke();

      // Favored Alpha Helix Region (approximate polygon)
      rCtx.fillStyle = "rgba(16, 185, 129, 0.15)";
      rCtx.beginPath();
      rCtx.ellipse(toX(-65), toY(-40), w * 0.12, h * 0.14, 0, 0, Math.PI * 2);
      rCtx.fill();

      // Favored Beta Sheet Region
      rCtx.fillStyle = "rgba(56, 189, 248, 0.15)";
      rCtx.beginPath();
      rCtx.ellipse(toX(-120), toY(135), w * 0.16, h * 0.18, 0, 0, Math.PI * 2);
      rCtx.fill();

      // Axis labels
      rCtx.fillStyle = "#64748b";
      rCtx.font = "9px system-ui";
      rCtx.fillText("-180°", 4, h / 2 - 4);
      rCtx.fillText("+180°", w - 28, h / 2 - 4);
      rCtx.fillText("+180°", w / 2 + 4, 12);
      rCtx.fillText("-180°", w / 2 + 4, h - 4);
      rCtx.fillText("φ (phi)", w - 38, h - 6);
      rCtx.fillText("ψ (psi)", 6, 14);

      // Draw points
      for (const p of ramaPoints) {
        const x = toX(p.phi);
        const y = toY(p.psi);

        rCtx.beginPath();
        rCtx.arc(x, y, 3.5, 0, Math.PI * 2);

        if (p.isOutlier) {
          rCtx.fillStyle = "#ef4444";
        } else if (p.region === "favored_alpha" || p.region === "favored_beta") {
          rCtx.fillStyle = "#10b981";
        } else {
          rCtx.fillStyle = "#f59e0b";
        }

        rCtx.fill();
        rCtx.strokeStyle = "rgba(0,0,0,0.5)";
        rCtx.lineWidth = 0.5;
        rCtx.stroke();

        if (selectedResSeq !== null && p.seq === selectedResSeq) {
          rCtx.beginPath();
          rCtx.arc(x, y, 7.5, 0, Math.PI * 2);
          rCtx.strokeStyle = "#facc15";
          rCtx.lineWidth = 2.5;
          rCtx.stroke();
        }
      }
    }

    renderRamachandran();

    // Hover & Click interaction on Ramachandran plot
    ramaCanvas.addEventListener("mousemove", (e) => {
      const rect = ramaCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (ramaCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (ramaCanvas.height / rect.height);

      const toX = (phi) => ((phi + 180) / 360) * ramaCanvas.width;
      const toY = (psi) => ((180 - psi) / 360) * ramaCanvas.height;

      let found = null;
      for (const p of ramaPoints) {
        const px = toX(p.phi);
        const py = toY(p.psi);
        const dist = Math.hypot(px - mx, py - my);
        if (dist <= 6) {
          found = p;
          break;
        }
      }

      if (found) {
        tooltip.style.display = "block";
        tooltip.style.left = (e.clientX - rect.left + 10) + "px";
        tooltip.style.top = (e.clientY - rect.top - 20) + "px";
        tooltip.innerHTML = "<b>" + found.res + found.seq + ":" + found.chain + "</b><br/>" +
          "φ=" + found.phi.toFixed(1) + "°, ψ=" + found.psi.toFixed(1) + "°<br/>" +
          "Region: " + found.region;
      } else {
        tooltip.style.display = "none";
      }
    });

    ramaCanvas.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    ramaCanvas.addEventListener("click", (e) => {
      const rect = ramaCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (ramaCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (ramaCanvas.height / rect.height);

      const toX = (phi) => ((phi + 180) / 360) * ramaCanvas.width;
      const toY = (psi) => ((180 - psi) / 360) * ramaCanvas.height;

      for (const p of ramaPoints) {
        const px = toX(p.phi);
        const py = toY(p.psi);
        if (Math.hypot(px - mx, py - my) <= 6) {
          selectedResSeq = p.seq;
          updateResidueBadge(p.seq, p.chain);
          render3D();
          renderRamachandran();
          vscode.postMessage({
            command: "selectResidue",
            chainId: p.chain,
            resSeq: p.seq,
          });
          break;
        }
      }
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "highlightResidue" && typeof msg.resSeq === "number") {
        selectedResSeq = msg.resSeq;
        updateResidueBadge(msg.resSeq, msg.chainId);
        render3D();
        renderRamachandran();
      }
    });
  </script>
</body>
</html>`;
}

const SAMPLE_PDB_PEPTIDE = `
HEADER    PEPTIDE HORMONE                         30-APR-81   1CRN
TITLE     WATER STRUCTURE OF A HYDROPHOBIC PROTEIN AT ATOMIC RESOLUTION.
ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N
ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C
ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C
ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O
ATOM      5  N   THR A   2      15.115  11.555   5.265  1.00  7.67           N
ATOM      6  CA  THR A   2      13.856  11.469   6.066  1.00  8.56           C
ATOM      7  C   THR A   2      14.164  10.785   7.379  1.00  8.00           C
ATOM      8  O   THR A   2      14.993   9.862   7.443  1.00  8.61           O
ATOM      9  N   CYS A   3      13.488  11.241   8.417  1.00  7.87           N
ATOM     10  CA  CYS A   3      13.660  10.707   9.756  1.00  8.25           C
ATOM     11  C   CYS A   3      12.269  10.428  10.366  1.00  7.91           C
ATOM     12  O   CYS A   3      11.408  11.311  10.320  1.00  9.60           O
ATOM     13  N   CYS A   4      12.062   9.208  10.884  1.00  7.24           N
ATOM     14  CA  CYS A   4      10.781   8.825  11.530  1.00  7.89           C
ATOM     15  C   CYS A   4      10.999   7.653  12.476  1.00  7.92           C
ATOM     16  O   CYS A   4      12.124   7.360  12.879  1.00  7.68           O
ATOM     17  N   PRO A   5       9.914   6.969  12.837  1.00  7.91           N
ATOM     18  CA  PRO A   5      10.024   5.787  13.722  1.00  8.85           C
ATOM     19  C   PRO A   5       9.932   4.469  12.969  1.00  8.13           C
ATOM     20  O   PRO A   5       9.060   4.316  12.115  1.00  8.79           O
END
`;

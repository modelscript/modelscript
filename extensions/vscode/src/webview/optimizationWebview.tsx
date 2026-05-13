// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Optimization Dashboard webview entry point.

declare const acquireVsCodeApi: () => { postMessage: (msg: Record<string, unknown>) => void };
const vscode = acquireVsCodeApi();

// ── State ──

interface OptimizationResultData {
  success: boolean;
  t: number[];
  states: Record<string, number[]>;
  controls: Record<string, number[]>;
  error?: string;
}

let optFinalResult: OptimizationResultData | null = null;

// ── DOM Setup ──

const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
    <div id="opt-layout" style="display: flex; width: 100vw; height: 100vh;">
      <div id="opt-sidebar" style="width: 300px; min-width: 200px; border-right: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-sideBar-background, #252526); overflow-y: auto; display: flex; flex-direction: column;">
        <div style="padding: 12px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border, #333);">Optimization</div>
        <div style="padding: 8px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">Objective</label>
          <input type="text" id="opt-objective" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" placeholder="e.g. min(time)">
        </div>
        <div style="padding: 4px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">Controls (comma separated)</label>
          <input type="text" id="opt-controls" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" placeholder="u1, u2">
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Tolerance</label>
          <input type="number" id="opt-tolerance" value="1e-4" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Max Iterations</label>
          <input type="number" id="opt-iters" value="200" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 8px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">SysML URI (Optional)</label>
          <input type="text" id="opt-sysml-uri" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 8px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">SysML Filter (Optional)</label>
          <input type="text" id="opt-sysml-filter" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 12px 16px;">
          <button id="btn-optimize" style="width:100%;padding:6px;background:var(--vscode-debugIcon-startForeground, #388a34);color:#fff;border:none;border-radius:2px;cursor:pointer;font-size:13px;font-weight:500;">Run Optimization</button>
        </div>
        <div id="opt-status" style="padding: 8px 16px; font-size: 11px; color: var(--vscode-descriptionForeground);"></div>
      </div>
      <div id="opt-main" style="flex: 1; display: flex; flex-direction: column; min-width: 0; align-items:center; justify-content:center; background:var(--vscode-editor-background);">
        <div id="opt-placeholder" style="opacity:0.5;font-size:14px;">Run optimization to see results</div>
        <div id="opt-results-container" style="display:none; width:100%; height:100%; padding: 16px; box-sizing: border-box; overflow-y: auto;">
          <h2 style="font-size: 16px; margin-bottom: 8px;">Optimization Results</h2>
          <pre id="opt-results-raw" style="font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 8px;"></pre>
        </div>
      </div>
    </div>
  `;

  // Wire up controls
  const btnOptimize = document.getElementById("btn-optimize");

  if (btnOptimize) {
    btnOptimize.addEventListener("click", () => {
      const objEl = document.getElementById("opt-objective") as HTMLInputElement | null;
      const controlsEl = document.getElementById("opt-controls") as HTMLInputElement | null;
      const tolEl = document.getElementById("opt-tolerance") as HTMLInputElement | null;
      const itersEl = document.getElementById("opt-iters") as HTMLInputElement | null;
      const sysmlUriEl = document.getElementById("opt-sysml-uri") as HTMLInputElement | null;
      const sysmlFilterEl = document.getElementById("opt-sysml-filter") as HTMLInputElement | null;

      const objective = objEl?.value || undefined;
      const controls = (controlsEl?.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const tolerance = parseFloat(tolEl?.value || "1e-4");
      const maxIterations = parseInt(itersEl?.value || "200", 10);
      const sysmlUri = sysmlUriEl?.value || undefined;
      const sysmlFilter = sysmlFilterEl?.value || undefined;

      optFinalResult = null;
      optSetStatus("Optimizing...");

      const placeholder = document.getElementById("opt-placeholder");
      const resultsContainer = document.getElementById("opt-results-container");
      if (placeholder) placeholder.style.display = "block";
      if (resultsContainer) resultsContainer.style.display = "none";

      vscode.postMessage({
        type: "optimizeRequest",
        payload: { objective, controls, tolerance, maxIterations, sysmlUri, sysmlFilter },
      });
    });
  }
}

// ── Message Handler ──

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "optimizationResult") {
    optFinalResult = msg.data as OptimizationResultData;
    optSetStatus(optFinalResult.success ? "Optimization Converged." : "Optimization failed to converge.");
    optShowResults();
  } else if (msg.type === "optimizationError") {
    optSetStatus(`Error: ${msg.error}`);
  }
});

function optSetStatus(text: string): void {
  const el = document.getElementById("opt-status");
  if (el) el.textContent = text;
}

function optShowResults(): void {
  if (!optFinalResult) return;
  const placeholder = document.getElementById("opt-placeholder");
  const resultsContainer = document.getElementById("opt-results-container");
  const rawResults = document.getElementById("opt-results-raw");

  if (placeholder) placeholder.style.display = "none";
  if (resultsContainer) resultsContainer.style.display = "block";
  if (rawResults) {
    const displayData = {
      success: optFinalResult.success,
      numPoints: optFinalResult.t?.length || 0,
      states: Object.keys(optFinalResult.states || {}),
      controls: Object.keys(optFinalResult.controls || {}),
    };
    rawResults.textContent = JSON.stringify(displayData, null, 2);
  }
}

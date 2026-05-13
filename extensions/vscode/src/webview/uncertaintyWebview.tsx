// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Uncertainty (Monte Carlo) Dashboard webview entry point.

declare const acquireVsCodeApi: () => { postMessage: (msg: Record<string, unknown>) => void };
const vscode = acquireVsCodeApi();

// ── State ──

interface MonteCarloResultData {
  success: boolean;
  samples: number;
  results: Record<string, unknown>;
  error?: string;
}

let mcFinalResult: MonteCarloResultData | null = null;

// ── DOM Setup ──

const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
    <div id="mc-layout" style="display: flex; width: 100vw; height: 100vh;">
      <div id="mc-sidebar" style="width: 300px; min-width: 200px; border-right: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-sideBar-background, #252526); overflow-y: auto; display: flex; flex-direction: column;">
        <div style="padding: 12px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border, #333);">Uncertainty (Monte Carlo)</div>
        <div style="padding: 8px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">Parameters (JSON)</label>
          <textarea id="mc-params" rows="5" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);font-family:monospace;font-size:10px;" placeholder='[{"name": "a", "distribution": "normal", "mean": 1.0, "std": 0.1}]'></textarea>
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Number of Samples</label>
          <input type="number" id="mc-samples" value="200" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Confidence Level</label>
          <input type="number" step="0.01" id="mc-confidence" value="0.95" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Method</label>
          <select id="mc-method" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
            <option value="latinHypercube">LHS</option>
            <option value="random">Random</option>
          </select>
        </div>
        <div style="padding: 12px 16px;">
          <button id="btn-montecarlo" style="width:100%;padding:6px;background:var(--vscode-debugIcon-startForeground, #388a34);color:#fff;border:none;border-radius:2px;cursor:pointer;font-size:13px;font-weight:500;">Run Monte Carlo</button>
        </div>
        <div id="mc-status" style="padding: 8px 16px; font-size: 11px; color: var(--vscode-descriptionForeground);"></div>
      </div>
      <div id="mc-main" style="flex: 1; display: flex; flex-direction: column; min-width: 0; align-items:center; justify-content:center; background:var(--vscode-editor-background);">
        <div id="mc-placeholder" style="opacity:0.5;font-size:14px;">Run Monte Carlo to see results</div>
        <div id="mc-results-container" style="display:none; width:100%; height:100%; padding: 16px; box-sizing: border-box; overflow-y: auto;">
          <h2 style="font-size: 16px; margin-bottom: 8px;">Monte Carlo Results</h2>
          <pre id="mc-results-raw" style="font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 8px;"></pre>
        </div>
      </div>
    </div>
  `;

  // Wire up controls
  const btnMonteCarlo = document.getElementById("btn-montecarlo");

  if (btnMonteCarlo) {
    btnMonteCarlo.addEventListener("click", () => {
      const paramsEl = document.getElementById("mc-params") as HTMLTextAreaElement | null;
      const samplesEl = document.getElementById("mc-samples") as HTMLInputElement | null;
      const confidenceEl = document.getElementById("mc-confidence") as HTMLInputElement | null;
      const methodEl = document.getElementById("mc-method") as HTMLSelectElement | null;

      let parameters: unknown[];
      try {
        parameters = JSON.parse(paramsEl?.value || "[]");
      } catch {
        mcSetStatus("Invalid JSON in Parameters.");
        return;
      }

      const numSamples = parseInt(samplesEl?.value || "200", 10);
      const confidenceLevel = parseFloat(confidenceEl?.value || "0.95");
      const method = methodEl?.value || "latinHypercube";

      mcFinalResult = null;
      mcSetStatus("Running Monte Carlo...");

      const placeholder = document.getElementById("mc-placeholder");
      const resultsContainer = document.getElementById("mc-results-container");
      if (placeholder) placeholder.style.display = "block";
      if (resultsContainer) resultsContainer.style.display = "none";

      vscode.postMessage({
        type: "montecarloRequest",
        payload: { numSamples, confidenceLevel, method, parameters },
      });
    });
  }
}

// ── Message Handler ──

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "montecarloResult") {
    mcFinalResult = msg.data as MonteCarloResultData;
    mcSetStatus(mcFinalResult.success ? "Monte Carlo Finished." : "Monte Carlo failed.");
    mcShowResults();
  } else if (msg.type === "montecarloError") {
    mcSetStatus(`Error: ${msg.error}`);
  }
});

function mcSetStatus(text: string): void {
  const el = document.getElementById("mc-status");
  if (el) el.textContent = text;
}

function mcShowResults(): void {
  if (!mcFinalResult) return;
  const placeholder = document.getElementById("mc-placeholder");
  const resultsContainer = document.getElementById("mc-results-container");
  const rawResults = document.getElementById("mc-results-raw");

  if (placeholder) placeholder.style.display = "none";
  if (resultsContainer) resultsContainer.style.display = "block";
  if (rawResults) {
    rawResults.textContent = JSON.stringify(mcFinalResult.results || {}, null, 2);
  }
}

export {};

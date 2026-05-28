// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Surrogate Editor webview entry point.
// Renders a dashboard for training AI surrogate models (ROMs) and exporting them to WASM.

declare const acquireVsCodeApi: () => { postMessage: (msg: Record<string, unknown>) => void };
const vscode = acquireVsCodeApi();

// ── State ──

let isTraining = false;

// ── DOM Setup ──

const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
    <div id="surrogate-layout" style="display: flex; width: 100vw; height: 100vh; flex-direction: column;">
      <div style="padding: 16px; border-bottom: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-sideBar-background, #252526);">
        <h2 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: var(--vscode-foreground);">AI Surrogate Modeling (ROM)</h2>
        <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Train neural networks from physics models and export as edge-ready WebAssembly.</div>
      </div>
      
      <div style="display: flex; flex: 1; overflow: hidden;">
        <!-- Left Sidebar: Configuration -->
        <div style="width: 350px; min-width: 250px; border-right: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-sideBar-background, #252526); overflow-y: auto; display: flex; flex-direction: column;">
          <div style="padding: 12px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border, #333);">Configuration</div>
          
          <div style="padding: 12px 16px; font-size: 12px;">
            <label style="display:block;margin-bottom:4px;font-weight:600;">Design of Experiments (DoE) Strategy</label>
            <select id="cfg-doe" style="width:100%;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
              <option value="lhs">Latin Hypercube Sampling (LHS)</option>
              <option value="random">Random Sampling</option>
              <option value="grid">Grid Search</option>
            </select>
          </div>
          
          <div style="padding: 12px 16px; font-size: 12px;">
            <label style="display:block;margin-bottom:4px;font-weight:600;">Sample Size</label>
            <input type="number" id="cfg-samples" value="1000" style="width:100%;padding:4px;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
          </div>
          
          <div style="padding: 12px 16px; font-size: 12px;">
            <label style="display:block;margin-bottom:4px;font-weight:600;">Neural Network Architecture</label>
            <select id="cfg-arch" style="width:100%;padding:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
              <option value="mlp">Multi-Layer Perceptron (MLP)</option>
              <option value="rbf">Radial Basis Function (RBF)</option>
            </select>
          </div>
          
          <div style="padding: 12px 16px; font-size: 12px;">
            <label style="display:block;margin-bottom:4px;font-weight:600;">Hidden Layers</label>
            <input type="text" id="cfg-layers" value="64, 32" style="width:100%;padding:4px;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
          </div>
          
          <div style="padding: 16px;">
            <button id="btn-train" style="width:100%;padding:8px;background:var(--vscode-debugIcon-startForeground, #388a34);color:#fff;border:none;border-radius:2px;cursor:pointer;font-size:13px;font-weight:600;">Train Surrogate</button>
          </div>
        </div>
        
        <!-- Main Area: Progress & Results -->
        <div style="flex: 1; display: flex; flex-direction: column; padding: 24px; overflow-y: auto; background: var(--vscode-editor-background);">
          
          <div id="progress-container" style="display: none; flex-direction: column; gap: 8px; margin-bottom: 32px; padding: 16px; border: 1px solid var(--vscode-panel-border, #333); border-radius: 4px; background: var(--vscode-editorWidget-background);">
            <div style="font-weight: 600; font-size: 14px;">Training Progress</div>
            <div id="progress-status" style="font-size: 12px; color: var(--vscode-descriptionForeground);">Initializing...</div>
            <div style="width: 100%; height: 8px; background: var(--vscode-progressBar-background, #111); border-radius: 4px; overflow: hidden; margin-top: 4px;">
              <div id="progress-bar" style="height: 100%; width: 0%; background: var(--vscode-debugIcon-startForeground, #388a34); transition: width 0.3s ease;"></div>
            </div>
          </div>
          
          <div id="results-container" style="display: none; flex-direction: column; gap: 16px; padding: 16px; border: 1px solid var(--vscode-panel-border, #333); border-radius: 4px; background: var(--vscode-editorWidget-background);">
            <div style="font-weight: 600; font-size: 14px; color: var(--vscode-editorInfo-foreground, #3794ff); display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"></path></svg>
              Training Complete
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
              <div style="padding: 12px; background: rgba(0,0,0,0.1); border-radius: 4px; text-align: center;">
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; text-transform: uppercase;">Train MSE</div>
                <div id="metric-train-mse" style="font-size: 18px; font-weight: 600; font-family: monospace;">-</div>
              </div>
              <div style="padding: 12px; background: rgba(0,0,0,0.1); border-radius: 4px; text-align: center;">
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; text-transform: uppercase;">Validation MSE</div>
                <div id="metric-val-mse" style="font-size: 18px; font-weight: 600; font-family: monospace;">-</div>
              </div>
              <div style="padding: 12px; background: rgba(0,0,0,0.1); border-radius: 4px; text-align: center;">
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; text-transform: uppercase;">R² Score</div>
                <div id="metric-r2" style="font-size: 18px; font-weight: 600; font-family: monospace; color: var(--vscode-debugIcon-startForeground, #388a34);">-</div>
              </div>
            </div>
            
            <div style="margin-top: 16px; border-top: 1px solid var(--vscode-panel-border, #333); padding-top: 16px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">Edge Deployment</div>
              <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
                Export this trained surrogate model as a self-contained WebAssembly / C module.
              </div>
              <button id="btn-export" style="padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.75 2a.75.75 0 01.75.75V11l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06L7 11V2.75A.75.75 0 017.75 2z"></path></svg>
                Generate WASM
              </button>
            </div>
          </div>
          
          <div id="error-container" style="display: none; margin-top: 16px; padding: 12px; background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-foreground); border-radius: 4px; font-size: 12px;"></div>
          
        </div>
      </div>
    </div>
  `;

  // Wire up controls
  const btnTrain = document.getElementById("btn-train") as HTMLButtonElement | null;
  const btnExport = document.getElementById("btn-export") as HTMLButtonElement | null;

  if (btnTrain) {
    btnTrain.addEventListener("click", () => {
      if (isTraining) return;

      const doeEl = document.getElementById("cfg-doe") as HTMLSelectElement | null;
      const samplesEl = document.getElementById("cfg-samples") as HTMLInputElement | null;
      const archEl = document.getElementById("cfg-arch") as HTMLSelectElement | null;
      const layersEl = document.getElementById("cfg-layers") as HTMLInputElement | null;

      const doeStrategy = doeEl?.value ?? "lhs";
      const sampleSize = parseInt(samplesEl?.value ?? "1000", 10) || 1000;
      const architecture = archEl?.value ?? "mlp";
      const hiddenLayers = (layersEl?.value ?? "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      isTraining = true;
      btnTrain.disabled = true;
      btnTrain.style.opacity = "0.5";
      btnTrain.textContent = "Training...";

      const progressContainer = document.getElementById("progress-container");
      const resultsContainer = document.getElementById("results-container");
      const errorContainer = document.getElementById("error-container");

      if (progressContainer) progressContainer.style.display = "flex";
      if (resultsContainer) resultsContainer.style.display = "none";
      if (errorContainer) errorContainer.style.display = "none";

      const progressBar = document.getElementById("progress-bar");
      const progressStatus = document.getElementById("progress-status");

      if (progressBar) progressBar.style.width = "0%";
      if (progressStatus) progressStatus.textContent = "Starting...";

      vscode.postMessage({
        type: "trainSurrogate",
        payload: { doeStrategy, sampleSize, architecture, hiddenLayers },
      });
    });
  }

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      vscode.postMessage({
        type: "exportSurrogate",
      });
    });
  }
}

// ── Message Handler ──

window.addEventListener("message", (event) => {
  const msg = event.data;

  if (msg.type === "surrogateTrainingProgress") {
    const progressBar = document.getElementById("progress-bar");
    const progressStatus = document.getElementById("progress-status");

    if (progressBar) progressBar.style.width = `${msg.progress}%`;
    if (progressStatus) progressStatus.textContent = msg.message || "Training in progress...";
  } else if (msg.type === "surrogateTrainingComplete") {
    isTraining = false;
    const btnTrain = document.getElementById("btn-train") as HTMLButtonElement | null;
    if (btnTrain) {
      btnTrain.disabled = false;
      btnTrain.style.opacity = "1";
      btnTrain.textContent = "Train Surrogate";
    }

    const progressContainer = document.getElementById("progress-container");
    const resultsContainer = document.getElementById("results-container");
    const progressBar = document.getElementById("progress-bar");
    const progressStatus = document.getElementById("progress-status");

    if (progressContainer) progressContainer.style.display = "flex"; // Keep it visible to show 100%
    if (progressBar) progressBar.style.width = "100%";
    if (progressStatus) progressStatus.textContent = "Training complete!";

    if (resultsContainer) resultsContainer.style.display = "flex";

    if (msg.metrics) {
      const trainMseEl = document.getElementById("metric-train-mse");
      const valMseEl = document.getElementById("metric-val-mse");
      const r2El = document.getElementById("metric-r2");

      if (trainMseEl) trainMseEl.textContent = msg.metrics.trainMSE?.toExponential(4) ?? "-";
      if (valMseEl) valMseEl.textContent = msg.metrics.valMSE?.toExponential(4) ?? "-";
      if (r2El) r2El.textContent = msg.metrics.r2?.toFixed(4) ?? "-";
    }
  } else if (msg.type === "surrogateTrainingError") {
    isTraining = false;
    const btnTrain = document.getElementById("btn-train") as HTMLButtonElement | null;
    if (btnTrain) {
      btnTrain.disabled = false;
      btnTrain.style.opacity = "1";
      btnTrain.textContent = "Train Surrogate";
    }

    const progressContainer = document.getElementById("progress-container");
    const errorContainer = document.getElementById("error-container");

    if (progressContainer) progressContainer.style.display = "none";
    if (errorContainer) {
      errorContainer.style.display = "block";
      errorContainer.textContent = `Error: ${msg.error}`;
    }
  }
});

export {};

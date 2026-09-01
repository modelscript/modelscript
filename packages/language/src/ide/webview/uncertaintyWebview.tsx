// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Uncertainty (Monte Carlo) Dashboard webview entry point.
// Professional UI with parameter distribution forms, statistics tables,
// and convergence diagnostics.

declare const acquireVsCodeApi: () => { postMessage: (msg: Record<string, unknown>) => void };
const vscode = acquireVsCodeApi();

// ── Types ──

interface ModelParameter {
  name: string;
  type: string;
  defaultValue: number;
  unit?: string;
}

interface ParamConfig {
  name: string;
  enabled: boolean;
  distribution: string;
  mean: number;
  stddev: number;
  lo: number;
  hi: number;
}

interface MCStatistics {
  mean: number[];
  stddev: number[];
  ciLo: number[];
  ciHi: number[];
  percentiles: Record<string, number[]>;
}

interface MCResultData {
  success: boolean;
  numSamples: number;
  statistics: Record<string, MCStatistics>;
  t: number[];
  convergence: { coeffOfVariation: number; effectiveSampleSize: number };
  error?: string;
}

// ── State ──

let paramConfigs: ParamConfig[] = [];
let isRunning = false;

// ── DOM Setup ──

const root = document.getElementById("root");
if (root) {
  root.innerHTML = buildLayout();
  wireControls();
}

function buildLayout(): string {
  return `
<div id="mc-layout" style="display:flex;width:100vw;height:100vh;">
  <div id="mc-sidebar" style="width:320px;min-width:240px;border-right:1px solid var(--vscode-panel-border,#333);background:var(--vscode-sideBar-background,#252526);overflow-y:auto;display:flex;flex-direction:column;">
    <div style="padding:12px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border,#333);display:flex;align-items:center;gap:6px;">
      <span style="font-size:16px;">📊</span> Monte Carlo UQ
    </div>

    <!-- Parameters Section -->
    <div style="padding:8px 16px 4px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-sideBarTitle-foreground,#888);letter-spacing:0.5px;">Uncertain Parameters</div>
    <div id="params-list" style="padding:0 12px;flex:1;overflow-y:auto;"></div>

    <!-- Settings -->
    <div style="border-top:1px solid var(--vscode-panel-border,#333);padding:8px 16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;">
        <label>Samples</label>
        <input type="number" id="mc-samples" value="200" min="10" max="10000" style="width:70px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#444);padding:2px 4px;font-size:11px;">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;">
        <label>Confidence</label>
        <input type="number" id="mc-confidence" value="0.95" step="0.01" min="0.5" max="0.999" style="width:70px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#444);padding:2px 4px;font-size:11px;">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;">
        <label>Method</label>
        <select id="mc-method" style="width:70px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#444);padding:2px 4px;font-size:11px;">
          <option value="lhs">LHS</option>
          <option value="crude">Random</option>
          <option value="antithetic">Antithetic</option>
        </select>
      </div>
      <button id="btn-run" style="width:100%;margin-top:8px;padding:7px;background:var(--vscode-debugIcon-startForeground,#388a34);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:13px;font-weight:600;">▶ Run Monte Carlo</button>
    </div>
    <div id="mc-status" style="padding:6px 16px;font-size:11px;color:var(--vscode-descriptionForeground,#888);border-top:1px solid var(--vscode-panel-border,#333);min-height:20px;"></div>
  </div>

  <!-- Main results area -->
  <div id="mc-main" style="flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto;background:var(--vscode-editor-background);">
    <div id="mc-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.4;font-size:14px;padding:32px;text-align:center;">
      Configure uncertain parameters and click <strong style="margin:0 4px;">▶ Run Monte Carlo</strong> to quantify output uncertainty.
    </div>
    <div id="mc-spinner" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px;">
      <div style="width:32px;height:32px;border:3px solid var(--vscode-foreground,#ccc);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <div id="mc-spinner-text" style="font-size:13px;opacity:0.7;">Running simulations...</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>
    <div id="mc-results" style="display:none;padding:20px 24px;"></div>
  </div>
</div>`;
}

function wireControls(): void {
  const btnRun = document.getElementById("btn-run");
  btnRun?.addEventListener("click", () => {
    if (isRunning) return;
    runMonteCarlo();
  });
}

function runMonteCarlo(): void {
  const enabledParams = paramConfigs.filter((p) => p.enabled);
  if (enabledParams.length === 0) {
    setStatus("⚠ Enable at least one uncertain parameter.");
    return;
  }

  const numSamples = parseInt((document.getElementById("mc-samples") as HTMLInputElement)?.value || "200", 10);
  const confidenceLevel = parseFloat((document.getElementById("mc-confidence") as HTMLInputElement)?.value || "0.95");
  const method = (document.getElementById("mc-method") as HTMLSelectElement)?.value || "lhs";

  const parameters = enabledParams.map((p) => {
    if (p.distribution === "uniform") {
      return { name: p.name, distribution: "uniform", lo: p.lo, hi: p.hi };
    }
    return { name: p.name, distribution: "normal", mean: p.mean, stddev: p.stddev };
  });

  isRunning = true;
  showSpinner(numSamples);
  setStatus(`Running ${numSamples} samples...`);
  const btn = document.getElementById("btn-run") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  }

  vscode.postMessage({
    type: "montecarloRequest",
    payload: { numSamples, confidenceLevel, method, parameters },
  });
}

// ── Parameter Form ──

function buildParamRows(): void {
  const list = document.getElementById("params-list");
  if (!list) return;
  list.innerHTML = "";

  if (paramConfigs.length === 0) {
    list.innerHTML =
      '<div style="padding:8px 4px;font-size:11px;opacity:0.5;">No parameters detected. Open a Modelica file first.</div>';
    return;
  }

  for (let i = 0; i < paramConfigs.length; i++) {
    const p = paramConfigs[i];
    const row = document.createElement("div");
    row.style.cssText = "padding:6px 4px;border-bottom:1px solid var(--vscode-panel-border,#333);font-size:11px;";

    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = p.enabled;
    cb.style.cssText = "margin:0;";
    cb.addEventListener("change", () => {
      paramConfigs[i].enabled = cb.checked;
      detailDiv.style.display = cb.checked ? "block" : "none";
    });

    const label = document.createElement("span");
    label.style.cssText = "font-weight:600;font-family:var(--vscode-editor-font-family,monospace);flex:1;";
    label.textContent = p.name;

    const valSpan = document.createElement("span");
    valSpan.style.cssText = "opacity:0.5;font-size:10px;";
    valSpan.textContent = `= ${p.mean}`;

    headerDiv.appendChild(cb);
    headerDiv.appendChild(label);
    headerDiv.appendChild(valSpan);
    row.appendChild(headerDiv);

    // Detail fields
    const detailDiv = document.createElement("div");
    detailDiv.style.cssText = `display:${p.enabled ? "block" : "none"};padding-left:22px;`;

    // Distribution select
    const distRow = makeFieldRow("Distribution");
    const distSel = document.createElement("select");
    distSel.style.cssText = inputStyle();
    distSel.innerHTML = '<option value="normal">Normal</option><option value="uniform">Uniform</option>';
    distSel.value = p.distribution;
    distRow.appendChild(distSel);
    detailDiv.appendChild(distRow);

    // Normal fields
    const normalDiv = document.createElement("div");
    normalDiv.id = `normal-${i}`;
    normalDiv.style.display = p.distribution === "normal" ? "block" : "none";
    const meanRow = makeFieldRow("μ (mean)");
    const meanInp = numInput(p.mean);
    meanInp.addEventListener("change", () => {
      paramConfigs[i].mean = parseFloat(meanInp.value) || 0;
    });
    meanRow.appendChild(meanInp);
    normalDiv.appendChild(meanRow);
    const sdRow = makeFieldRow("σ (std)");
    const sdInp = numInput(p.stddev);
    sdInp.addEventListener("change", () => {
      paramConfigs[i].stddev = parseFloat(sdInp.value) || 0;
    });
    sdRow.appendChild(sdInp);
    normalDiv.appendChild(sdRow);
    detailDiv.appendChild(normalDiv);

    // Uniform fields
    const uniformDiv = document.createElement("div");
    uniformDiv.id = `uniform-${i}`;
    uniformDiv.style.display = p.distribution === "uniform" ? "block" : "none";
    const loRow = makeFieldRow("Lo");
    const loInp = numInput(p.lo);
    loInp.addEventListener("change", () => {
      paramConfigs[i].lo = parseFloat(loInp.value) || 0;
    });
    loRow.appendChild(loInp);
    uniformDiv.appendChild(loRow);
    const hiRow = makeFieldRow("Hi");
    const hiInp = numInput(p.hi);
    hiInp.addEventListener("change", () => {
      paramConfigs[i].hi = parseFloat(hiInp.value) || 0;
    });
    hiRow.appendChild(hiInp);
    uniformDiv.appendChild(hiRow);
    detailDiv.appendChild(uniformDiv);

    distSel.addEventListener("change", () => {
      paramConfigs[i].distribution = distSel.value;
      normalDiv.style.display = distSel.value === "normal" ? "block" : "none";
      uniformDiv.style.display = distSel.value === "uniform" ? "block" : "none";
    });

    row.appendChild(detailDiv);
    list.appendChild(row);
  }
}

function makeFieldRow(labelText: string): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:2px 0;";
  const lbl = document.createElement("label");
  lbl.style.cssText = "font-size:11px;opacity:0.7;";
  lbl.textContent = labelText;
  row.appendChild(lbl);
  return row;
}

function numInput(val: number): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.step = "any";
  inp.value = val.toString();
  inp.style.cssText = inputStyle();
  return inp;
}

function inputStyle(): string {
  return "width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#444);padding:2px 4px;font-size:11px;font-family:var(--vscode-editor-font-family,monospace);";
}

// ── Display Helpers ──

function setStatus(text: string): void {
  const el = document.getElementById("mc-status");
  if (el) el.textContent = text;
}

function showSpinner(n: number): void {
  hide("mc-placeholder");
  hide("mc-results");
  const spinner = document.getElementById("mc-spinner");
  if (spinner) spinner.style.display = "flex";
  const txt = document.getElementById("mc-spinner-text");
  if (txt) txt.textContent = `Running ${n} parallel simulations...`;
}

function hide(id: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function showResults(data: MCResultData): void {
  hide("mc-placeholder");
  hide("mc-spinner");
  const container = document.getElementById("mc-results");
  if (!container) return;
  container.style.display = "block";
  container.innerHTML = "";

  const vars = Object.keys(data.statistics);
  const nT = data.t.length;
  const lastIdx = nT > 0 ? nT - 1 : 0;
  const cov = data.convergence.coeffOfVariation;
  const converged = isFinite(cov) && cov < 0.05;

  // ── Summary Cards ──
  const cards = document.createElement("div");
  cards.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;";
  cards.appendChild(summaryCard("Samples", `${data.numSamples}`));
  cards.appendChild(summaryCard("Effective N", `${data.convergence.effectiveSampleSize}`));
  cards.appendChild(summaryCard("CoV", isFinite(cov) ? cov.toFixed(4) : "∞"));
  const convCard = summaryCard("Convergence", converged ? "✅ Converged" : "⚠️ Not converged");
  if (!converged) convCard.style.borderColor = "var(--vscode-testing-iconFailed,#f14c4c)";
  cards.appendChild(convCard);
  container.appendChild(cards);

  // ── Statistics Table ──
  const title = document.createElement("div");
  title.style.cssText = "font-size:13px;font-weight:600;margin-bottom:8px;";
  title.textContent = "Per-Variable Statistics (final time step)";
  container.appendChild(title);

  const table = document.createElement("table");
  table.style.cssText =
    "width:100%;border-collapse:collapse;font-size:11px;font-family:var(--vscode-editor-font-family,monospace);";

  // Header
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const h of ["Variable", "μ (mean)", "σ (std)", "CI Lower", "CI Upper", "p5", "p50", "p95"]) {
    const th = document.createElement("th");
    th.style.cssText =
      "text-align:left;padding:6px 8px;border-bottom:2px solid var(--vscode-panel-border,#444);font-weight:600;white-space:nowrap;";
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement("tbody");
  for (const varName of vars) {
    const s = data.statistics[varName];
    if (!s) continue;
    const tr = document.createElement("tr");
    tr.style.cssText = "border-bottom:1px solid var(--vscode-panel-border,#333);";

    const vals = [
      varName,
      fmt(s.mean[lastIdx]),
      fmt(s.stddev[lastIdx]),
      fmt(s.ciLo[lastIdx]),
      fmt(s.ciHi[lastIdx]),
      fmt(s.percentiles?.p5?.[lastIdx]),
      fmt(s.percentiles?.p50?.[lastIdx]),
      fmt(s.percentiles?.p95?.[lastIdx]),
    ];

    for (let ci = 0; ci < vals.length; ci++) {
      const td = document.createElement("td");
      td.style.cssText = `padding:5px 8px;${ci === 0 ? "font-weight:600;" : "opacity:0.9;"}`;
      td.textContent = vals[ci] ?? "—";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function summaryCard(label: string, value: string): HTMLDivElement {
  const card = document.createElement("div");
  card.style.cssText =
    "flex:1;min-width:120px;padding:10px 14px;border:1px solid var(--vscode-panel-border,#444);border-radius:4px;background:var(--vscode-sideBar-background,#252526);";
  card.innerHTML = `<div style="font-size:10px;text-transform:uppercase;opacity:0.6;margin-bottom:4px;letter-spacing:0.5px;">${esc(label)}</div><div style="font-size:16px;font-weight:700;">${esc(value)}</div>`;
  return card;
}

function fmt(v: number | undefined): string {
  if (v === undefined || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(3);
  return v.toPrecision(5);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Message Handler ──

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "modelParameters") {
    const params = msg.parameters as ModelParameter[];
    paramConfigs = params
      .filter((p) => p.type === "real")
      .map((p) => ({
        name: p.name,
        enabled: false,
        distribution: "normal",
        mean: p.defaultValue,
        stddev: Math.abs(p.defaultValue) * 0.05 || 0.1,
        lo: p.defaultValue * 0.9,
        hi: p.defaultValue * 1.1,
      }));
    buildParamRows();
  } else if (msg.type === "montecarloResult") {
    isRunning = false;
    const btn = document.getElementById("btn-run") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
    const data = msg.data as MCResultData;
    if (data.success) {
      setStatus(`✅ Completed ${data.numSamples} samples.`);
      showResults(data);
    } else {
      setStatus(`❌ Failed: ${data.error || "Unknown error"}`);
      hide("mc-spinner");
    }
  } else if (msg.type === "montecarloError") {
    isRunning = false;
    const btn = document.getElementById("btn-run") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
    setStatus(`❌ Error: ${msg.error}`);
    hide("mc-spinner");
  } else if (msg.type === "montecarloRunning") {
    // Already handled by showSpinner in runMonteCarlo
  }
});

export {};

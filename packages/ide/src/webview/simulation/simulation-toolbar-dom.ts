// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DOM builders for the Simulation Results webview:
// - Pinned run chips bar
// - Signal statistics & baseline delta drawer
// - Analysis & X-axis selector population
// - Parameter sliders, reset buttons, and parametric sweep drawers
// - Hierarchical variable tree view and search filtering
// - Solver preset synchronization

import { computeLocalSignalStats, escapeHtmlSim, formatTick } from "./simulation-signal-utils.js";
import {
  COLORS,
  RUN_ACCENT_COLORS,
  type ParameterSpec,
  type PinnedRun,
  type SimulationData,
} from "./simulation-types.js";

export interface RenderRunChipsParams {
  runsBarEl: HTMLElement | null;
  pinnedRuns: PinnedRun[];
  onRemoveRun: (runId: number) => void;
  onChange: () => void;
}

export function renderRunChipsDom(params: RenderRunChipsParams): void {
  const { runsBarEl, pinnedRuns, onRemoveRun, onChange } = params;
  if (!runsBarEl) return;
  runsBarEl.textContent = "";
  runsBarEl.classList.toggle("has-runs", pinnedRuns.length > 0);
  for (const run of pinnedRuns) {
    const chip = document.createElement("span");
    chip.className = "run-chip" + (run.visible ? "" : " off");
    const runColor = RUN_ACCENT_COLORS[(run.id - 1) % RUN_ACCENT_COLORS.length];
    chip.style.setProperty("--run-color", runColor);
    chip.title = (run.visible ? "Click to hide this run" : "Click to show this run") + " (double-click name to rename)";

    const dot = document.createElement("span");
    dot.className = "run-dot";
    chip.appendChild(dot);

    const label = document.createElement("span");
    label.textContent = run.name;
    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "run-rename";
      input.value = run.name;
      let done = false;
      const finish = (commit: boolean) => {
        if (done) return;
        done = true;
        if (commit && input.value.trim()) run.name = input.value.trim();
        renderRunChipsDom(params);
      };
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") finish(true);
        else if (ev.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      label.replaceWith(input);
      input.focus();
      input.select();
    });
    chip.appendChild(label);

    const close = document.createElement("button");
    close.className = "run-close";
    close.title = "Remove run";
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemoveRun(run.id);
    });
    chip.appendChild(close);

    chip.addEventListener("click", () => {
      run.visible = !run.visible;
      chip.classList.toggle("off", !run.visible);
      chip.title = run.visible ? "Click to hide this run (double-click name to rename)" : "Click to show this run";
      onChange();
    });
    runsBarEl.appendChild(chip);
  }
}

export interface RenderStatsDrawerParams {
  statsDrawerEl: HTMLElement | null;
  btnToggleStats: HTMLElement | null;
  showStatsDrawer: boolean;
  currentData: SimulationData | null;
  isComparingBaseline: boolean;
  pinnedRuns: PinnedRun[];
  hiddenVars: Set<string>;
}

export function renderStatsDrawerDom(params: RenderStatsDrawerParams): void {
  const { statsDrawerEl, btnToggleStats, showStatsDrawer, currentData, isComparingBaseline, pinnedRuns, hiddenVars } =
    params;
  if (!statsDrawerEl) return;
  statsDrawerEl.classList.toggle("visible", showStatsDrawer);
  btnToggleStats?.classList.toggle("active", showStatsDrawer);
  if (!showStatsDrawer || !currentData || currentData.t.length === 0) {
    statsDrawerEl.innerHTML = "";
    return;
  }
  const { t, y, states } = currentData;
  const activeBaseline = isComparingBaseline ? pinnedRuns.find((r) => r.visible) : undefined;
  const visibleVars = states.map((name, vi) => ({ name, vi })).filter((entry) => !hiddenVars.has(entry.name));

  if (visibleVars.length === 0) {
    statsDrawerEl.innerHTML = `<div style="color:var(--vscode-descriptionForeground,#888)">Select one or more variables to view signal statistics.</div>`;
    return;
  }

  const rowsHtml = visibleVars
    .map(({ name, vi }) => {
      const col = new Array<number>(t.length);
      for (let i = 0; i < t.length; i++) col[i] = y[i]?.[vi] ?? NaN;
      let baseCol: number[] | undefined;
      if (activeBaseline) {
        const bVi = activeBaseline.data.states.indexOf(name);
        if (bVi >= 0) {
          baseCol = activeBaseline.data.y.map((r) => r[bVi] ?? NaN);
        }
      }
      const s = computeLocalSignalStats(t, col, baseCol);
      const color = COLORS[vi % COLORS.length];
      const settleTxt = s.settlingTime !== null ? `${formatTick(s.settlingTime)}s` : "—";
      const baseCell = activeBaseline
        ? `<td>${s.baselineDeltaMean !== undefined ? formatTick(s.baselineDeltaMean) : "—"}</td><td>${s.baselineRmse !== undefined ? formatTick(s.baselineRmse) : "—"}</td>`
        : "";
      return `<tr>
        <td><span class="stats-dot" style="background:${color}"></span>${escapeHtmlSim(name)}</td>
        <td>${formatTick(s.min)}</td>
        <td>${formatTick(s.max)}</td>
        <td>${formatTick(s.peakToPeak)}</td>
        <td>${formatTick(s.mean)}</td>
        <td>${formatTick(s.rms)}</td>
        <td>${formatTick(s.finalVal)}</td>
        <td>${settleTxt}</td>
        ${baseCell}
      </tr>`;
    })
    .join("");

  statsDrawerEl.innerHTML = `<table>
    <thead><tr>
      <th>Variable</th><th>Min</th><th>Max</th><th>Pk-Pk</th><th>Mean</th><th>RMS</th><th>Final</th><th>Settling (2%)</th>
      ${activeBaseline ? `<th>Δ Mean (${escapeHtmlSim(activeBaseline.name)})</th><th>RMSE</th>` : ""}
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

export function populateXAxisSelectorDom(selectXAxis: HTMLSelectElement | null, states: string[]): string {
  if (!selectXAxis) return "__time__";
  const currentVal = selectXAxis.value;
  selectXAxis.innerHTML = '<option value="__time__">Time (s)</option>';
  states.forEach((s: string) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    selectXAxis.appendChild(opt);
  });
  if (states.includes(currentVal)) {
    selectXAxis.value = currentVal;
  } else {
    selectXAxis.value = "__time__";
  }
  return selectXAxis.value;
}

export function populateAnalysisSelectorsDom(
  selects: {
    selectCpX: HTMLSelectElement | null;
    selectCpY: HTMLSelectElement | null;
    selectCpColor: HTMLSelectElement | null;
    selectHistVar: HTMLSelectElement | null;
  },
  states: string[],
): void {
  const fillSelect = (sel: HTMLSelectElement | null, items: string[], fallbackIdx: number, includeEmpty = false) => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = includeEmpty ? '<option value="">None</option>' : "";
    for (const s of items) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    }
    if (prev && items.includes(prev)) {
      sel.value = prev;
    } else if (!includeEmpty && items.length > 0) {
      sel.value = items[Math.min(fallbackIdx, items.length - 1)]!;
    } else if (includeEmpty) {
      sel.value = "";
    }
  };
  fillSelect(selects.selectCpX, states, 0);
  fillSelect(selects.selectCpY, states, 1);
  fillSelect(selects.selectCpColor, states, 2, true);
  fillSelect(selects.selectHistVar, states, 0);
}

export interface RenderParametersDomParams {
  parameters: ParameterSpec[];
  paramsSection: HTMLElement;
  parametersView: HTMLElement;
  defaultParameters: Map<string, number>;
  includeSweep: boolean;
  onModifiedChange: () => void;
  onRunSweep?: (sweepConfig: { parameterName: string; start: number; end: number; steps: number }) => void;
}

export function renderParametersDom(params: RenderParametersDomParams): Record<string, HTMLInputElement> {
  const { parameters, paramsSection, parametersView, defaultParameters, includeSweep, onModifiedChange, onRunSweep } =
    params;

  const currentParameters: Record<string, HTMLInputElement> = {};
  if (parameters.length === 0) {
    paramsSection.style.display = "none";
    return currentParameters;
  }

  paramsSection.style.display = "flex";
  parametersView.innerHTML = "";
  defaultParameters.clear();

  parameters.forEach((p) => {
    defaultParameters.set(p.name, p.defaultValue);
    const item = document.createElement("div");
    item.className = "param-item";
    item.setAttribute("data-param-name", p.name);

    const header = document.createElement("div");
    header.className = "param-item-header";

    const label = document.createElement("div");
    label.className = "param-label";
    label.title = p.description || `${p.name} (default: ${p.defaultValue}${p.unit ? " " + p.unit : ""})`;

    const dot = document.createElement("span");
    dot.className = "param-dot";
    dot.style.display = "none";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name + (p.unit ? ` [${p.unit}]` : "");

    label.appendChild(dot);
    label.appendChild(nameSpan);

    const actions = document.createElement("div");
    actions.className = "param-actions";

    const resetBtn = document.createElement("button");
    resetBtn.className = "param-action-btn";
    resetBtn.textContent = "↺";
    resetBtn.title = `Reset ${p.name} to default (${p.defaultValue})`;
    actions.appendChild(resetBtn);

    let sweepBtn: HTMLButtonElement | null = null;
    if (includeSweep) {
      sweepBtn = document.createElement("button");
      sweepBtn.className = "param-action-btn";
      sweepBtn.textContent = "⚡";
      sweepBtn.title = `Configure parametric sweep for ${p.name}`;
      actions.appendChild(sweepBtn);
    }

    header.appendChild(label);
    header.appendChild(actions);

    const controls = document.createElement("div");
    controls.className = "param-controls";

    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.className = "param-input";
    input.value = typeof p.defaultValue === "number" ? p.defaultValue.toString() : "";

    let sMin = p.min !== undefined ? p.min : p.defaultValue !== 0 ? Math.min(0, p.defaultValue * 0.5) : -10;
    let sMax =
      p.max !== undefined
        ? p.max
        : p.defaultValue !== 0
          ? Math.max(p.defaultValue * 2, Math.abs(p.defaultValue) * 2)
          : 10;
    if (sMin === sMax) {
      sMin -= 1;
      sMax += 1;
    }

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "param-slider";
    slider.min = sMin.toString();
    slider.max = sMax.toString();
    slider.step = ((sMax - sMin) / 100).toString();
    slider.value = p.defaultValue.toString();

    controls.appendChild(slider);
    controls.appendChild(input);

    const updateModifiedState = () => {
      const currentVal = parseFloat(input.value);
      const isMod = !isNaN(currentVal) && currentVal !== p.defaultValue;
      dot.style.display = isMod ? "inline-block" : "none";
      onModifiedChange();
    };

    slider.addEventListener("input", () => {
      input.value = slider.value;
      updateModifiedState();
    });

    input.addEventListener("input", () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        if (val < parseFloat(slider.min)) slider.min = (val * 0.8).toString();
        if (val > parseFloat(slider.max)) slider.max = (val * 1.2).toString();
        slider.value = input.value;
      }
      updateModifiedState();
    });

    resetBtn.addEventListener("click", () => {
      input.value = p.defaultValue.toString();
      slider.value = p.defaultValue.toString();
      updateModifiedState();
    });

    item.appendChild(header);
    item.appendChild(controls);

    if (includeSweep && sweepBtn) {
      const sweepPanel = document.createElement("div");
      sweepPanel.className = "param-sweep-panel";
      sweepPanel.style.display = "none";

      const defVal = typeof p.defaultValue === "number" ? p.defaultValue : 1;
      const swStart = defVal * 0.8;
      const swEnd = defVal * 1.2;

      sweepPanel.innerHTML = `
        <div class="param-sweep-row">
          <label>Min</label>
          <input type="number" class="sweep-start" step="any" value="${swStart.toFixed(2)}">
          <label>Max</label>
          <input type="number" class="sweep-end" step="any" value="${swEnd.toFixed(2)}">
        </div>
        <div class="param-sweep-row">
          <label>Steps</label>
          <input type="number" class="sweep-steps" step="1" min="2" max="50" value="5">
          <button class="btn-run-sweep">Run Sweep</button>
        </div>
      `;

      sweepBtn.addEventListener("click", () => {
        const isHidden = sweepPanel.style.display === "none";
        sweepPanel.style.display = isHidden ? "flex" : "none";
        sweepBtn!.style.color = isHidden ? "var(--vscode-button-background, #0e639c)" : "";
      });

      sweepPanel.querySelector(".btn-run-sweep")?.addEventListener("click", () => {
        const startVal = parseFloat((sweepPanel.querySelector(".sweep-start") as HTMLInputElement).value);
        const endVal = parseFloat((sweepPanel.querySelector(".sweep-end") as HTMLInputElement).value);
        const stepsVal = parseInt((sweepPanel.querySelector(".sweep-steps") as HTMLInputElement).value, 10) || 5;

        onRunSweep?.({
          parameterName: p.name,
          start: isNaN(startVal) ? defVal * 0.8 : startVal,
          end: isNaN(endVal) ? defVal * 1.2 : endVal,
          steps: stepsVal,
        });
      });

      item.appendChild(sweepPanel);
    }

    parametersView.appendChild(item);
    currentParameters[p.name] = input;
  });

  onModifiedChange();
  return currentParameters;
}

interface TreeNode {
  name: string;
  fullName: string;
  children: Map<string, TreeNode>;
  isVariable: boolean;
  colorIndex?: number;
}

export interface BuildVariableTreeParams {
  treeViewEl: HTMLElement;
  variables: string[];
  currentData: SimulationData | null;
  hiddenVars: Set<string>;
  customRightVars: Set<string>;
  onToggleVisibility: () => void;
  onEnableDualY: () => void;
  onAxisChanged: () => void;
}

export function buildVariableTreeDom(params: BuildVariableTreeParams): void {
  const {
    treeViewEl,
    variables,
    currentData,
    hiddenVars,
    customRightVars,
    onToggleVisibility,
    onEnableDualY,
    onAxisChanged,
  } = params;

  const root: TreeNode = { name: "", fullName: "", children: new Map(), isVariable: false };

  variables.forEach((variable, i) => {
    const isDer = variable.startsWith("der(") && variable.endsWith(")");
    const innerVar = isDer ? variable.slice(4, -1) : variable;
    const originalParts = innerVar.split(".");

    let current = root;
    let prefix = "";

    for (let j = 0; j < originalParts.length; j++) {
      const isLeaf = j === originalParts.length - 1;
      const basePart = originalParts[j];

      const part = isLeaf && isDer ? `der(${basePart})` : basePart;
      prefix = prefix ? `${prefix}.${basePart}` : basePart;
      const fullName = isLeaf ? variable : prefix;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullName,
          children: new Map(),
          isVariable: isLeaf,
          colorIndex: isLeaf ? i : undefined,
        });
      }
      current = current.children.get(part) as TreeNode;
    }
  });

  treeViewEl.innerHTML = "";

  function renderNode(node: TreeNode, parentEl: HTMLElement) {
    const li = document.createElement("li");
    li.className = "tree-node";

    const item = document.createElement("div");
    item.className = "tree-item";

    const hasChildren = node.children.size > 0;
    const caret = document.createElement("span");
    caret.className = "tree-caret " + (hasChildren ? "expanded" : "empty");
    item.appendChild(caret);

    if (node.isVariable) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "tree-checkbox";
      checkbox.checked = !hiddenVars.has(node.fullName);

      const swatch = document.createElement("div");
      swatch.style.width = "10px";
      swatch.style.height = "10px";
      swatch.style.borderRadius = "2px";
      swatch.style.marginRight = "6px";
      if (node.colorIndex !== undefined) {
        swatch.style.background = COLORS[node.colorIndex % COLORS.length];
      }

      item.appendChild(checkbox);
      item.appendChild(swatch);

      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          hiddenVars.delete(node.fullName);
        } else {
          hiddenVars.add(node.fullName);
        }
        onToggleVisibility();
      });

      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          checkbox.click();
        }
      });
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    const varMeta = node.isVariable ? currentData?.variableMetadata?.[node.fullName] : undefined;
    label.textContent = varMeta?.unit ? `${node.name} [${varMeta.unit}]` : node.name;
    label.title = varMeta?.description
      ? `${node.fullName}${varMeta.unit ? ` [${varMeta.unit}]` : ""} — ${varMeta.description}`
      : node.fullName;
    item.appendChild(label);

    if (node.isVariable && currentData) {
      const actions = document.createElement("div");
      actions.className = "tree-item-actions";

      const vi = currentData.states.indexOf(node.fullName);
      if (vi >= 0 && currentData.y.length > 0) {
        const lastVal = currentData.y[currentData.y.length - 1]?.[vi];
        if (lastVal !== undefined && isFinite(lastVal)) {
          const stat = document.createElement("span");
          stat.className = "var-stat-pill";
          stat.textContent =
            Math.abs(lastVal) >= 1000 || (Math.abs(lastVal) < 0.01 && lastVal !== 0)
              ? lastVal.toExponential(2)
              : lastVal.toFixed(2);
          actions.appendChild(stat);
        }
      }

      const axisPill = document.createElement("span");
      axisPill.className = "axis-pill" + (customRightVars.has(node.fullName) ? " right" : "");
      axisPill.textContent = customRightVars.has(node.fullName) ? "R" : "L";
      axisPill.title = "Toggle Primary (Left) or Secondary (Right) Y-Axis";
      axisPill.addEventListener("click", (e) => {
        e.stopPropagation();
        if (customRightVars.has(node.fullName)) {
          customRightVars.delete(node.fullName);
          axisPill.className = "axis-pill";
          axisPill.textContent = "L";
        } else {
          customRightVars.add(node.fullName);
          axisPill.className = "axis-pill right";
          axisPill.textContent = "R";
          onEnableDualY();
        }
        onAxisChanged();
      });
      actions.appendChild(axisPill);
      item.appendChild(actions);
    }

    li.appendChild(item);

    if (hasChildren) {
      const childrenUl = document.createElement("ul");
      childrenUl.className = "tree-children expanded";

      item.addEventListener("click", (e) => {
        if (node.isVariable && (e.target as HTMLElement).tagName === "INPUT") return;
        const isExpanded = childrenUl.classList.contains("expanded");
        if (isExpanded) {
          childrenUl.classList.remove("expanded");
          caret.classList.remove("expanded");
        } else {
          childrenUl.classList.add("expanded");
          caret.classList.add("expanded");
        }
      });

      const childNodes = Array.from(node.children.values()).sort((a, b) => {
        if (a.children.size > 0 && b.children.size === 0) return -1;
        if (a.children.size === 0 && b.children.size > 0) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const child of childNodes) {
        renderNode(child, childrenUl);
      }
      li.appendChild(childrenUl);
    }

    parentEl.appendChild(li);
  }

  const sortedRoots = Array.from(root.children.values()).sort((a, b) => {
    if (a.children.size > 0 && b.children.size === 0) return -1;
    if (a.children.size === 0 && b.children.size > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of sortedRoots) {
    renderNode(child, treeViewEl);
  }
}

export function filterVariablesDom(
  treeViewEl: HTMLElement,
  btnClearVarSearch: HTMLElement | null,
  query: string,
): void {
  const q = query.trim().toLowerCase();
  if (btnClearVarSearch) {
    btnClearVarSearch.style.display = q ? "block" : "none";
  }

  const nodes = treeViewEl.querySelectorAll("li.tree-node");
  if (!q) {
    nodes.forEach((n) => {
      (n as HTMLElement).style.display = "";
    });
    return;
  }

  nodes.forEach((n) => {
    const item = n.querySelector(":scope > .tree-item");
    const label = item?.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
    const title = (item?.querySelector(".tree-label") as HTMLElement)?.title?.toLowerCase() || "";
    const isMatch = label.includes(q) || title.includes(q);

    if (!n.querySelector("ul.tree-children")) {
      (n as HTMLElement).style.display = isMatch ? "" : "none";
    }
  });

  nodes.forEach((n) => {
    const childrenUl = n.querySelector(":scope > ul.tree-children");
    if (childrenUl) {
      const visibleChildren = childrenUl.querySelectorAll("li.tree-node:not([style*='display: none'])");
      if (visibleChildren.length > 0) {
        (n as HTMLElement).style.display = "";
        childrenUl.classList.add("expanded");
        n.querySelector(":scope > .tree-item > .tree-caret")?.classList.add("expanded");
      } else {
        (n as HTMLElement).style.display = "none";
      }
    }
  });
}

export function filterParametersDom(
  parametersView: HTMLElement,
  btnClearParamSearch: HTMLElement | null,
  query: string,
): void {
  const q = query.trim().toLowerCase();
  if (btnClearParamSearch) {
    btnClearParamSearch.style.display = q ? "block" : "none";
  }
  const items = parametersView.querySelectorAll(".param-item");
  items.forEach((item) => {
    const name = item.getAttribute("data-param-name")?.toLowerCase() || "";
    const label = item.querySelector(".param-label")?.textContent?.toLowerCase() || "";
    if (!q || name.includes(q) || label.includes(q)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
}

export function syncSolverFromExperimentDom(
  stSolver: HTMLSelectElement | null,
  stPreset: HTMLSelectElement | null,
  solverName: string | undefined,
): void {
  if (!stSolver) return;
  const solverLower = (solverName || "").toLowerCase();
  if (solverLower.includes("dommel") || solverLower.includes("emt") || solverLower.includes("companion")) {
    stSolver.value = "dommel";
    if (stPreset) stPreset.value = "emt";
  } else if (solverLower.includes("cvode") || solverLower.includes("bdf")) {
    stSolver.value = "cvode";
    if (stPreset) stPreset.value = "stiff";
  } else if (solverLower.includes("rodas")) {
    stSolver.value = "rodas4p";
    if (stPreset) stPreset.value = "stiff";
  } else if (solverLower.includes("tsit")) {
    stSolver.value = "tsit5";
    if (stPreset) stPreset.value = "standard";
  } else if (solverLower.includes("rk4")) {
    stSolver.value = "rk4";
    if (stPreset) stPreset.value = "fast";
  } else if (solverLower.includes("euler")) {
    stSolver.value = "euler";
    if (stPreset) stPreset.value = "custom";
  } else if (solverLower.includes("webgpu")) {
    stSolver.value = "webgpu";
    if (stPreset) stPreset.value = "custom";
  } else {
    stSolver.value = "dopri5";
    if (stPreset) stPreset.value = "standard";
  }
}

export interface ApplySolverPresetParams {
  preset: string;
  tStartInput: HTMLInputElement;
  tStopInput: HTMLInputElement;
  intervalInput: HTMLInputElement;
  toleranceInput: HTMLInputElement;
  stSolver: HTMLSelectElement | null;
  stRtol: HTMLInputElement | null;
  stAtol: HTMLInputElement | null;
  stSteadyState: HTMLInputElement | null;
}

export function applySolverPresetDom(params: ApplySolverPresetParams): void {
  const { preset, tStartInput, tStopInput, intervalInput, toleranceInput, stSolver, stRtol, stAtol, stSteadyState } =
    params;
  const start = parseFloat(tStartInput.value) || 0;
  const stop = parseFloat(tStopInput.value) || 10;
  const span = Math.max(0.001, stop - start);

  if (preset === "standard") {
    if (stSolver) stSolver.value = "dopri5";
    intervalInput.value = (span / 500).toString();
    toleranceInput.value = "1e-4";
    if (stRtol) stRtol.value = "1e-4";
    if (stAtol) stAtol.value = "1e-6";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "fast") {
    if (stSolver) stSolver.value = "rk4";
    intervalInput.value = (span / 250).toString();
    toleranceInput.value = "1e-3";
    if (stRtol) stRtol.value = "1e-3";
    if (stAtol) stAtol.value = "1e-4";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "high-accuracy") {
    if (stSolver) stSolver.value = "dopri5";
    intervalInput.value = (span / 2000).toString();
    toleranceInput.value = "1e-7";
    if (stRtol) stRtol.value = "1e-7";
    if (stAtol) stAtol.value = "1e-8";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "stiff") {
    if (stSolver) stSolver.value = "cvode";
    intervalInput.value = (span / 500).toString();
    toleranceInput.value = "1e-5";
    if (stRtol) stRtol.value = "1e-5";
    if (stAtol) stAtol.value = "1e-7";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "emt") {
    if (stSolver) stSolver.value = "dommel";
    intervalInput.value = "0.00005";
    toleranceInput.value = "1e-4";
    if (stRtol) stRtol.value = "1e-4";
    if (stAtol) stAtol.value = "1e-6";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "steady-state") {
    if (stSolver) stSolver.value = "dopri5";
    if (stSteadyState) stSteadyState.checked = true;
  }
}

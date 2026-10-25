// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import {
  dropComponentGhost,
  evaluatePropertyPredicate,
  getGraph,
  getTypicalNodeSize,
  initGraph,
  rerouteEdgeOrthogonal,
  setDiagramOptions,
  updateParameterText,
  validatePropertyValue,
} from "@modelscript/diagram";
import DOMPurify from "dompurify";

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SNAP_GRID = 20;
const snapToGrid = (val: number, step = SNAP_GRID) => Math.round(val / step) * step;

// Add global binding for close button
function initPropertiesClose() {
  document.getElementById("properties-close")?.addEventListener("click", () => {
    document.getElementById("properties-panel")?.classList.remove("open");
  });
}
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initPropertiesClose);
} else {
  initPropertiesClose();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage() {
    /* noop fallback */
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingDiagramActions: any[] = [];
let diagramActionTimer: ReturnType<typeof setTimeout> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueueDiagramAction(action: any) {
  console.log("[diagram.ts] enqueuing diagram action:", action.type, action);

  if (action.type === "interactiveWrite") {
    vscode.postMessage({ type: "interactiveWrite", ...action });
    return;
  }

  pendingDiagramActions.push(action);
  if (diagramActionTimer) clearTimeout(diagramActionTimer);

  const isSpatial = ["move", "resize", "rotate", "toggleDisable", "moveEdge"].includes(action.type);
  const delay = isSpatial ? 10 : 0;

  diagramActionTimer = setTimeout(() => {
    const actions = pendingDiagramActions;
    pendingDiagramActions = [];
    diagramActionTimer = null;
    if (actions.length > 0) {
      console.log("[diagram.ts] posting diagram edits to host:", actions.length);
      vscode.postMessage({ type: "diagramEdit", actions });
    }
  }, delay);
}

// Global initialization
function initDiagramBridge() {
  const container = document.getElementById("container");
  if (!container) return;

  const isDark =
    document.documentElement.classList.contains("vscode-dark") ||
    document.documentElement.classList.contains("vscode-high-contrast");

  let ghostRafId: number | null = null;
  let lastGhostClientPos: { x: number; y: number } | null = null;

  const updateGhostPosition = (clientX: number, clientY: number) => {
    lastGhostClientPos = { x: clientX, y: clientY };
    if (!ghostRafId) {
      ghostRafId = requestAnimationFrame(() => {
        ghostRafId = null;
        if (lastGhostClientPos && (window as any).__movePlacementGhost) {
          const g = getGraph() ?? initGraph(isDark);
          if (g) {
            const p = g.clientToLocal(lastGhostClientPos.x, lastGhostClientPos.y);
            (window as any).__movePlacementGhost(snapToGrid(p.x), snapToGrid(p.y), window.event);
          }
        }
      });
    }
  };

  let isPointerOverCanvas = false;

  window.addEventListener(
    "mouseenter",
    () => {
      isPointerOverCanvas = true;
      (window as any).__setPointerOverCanvas?.(true);
    },
    true,
  );

  window.addEventListener(
    "mouseleave",
    () => {
      isPointerOverCanvas = false;
      (window as any).__setPointerOverCanvas?.(false);
    },
    true,
  );

  const onDragEnterOrOver = (e: DragEvent) => {
    e.preventDefault();
    isPointerOverCanvas = true;
    lastGhostClientPos = { x: e.clientX, y: e.clientY };
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    updateGhostPosition(e.clientX, e.clientY);
    (window as any).__setPointerOverCanvas?.(true, { x: e.clientX, y: e.clientY });
  };

  window.addEventListener("dragenter", onDragEnterOrOver, true);
  window.addEventListener("dragover", onDragEnterOrOver, true);
  container.addEventListener("dragenter", onDragEnterOrOver, true);
  container.addEventListener("dragover", onDragEnterOrOver, true);

  window.addEventListener(
    "mousemove",
    (e) => {
      isPointerOverCanvas = true;
      lastGhostClientPos = { x: e.clientX, y: e.clientY };
      const placementData = (window as any).__getPlacementData?.();
      if (placementData) {
        // If dragging from the library tree and the mouse button is no longer held down (buttons === 0),
        // the drop has completed! Place the component immediately.
        if (placementData.isDrag && typeof e.buttons === "number" && e.buttons === 0) {
          handleDropOrPlace(e.clientX, e.clientY);
          return;
        }
        updateGhostPosition(e.clientX, e.clientY);
      }
    },
    true,
  );

  window.addEventListener(
    "dragleave",
    (e) => {
      // In HTML5 drag and drop, dragleave fires on transitions between child SVG/DOM elements,
      // where e.relatedTarget is frequently null in browsers.
      // Only hide placement ghost if the pointer has actually exited the webview window bounds!
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        isPointerOverCanvas = false;
        (window as any).__setPointerOverCanvas?.(false);
        if (ghostRafId) {
          cancelAnimationFrame(ghostRafId);
          ghostRafId = null;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__hidePlacementGhost?.();
      }
    },
    true,
  );

  let lastDropTimestamp = 0;

  const handleDropOrPlace = (clientX?: number, clientY?: number, dataTransferOrExtra?: any) => {
    const now = Date.now();
    if (now - lastDropTimestamp < 350) return;
    if (ghostRafId) {
      cancelAnimationFrame(ghostRafId);
      ghostRafId = null;
    }
    const targetX = typeof clientX === "number" && clientX > 0 ? clientX : (lastGhostClientPos?.x ?? 0);
    const targetY = typeof clientY === "number" && clientY > 0 ? clientY : (lastGhostClientPos?.y ?? 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getPlacementData = (window as any).__getPlacementData;
    let placementData = getPlacementData ? getPlacementData() : null;

    if (!placementData && dataTransferOrExtra) {
      if (dataTransferOrExtra.className) {
        placementData = {
          className: dataTransferOrExtra.className,
          iconSvg: dataTransferOrExtra.iconSvg || undefined,
        };
      } else if (typeof dataTransferOrExtra.getData === "function") {
        const classNameMime = dataTransferOrExtra.getData("application/vnd.modelscript.classname");
        const iconSvgMime = dataTransferOrExtra.getData("application/vnd.modelscript.iconsvg");
        if (classNameMime) {
          placementData = { className: classNameMime, iconSvg: iconSvgMime || undefined };
        }

        if (!placementData) {
          const treeMime =
            dataTransferOrExtra.getData("application/vnd.code.tree.modelscript.librarytree") ||
            dataTransferOrExtra.getData("application/vnd.code.tree.modelscript.libraryTree");
          const rawText =
            treeMime || dataTransferOrExtra.getData("application/json") || dataTransferOrExtra.getData("text/plain");
          if (rawText) {
            try {
              const parsed = JSON.parse(rawText);
              if (parsed && parsed.className) {
                placementData = parsed;
              } else if (Array.isArray(parsed) && parsed[0]?.info?.compositeName) {
                placementData = {
                  className: parsed[0].info.compositeName,
                  iconSvg: parsed[0].info.iconSvg,
                };
              }
            } catch {
              const trimmed = rawText.trim();
              if (trimmed && /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(trimmed)) {
                placementData = { className: trimmed };
              }
            }
          }
        }
      }
    }

    if (placementData && placementData.className) {
      lastDropTimestamp = now;
      const g = getGraph() ?? initGraph(isDark);
      if (g) {
        const p = g.clientToLocal(targetX, targetY);
        const snappedX = snapToGrid(p.x);
        const snappedY = snapToGrid(p.y);
        const { width, height } = getTypicalNodeSize(g);
        dropComponentGhost(
          g,
          snappedX,
          snappedY,
          placementData.className,
          placementData.iconSvg,
          isDark,
          width,
          height,
        );
        enqueueDiagramAction({
          type: "addComponent",
          className: placementData.className,
          x: snappedX,
          y: snappedY,
        });
        // Clear placement ghost and state inside diagram-core without removing the drop animation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__clearPlacement?.();
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleDropOrPlace(e.clientX, e.clientY, e.dataTransfer);
  };

  window.addEventListener("drop", onDrop, true);
  window.addEventListener("drop", onDrop, false);
  container.addEventListener("drop", onDrop, true);
  container.addEventListener("drop", onDrop, false);

  const onPointerUpOrMouseUp = (e: MouseEvent | PointerEvent) => {
    // Only handle placement on mouseup/pointerup if placement mode was active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__getPlacementData?.()) {
      handleDropOrPlace(e.clientX, e.clientY);
    }
  };

  window.addEventListener("mouseup", onPointerUpOrMouseUp, true);
  window.addEventListener("mouseup", onPointerUpOrMouseUp, false);
  window.addEventListener("pointerup", onPointerUpOrMouseUp, true);
  window.addEventListener("pointerup", onPointerUpOrMouseUp, false);
  container.addEventListener("mouseup", onPointerUpOrMouseUp, true);
  container.addEventListener("pointerup", onPointerUpOrMouseUp, true);

  // Handle messages forwarded from the top-level workbench or extension host
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "workbenchDrop") {
      handleDropOrPlace(e.data.clientX, e.data.clientY, e.data);
    } else if (e.data.type === "workbenchDragOver" && typeof e.data.clientX === "number") {
      isPointerOverCanvas = true;
      (window as any).__setPointerOverCanvas?.(true, { x: e.data.clientX, y: e.data.clientY });
      updateGhostPosition(e.data.clientX, e.data.clientY);
    } else if (e.data.type === "dragEnd") {
      if (isPointerOverCanvas && lastGhostClientPos) {
        handleDropOrPlace(lastGhostClientPos.x, lastGhostClientPos.y);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__clearPlacement?.();
      }
    } else if (e.data.type === "simulationData") {
      currentSimData = e.data.data;
      const runBtn = document.getElementById("hud-run");
      if (runBtn) {
        runBtn.textContent = "▶ Sim Ready";
        runBtn.style.background = "#10b981";
      }
      updateAllPinnedScopes();
    }
  });

  setDiagramOptions({
    container,
    isDark,
    onAction: enqueueDiagramAction,
    onSelect: (id: unknown) => {
      if (!id) {
        currentRenderedNodeId = null;
        document.getElementById("properties-panel")?.classList.remove("open");
      }
    },
    onShowProperties: (nodeId: unknown, cachedProps: unknown, isLoading?: boolean) => {
      if (typeof nodeId === "string" && (nodeId === "__diagram_background__" || nodeId === "__diagram_axes__")) {
        currentRenderedNodeId = null;
        document.getElementById("properties-panel")?.classList.remove("open");
        return;
      }
      showProperties({ id: nodeId, properties: cachedProps, isLoading });
      // Only request full properties if not already loaded or if explicitly in loading state
      if (!cachedProps || isLoading === true) {
        vscode.postMessage({ type: "getProperties", componentName: nodeId });
      }
    },
    onUndo: () => vscode.postMessage({ type: "undo" }),
    onRedo: () => vscode.postMessage({ type: "redo" }),
    onMessage: (msg) => vscode.postMessage(msg),
  });

  initCanvasHud();
  initContextMenu();
  initKeyboardAccelerators();
}

const SPOTLIGHT_CATALOG = [
  { id: "master:ground", name: "Ground (0 V Reference)", category: "Sources & Ground" },
  { id: "master:bus", name: "Busbar (Substation Node)", category: "Meters & Buses" },
  { id: "master:breaker3", name: "3-Phase Circuit Breaker", category: "Switchgear" },
  { id: "master:resistor", name: "Resistor Branch (R)", category: "Passive Branches" },
  { id: "master:inductor", name: "Inductor Branch (L)", category: "Passive Branches" },
  { id: "master:capacitor", name: "Capacitor Branch (C)", category: "Passive Branches" },
  { id: "master:source3", name: "3-Phase AC Voltage Source", category: "Sources & Machines" },
  { id: "master:source_1", name: "DC / 1-Phase Voltage Source", category: "Sources & Machines" },
  { id: "master:xfmr-3p2w", name: "3-Phase 2-Winding Transformer", category: "Transformers" },
  { id: "master:xfmr-3p3w", name: "3-Phase 3-Winding Transformer", category: "Transformers" },
  { id: "master:tline", name: "Bergeron Transmission Line", category: "Lines & Cables" },
  { id: "master:cable", name: "Coaxial Cable (Wedepohl)", category: "Lines & Cables" },
  { id: "master:battery", name: "Battery Energy Storage (BESS)", category: "Sources & Machines" },
  { id: "master:sync_machine", name: "6th-Order Synchronous Machine", category: "Sources & Machines" },
  { id: "master:wound_rotor", name: "Wound-Rotor Induction Machine", category: "Sources & Machines" },
  { id: "master:dfig", name: "DFIG Wind Turbine Generator", category: "Sources & Machines" },
  { id: "master:vsc_pwm", name: "2/3-Level VSC PWM Converter", category: "Power Electronics" },
  { id: "master:mmc", name: "Modular Multilevel Converter (MMC)", category: "Power Electronics" },
  { id: "master:mov", name: "Metal-Oxide Surge Arrester (MOV)", category: "Protection" },
  { id: "master:voltmeter", name: "Voltmeter Phase-Gnd Probe", category: "Meters & Probes" },
  { id: "master:ammeter", name: "Series Current Sensor", category: "Meters & Probes" },
  { id: "master:pgb", name: "Output Channel Recorder (PGB)", category: "Meters & Probes" },
  { id: "master:pi_ctlr", name: "CSMF PI Controller", category: "Control Blocks" },
  { id: "master:gain", name: "CSMF Proportional Gain", category: "Control Blocks" },
  { id: "master:sum", name: "CSMF Sum / Difference Junction", category: "Control Blocks" },
  { id: "master:limit", name: "CSMF Hard Limiter", category: "Control Blocks" },
  { id: "master:realpole", name: "CSMF Real Pole Filter", category: "Control Blocks" },
  { id: "master:leadlag", name: "CSMF Lead-Lag Compensator", category: "Control Blocks" },
  { id: "master:rms3ph", name: "CSMF 3-Phase RMS Meter", category: "Control Blocks" },
  { id: "master:abcdq0", name: "CSMF Park dq0 Transformation", category: "Control Blocks" },
  { id: "master:datalabel", name: "Wireless Data Label Tag", category: "Meters & Buses" },
];

let isWireModeActive = false;

function initCanvasHud() {
  const hudSelect = document.getElementById("hud-select");
  const hudWire = document.getElementById("hud-wire");
  const hudGnd = document.getElementById("hud-gnd");
  const hudBus = document.getElementById("hud-bus");
  const hudBreaker = document.getElementById("hud-breaker");
  const hudResistor = document.getElementById("hud-resistor");
  const hudOmni = document.getElementById("hud-omni");
  const hudRun = document.getElementById("hud-run");

  const setSelectMode = () => {
    isWireModeActive = false;
    hudWire?.classList.remove("active");
    hudSelect?.classList.add("active");
    const container = document.getElementById("container");
    if (container) container.style.cursor = "default";
  };

  const setWireMode = () => {
    isWireModeActive = !isWireModeActive;
    if (isWireModeActive) {
      hudSelect?.classList.remove("active");
      hudWire?.classList.add("active");
      const container = document.getElementById("container");
      if (container) container.style.cursor = "crosshair";
    } else {
      setSelectMode();
    }
  };

  hudSelect?.addEventListener("click", setSelectMode);
  hudWire?.addEventListener("click", setWireMode);

  hudGnd?.addEventListener("click", () => {
    setSelectMode();
    (window as any).__startPlacement?.({ className: "master:ground", classKind: "Component" });
  });

  hudBus?.addEventListener("click", () => {
    setSelectMode();
    (window as any).__startPlacement?.({ className: "master:bus", classKind: "Component" });
  });

  hudBreaker?.addEventListener("click", () => {
    setSelectMode();
    (window as any).__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
  });

  hudResistor?.addEventListener("click", () => {
    setSelectMode();
    (window as any).__startPlacement?.({ className: "master:resistor", classKind: "Component" });
  });

  hudOmni?.addEventListener("click", (e) => {
    showSpotlight(e.clientX || window.innerWidth / 2, 60);
  });

  hudRun?.addEventListener("click", () => {
    vscode.postMessage({ type: "runSimulation" });
  });
}

export interface SimulationTelemetryData {
  time: number[];
  busVoltages: Record<string, number[]>;
  busPhaseVoltages?: Record<string, { a: number[]; b: number[]; c: number[] }>;
  branchCurrents: Record<string, number[]>;
  branchPhaseCurrents?: Record<string, { a: number[]; b: number[]; c: number[] }>;
}

let currentSimData: SimulationTelemetryData | null = null;
const pinnedScopes = new Map<string, { name: string; element: HTMLElement }>();

function findWaveform(
  id: string,
  name?: string,
): {
  kind: "voltage" | "current";
  label: string;
  unit: string;
  isThreePhase: boolean;
  values: number[];
  phases?: { a: number[]; b: number[]; c: number[] };
} | null {
  if (!currentSimData) return null;
  const candidates = [name, id].filter(Boolean) as string[];
  const cleanCandidates = candidates.flatMap((c) => [c, c.replace(/^v_/, ""), c.replace(/^i_/, ""), c.toLowerCase()]);

  // 1. Check bus phase voltages
  if (currentSimData.busPhaseVoltages) {
    for (const [bus, phases] of Object.entries(currentSimData.busPhaseVoltages)) {
      if (cleanCandidates.some((c) => bus.toLowerCase() === c.toLowerCase())) {
        return {
          kind: "voltage",
          label: `Bus: ${bus} (3-Phase)`,
          unit: "V",
          isThreePhase: true,
          values: phases.a,
          phases,
        };
      }
    }
  }

  // 2. Check bus line voltages
  if (currentSimData.busVoltages) {
    for (const [bus, arr] of Object.entries(currentSimData.busVoltages)) {
      if (cleanCandidates.some((c) => bus.toLowerCase() === c.toLowerCase())) {
        return {
          kind: "voltage",
          label: `Bus: ${bus}`,
          unit: "V",
          isThreePhase: false,
          values: arr,
        };
      }
    }
  }

  // 3. Check branch phase currents
  if (currentSimData.branchPhaseCurrents) {
    for (const [br, phases] of Object.entries(currentSimData.branchPhaseCurrents)) {
      if (cleanCandidates.some((c) => br.toLowerCase() === c.toLowerCase())) {
        return {
          kind: "current",
          label: `Branch: ${br} (3-Phase)`,
          unit: "A",
          isThreePhase: true,
          values: phases.a,
          phases,
        };
      }
    }
  }

  // 4. Check branch currents
  if (currentSimData.branchCurrents) {
    for (const [br, arr] of Object.entries(currentSimData.branchCurrents)) {
      if (cleanCandidates.some((c) => br.toLowerCase() === c.toLowerCase())) {
        return {
          kind: "current",
          label: `Branch: ${br}`,
          unit: "A",
          isThreePhase: false,
          values: arr,
        };
      }
    }
  }

  return null;
}

function computeWaveformMetrics(vals: number[]) {
  if (!vals || vals.length === 0) return { rms: 0, peak: 0, last: 0 };
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]!;
    sumSq += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSq / vals.length);
  return { rms, peak, last: vals[vals.length - 1] ?? 0 };
}

function formatEngineeringValue(val: number, unit: string): string {
  const abs = Math.abs(val);
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)} M${unit}`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(2)} k${unit}`;
  if (abs >= 1 || abs === 0) return `${val.toFixed(2)} ${unit}`;
  if (abs >= 1e-3) return `${(val * 1e3).toFixed(2)} m${unit}`;
  return `${(val * 1e6).toFixed(2)} µ${unit}`;
}

function generateSparklineSvg(
  wf: { values: number[]; phases?: { a: number[]; b: number[]; c: number[] }; isThreePhase: boolean },
  width = 180,
  height = 32,
): string {
  const traces =
    wf.isThreePhase && wf.phases
      ? [
          { vals: wf.phases.a, color: "#ef4444" },
          { vals: wf.phases.b, color: "#10b981" },
          { vals: wf.phases.c, color: "#3b82f6" },
        ]
      : [{ vals: wf.values, color: "#38bdf8" }];

  let min = Infinity;
  let max = -Infinity;
  for (const tr of traces) {
    for (let i = 0; i < tr.vals.length; i++) {
      const v = tr.vals[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!isFinite(min) || !isFinite(max) || min === max) {
    min = -1;
    max = 1;
  }
  const range = max - min;

  const paths = traces
    .map((tr) => {
      const n = tr.vals.length;
      if (n === 0) return "";
      const step = Math.max(1, Math.floor(n / 60));
      const points: [number, number][] = [];
      for (let i = 0; i < n; i += step) {
        const x = (i / Math.max(1, n - 1)) * width;
        const normY = (tr.vals[i]! - min) / range;
        const y = height - (normY * (height - 4) + 2);
        points.push([x, y]);
      }
      const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${tr.color}" stroke-width="1.5" stroke-linecap="round"/>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">
    <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="rgba(148, 163, 184, 0.2)" stroke-dasharray="2,2"/>
    ${paths}
  </svg>`;
}

function pinSparklineScope(id: string, name: string) {
  const container = document.getElementById("pinned-scopes-container");
  if (!container) return;
  if (pinnedScopes.has(id)) {
    const existing = pinnedScopes.get(id);
    existing?.element.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const card = document.createElement("div");
  card.className = "pinned-scope-card";
  card.id = `pinned-scope-${id}`;

  const header = document.createElement("div");
  header.className = "scope-header";
  header.innerHTML = `
    <span>⚡ ${escapeHtml(name || id)}</span>
    <button class="scope-close-btn" title="Close Scope">×</button>
  `;

  header.querySelector(".scope-close-btn")?.addEventListener("click", () => {
    card.remove();
    pinnedScopes.delete(id);
  });

  const body = document.createElement("div");
  body.className = "scope-body";

  card.appendChild(header);
  card.appendChild(body);
  container.appendChild(card);

  pinnedScopes.set(id, { name, element: card });
  updateScopeCard(id, body);
}

function updateScopeCard(id: string, bodyEl: HTMLElement) {
  const scope = pinnedScopes.get(id);
  if (!scope) return;
  const wf = findWaveform(id, scope.name);
  if (!wf) {
    bodyEl.innerHTML = `<div style="color: #94a3b8; font-size: 11px;">Waiting for simulation telemetry...</div>`;
    return;
  }

  const metrics = computeWaveformMetrics(wf.values);
  const rmsStr = formatEngineeringValue(metrics.rms, wf.unit);
  const pkStr = formatEngineeringValue(metrics.peak, wf.unit);
  const sparkline = generateSparklineSvg(wf, 256, 44);

  bodyEl.innerHTML = `
    <div class="scope-metrics">
      <span>RMS: <strong style="color:#38bdf8;">${rmsStr}</strong></span>
      <span>Pk: <strong style="color:#a78bfa;">${pkStr}</strong></span>
      <span>f: <strong style="color:#34d399;">60 Hz</strong></span>
    </div>
    <div style="background: rgba(15,23,42,0.6); padding: 4px; border-radius: 4px; border: 1px solid rgba(51,65,85,0.4);">
      ${sparkline}
    </div>
  `;
}

function updateAllPinnedScopes() {
  for (const [id, scope] of pinnedScopes) {
    const body = scope.element.querySelector(".scope-body") as HTMLElement;
    if (body) updateScopeCard(id, body);
  }
}

function showProbeTooltip(clientX: number, clientY: number, id: string, name?: string) {
  const tooltip = document.getElementById("wire-probe-tooltip");
  if (!tooltip || !currentSimData) return;
  const wf = findWaveform(id, name);
  if (!wf) {
    tooltip.style.display = "none";
    return;
  }

  const metrics = computeWaveformMetrics(wf.values);
  const rmsStr = formatEngineeringValue(metrics.rms, wf.unit);
  const pkStr = formatEngineeringValue(metrics.peak, wf.unit);
  const sparkline = generateSparklineSvg(wf, 180, 28);

  tooltip.innerHTML = `
    <div style="font-weight: 600; font-size: 11px; margin-bottom: 2px; color: #f8fafc;">
      ${escapeHtml(wf.label)}
    </div>
    <div style="display: flex; gap: 8px; font-family: monospace; font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
      <span>RMS: <strong style="color: #38bdf8;">${rmsStr}</strong></span>
      <span>Pk: <strong style="color: #a78bfa;">${pkStr}</strong></span>
      <span>f: <strong style="color: #34d399;">60 Hz</strong></span>
    </div>
    ${sparkline}
  `;

  const posX = Math.min(clientX + 14, window.innerWidth - 220);
  const posY = Math.min(clientY + 14, window.innerHeight - 100);
  tooltip.style.left = `${posX}px`;
  tooltip.style.top = `${posY}px`;
  tooltip.style.display = "block";
}

function hideProbeTooltip() {
  const tooltip = document.getElementById("wire-probe-tooltip");
  if (tooltip) tooltip.style.display = "none";
}

function initContextMenu() {
  const menu = document.getElementById("diagram-context-menu");
  if (!menu) return;

  const hideMenu = () => {
    menu.style.display = "none";
  };

  document.addEventListener("click", hideMenu);
  window.addEventListener("blur", hideMenu);

  const showMenuAt = (
    x: number,
    y: number,
    items: { label: string; shortcut?: string; action: () => void; isDivider?: boolean }[],
  ) => {
    menu.innerHTML = "";
    for (const item of items) {
      if (item.isDivider) {
        const div = document.createElement("div");
        div.className = "context-menu-divider";
        menu.appendChild(div);
        continue;
      }
      const el = document.createElement("div");
      el.className = "context-menu-item";
      el.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ""}`;
      el.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
        item.action();
      };
      menu.appendChild(el);
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
    menu.style.display = "block";
  };

  const bindGraphEvents = () => {
    const g = getGraph();
    if (!g) {
      setTimeout(bindGraphEvents, 100);
      return;
    }

    g.on("node:click", ({ node }: any) => {
      const defn = String(node.getData()?.definition || "").toLowerCase();
      const name = String(node.getData()?.name || node.id).toLowerCase();
      if (defn.includes("breaker") || defn.includes("switch") || name.includes("brk") || name.includes("breaker")) {
        const isCurrentlyOpen =
          String(node.getData()?.parameters?.Status ?? node.getData()?.parameters?.status ?? "closed").toLowerCase() ===
          "open";
        const targetStatus = isCurrentlyOpen ? "Closed" : "Open";
        const curData = node.getData() || {};
        node.setData({
          ...curData,
          parameters: {
            ...curData.parameters,
            Status: targetStatus,
          },
        });
        node.setAttrs({
          body: { stroke: targetStatus === "Closed" ? "#10b981" : "#ef4444" },
        });
        vscode.postMessage({
          type: "toggleBreakerState",
          name: node.id,
          componentName: curData.name || node.id,
          targetStatus,
        });
      }
    });

    g.on("node:mouseenter", ({ node, e }: any) => {
      showProbeTooltip(e.clientX, e.clientY, node.id, node.getData()?.name);
    });
    g.on("node:mousemove", ({ node, e }: any) => {
      if (currentSimData) {
        showProbeTooltip(e.clientX, e.clientY, node.id, node.getData()?.name);
      }
    });
    g.on("node:mouseleave", () => {
      hideProbeTooltip();
    });

    g.on("edge:mouseenter", ({ edge, e }: any) => {
      const wireId = edge.getData()?.wireId || edge.id;
      showProbeTooltip(e.clientX, e.clientY, wireId);
    });
    g.on("edge:mousemove", ({ edge, e }: any) => {
      if (currentSimData) {
        const wireId = edge.getData()?.wireId || edge.id;
        showProbeTooltip(e.clientX, e.clientY, wireId);
      }
    });
    g.on("edge:mouseleave", () => {
      hideProbeTooltip();
    });

    g.on("blank:mousemove", () => {
      hideProbeTooltip();
    });

    g.on("node:contextmenu", ({ node, e }: any) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const clientX = e.clientX ?? 100;
      const clientY = e.clientY ?? 100;
      const isCurrentlyDisabled = Boolean(node.getData()?.disabled);

      const defn = String(node.getData()?.definition || "").toLowerCase();
      const name = String(node.getData()?.name || node.id).toLowerCase();
      const isBreaker = defn.includes("breaker") || defn.includes("switch") || name.includes("brk");
      const isLineOrCable = defn.includes("tline") || defn.includes("cable");
      const isBreakerOpen =
        String(node.getData()?.parameters?.Status ?? node.getData()?.parameters?.status ?? "closed").toLowerCase() ===
        "open";

      const items: { label: string; shortcut?: string; action: () => void; isDivider?: boolean }[] = [
        {
          label: "Edit Parameters...",
          shortcut: "Space",
          action: () => {
            showProperties({ id: node.id, properties: node.getData()?.properties });
            vscode.postMessage({ type: "getProperties", componentName: node.id });
          },
        },
      ];

      if (isBreaker) {
        items.push({
          label: isBreakerOpen ? "Close Breaker Contact" : "Trip / Open Breaker",
          shortcut: "K",
          action: () => {
            const targetStatus = isBreakerOpen ? "Closed" : "Open";
            node.setData({ ...node.getData(), parameters: { ...node.getData()?.parameters, Status: targetStatus } });
            node.setAttrs({ body: { stroke: targetStatus === "Closed" ? "#10b981" : "#ef4444" } });
            vscode.postMessage({
              type: "toggleBreakerState",
              name: node.id,
              componentName: node.getData()?.name || node.id,
              targetStatus,
            });
          },
        });
      }

      if (isLineOrCable) {
        items.push({
          label: "Edit Line Geometry (2D CAD)...",
          action: () => {
            vscode.postMessage({
              type: "openLineGeometryEditor",
              name: node.id,
              defn: node.getData()?.definition,
              parameters: node.getData()?.parameters,
            });
          },
        });
      }

      items.push({
        label: "Pin Sparkline Scope",
        action: () => {
          pinSparklineScope(node.id, node.getData()?.name || node.id);
        },
      });

      items.push(
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Rotate 90° Clockwise",
          shortcut: "R",
          action: () => {
            const curAngle = node.getAngle() || 0;
            const newAngle = (((curAngle + 90) % 360) + 360) % 360;
            node.rotate(90);
            enqueueDiagramAction({ type: "rotate", item: { name: node.id, rotation: newAngle } });
          },
        },
        {
          label: "Rotate 90° Counter-Clockwise",
          shortcut: "Shift+R",
          action: () => {
            const curAngle = node.getAngle() || 0;
            const newAngle = (((curAngle - 90) % 360) + 360) % 360;
            node.rotate(-90);
            enqueueDiagramAction({ type: "rotate", item: { name: node.id, rotation: newAngle } });
          },
        },
        {
          label: isCurrentlyDisabled ? "Enable Component" : "Disable / Bypass",
          shortcut: "D",
          action: () => {
            const target = !isCurrentlyDisabled;
            node.setData({ ...node.getData(), disabled: target });
            node.setAttrs({ body: { opacity: target ? 0.45 : 1 } });
            enqueueDiagramAction({ type: "toggleDisable", name: node.id, disabled: target });
          },
        },
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Drill into Definition",
          shortcut: "F12",
          action: () => {
            const targetMod = node.getData()?.targetModule || (node.getData()?.isModule ? node.id : undefined);
            if (targetMod) {
              vscode.postMessage({ type: "navigateTo", className: targetMod, diagramType: "All" });
            }
          },
        },
        {
          label: "Delete Component",
          shortcut: "Del",
          action: () => {
            enqueueDiagramAction({ type: "deleteComponents", names: [node.id] });
            g.removeCell(node);
          },
        },
      );

      showMenuAt(clientX, clientY, items);
    });

    g.on("edge:contextmenu", ({ edge, e }: any) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const clientX = e.clientX ?? 100;
      const clientY = e.clientY ?? 100;
      const wireId = edge.getData()?.wireId || edge.id;

      showMenuAt(clientX, clientY, [
        {
          label: "Pin Sparkline Scope",
          action: () => {
            pinSparklineScope(wireId, `Wire ${wireId}`);
          },
        },
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Reroute Orthogonal",
          shortcut: "Shift+O",
          action: () => {
            rerouteEdgeOrthogonal(edge, g);
          },
        },
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Delete Wire",
          shortcut: "Del",
          action: () => {
            const source = edge.getSource() as any;
            const target = edge.getTarget() as any;
            if (source?.cell && source?.port && target?.cell && target?.port) {
              enqueueDiagramAction({
                type: "disconnect",
                source: `${source.cell}.${source.port}`,
                target: `${target.cell}.${target.port}`,
              });
            } else {
              enqueueDiagramAction({ type: "disconnect", source: String(wireId), target: String(wireId) });
            }
            g.removeCell(edge);
          },
        },
      ]);
    });

    g.on("blank:contextmenu", ({ e }: any) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const clientX = e.clientX ?? 100;
      const clientY = e.clientY ?? 100;

      showMenuAt(clientX, clientY, [
        {
          label: "Search Component...",
          shortcut: "Shift+A",
          action: () => {
            showSpotlight(clientX, clientY);
          },
        },
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Insert Ground",
          shortcut: "G",
          action: () => {
            (window as any).__startPlacement?.({ className: "master:ground", classKind: "Component" });
          },
        },
        {
          label: "Insert Busbar",
          shortcut: "B",
          action: () => {
            (window as any).__startPlacement?.({ className: "master:bus", classKind: "Component" });
          },
        },
        {
          label: "Insert Breaker",
          shortcut: "K",
          action: () => {
            (window as any).__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
          },
        },
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Zoom to Fit",
          shortcut: "Shift+1",
          action: () => {
            g.zoomToFit({ padding: 30, maxScale: 1.5 });
          },
        },
      ]);
    });
  };

  bindGraphEvents();
}

function showSpotlight(x: number, y: number) {
  const popover = document.getElementById("spotlight-omni-insert");
  const input = document.getElementById("spotlight-input") as HTMLInputElement | null;
  const results = document.getElementById("spotlight-results");
  if (!popover || !input || !results) return;

  popover.style.left = `${Math.max(10, Math.min(x, window.innerWidth - 320))}px`;
  popover.style.top = `${Math.max(10, Math.min(y, window.innerHeight - 280))}px`;
  popover.style.display = "block";
  input.value = "";
  input.focus();

  let selectedIdx = 0;

  const renderResults = () => {
    const q = input.value.trim().toLowerCase();
    const filtered = SPOTLIGHT_CATALOG.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );

    results.innerHTML = "";
    if (filtered.length === 0) {
      results.innerHTML = `<div style="padding: 10px 12px; color: #888; font-size: 11px;">No components found</div>`;
      return;
    }

    if (selectedIdx >= filtered.length) selectedIdx = 0;

    filtered.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = `spotlight-item${idx === selectedIdx ? " selected" : ""}`;
      row.innerHTML = `<span>${item.name}</span><span class="spotlight-badge">${item.category}</span>`;
      row.onmouseenter = () => {
        selectedIdx = idx;
        renderResults();
      };
      row.onclick = () => {
        popover.style.display = "none";
        (window as any).__startPlacement?.({ className: item.id, classKind: "Component" });
      };
      results.appendChild(row);
    });
  };

  renderResults();

  input.oninput = () => {
    selectedIdx = 0;
    renderResults();
  };

  input.onkeydown = (e) => {
    const q = input.value.trim().toLowerCase();
    const filtered = SPOTLIGHT_CATALOG.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );
    if (e.key === "Escape") {
      popover.style.display = "none";
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % Math.max(1, filtered.length);
      renderResults();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + filtered.length) % Math.max(1, filtered.length);
      renderResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = filtered[selectedIdx];
      if (choice) {
        popover.style.display = "none";
        (window as any).__startPlacement?.({ className: choice.id, classKind: "Component" });
      }
    }
  };
}

function initKeyboardAccelerators() {
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const isEditingText =
      active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");

    // Close Spotlight on Escape
    const spotlight = document.getElementById("spotlight-omni-insert");
    if (e.key === "Escape" && spotlight && spotlight.style.display !== "none") {
      spotlight.style.display = "none";
      return;
    }

    if (isEditingText) return;

    const g = getGraph();
    if (!g) return;

    // Shift+A or Tab -> Open Spotlight Omni-Insert
    if ((e.shiftKey && e.key.toLowerCase() === "a") || e.key === "Tab") {
      e.preventDefault();
      showSpotlight(window.innerWidth / 2 - 150, 80);
      return;
    }

    const selectedCells = g.getSelectedCells();
    const selectedNodes = selectedCells.filter((c: any) => c.isNode());

    // Rotate: R
    if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) {
      if (selectedNodes.length > 0) {
        e.preventDefault();
        const deg = e.shiftKey ? -90 : 90;
        selectedNodes.forEach((node: any) => {
          const curAngle = node.getAngle() || 0;
          const newAngle = (((curAngle + deg) % 360) + 360) % 360;
          node.rotate(deg);
          enqueueDiagramAction({ type: "rotate", item: { name: node.id, rotation: newAngle } });
        });
        return;
      }
    }

    // Toggle Disable/Bypass: D
    if (e.key.toLowerCase() === "d" && !e.ctrlKey && !e.metaKey) {
      if (selectedNodes.length > 0) {
        e.preventDefault();
        selectedNodes.forEach((node: any) => {
          const current = Boolean(node.getData()?.disabled);
          const target = !current;
          node.setData({ ...node.getData(), disabled: target });
          node.setAttrs({ body: { opacity: target ? 0.45 : 1 } });
          enqueueDiagramAction({ type: "toggleDisable", name: node.id, disabled: target });
        });
        return;
      }
    }

    // Wire mode: W
    if (e.key.toLowerCase() === "w" && !e.ctrlKey && !e.metaKey) {
      const hudWire = document.getElementById("hud-wire");
      hudWire?.click();
      return;
    }

    // Quick insert Ground: G
    if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) {
      (window as any).__startPlacement?.({ className: "master:ground", classKind: "Component" });
      return;
    }

    // Quick insert Busbar: B
    if (e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey) {
      (window as any).__startPlacement?.({ className: "master:bus", classKind: "Component" });
      return;
    }

    // Quick toggle or insert Breaker: K
    if (e.key.toLowerCase() === "k" && !e.ctrlKey && !e.metaKey) {
      if (selectedNodes.length > 0) {
        const node = selectedNodes[0]!;
        const defn = String(node.getData()?.definition || "").toLowerCase();
        const name = String(node.getData()?.name || node.id).toLowerCase();
        if (defn.includes("breaker") || defn.includes("switch") || name.includes("brk")) {
          e.preventDefault();
          const isCurrentlyOpen =
            String(
              node.getData()?.parameters?.Status ?? node.getData()?.parameters?.status ?? "closed",
            ).toLowerCase() === "open";
          const targetStatus = isCurrentlyOpen ? "Closed" : "Open";
          const curData = node.getData() || {};
          node.setData({
            ...curData,
            parameters: {
              ...curData.parameters,
              Status: targetStatus,
            },
          });
          node.setAttrs({
            body: { stroke: targetStatus === "Closed" ? "#10b981" : "#ef4444" },
          });
          vscode.postMessage({
            type: "toggleBreakerState",
            name: node.id,
            componentName: curData.name || node.id,
            targetStatus,
          });
          return;
        }
      }
      (window as any).__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
      return;
    }

    // Run simulation: F5
    if (e.key === "F5") {
      e.preventDefault();
      vscode.postMessage({ type: "runSimulation" });
      return;
    }

    // Open properties: Space
    if (e.key === " " && selectedNodes.length > 0) {
      e.preventDefault();
      const node = selectedNodes[0]!;
      showProperties({ id: node.id, properties: node.getData()?.properties });
      vscode.postMessage({ type: "getProperties", componentName: node.id });
      return;
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initDiagramBridge);
} else {
  initDiagramBridge();
}

// The diagram.ts bridge no longer needs its own message listener.
// All message types (diagramData, loading, stopLoading, startPlacement,
// empty, error, componentProperties, autoLayout, setLanguage) are handled
// by @modelscript/diagram's canonical message handler in index.ts.

const nodeActiveTabMap = new Map<string, string>();
let currentRenderedNodeId: string | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showProperties(nodeData: any) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const nodeIdStr = String(nodeData.id ?? "");
  const props = nodeData.properties;
  const isLoading = nodeData.isLoading === true;
  const expectedTitle = props?.className ? props.className.split(".").pop()?.toUpperCase() : "PROPERTIES";

  // Prevent overwriting the DOM if the user is currently typing in an input field for the same component
  if (
    content.contains(document.activeElement) &&
    (document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA" ||
      document.activeElement?.tagName === "SELECT") &&
    (currentRenderedNodeId === nodeIdStr || title.textContent === expectedTitle)
  ) {
    return;
  }

  currentRenderedNodeId = nodeIdStr;
  title.textContent = expectedTitle as string;

  const loadingSpinner = `<div style="display: flex; align-items: center; gap: 8px; padding: 12px 0; color: var(--vscode-descriptionForeground, #888); font-size: 12px;">
    <div style="width: 14px; height: 14px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
    Loading...
  </div>`;

  const iconContent = isLoading
    ? `<div style="width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
        <div style="width: 20px; height: 20px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
       </div>`
    : props?.iconSvg || "";

  let html = `
    <details open style="margin-bottom: 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 16px;">
      <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground); margin-bottom: 8px; list-style: none;">
        INFORMATION
      </summary>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: row; gap: 24px; align-items: stretch;">
          <div class="prop-icon-wrapper" style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; overflow: hidden;">
            ${iconContent}
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; justify-content: center;">
            <div style="padding: 4px 0;">
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888);">Type</div>
              <div style="word-break: break-all; line-height: 1.2; padding: 4px 0;">
                ${escapeHtml(props?.className || "")}
              </div>
            </div>
            <div>
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 4px;">Name</div>
              <input type="text" class="prop-input" id="prop-input-name" value="${escapeHtml(nodeData.id)}" style="width: 100%; border-radius: 4px;" />
            </div>
          </div>
        </div>
  `;

  if (props) {
    const escapedDesc = escapeHtml(props.description || "");
    if (props.description) {
      html += `
        <div style="display: flex; flex-direction: column; margin-top: 16px;">
          <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
          <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4">${escapedDesc}</textarea>
        </div>
      `;
    } else if (!isLoading) {
      html += `
        <div id="prop-desc-container" style="display: flex; justify-content: center; padding: 16px 0;">
          <button id="prop-btn-add-desc" style="width: 100%; border-radius: 8px; padding: 8px 24px; background: transparent; color: var(--vscode-descriptionForeground, #888); border: 1px solid var(--vscode-dropdown-border, #d0d7de); cursor: pointer;">Add description</button>
        </div>
      `;
    }
  }

  html += `
      </div>
    </details>
  `;

  if (isLoading) {
    html += loadingSpinner;
  } else if (props) {
    const hasSchemaTabs = props.schema?.tabs && props.schema.tabs.length > 0;

    if (hasSchemaTabs) {
      const availableTabs = props.schema.tabs.filter((t: any) =>
        evaluatePropertyPredicate(t.visibleIf, props.values || {}),
      );
      let activeTabId = nodeActiveTabMap.get(nodeData.id);
      if (!activeTabId || !availableTabs.some((t: any) => t.id === activeTabId)) {
        activeTabId = availableTabs[0]?.id;
        if (activeTabId) {
          nodeActiveTabMap.set(String(nodeData.id), activeTabId);
        }
      }
      const activeTab = availableTabs.find((t: any) => t.id === activeTabId) || availableTabs[0];

      // Tab navigation bar
      html += `
        <div class="prop-tabs-bar" style="display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); margin-top: 12px; margin-bottom: 12px; overflow-x: auto;">
          ${availableTabs
            .map(
              (t: any) => `
            <button class="prop-tab-btn" data-tab="${t.id}" style="padding: 6px 10px; background: transparent; border: none; border-bottom: 2px solid ${t.id === activeTabId ? "var(--vscode-panelTitle-activeBorder, #007acc)" : "transparent"}; color: ${t.id === activeTabId ? "var(--vscode-panelTitle-activeForeground, #fff)" : "var(--vscode-descriptionForeground, #888)"}; cursor: pointer; font-size: 11px; font-weight: 600; white-space: nowrap;">
              ${t.label}
            </button>
          `,
            )
            .join("")}
        </div>
      `;

      // Active tab groups
      if (activeTab && activeTab.groups) {
        for (const group of activeTab.groups) {
          if (!evaluatePropertyPredicate(group.visibleIf, props.values || {})) continue;
          html += `
            <details open style="margin-bottom: 12px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
              <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground); margin-bottom: 8px;">${group.label}</summary>
              <div style="display: flex; flex-direction: column; gap: 8px;">
          `;
          for (const field of group.fields || []) {
            if (!evaluatePropertyPredicate(field.visibleIf, props.values || {})) continue;
            const val = props.values?.[field.key] ?? field.defaultValue ?? "";
            const escapedVal = escapeHtml(val);
            const escapedDesc = escapeHtml(field.description || "");
            const escapedLabel = escapeHtml(field.label);

            const isEnabled = evaluatePropertyPredicate(field.enabledIf, props.values || {});
            const isDisabled = !isEnabled || Boolean(field.readOnly);
            const fieldErr = validatePropertyValue(field, val, props.values || {});

            if (field.kind === "boolean") {
              const isChecked = val === true || val === "true";
              html += `
                <div class="prop-group" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <input type="checkbox" class="prop-checkbox prop-input-property" data-prop="${field.key}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""} />
                </div>
              `;
            } else if (field.kind === "choice" && Array.isArray(field.choices)) {
              html += `
                <div class="prop-group" style="opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <select class="prop-select prop-input-property" data-prop="${field.key}" style="width: 100%; border-radius: 4px; padding: 4px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);" ${isDisabled ? "disabled" : ""}>
                    ${field.choices
                      .map((c: any) => {
                        const cVal = typeof c === "string" ? c : c.value;
                        const cLabel = typeof c === "string" ? c : c.label;
                        return `<option value="${escapeHtml(cVal)}" ${String(cVal) === String(val) ? "selected" : ""}>${escapeHtml(cLabel)}</option>`;
                      })
                      .join("")}
                  </select>
                </div>
              `;
            } else if (field.kind === "html" || field.kind === "codeBlock") {
              const safeContent =
                field.kind === "html" || /<[a-z][\s\S]*>/i.test(String(val))
                  ? DOMPurify.sanitize(String(val))
                  : escapedVal;
              html += `
                <div class="prop-group" style="display: flex; flex-direction: column; gap: 4px;">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; max-height: 250px; overflow-y: auto;">
                    ${safeContent}
                  </div>
                </div>
              `;
            } else if (field.kind === "color") {
              html += `
                <div class="prop-group" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <input type="color" class="prop-input-property" data-prop="${field.key}" value="${escapedVal || "#000000"}" ${isDisabled ? "disabled" : ""} style="border: 1px solid var(--vscode-dropdown-border); background: transparent; cursor: pointer; border-radius: 4px; height: 26px; width: 40px; padding: 2px;" />
                </div>
              `;
            } else {
              const escapedUnit = field.unit ? `[${escapeHtml(field.unit)}]` : "";
              const inputType = field.kind === "number" ? "number" : "text";
              html += `
                <div class="prop-group" style="opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel} ${escapedUnit}</label>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="${inputType}" class="prop-input prop-input-property" data-prop="${field.key}" value="${escapedVal}" ${field.readOnly ? "readonly" : ""} ${isDisabled ? "disabled" : ""} style="flex: 1;" />
                    ${field.unit ? `<span style="font-size: 11px; color: var(--vscode-descriptionForeground);">${escapeHtml(field.unit)}</span>` : ""}
                  </div>
                  ${fieldErr ? `<div class="prop-error" style="color: var(--vscode-errorForeground, #f85149); font-size: 11px; margin-top: 2px;">${escapeHtml(fieldErr)}</div>` : ""}
                </div>
              `;
            }
          }
          html += `
              </div>
            </details>
          `;
        }
      }
    } else {
      // Legacy flat parameters fallback
      if (props.parameters && props.parameters.length > 0) {
        html += `<div style="margin-top:24px; margin-bottom:12px; font-weight:600; text-transform:uppercase; font-size:11px; color:var(--vscode-sideBarTitle-foreground)">Parameters</div>`;
        for (const p of props.parameters as any[]) {
          const escapedValue = escapeHtml(p.value || "");
          const escapedDescParam = escapeHtml(p.description || "");
          const escapedParamName = escapeHtml(p.name);
          const escapedUnit = p.unit ? `[${escapeHtml(p.unit)}]` : "";
          html += `
            <div class="prop-group">
              <label class="prop-label" title="${escapedDescParam}">${escapedParamName} ${escapedUnit}</label>
              <input type="text" class="prop-input prop-input-param prop-input-property" data-param="${escapedParamName}" data-prop="${escapedParamName}" value="${escapedValue}" />
            </div>
          `;
        }
      }

      if (props.docInfo) {
        html += `
          <details open style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
            <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Information</summary>
            <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.5; user-select: text;">
              ${DOMPurify.sanitize(props.docInfo)}
            </div>
          </details>
        `;
      }

      if (props.docRevisions) {
        html += `
          <details style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
            <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Revisions</summary>
            <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.5; user-select: text;">
              ${DOMPurify.sanitize(props.docRevisions)}
            </div>
          </details>
        `;
      }
    }

    html += `<style>
      .prop-doc-container { font-size: 12px; line-height: 1.5; word-break: break-word; }
      .prop-doc-container p { margin: 4px 0 8px 0; }
      .prop-doc-container ul, .prop-doc-container ol { margin: 4px 0 8px 0; padding-left: 20px; }
      .prop-doc-container li { margin-bottom: 4px; }
      .prop-doc-container img { max-width: 100%; height: auto; }
      .prop-doc-container a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; }
      .prop-doc-container a:hover { text-decoration: underline; }
      .prop-doc-container code { background: rgba(128,128,128,0.15); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); }
    </style>`;
  }

  content.innerHTML = html;
  panel.classList.add("open");

  // Bind events
  const nameInput = document.getElementById("prop-input-name") as HTMLInputElement;
  if (nameInput) {
    nameInput.addEventListener("change", (e) => {
      const newName = (e.target as HTMLInputElement).value;
      if (newName && newName !== nodeData.id) {
        enqueueDiagramAction({ type: "updateName", oldName: nodeData.id, newName });
        nodeData.id = newName;
        title.textContent = newName;
      }
    });
  }

  const descInput = document.getElementById("prop-input-description") as HTMLInputElement;
  const bindDescInput = (input: HTMLInputElement) => {
    input.addEventListener("change", (e) => {
      const newDesc = (e.target as HTMLInputElement).value;
      if (props && newDesc !== props.description) {
        enqueueDiagramAction({ type: "updateDescription", name: nodeData.id, description: newDesc });
        props.description = newDesc;
      }
    });
  };

  if (descInput) {
    bindDescInput(descInput);
  }

  const addDescBtn = document.getElementById("prop-btn-add-desc");
  if (addDescBtn) {
    addDescBtn.addEventListener("click", () => {
      const container = document.getElementById("prop-desc-container");
      if (container) {
        container.innerHTML = `
          <div style="display: flex; flex-direction: column; width: 100%;">
            <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
            <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4"></textarea>
          </div>
        `;
        const newDescInput = document.getElementById("prop-input-description") as HTMLInputElement;
        if (newDescInput) {
          bindDescInput(newDescInput);
          newDescInput.focus();
        }
      }
    });
  }

  // Bind tab buttons
  const tabBtns = document.querySelectorAll(".prop-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tabId = (e.currentTarget as HTMLElement).getAttribute("data-tab");
      if (tabId) {
        nodeActiveTabMap.set(String(nodeData.id), tabId);
        showProperties(nodeData);
      }
    });
  });

  // Bind property inputs (inputs, checkboxes, selects)
  const propInputs = document.querySelectorAll(".prop-input-property");
  const propDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  propInputs.forEach((input) => {
    const isCheckbox = (input as HTMLInputElement).type === "checkbox";
    const isSelect = input.tagName === "SELECT";
    const eventType = isCheckbox || isSelect ? "change" : "input";

    input.addEventListener(eventType, (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const propKey = target.getAttribute("data-prop");
      if (!propKey) return;

      const newValue = isCheckbox ? (target as HTMLInputElement).checked : target.value;
      const prevValue = props?.values?.[propKey];

      if (props?.values) {
        props.values[propKey] = newValue;
      }
      if (props?.parameters) {
        const p = props.parameters.find((param: any) => param.name === propKey);
        if (p) p.value = String(newValue);
      }

      // Optimistically patch diagram SVG text in-place
      updateParameterText(nodeData.id, propKey, String(prevValue ?? ""), String(newValue));

      // Live condition evaluation for enabledIf and visibleIf fields in the current DOM
      const allPropInputs = document.querySelectorAll(".prop-input-property");
      allPropInputs.forEach((otherInput) => {
        const otherKey = otherInput.getAttribute("data-prop");
        for (const tab of props?.schema?.tabs || []) {
          for (const grp of tab.groups || []) {
            const f = grp.fields?.find((field: any) => field.key === otherKey);
            if (f && props.values) {
              const isEnabled = evaluatePropertyPredicate(f.enabledIf, props.values);
              const isVisible = evaluatePropertyPredicate(f.visibleIf, props.values);
              const parentGroup = otherInput.closest(".prop-group") as HTMLElement | null;
              if (parentGroup) {
                parentGroup.style.display = isVisible ? "" : "none";
                parentGroup.style.opacity = isEnabled && !f.readOnly ? "1" : "0.5";
              }
              if (isEnabled && !f.readOnly) {
                otherInput.removeAttribute("disabled");
              } else {
                otherInput.setAttribute("disabled", "");
              }
            }
          }
        }
      });

      // Debounce LSP update action
      const timerKey = `${nodeData.id}:${propKey}`;
      const existing = propDebounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);
      propDebounceTimers.set(
        timerKey,
        setTimeout(() => {
          propDebounceTimers.delete(timerKey);
          enqueueDiagramAction({
            type: "updateProperty",
            name: nodeData.id,
            key: propKey,
            value: newValue,
            previousValue: prevValue,
          });
        }, 100),
      );
    });
  });
}

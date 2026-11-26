// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import {
  applyOptimisticPropertyAction,
  buildPropertyContextValues,
  ConflictManager,
  createBulkPropertyEditActions,
  DiagramActionQueue,
  dropComponentGhost,
  ensureMinimapHud,
  flipSelectedNodes,
  getGraph,
  getTypicalNodeSize,
  getVisiblePropertyTabs,
  hydrateDiagramWasm,
  initGraph,
  isMinimapVisible,
  mergeMultiSelectPropertyData,
  MIXED_PROPERTY_VALUE,
  reconcilePropertiesDOM,
  rerouteEdgeOrthogonal,
  resolveActivePropertyTabId,
  rotateSelectedNodes,
  setDiagramGrid,
  setDiagramOptions,
  toggleMinimap,
  updateMinimapHud,
  updateParameterText,
  type ComponentPropertyData,
  type DiagramGridMode,
} from "@modelscript/diagram";
import { serializeInteractiveGraphSvg } from "@modelscript/diagram/svg";
import DOMPurify from "dompurify";

if (typeof document !== "undefined") {
  const wasmUrl = document.getElementById("container")?.dataset?.wasmUrl;
  if (wasmUrl) {
    void hydrateDiagramWasm(wasmUrl);
  }
}

interface PlacementPayload {
  className: string;
  classKind?: string | undefined;
  iconSvg?: string | undefined;
  isDrag?: boolean | undefined;
}

interface DiagramWindowGlobals extends Window {
  acquireVsCodeApi?: () => {
    postMessage(message: unknown): void;
    getState<T = unknown>(): T | undefined;
    setState<T = unknown>(state: T): T;
  };
  __movePlacementGhost?: ((x: number, y: number, event?: Event) => void) | undefined;
  __setPointerOverCanvas?: ((over: boolean, pos?: { x: number; y: number }) => void) | undefined;
  __getPlacementData?: (() => PlacementPayload | null | undefined) | undefined;
  __hidePlacementGhost?: (() => void) | undefined;
  __handlePlacementClick?: ((x: number, y: number) => void) | undefined;
  __startPlacement?: ((data: PlacementPayload) => void) | undefined;
  __clearPlacement?: (() => void) | undefined;
  __toggleWireTool?: ((active?: boolean) => boolean) | undefined;
  __isWireToolActive?: (() => boolean) | undefined;
  __cancelWireTool?: (() => void) | undefined;
  __startInlineNodeEdit?: ((nodeId: string) => void) | undefined;
}

interface WebviewDiagramAction {
  type: string;
  [key: string]: unknown;
}

interface DropDataTransferOrExtra {
  className?: string | undefined;
  iconSvg?: string | undefined;
  getData?: ((format: string) => string) | undefined;
}

interface ContextMenuItem {
  label: string;
  shortcut?: string | undefined;
  action: () => void;
  isDivider?: boolean | undefined;
}

interface DiagramCellData {
  definition?: string | undefined;
  name?: string | undefined;
  parameters?: Record<string, unknown> | undefined;
  disabled?: boolean | undefined;
  properties?: ComponentPropertyData | undefined;
  targetModule?: string | undefined;
  isModule?: boolean | undefined;
  wireId?: string | undefined;
  [key: string]: unknown;
}

interface DiagramNodeCell {
  id: string;
  isNode(): boolean;
  getData(): DiagramCellData | undefined;
  setData(data: DiagramCellData): void;
  setAttrs(attrs: Record<string, unknown>): void;
  getAngle(): number;
  rotate(deg: number): void;
}

interface DiagramEdgeEndpoint {
  cell?: string | undefined;
  port?: string | undefined;
}

interface DiagramEdgeCell {
  id: string;
  getData(): DiagramCellData | undefined;
  getSource(): DiagramEdgeEndpoint | null | undefined;
  getTarget(): DiagramEdgeEndpoint | null | undefined;
}

interface DiagramShowPropertiesInput {
  id: string;
  properties?: ComponentPropertyData | undefined;
  isLoading?: boolean | undefined;
}

const diagramWindow = window as DiagramWindowGlobals;

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSnapGrid(lang = activeLanguage): number {
  return isPscadLanguage(lang) ? 18 : 20;
}
const snapToGrid = (val: number, step?: number) => {
  const s = step ?? getSnapGrid();
  return Math.round(val / s) * s;
};

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

const vscode = diagramWindow.acquireVsCodeApi?.() ?? {
  postMessage() {
    /* noop fallback */
  },
};

const diagramActionQueue = new DiagramActionQueue<WebviewDiagramAction>({
  spatialDelayMs: 10,
  structuralDelayMs: 0,
  onImmediateAction: (action) => {
    vscode.postMessage({ type: "interactiveWrite", ...action });
  },
  onFlush: (actions) => {
    console.log("[diagram.ts] posting diagram edits to host:", actions.length);
    vscode.postMessage({ type: "diagramEdit", actions });
  },
});

function enqueueDiagramAction(action: WebviewDiagramAction) {
  console.log("[diagram.ts] enqueuing diagram action:", action.type, action);
  diagramActionQueue.enqueue(action);
}

let activeLanguage = "modelica";

function isPscadLanguage(lang?: string): boolean {
  return Boolean(lang && /^(pscad|pscx|pslx|pswx|psmx)$/i.test(lang));
}

function isPsseLanguage(lang?: string): boolean {
  return Boolean(lang && /^(psse|raw|dyr|seq)$/i.test(lang));
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
  let lastGhostEvent: Event | undefined = undefined;

  const updateGhostPosition = (clientX: number, clientY: number, sourceEvent?: Event) => {
    lastGhostClientPos = { x: clientX, y: clientY };
    if (sourceEvent !== undefined) lastGhostEvent = sourceEvent;
    if (!ghostRafId) {
      ghostRafId = requestAnimationFrame(() => {
        ghostRafId = null;
        if (lastGhostClientPos && diagramWindow.__movePlacementGhost) {
          const g = getGraph() ?? initGraph(isDark);
          if (g) {
            const p = g.clientToLocal(lastGhostClientPos.x, lastGhostClientPos.y);
            diagramWindow.__movePlacementGhost(snapToGrid(p.x), snapToGrid(p.y), lastGhostEvent);
          }
        }
      });
    }
  };

  let isPointerOverCanvas = false;

  document.documentElement.addEventListener("mouseenter", () => {
    isPointerOverCanvas = true;
    diagramWindow.__setPointerOverCanvas?.(true);
  });

  document.documentElement.addEventListener("mouseleave", () => {
    isPointerOverCanvas = false;
    diagramWindow.__setPointerOverCanvas?.(false);
  });

  const onDragEnterOrOver = (e: DragEvent) => {
    e.preventDefault();
    isPointerOverCanvas = true;
    lastGhostClientPos = { x: e.clientX, y: e.clientY };
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    updateGhostPosition(e.clientX, e.clientY, e);
    diagramWindow.__setPointerOverCanvas?.(true, { x: e.clientX, y: e.clientY });
  };

  window.addEventListener("dragenter", onDragEnterOrOver, true);
  window.addEventListener("dragover", onDragEnterOrOver, true);

  window.addEventListener(
    "mousemove",
    (e) => {
      isPointerOverCanvas = true;
      lastGhostClientPos = { x: e.clientX, y: e.clientY };
      const placementData = diagramWindow.__getPlacementData?.();
      if (placementData) {
        // If dragging from the library tree and the mouse button is no longer held down (buttons === 0),
        // the drop has completed! Place the component immediately.
        if (placementData.isDrag && typeof e.buttons === "number" && e.buttons === 0) {
          handleDropOrPlace(e.clientX, e.clientY);
          return;
        }
        updateGhostPosition(e.clientX, e.clientY, e);
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
        diagramWindow.__setPointerOverCanvas?.(false);
        if (ghostRafId) {
          cancelAnimationFrame(ghostRafId);
          ghostRafId = null;
        }

        diagramWindow.__hidePlacementGhost?.();
      }
    },
    true,
  );

  let lastDropTimestamp = 0;

  const handleDropOrPlace = (
    clientX?: number,
    clientY?: number,
    dataTransferOrExtra?: DropDataTransferOrExtra | null,
  ) => {
    const now = Date.now();
    if (now - lastDropTimestamp < 350) return;
    if (ghostRafId) {
      cancelAnimationFrame(ghostRafId);
      ghostRafId = null;
    }
    const targetX = typeof clientX === "number" && clientX > 0 ? clientX : (lastGhostClientPos?.x ?? 0);
    const targetY = typeof clientY === "number" && clientY > 0 ? clientY : (lastGhostClientPos?.y ?? 0);

    const getPlacementData = diagramWindow.__getPlacementData;
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
        // Delegate to unified handlePlacementClick if present
        if (typeof diagramWindow.__handlePlacementClick === "function") {
          if (!diagramWindow.__getPlacementData?.()) {
            diagramWindow.__startPlacement?.({
              className: placementData.className,
              classKind: "Component",
              iconSvg: placementData.iconSvg,
              isDrag: true,
            });
          }
          diagramWindow.__handlePlacementClick(p.x, p.y);
          return;
        }

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

        diagramWindow.__clearPlacement?.();
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleDropOrPlace(e.clientX, e.clientY, e.dataTransfer);
  };

  window.addEventListener("drop", onDrop, false);

  const onPointerUpOrMouseUp = (e: MouseEvent | PointerEvent) => {
    // Only handle placement on pointerup if placement mode was active

    if (diagramWindow.__getPlacementData?.()) {
      handleDropOrPlace(e.clientX, e.clientY);
    }
  };

  window.addEventListener("pointerup", onPointerUpOrMouseUp, false);

  let validateReqSeq = 0;
  const pendingValidateRequests = new Map<
    number,
    (res: { compatible: boolean; reason?: string | undefined }) => void
  >();

  const baseDiagramOptions = {
    container,
    isDark,
    disableBuiltinContextMenu: true,
    onAction: enqueueDiagramAction,
    onSelect: (id: string | null) => {
      if (!id) {
        document.getElementById("properties-panel")?.classList.remove("open");
      }
    },
    onShowProperties: (nodeId: string, cachedProps?: ComponentPropertyData, isLoading?: boolean) => {
      if (typeof nodeId === "string" && (nodeId === "__diagram_background__" || nodeId === "__diagram_axes__")) {
        document.getElementById("properties-panel")?.classList.remove("open");
        return;
      }
      showProperties({ id: nodeId, properties: cachedProps, isLoading });
    },
    onUndo: () => vscode.postMessage({ type: "undo" }),
    onRedo: () => vscode.postMessage({ type: "redo" }),
    onMessage: (msg: Record<string, unknown>) => vscode.postMessage(msg),
    onValidateConnection: (params: {
      sourceNode: string;
      sourcePort: string;
      targetNode: string;
      targetPort: string;
    }) => {
      const requestId = ++validateReqSeq;
      return new Promise<{ compatible: boolean; reason?: string | undefined }>((resolve) => {
        const timer = setTimeout(() => {
          pendingValidateRequests.delete(requestId);
          resolve({ compatible: true });
        }, 1500);
        pendingValidateRequests.set(requestId, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        vscode.postMessage({
          type: "validateConnection",
          requestId,
          ...params,
        });
      });
    },
  };

  // Handle messages forwarded from the top-level workbench or extension host
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "validateConnectionResult") {
      const cb = pendingValidateRequests.get(e.data.requestId);
      if (cb) {
        pendingValidateRequests.delete(e.data.requestId);
        cb(e.data.result ?? { compatible: true });
      }
      return;
    }
    if (e.data.type === "setLanguage") {
      activeLanguage = e.data.language || "modelica";
      const snap = getSnapGrid(activeLanguage);
      setDiagramOptions({ ...baseDiagramOptions, language: activeLanguage, snapGrid: snap });
      getGraph()?.setGridSize?.(snap);
      const isPscad = isPscadLanguage(activeLanguage);
      const canvasHud = document.getElementById("canvas-hud");
      if (canvasHud) {
        canvasHud.style.display = isPscad ? "flex" : "none";
      }
      lspPaletteCatalog = [];
      vscode.postMessage({ type: "getPalette" });
    } else if (e.data.type === "palette") {
      const cats = Array.isArray(e.data.palette?.categories) ? e.data.palette.categories : [];
      const flattened: { id: string; name: string; category: string }[] = [];
      for (const cat of cats) {
        const catName = String(cat.label || cat.name || cat.id || "Components");
        const items = Array.isArray(cat.items) ? cat.items : [];
        for (const item of items) {
          const id = String(item.className || item.type || item.id || item.label || "");
          const name = String(item.label || item.name || id);
          if (id) flattened.push({ id, name, category: catName });
        }
      }
      lspPaletteCatalog = flattened;
      if (activeSpotlightRender) activeSpotlightRender();
    } else if (e.data.type === "workbenchDrop") {
      handleDropOrPlace(e.data.clientX, e.data.clientY, e.data);
    } else if (e.data.type === "workbenchDragOver" && typeof e.data.clientX === "number") {
      isPointerOverCanvas = true;
      diagramWindow.__setPointerOverCanvas?.(true, { x: e.data.clientX, y: e.data.clientY });
      updateGhostPosition(e.data.clientX, e.data.clientY);
    } else if (e.data.type === "dragEnd") {
      if (isPointerOverCanvas && lastGhostClientPos) {
        handleDropOrPlace(lastGhostClientPos.x, lastGhostClientPos.y);
      } else {
        diagramWindow.__clearPlacement?.();
      }
    } else if (e.data.type === "simulationData") {
      currentSimData = e.data.data;
      const runBtn = document.getElementById("hud-run");
      if (runBtn) {
        runBtn.textContent = "▶ Sim Ready";
        runBtn.style.background = "#10b981";
      }
      updateAllPinnedScopes();
      updateAllPinnedStickies();
    } else if (e.data.type === "simulationFrame") {
      const sv = e.data.stateVector;
      if (sv && typeof sv === "object" && !ArrayBuffer.isView(sv)) {
        updateStickyValuesFromFrame(sv as Record<string, number>);
      }
    } else if (e.data.type === "breadcrumbsUpdate") {
      if (Array.isArray(e.data.breadcrumbs)) {
        renderBreadcrumbsBar(e.data.breadcrumbs);
      }
    } else if (e.data.type === "diagramData") {
      if (Array.isArray(e.data.data?.breadcrumbs) && e.data.data.breadcrumbs.length > 0) {
        renderBreadcrumbsBar(e.data.data.breadcrumbs);
      } else if (currentBreadcrumbs.length > 1) {
        renderBreadcrumbsBar(currentBreadcrumbs);
      }
      requestAnimationFrame(() => {
        syncMinimapToggleButton();
      });
    } else if (e.data.type === "pinPlotWidget" && e.data.spec) {
      const spec = e.data.spec as {
        id?: string;
        title?: string;
        kind?: PinnedPlotMode;
      };
      pinSparklineScope(spec.id || spec.title || `plot_${Date.now()}`, spec.title || spec.id || "Plot", spec.kind);
    } else if (e.data.type === "pinStickyWidget" && e.data.spec) {
      const spec = e.data.spec as PinStickyWidgetSpec;
      pinStickyValueWidget(spec);
    }
  });

  setDiagramOptions({ ...baseDiagramOptions, snapGrid: getSnapGrid(activeLanguage) });

  initCanvasHud();
  initDiagramActionBar();
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
  // Modelica Standard Library (MSL)
  { id: "Modelica.Electrical.Analog.Basic.Resistor", name: "MSL Electrical Resistor", category: "Modelica Electrical" },
  {
    id: "Modelica.Electrical.Analog.Basic.Capacitor",
    name: "MSL Electrical Capacitor",
    category: "Modelica Electrical",
  },
  { id: "Modelica.Electrical.Analog.Basic.Inductor", name: "MSL Electrical Inductor", category: "Modelica Electrical" },
  { id: "Modelica.Electrical.Analog.Basic.Ground", name: "MSL Electrical Ground", category: "Modelica Electrical" },
  {
    id: "Modelica.Electrical.Analog.Sources.ConstantVoltage",
    name: "MSL Constant Voltage Source",
    category: "Modelica Electrical",
  },
  {
    id: "Modelica.Mechanics.Translational.Components.Mass",
    name: "MSL Translational Mass",
    category: "Modelica Mechanics",
  },
  {
    id: "Modelica.Mechanics.Translational.Components.SpringDamper",
    name: "MSL Spring-Damper",
    category: "Modelica Mechanics",
  },
  {
    id: "Modelica.Mechanics.Rotational.Components.Inertia",
    name: "MSL Rotational Inertia",
    category: "Modelica Mechanics",
  },
  { id: "Modelica.Blocks.Continuous.PID", name: "MSL Continuous PID Controller", category: "Modelica Blocks" },
  { id: "Modelica.Blocks.Sources.Step", name: "MSL Step Signal Source", category: "Modelica Blocks" },
  {
    id: "Modelica.Thermal.HeatTransfer.Components.HeatCapacitor",
    name: "MSL Thermal Heat Capacitor",
    category: "Modelica Thermal",
  },
  {
    id: "Modelica.Thermal.HeatTransfer.Components.ThermalConductor",
    name: "MSL Thermal Conductor",
    category: "Modelica Thermal",
  },
  // SysML v2
  { id: "sysml:part", name: "SysML v2 Part Definition (part def)", category: "SysML v2" },
  { id: "sysml:action", name: "SysML v2 Action Definition (action def)", category: "SysML v2" },
  { id: "sysml:requirement", name: "SysML v2 Requirement Definition (requirement def)", category: "SysML v2" },
  { id: "sysml:state", name: "SysML v2 State Definition (state def)", category: "SysML v2" },
  { id: "sysml:port", name: "SysML v2 Port Definition (port def)", category: "SysML v2" },
  // PSS/E
  { id: "psse:bus_pq", name: "PQ Load Bus (IDE=1)", category: "PSS/E Buses" },
  { id: "psse:bus_pv", name: "PV Generator Bus (IDE=2)", category: "PSS/E Buses" },
  { id: "psse:bus_slack", name: "Swing / Slack Bus (IDE=3)", category: "PSS/E Buses" },
  { id: "psse:generator", name: "Synchronous Generator", category: "PSS/E Generation & Shunts" },
  { id: "psse:load", name: "ZIP Load", category: "PSS/E Generation & Shunts" },
  { id: "psse:fixed_shunt", name: "Fixed Shunt", category: "PSS/E Generation & Shunts" },
  { id: "psse:switched_shunt", name: "Switched Shunt", category: "PSS/E Generation & Shunts" },
  { id: "psse:branch", name: "AC Transmission Branch", category: "PSS/E Transmission" },
  { id: "psse:xfmr_2w", name: "2-Winding Transformer", category: "PSS/E Transmission" },
  { id: "psse:xfmr_3w", name: "3-Winding Transformer", category: "PSS/E Transmission" },
];

let isWireModeActive = false;
const GRID_MODES: DiagramGridMode[] = ["doubleMesh", "dot", "mesh", "none"];
let currentGridModeIdx = 0;

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
    diagramWindow.__toggleWireTool?.(false);
    hudWire?.classList.remove("active");
    hudSelect?.classList.add("active");
    const container = document.getElementById("container");
    if (container) container.style.cursor = "default";
  };

  const setWireMode = () => {
    isWireModeActive = !isWireModeActive;
    if (diagramWindow.__toggleWireTool) {
      isWireModeActive = diagramWindow.__toggleWireTool(isWireModeActive);
    }
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
    diagramWindow.__startPlacement?.({ className: "master:ground", classKind: "Component" });
  });

  hudBus?.addEventListener("click", () => {
    setSelectMode();
    diagramWindow.__startPlacement?.({ className: "master:bus", classKind: "Component" });
  });

  hudBreaker?.addEventListener("click", () => {
    setSelectMode();
    diagramWindow.__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
  });

  hudResistor?.addEventListener("click", () => {
    setSelectMode();
    diagramWindow.__startPlacement?.({ className: "master:resistor", classKind: "Component" });
  });

  hudOmni?.addEventListener("click", (e) => {
    showSpotlight(e.clientX || window.innerWidth / 2, 60);
  });

  hudRun?.addEventListener("click", () => {
    vscode.postMessage({ type: "runSimulation" });
  });
}

// ── Toggleable Minimap Overlay, Action Bar & Breadcrumbs ──

interface DiagramBreadcrumbEntry {
  id: string;
  label: string;
  diagramType?: string | undefined;
}

let currentBreadcrumbs: DiagramBreadcrumbEntry[] = [];

function syncMinimapToggleButton() {
  const container = document.getElementById("container");
  const btn = document.getElementById("action-minimap");
  if (!btn) return;
  const open = isMinimapVisible(container);
  btn.classList.toggle("active", open);
  btn.setAttribute("aria-pressed", open ? "true" : "false");
}

function toggleMinimapOverlay(): boolean {
  const container = document.getElementById("container");
  if (!container) return false;
  const g = getGraph();
  if (!container.querySelector("#modelscript-minimap-hud")) {
    ensureMinimapHud(
      container,
      (wx: number, wy: number) => {
        const active = getGraph();
        if (active && typeof active.centerPoint === "function") {
          active.centerPoint(wx, wy);
        }
      },
      false,
    );
  }
  const isOpen = toggleMinimap(container);
  if (isOpen && g) {
    const hud = container.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
    if (hud) {
      updateMinimapHud(hud, g);
    }
  }
  syncMinimapToggleButton();
  return isOpen;
}

function syncActionBarSelectionState() {
  const g = getGraph();
  const selectedNodes = g
    ? (g.getSelectedCells() as DiagramNodeCell[]).filter((c) => typeof c.isNode === "function" && c.isNode())
    : [];
  const hasNodeSelection = selectedNodes.length > 0;
  for (const id of ["action-flip-h", "action-flip-v", "action-rotate", "action-pin-plot", "action-pin-sticky"]) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = !hasNodeSelection;
  }
}

function renderBreadcrumbsBar(breadcrumbs: DiagramBreadcrumbEntry[]) {
  currentBreadcrumbs = Array.isArray(breadcrumbs) ? breadcrumbs : [];
  const bar = document.getElementById("breadcrumb-bar");
  if (!bar) return;
  if (currentBreadcrumbs.length <= 1) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }

  bar.style.display = "flex";
  bar.innerHTML = "";

  currentBreadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      bar.appendChild(sep);
    }
    const item = document.createElement("span");
    const isLast = idx === currentBreadcrumbs.length - 1;
    item.className = `breadcrumb-item${isLast ? " active" : ""}`;
    item.textContent = crumb.label;
    if (!isLast) {
      item.title = `Jump to ${crumb.label}`;
      item.onclick = () => {
        vscode.postMessage({
          type: "drillUp",
          depth: idx,
          className: crumb.id,
          diagramType: crumb.diagramType,
        });
      };
    }
    bar.appendChild(item);
  });

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "breadcrumb-back-btn";
  upBtn.title = "Drill Up one level (Alt+Up)";
  upBtn.textContent = "▲ Up";
  upBtn.onclick = () => {
    vscode.postMessage({ type: "drillUp" });
  };
  bar.appendChild(upBtn);

  if (currentBreadcrumbs.length > 2) {
    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "breadcrumb-back-btn";
    rootBtn.title = "Back to Root Overview";
    rootBtn.textContent = "◀ Root";
    rootBtn.onclick = () => {
      vscode.postMessage({ type: "drillUp", depth: 0 });
    };
    bar.appendChild(rootBtn);
  }
}

function initDiagramActionBar() {
  const minimapBtn = document.getElementById("action-minimap");
  const flipHBtn = document.getElementById("action-flip-h");
  const flipVBtn = document.getElementById("action-flip-v");
  const rotateBtn = document.getElementById("action-rotate");
  const pinPlotBtn = document.getElementById("action-pin-plot");
  const pinStickyBtn = document.getElementById("action-pin-sticky");
  const spatial3DBtn = document.getElementById("action-spatial-3d");

  minimapBtn?.addEventListener("click", () => {
    toggleMinimapOverlay();
  });

  flipHBtn?.addEventListener("click", () => {
    const g = getGraph();
    if (g) flipSelectedNodes("x", g);
  });

  flipVBtn?.addEventListener("click", () => {
    const g = getGraph();
    if (g) flipSelectedNodes("y", g);
  });

  rotateBtn?.addEventListener("click", () => {
    const g = getGraph();
    if (g) rotateSelectedNodes(90, g);
  });

  pinPlotBtn?.addEventListener("click", () => {
    const g = getGraph();
    if (!g) return;
    const selectedNodes = (g.getSelectedCells() as DiagramNodeCell[]).filter(
      (c) => typeof c.isNode === "function" && c.isNode(),
    );
    const first = selectedNodes[0];
    if (first) {
      pinSparklineScope(first.id, first.getData()?.name || first.id, "timeseries");
    }
  });

  pinStickyBtn?.addEventListener("click", () => {
    const g = getGraph();
    if (!g) return;
    const selectedNodes = (g.getSelectedCells() as DiagramNodeCell[]).filter(
      (c) => typeof c.isNode === "function" && c.isNode(),
    );
    const first = selectedNodes[0];
    if (first) {
      pinStickyValueWidget({
        id: first.id,
        label: first.getData()?.name || first.id,
      });
    }
  });

  spatial3DBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "openSpatialDiagram3D" });
  });

  syncMinimapToggleButton();
  syncActionBarSelectionState();
}

export type PinnedPlotMode = "timeseries" | "xy" | "bode" | "scatter" | "pareto";

export interface PinStickyWidgetSpec {
  id?: string | undefined;
  label: string;
  value?: string | undefined;
  unit?: string | undefined;
  status?: "ok" | "warning" | "error" | "stale" | undefined;
}

export interface SimulationTelemetryData {
  time: number[];
  busVoltages?: Record<string, number[]> | undefined;
  busPhaseVoltages?: Record<string, { a: number[]; b: number[]; c: number[] }> | undefined;
  branchCurrents?: Record<string, number[]> | undefined;
  branchPhaseCurrents?: Record<string, { a: number[]; b: number[]; c: number[] }> | undefined;
  signals?: Record<string, number[]> | undefined;
}

let currentSimData: SimulationTelemetryData | null = null;
const pinnedScopes = new Map<string, { name: string; mode: PinnedPlotMode; element: HTMLElement }>();
const pinnedStickies = new Map<
  string,
  {
    label: string;
    unit?: string | undefined;
    overrideValue?: string | undefined;
    status?: "ok" | "warning" | "error" | "stale" | undefined;
    element: HTMLElement;
  }
>();

function findWaveform(
  id: string,
  name?: string,
): {
  kind: "voltage" | "current" | "signal";
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

  // 5. Check generic simulation signals (e.g. Modelica trajectories)
  if (currentSimData.signals) {
    for (const [sigName, arr] of Object.entries(currentSimData.signals)) {
      if (
        cleanCandidates.some(
          (c) => sigName.toLowerCase() === c.toLowerCase() || sigName.toLowerCase().startsWith(`${c.toLowerCase()}.`),
        )
      ) {
        return {
          kind: "signal",
          label: sigName,
          unit: "",
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
  const u = unit ? ` ${unit}` : "";
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)} M${unit}`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(2)} k${unit}`;
  if (abs >= 1 || abs === 0) return `${val.toFixed(2)}${u}`;
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

function generatePlotSvg(
  wf: { values: number[]; phases?: { a: number[]; b: number[]; c: number[] }; isThreePhase: boolean },
  mode: PinnedPlotMode,
  width = 256,
  height = 68,
): string {
  if (mode === "timeseries") {
    return generateSparklineSvg(wf, width, height);
  }

  const vals = wf.values;
  const n = vals.length;
  if (n < 2) {
    return generateSparklineSvg(wf, width, height);
  }

  const pad = 6;
  const plotW = Math.max(20, width - pad * 2);
  const plotH = Math.max(20, height - pad * 2);

  if (mode === "xy") {
    // Phase portrait: Phase A vs Phase B for 3-phase, or y(t) vs dy/dt for 1-phase
    const xs: number[] = [];
    const ys: number[] = [];
    const step = Math.max(1, Math.floor(n / 80));
    if (wf.isThreePhase && wf.phases && wf.phases.b.length === n) {
      for (let i = 0; i < n; i += step) {
        xs.push(wf.phases.a[i]!);
        ys.push(wf.phases.b[i]!);
      }
    } else {
      for (let i = 1; i < n; i += step) {
        xs.push(vals[i]!);
        ys.push(vals[i]! - vals[i - 1]!);
      }
    }
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (!Number.isFinite(minX) || minX === maxX) {
      minX = -1;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || minY === maxY) {
      minY = -1;
      maxY = 1;
    }
    const pts = xs.map((x, idx) => {
      const px = pad + ((x - minX) / (maxX - minX)) * plotW;
      const py = height - pad - ((ys[idx]! - minY) / (maxY - minY)) * plotH;
      return [px, py] as [number, number];
    });
    const d = pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const endPt = pts[pts.length - 1]!;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">
      <line x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}" stroke="rgba(148,163,184,0.2)" stroke-dasharray="2,2"/>
      <line x1="${width / 2}" y1="${pad}" x2="${width / 2}" y2="${height - pad}" stroke="rgba(148,163,184,0.2)" stroke-dasharray="2,2"/>
      <path d="${d}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="${endPt[0].toFixed(1)}" cy="${endPt[1].toFixed(1)}" r="2.8" fill="#38bdf8"/>
    </svg>`;
  }

  if (mode === "bode") {
    // Discrete Fourier magnitude spectrum in dB on log-spaced bins
    const sampleCount = Math.min(64, n);
    const step = Math.max(1, Math.floor(n / sampleCount));
    const sampled: number[] = [];
    for (let i = 0; i < n && sampled.length < sampleCount; i += step) {
      sampled.push(vals[i]!);
    }
    const N = sampled.length;
    const half = Math.max(2, Math.floor(N / 2));
    const magsDb: number[] = [];
    for (let k = 1; k <= half; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < N; t++) {
        const angle = (2 * Math.PI * k * t) / N;
        re += sampled[t]! * Math.cos(angle);
        im -= sampled[t]! * Math.sin(angle);
      }
      const mag = Math.hypot(re, im) / N;
      magsDb.push(20 * Math.log10(Math.max(mag, 1e-6)));
    }
    let minDb = Math.min(...magsDb);
    let maxDb = Math.max(...magsDb);
    if (!Number.isFinite(minDb) || minDb === maxDb) {
      minDb = -60;
      maxDb = 0;
    }
    const pts = magsDb.map((db, idx) => {
      const logX = Math.log10(idx + 1) / Math.max(1e-6, Math.log10(magsDb.length));
      const px = pad + logX * plotW;
      const py = height - pad - ((db - minDb) / (maxDb - minDb)) * plotH;
      return [px, py] as [number, number];
    });
    const d = pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">
      <line x1="${pad}" y1="${pad + plotH * 0.5}" x2="${width - pad}" y2="${pad + plotH * 0.5}" stroke="rgba(148,163,184,0.2)" stroke-dasharray="2,2"/>
      <path d="${d}" fill="none" stroke="#34d399" stroke-width="1.6" stroke-linecap="round"/>
      <text x="${width - pad}" y="${pad + 8}" text-anchor="end" fill="#94a3b8" font-size="8" font-family="monospace">${maxDb.toFixed(0)} dB</text>
      <text x="${width - pad}" y="${height - pad}" text-anchor="end" fill="#64748b" font-size="8" font-family="monospace">${minDb.toFixed(0)} dB</text>
    </svg>`;
  }

  if (mode === "scatter") {
    const step = Math.max(1, Math.floor(n / 40));
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < n; i += step) {
      const v = vals[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      cnt++;
    }
    if (!Number.isFinite(min) || min === max) {
      min = -1;
      max = 1;
    }
    const mean = cnt > 0 ? sum / cnt : 0;
    const meanY = height - pad - ((mean - min) / (max - min)) * plotH;
    const circles: string[] = [];
    for (let i = 0; i < n; i += step) {
      const px = pad + (i / Math.max(1, n - 1)) * plotW;
      const py = height - pad - ((vals[i]! - min) / (max - min)) * plotH;
      circles.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.2" fill="#f59e0b" opacity="0.88"/>`);
    }
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">
      <line x1="${pad}" y1="${meanY.toFixed(1)}" x2="${width - pad}" y2="${meanY.toFixed(1)}" stroke="rgba(56,189,248,0.45)" stroke-dasharray="3,2"/>
      ${circles.join("")}
    </svg>`;
  }

  // Pareto chart: top-8 magnitude bins sorted descending + cumulative percentage curve
  const binCount = 8;
  const binSize = Math.max(1, Math.floor(n / binCount));
  const bins: number[] = [];
  for (let b = 0; b < binCount; b++) {
    let peak = 0;
    const start = b * binSize;
    const end = Math.min(n, start + binSize);
    for (let i = start; i < end; i++) {
      const a = Math.abs(vals[i]!);
      if (a > peak) peak = a;
    }
    bins.push(peak);
  }
  bins.sort((a, b) => b - a);
  const total = bins.reduce((acc, v) => acc + v, 0) || 1;
  const maxBin = bins[0] || 1;
  const barGap = 4;
  const barW = Math.max(6, (plotW - barGap * (binCount - 1)) / binCount);
  let cum = 0;
  const bars: string[] = [];
  const cumPts: [number, number][] = [];
  bins.forEach((v, idx) => {
    const bh = (v / maxBin) * plotH;
    const bx = pad + idx * (barW + barGap);
    const by = height - pad - bh;
    bars.push(
      `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="rgba(56,189,248,0.55)" stroke="#38bdf8" stroke-width="0.8"/>`,
    );
    cum += v;
    const cy = height - pad - (cum / total) * plotH;
    cumPts.push([bx + barW / 2, cy]);
  });
  const cumPath = cumPts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">
    ${bars.join("")}
    <path d="${cumPath}" fill="none" stroke="#f472b6" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

function pinSparklineScope(id: string, name: string, initialMode: PinnedPlotMode = "timeseries") {
  const container = document.getElementById("pinned-scopes-container");
  if (!container) return;
  if (pinnedScopes.has(id)) {
    const existing = pinnedScopes.get(id)!;
    if (existing.mode !== initialMode) {
      existing.mode = initialMode;
      const sel = existing.element.querySelector(".scope-mode-select") as HTMLSelectElement | null;
      if (sel) sel.value = initialMode;
      const bodyEl = existing.element.querySelector(".scope-body") as HTMLElement | null;
      if (bodyEl) updateScopeCard(id, bodyEl);
    }
    existing.element.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const card = document.createElement("div");
  card.className = "pinned-scope-card";
  card.id = `pinned-scope-${id}`;

  const header = document.createElement("div");
  header.className = "scope-header";
  header.innerHTML = `
    <span>⚡ ${escapeHtml(name || id)}</span>
    <div class="scope-header-controls">
      <select class="scope-mode-select" title="Plot mode" aria-label="Plot mode">
        <option value="timeseries"${initialMode === "timeseries" ? " selected" : ""}>Time</option>
        <option value="xy"${initialMode === "xy" ? " selected" : ""}>X-Y</option>
        <option value="bode"${initialMode === "bode" ? " selected" : ""}>Bode</option>
        <option value="scatter"${initialMode === "scatter" ? " selected" : ""}>Scatter</option>
        <option value="pareto"${initialMode === "pareto" ? " selected" : ""}>Pareto</option>
      </select>
      <button class="scope-close-btn" title="Close Plot">×</button>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "scope-body";

  header.querySelector(".scope-mode-select")?.addEventListener("change", (ev) => {
    const scope = pinnedScopes.get(id);
    if (!scope) return;
    scope.mode = (ev.target as HTMLSelectElement).value as PinnedPlotMode;
    updateScopeCard(id, body);
  });

  header.querySelector(".scope-close-btn")?.addEventListener("click", () => {
    card.remove();
    pinnedScopes.delete(id);
  });

  card.appendChild(header);
  card.appendChild(body);
  container.appendChild(card);

  pinnedScopes.set(id, { name, mode: initialMode, element: card });
  updateScopeCard(id, body);
}

function updateScopeCard(id: string, bodyEl: HTMLElement) {
  const scope = pinnedScopes.get(id);
  if (!scope) return;
  const wf = findWaveform(id, scope.name);
  if (!wf) {
    bodyEl.innerHTML = `<div style="color: #94a3b8; font-size: 11px;">Waiting for simulation telemetry (${escapeHtml(scope.mode)})...</div>`;
    return;
  }

  const metrics = computeWaveformMetrics(wf.values);
  const rmsStr = formatEngineeringValue(metrics.rms, wf.unit);
  const pkStr = formatEngineeringValue(metrics.peak, wf.unit);
  const plotSvg = generatePlotSvg(wf, scope.mode, 256, scope.mode === "timeseries" ? 48 : 68);

  const freqStr = (() => {
    const times = currentSimData?.time;
    const vals = wf.values;
    if (times && vals && vals.length > 4 && times.length === vals.length) {
      let crossings = 0;
      let firstT = 0;
      let lastT = 0;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i - 1]! <= 0 && vals[i]! > 0) {
          if (crossings === 0) firstT = times[i]!;
          lastT = times[i]!;
          crossings++;
        }
      }
      if (crossings > 1 && lastT > firstT) {
        return `${((crossings - 1) / (lastT - firstT)).toFixed(2)} Hz`;
      }
    }
    return "—";
  })();

  bodyEl.innerHTML = `
    <div class="scope-metrics">
      <span>RMS: <strong style="color:#38bdf8;">${rmsStr}</strong></span>
      <span>Pk: <strong style="color:#a78bfa;">${pkStr}</strong></span>
      <span>f: <strong style="color:#34d399;">${freqStr}</strong></span>
    </div>
    <div style="background: rgba(15,23,42,0.6); padding: 4px; border-radius: 4px; border: 1px solid rgba(51,65,85,0.4);">
      ${plotSvg}
    </div>
  `;
}

function updateAllPinnedScopes() {
  for (const [id, scope] of pinnedScopes) {
    const body = scope.element.querySelector(".scope-body") as HTMLElement;
    if (body) updateScopeCard(id, body);
  }
}

function pinStickyValueWidget(spec: PinStickyWidgetSpec) {
  const container = document.getElementById("pinned-scopes-container");
  if (!container) return;
  const id = spec.id || spec.label || `sticky_${Date.now()}`;
  const existing = pinnedStickies.get(id);
  if (existing) {
    existing.label = spec.label || existing.label;
    if (spec.value !== undefined) existing.overrideValue = spec.value;
    if (spec.unit !== undefined) existing.unit = spec.unit;
    if (spec.status !== undefined) existing.status = spec.status;
    updateStickyCard(id);
    existing.element.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const card = document.createElement("div");
  card.className = "pinned-sticky-card";
  card.id = `pinned-sticky-${id}`;
  card.innerHTML = `
    <div class="sticky-header">
      <span class="sticky-title">
        <span class="sticky-dot status-${escapeHtml(spec.status || "stale")}"></span>
        <span>${escapeHtml(spec.label || id)}</span>
      </span>
      <span class="scope-header-controls">
        <button class="sticky-action-btn sticky-expand-btn" title="Open Multi-Type Plot">📈</button>
        <button class="scope-close-btn" title="Remove Sticky">×</button>
      </span>
    </div>
    <div class="sticky-value-row">
      <span class="sticky-value">—</span>
      <span class="sticky-unit">${escapeHtml(spec.unit || "")}</span>
    </div>
  `;

  card.querySelector(".sticky-expand-btn")?.addEventListener("click", () => {
    pinSparklineScope(id, spec.label || id, "timeseries");
  });

  card.querySelector(".scope-close-btn")?.addEventListener("click", () => {
    card.remove();
    pinnedStickies.delete(id);
  });

  container.appendChild(card);
  pinnedStickies.set(id, {
    label: spec.label || id,
    unit: spec.unit,
    overrideValue: spec.value,
    status: spec.status,
    element: card,
  });
  updateStickyCard(id);
}

function updateStickyCard(id: string) {
  const sticky = pinnedStickies.get(id);
  if (!sticky) return;
  const valEl = sticky.element.querySelector(".sticky-value") as HTMLElement | null;
  const unitEl = sticky.element.querySelector(".sticky-unit") as HTMLElement | null;
  const dotEl = sticky.element.querySelector(".sticky-dot") as HTMLElement | null;
  if (!valEl) return;

  const wf = findWaveform(id, sticky.label);
  if (wf && wf.values.length > 0) {
    const metrics = computeWaveformMetrics(wf.values);
    valEl.textContent = formatEngineeringValue(metrics.last, "");
    if (unitEl) unitEl.textContent = sticky.unit || wf.unit || "";
    if (dotEl) {
      dotEl.className = `sticky-dot status-${sticky.status || "ok"}`;
    }
  } else if (sticky.overrideValue !== undefined) {
    valEl.textContent = sticky.overrideValue;
    if (unitEl) unitEl.textContent = sticky.unit || "";
    if (dotEl) {
      dotEl.className = `sticky-dot status-${sticky.status || "ok"}`;
    }
  } else {
    valEl.textContent = "—";
    if (dotEl) {
      dotEl.className = "sticky-dot status-stale";
    }
  }
}

function updateAllPinnedStickies() {
  for (const id of pinnedStickies.keys()) {
    updateStickyCard(id);
  }
}

function updateStickyValuesFromFrame(stateVector: Record<string, number>) {
  for (const [id, sticky] of pinnedStickies) {
    const candidates = [id, sticky.label].filter(Boolean);
    for (const [sigName, val] of Object.entries(stateVector)) {
      if (
        typeof val === "number" &&
        Number.isFinite(val) &&
        candidates.some(
          (c) => sigName.toLowerCase() === c.toLowerCase() || sigName.toLowerCase().startsWith(`${c.toLowerCase()}.`),
        )
      ) {
        sticky.overrideValue = formatEngineeringValue(val, "");
        sticky.status = "ok";
        updateStickyCard(id);
        break;
      }
    }
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
  const freqStr = (() => {
    const times = currentSimData?.time;
    const vals = wf.values;
    if (times && vals && vals.length > 4 && times.length === vals.length) {
      let crossings = 0;
      let firstT = 0;
      let lastT = 0;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i - 1]! <= 0 && vals[i]! > 0) {
          if (crossings === 0) firstT = times[i]!;
          lastT = times[i]!;
          crossings++;
        }
      }
      if (crossings > 1 && lastT > firstT) {
        return `${((crossings - 1) / (lastT - firstT)).toFixed(2)} Hz`;
      }
    }
    return "—";
  })();

  tooltip.innerHTML = `
    <div style="font-weight: 600; font-size: 11px; margin-bottom: 2px; color: #f8fafc;">
      ${escapeHtml(wf.label)}
    </div>
    <div style="display: flex; gap: 8px; font-family: monospace; font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
      <span>RMS: <strong style="color: #38bdf8;">${rmsStr}</strong></span>
      <span>Pk: <strong style="color: #a78bfa;">${pkStr}</strong></span>
      <span>f: <strong style="color: #34d399;">${freqStr}</strong></span>
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
  menu.setAttribute("role", "menu");

  const hideMenu = () => {
    menu.style.display = "none";
  };

  document.addEventListener("click", hideMenu);
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);
  window.addEventListener("wheel", hideMenu, { passive: true });
  document.addEventListener("scroll", hideMenu, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.style.display !== "none") {
      e.stopPropagation();
      hideMenu();
    }
  });

  const showMenuAt = (x: number, y: number, items: ContextMenuItem[]) => {
    menu.innerHTML = "";
    for (const item of items) {
      if (item.isDivider) {
        const div = document.createElement("div");
        div.className = "context-menu-divider";
        div.setAttribute("role", "separator");
        menu.appendChild(div);
        continue;
      }
      const el = document.createElement("div");
      el.className = "context-menu-item";
      el.setAttribute("role", "menuitem");
      el.tabIndex = 0;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = item.label;
      el.appendChild(labelSpan);
      if (item.shortcut) {
        const shortcutSpan = document.createElement("span");
        shortcutSpan.className = "shortcut";
        shortcutSpan.textContent = item.shortcut;
        el.appendChild(shortcutSpan);
      }
      el.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
        item.action();
      };
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          hideMenu();
          item.action();
        }
      };
      menu.appendChild(el);
    }
    menu.style.visibility = "hidden";
    menu.style.display = "block";
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const clampedX = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
    const clampedY = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
    menu.style.visibility = "visible";
  };

  const boundGraphs = new WeakSet<object>();
  let bindAttempts = 0;
  const MAX_BIND_ATTEMPTS = 100;

  const bindGraphEvents = () => {
    const g = getGraph();
    if (!g) {
      if (bindAttempts++ < MAX_BIND_ATTEMPTS) {
        setTimeout(bindGraphEvents, 100);
      }
      return;
    }
    if (boundGraphs.has(g)) return;
    boundGraphs.add(g);
    g.on("scale", hideMenu);
    g.on("translate", hideMenu);

    g.on("node:click", ({ node }: { node: DiagramNodeCell }) => {
      if (!isPscadLanguage(activeLanguage)) return;
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

    g.on("node:mouseenter", ({ node, e }: { node: DiagramNodeCell; e: MouseEvent }) => {
      showProbeTooltip(e.clientX, e.clientY, node.id, node.getData()?.name);
    });
    g.on("node:mousemove", ({ node, e }: { node: DiagramNodeCell; e: MouseEvent }) => {
      if (currentSimData) {
        showProbeTooltip(e.clientX, e.clientY, node.id, node.getData()?.name);
      }
    });
    g.on("node:mouseleave", () => {
      hideProbeTooltip();
    });

    g.on("edge:mouseenter", ({ edge, e }: { edge: DiagramEdgeCell; e: MouseEvent }) => {
      const wireId = edge.getData()?.wireId || edge.id;
      showProbeTooltip(e.clientX, e.clientY, wireId);
    });
    g.on("edge:mousemove", ({ edge, e }: { edge: DiagramEdgeCell; e: MouseEvent }) => {
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

    g.on("node:contextmenu", ({ node, e }: { node: DiagramNodeCell; e: MouseEvent }) => {
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

      const items: ContextMenuItem[] = [
        {
          label: "Edit Parameters...",
          shortcut: "Enter",
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

      items.push(
        {
          label: "Pin Plot Widget (Time / XY / Bode / Scatter / Pareto)",
          action: () => {
            pinSparklineScope(node.id, node.getData()?.name || node.id, "timeseries");
          },
        },
        {
          label: "Pin Live Sticky Value",
          action: () => {
            pinStickyValueWidget({
              id: node.id,
              label: node.getData()?.name || node.id,
            });
          },
        },
      );

      items.push(
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Rotate 90° Clockwise",
          shortcut: "R",
          action: () => {
            if (!g.isSelected?.(node)) {
              g.cleanSelection?.();
              g.select?.(node);
            }
            rotateSelectedNodes(90, g);
          },
        },
        {
          label: "Rotate 90° Counter-Clockwise",
          shortcut: "Shift+R",
          action: () => {
            if (!g.isSelected?.(node)) {
              g.cleanSelection?.();
              g.select?.(node);
            }
            rotateSelectedNodes(-90, g);
          },
        },
        {
          label: "Flip Horizontal",
          shortcut: "H",
          action: () => {
            if (!g.isSelected?.(node)) {
              g.cleanSelection?.();
              g.select?.(node);
            }
            flipSelectedNodes("x", g);
          },
        },
        {
          label: "Flip Vertical",
          shortcut: "V",
          action: () => {
            if (!g.isSelected?.(node)) {
              g.cleanSelection?.();
              g.select?.(node);
            }
            flipSelectedNodes("y", g);
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
            const data = node.getData();
            const targetMod = data?.targetModule || (data?.isModule ? node.id : undefined);
            vscode.postMessage({
              type: "drillDown",
              nodeId: node.id,
              componentId: node.id,
              componentName: data?.name || node.id,
              className: targetMod || data?.definition,
              fallbackClassName: targetMod,
              label: data?.name || node.id,
            });
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

    g.on("edge:contextmenu", ({ edge, e }: { edge: DiagramEdgeCell; e: MouseEvent }) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const clientX = e.clientX ?? 100;
      const clientY = e.clientY ?? 100;
      const wireId = edge.getData()?.wireId || edge.id;

      showMenuAt(clientX, clientY, [
        {
          label: "Pin Plot Widget",
          action: () => {
            pinSparklineScope(wireId, `Wire ${wireId}`, "timeseries");
          },
        },
        {
          label: "Pin Live Sticky Value",
          action: () => {
            pinStickyValueWidget({
              id: wireId,
              label: `Wire ${wireId}`,
            });
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
            const source = edge.getSource();
            const target = edge.getTarget();
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

    g.on("blank:contextmenu", ({ e }: { e: MouseEvent }) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const clientX = e.clientX ?? 100;
      const clientY = e.clientY ?? 100;

      const isPscad = isPscadLanguage(activeLanguage);
      const menuItems: ContextMenuItem[] = [
        {
          label: "Search Component...",
          shortcut: "Shift+A",
          action: () => {
            showSpotlight(clientX, clientY);
          },
        },
      ];

      if (isPscad) {
        menuItems.push(
          { isDivider: true, label: "", action: () => {} },
          {
            label: "Insert Ground",
            shortcut: "G",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "master:ground", classKind: "Component" });
            },
          },
          {
            label: "Insert Busbar",
            shortcut: "B",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "master:bus", classKind: "Component" });
            },
          },
          {
            label: "Insert Breaker",
            shortcut: "K",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
            },
          },
        );
      } else if (isPsseLanguage(activeLanguage)) {
        menuItems.push(
          { isDivider: true, label: "", action: () => {} },
          {
            label: "Insert PQ Bus",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "psse:bus_pq", classKind: "Component" });
            },
          },
          {
            label: "Insert PV Bus",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "psse:bus_pv", classKind: "Component" });
            },
          },
          {
            label: "Insert Generator",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "psse:generator", classKind: "Component" });
            },
          },
          {
            label: "Insert Load",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "psse:load", classKind: "Component" });
            },
          },
          {
            label: "Insert AC Branch",
            action: () => {
              diagramWindow.__startPlacement?.({ className: "psse:branch", classKind: "Component" });
            },
          },
        );
      }

      menuItems.push(
        { isDivider: true, label: "", action: () => {} },
        {
          label: "Zoom to Fit",
          shortcut: "Shift+1",
          action: () => {
            g.zoomToFit({ padding: 30, maxScale: 1.5 });
          },
        },
        {
          label: "Toggle Minimap",
          shortcut: "M",
          action: () => {
            toggleMinimapOverlay();
          },
        },
        {
          label: "Open 3D / VR Stage",
          action: () => {
            vscode.postMessage({ type: "openSpatialDiagram3D" });
          },
        },
        {
          label: "Cycle Grid Style",
          action: () => {
            currentGridModeIdx = (currentGridModeIdx + 1) % GRID_MODES.length;
            setDiagramGrid(GRID_MODES[currentGridModeIdx]!, g);
          },
        },
        {
          label: "Export SVG",
          action: () => {
            const svgEl = document.querySelector("#container svg.ms-graph-svg, #container svg") as SVGSVGElement | null;
            if (!svgEl) return;
            const darkNow =
              document.documentElement.classList.contains("vscode-dark") ||
              document.documentElement.classList.contains("vscode-high-contrast");
            const svgStr = serializeInteractiveGraphSvg(svgEl, {
              background: darkNow ? "#1e1e1e" : "#ffffff",
            });
            const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${activeLanguage || "diagram"}_schematic.svg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          },
        },
      );

      if (currentBreadcrumbs.length > 1) {
        menuItems.push(
          { isDivider: true, label: "", action: () => {} },
          {
            label: "Drill Up to Parent",
            shortcut: "Alt+↑",
            action: () => {
              vscode.postMessage({ type: "drillUp" });
            },
          },
        );
      }

      showMenuAt(clientX, clientY, menuItems);
    });

    g.on("node:dblclick", ({ node }: { node: DiagramNodeCell }) => {
      const data = node.getData();
      const targetMod = data?.targetModule || (data?.isModule ? node.id : undefined);
      if (targetMod) {
        vscode.postMessage({
          type: "drillDown",
          nodeId: node.id,
          componentId: node.id,
          componentName: data?.name || node.id,
          className: targetMod,
          fallbackClassName: targetMod,
          label: data?.name || node.id,
        });
      }
    });

    g.on("selection:changed", () => {
      syncActionBarSelectionState();
      const selectedNodes = (g.getSelectedCells() as DiagramNodeCell[]).filter((c) => c.isNode());
      if (selectedNodes.length >= 2) {
        showBulkProperties(selectedNodes);
      }
    });
  };

  bindGraphEvents();
}

let lspPaletteCatalog: { id: string; name: string; category: string }[] = [];
let activeSpotlightRender: (() => void) | null = null;

function getEffectiveSpotlightCatalog(): { id: string; name: string; category: string }[] {
  if (lspPaletteCatalog.length > 0) return lspPaletteCatalog;
  const lang = activeLanguage.toLowerCase();
  if (isPscadLanguage(lang)) {
    return SPOTLIGHT_CATALOG.filter((c) => c.id.startsWith("master:"));
  }
  if (lang === "modelica" || lang === "mo" || lang === "modelscript" || lang === "msx") {
    return SPOTLIGHT_CATALOG.filter((c) => c.id.startsWith("Modelica."));
  }
  if (isPsseLanguage(lang)) {
    return SPOTLIGHT_CATALOG.filter((c) => c.id.startsWith("psse:"));
  }
  if (lang === "sysml" || lang === "sysml2") {
    return SPOTLIGHT_CATALOG.filter((c) => c.id.startsWith("sysml:"));
  }
  return SPOTLIGHT_CATALOG;
}

function showSpotlight(x: number, y: number) {
  const popover = document.getElementById("spotlight-omni-insert");
  const input = document.getElementById("spotlight-input") as HTMLInputElement | null;
  const results = document.getElementById("spotlight-results");
  if (!popover || !input || !results) return;

  if (lspPaletteCatalog.length === 0) {
    vscode.postMessage({ type: "getPalette" });
  }

  popover.style.left = `${Math.max(10, Math.min(x, window.innerWidth - 320))}px`;
  popover.style.top = `${Math.max(10, Math.min(y, window.innerHeight - 280))}px`;
  popover.style.display = "block";
  input.value = "";
  input.focus();

  let selectedIdx = 0;

  const renderResults = () => {
    const q = input.value.trim().toLowerCase();
    const catalog = getEffectiveSpotlightCatalog();
    const filtered = catalog.filter(
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
      const nameSpan = document.createElement("span");
      nameSpan.textContent = item.name;
      const badgeSpan = document.createElement("span");
      badgeSpan.className = "spotlight-badge";
      badgeSpan.textContent = item.category;
      row.appendChild(nameSpan);
      row.appendChild(badgeSpan);
      row.onmouseenter = () => {
        selectedIdx = idx;
        renderResults();
      };
      row.onclick = () => {
        popover.style.display = "none";
        diagramWindow.__startPlacement?.({ className: item.id, classKind: "Component" });
      };
      results.appendChild(row);
    });
  };

  activeSpotlightRender = renderResults;
  renderResults();

  input.oninput = () => {
    selectedIdx = 0;
    renderResults();
  };

  input.onkeydown = (e) => {
    const q = input.value.trim().toLowerCase();
    const filtered = getEffectiveSpotlightCatalog().filter(
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
        diagramWindow.__startPlacement?.({ className: choice.id, classKind: "Component" });
      }
    }
  };
}

function initKeyboardAccelerators() {
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement as HTMLElement | null;
    const isEditingText =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable);

    // Close Spotlight or Wire Mode on Escape
    const spotlight = document.getElementById("spotlight-omni-insert");
    if (e.key === "Escape") {
      if (spotlight && spotlight.style.display !== "none") {
        spotlight.style.display = "none";
        return;
      }
      if (isWireModeActive) {
        setSelectMode();
        return;
      }
    }

    if (isEditingText) return;

    const g = getGraph();
    if (!g) return;

    // Shift+A or / -> Open Spotlight Omni-Insert (preserve Tab for keyboard focus navigation)
    if ((e.shiftKey && e.key.toLowerCase() === "a") || (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      e.preventDefault();
      showSpotlight(window.innerWidth / 2 - 150, 80);
      return;
    }

    // Universal Wire mode: W (Modelica, SysML v2, OWL 2, PSCAD)
    if (e.key.toLowerCase() === "w" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const hudWire = document.getElementById("hud-wire");
      if (hudWire) {
        hudWire.click();
      } else {
        setWireMode();
      }
      return;
    }

    // Minimap toggle sync: M
    if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!e.defaultPrevented) {
        e.preventDefault();
        toggleMinimapOverlay();
      } else {
        requestAnimationFrame(() => syncMinimapToggleButton());
      }
      return;
    }

    // Drill up: Alt+ArrowUp
    if (e.altKey && e.key === "ArrowUp" && !e.ctrlKey && !e.metaKey) {
      if (currentBreadcrumbs.length > 1) {
        e.preventDefault();
        vscode.postMessage({ type: "drillUp" });
        return;
      }
    }

    const selectedCells = g.getSelectedCells() as DiagramNodeCell[];
    const selectedNodes = selectedCells.filter((c: DiagramNodeCell) => c.isNode());

    // Flip Horizontal: H / Flip Vertical: V (fallback if not already handled by canvas-ui-handlers)
    if (
      (e.key.toLowerCase() === "h" || e.key.toLowerCase() === "v") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.repeat &&
      !e.defaultPrevented &&
      selectedNodes.length > 0
    ) {
      e.preventDefault();
      flipSelectedNodes(e.key.toLowerCase() === "h" ? "x" : "y", g);
      return;
    }

    // Drill into definition: F12
    if (e.key === "F12" && !e.ctrlKey && !e.metaKey && !e.altKey && selectedNodes.length > 0) {
      const node = selectedNodes[0]!;
      const data = node.getData();
      const targetMod = data?.targetModule || (data?.isModule ? node.id : undefined);
      e.preventDefault();
      vscode.postMessage({
        type: "drillDown",
        nodeId: node.id,
        componentId: node.id,
        componentName: data?.name || node.id,
        className: targetMod || data?.definition,
        fallbackClassName: targetMod,
        label: data?.name || node.id,
      });
      return;
    }

    // Toggle Disable/Bypass: D
    if (e.key.toLowerCase() === "d" && !e.ctrlKey && !e.metaKey) {
      if (selectedNodes.length > 0) {
        e.preventDefault();
        selectedNodes.forEach((node: DiagramNodeCell) => {
          const current = Boolean(node.getData()?.disabled);
          const target = !current;
          node.setData({ ...node.getData(), disabled: target });
          node.setAttrs({ body: { opacity: target ? 0.45 : 1 } });
          enqueueDiagramAction({ type: "toggleDisable", name: node.id, disabled: target });
        });
        return;
      }
    }

    const isPscad = isPscadLanguage(activeLanguage);
    if (isPscad) {
      // Quick insert Ground: G
      if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) {
        diagramWindow.__startPlacement?.({ className: "master:ground", classKind: "Component" });
        return;
      }

      // Quick insert Busbar: B
      if (e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey) {
        diagramWindow.__startPlacement?.({ className: "master:bus", classKind: "Component" });
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
        diagramWindow.__startPlacement?.({ className: "master:breaker3", classKind: "Component" });
        return;
      }

      // Run simulation: F5
      if (e.key === "F5") {
        e.preventDefault();
        vscode.postMessage({ type: "runSimulation" });
        return;
      }
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
const nodeFilterTextMap = new Map<string, string>();
const nodeConflictManagers = new Map<string, ConflictManager>();
const propDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function showBulkProperties(selectedNodes: DiagramNodeCell[]) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const propItems = selectedNodes
    .map((n) => n.getData()?.properties)
    .filter((p): p is ComponentPropertyData => Boolean(p));
  const summary = mergeMultiSelectPropertyData(propItems);

  title.textContent = `${selectedNodes.length} COMPONENTS SELECTED`;
  panel.classList.add("open");
  content.innerHTML = "";

  const header = document.createElement("div");
  header.style.cssText =
    "padding: 10px 12px; font-size: 11px; color: var(--vscode-descriptionForeground, #888); border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));";
  header.textContent =
    summary && summary.classNames.length === 1
      ? `Shared class: ${summary.classNames[0]}`
      : `${selectedNodes.length} components selected`;
  content.appendChild(header);

  if (!summary || summary.sharedParameters.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding: 16px 12px; font-size: 12px; color: var(--vscode-descriptionForeground, #888);";
    empty.textContent = "No shared parameters across selected components.";
    content.appendChild(empty);
    return;
  }

  for (const param of summary.sharedParameters) {
    const row = document.createElement("div");
    row.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12));";

    const label = document.createElement("label");
    label.style.cssText =
      "font-size: 12px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;";
    label.textContent = param.unit ? `${param.name} (${param.unit})` : param.name;

    const input = document.createElement("input");
    input.type = "text";
    input.value = param.isMixed ? "" : String(param.value ?? "");
    input.placeholder = param.isMixed ? "Mixed" : "";
    input.style.cssText =
      "width: 110px; padding: 3px 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35)); background: var(--vscode-input-background, transparent); color: var(--vscode-input-foreground, inherit);";

    input.addEventListener("change", () => {
      const nextVal = input.value.trim();
      if (!nextVal || nextVal === MIXED_PROPERTY_VALUE) return;
      const actions = createBulkPropertyEditActions(summary.componentNames, param.name, nextVal, "parameter");
      for (const act of actions) {
        enqueueDiagramAction(act as WebviewDiagramAction);
      }
      input.placeholder = "";
    });

    row.appendChild(label);
    row.appendChild(input);
    content.appendChild(row);
  }
}

function showProperties(nodeData: DiagramShowPropertiesInput) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const nodeIdStr = String(nodeData.id ?? "");
  const props = nodeData.properties;
  const isLoading = nodeData.isLoading === true;
  const expectedTitle = props?.className ? props.className.split(".").pop()?.toUpperCase() : "PROPERTIES";

  title.textContent = (expectedTitle ?? "PROPERTIES") as string;
  panel.classList.add("open");

  if (!props) {
    if (isLoading) {
      content.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; padding: 24px 16px; color: var(--vscode-descriptionForeground, #888); font-size: 12px;">
        <div style="width: 14px; height: 14px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
        Loading properties...
      </div>`;
    }
    return;
  }

  // Get or initialize instance-level ConflictManager for this component
  let conflictMgr = nodeConflictManagers.get(nodeIdStr);
  if (!conflictMgr) {
    conflictMgr = new ConflictManager();
    conflictMgr.reset(props.values || {});
    nodeConflictManagers.set(nodeIdStr, conflictMgr);
  } else {
    // 3-Way sync remote values against local edits
    conflictMgr.handleRemoteUpdate(props.values || {});
  }

  // Active tab resolution
  const contextValues = buildPropertyContextValues(props, conflictMgr.getAllLocalValues());
  const availableTabs = getVisiblePropertyTabs(props.schema, contextValues);
  const activeTabId = resolveActivePropertyTabId(availableTabs, nodeActiveTabMap.get(nodeIdStr));
  if (activeTabId) {
    nodeActiveTabMap.set(nodeIdStr, activeTabId);
  }

  // In-place differential DOM reconciliation
  reconcilePropertiesDOM(
    content,
    {
      nodeId: nodeIdStr,
      data: props,
      localValues: conflictMgr.getAllLocalValues(),
      activeTabId,
      filterText: nodeFilterTextMap.get(nodeIdStr),
      conflictManager: conflictMgr,
    },
    {
      onNameChange: (newName: string) => {
        enqueueDiagramAction({ type: "updateName", oldName: nodeIdStr, newName });
        nodeData.id = newName;
        title.textContent = newName;
      },
      onDescriptionChange: (newDesc: string) => {
        if (props && newDesc !== props.description) {
          enqueueDiagramAction({ type: "updateDescription", name: nodeIdStr, description: newDesc });
          props.description = newDesc;
        }
      },
      onFieldChange: (fieldKey: string, newValue: string) => {
        const prevValue = conflictMgr.getLocalValue(fieldKey) ?? props.values?.[fieldKey];
        const txId = conflictMgr.setLocalValue(fieldKey, newValue);

        const updatedProps = applyOptimisticPropertyAction(props, {
          type: "updateProperty",
          name: nodeIdStr,
          key: fieldKey,
          value: newValue,
        });
        if (updatedProps) {
          nodeData.properties = updatedProps;
        }

        // Optimistically patch diagram SVG text in-place
        updateParameterText(nodeIdStr, fieldKey, String(prevValue ?? ""), String(newValue));

        // Re-reconcile in-place differential DOM to immediately update dependent predicates, dots, revert buttons
        showProperties(nodeData);

        // Debounce LSP update action with client transaction correlation
        const timerKey = `${nodeIdStr}:${fieldKey}`;
        const existingTimer = propDebounceTimers.get(timerKey);
        if (existingTimer) clearTimeout(existingTimer);
        propDebounceTimers.set(
          timerKey,
          setTimeout(() => {
            propDebounceTimers.delete(timerKey);
            enqueueDiagramAction({
              type: "updateProperty",
              name: nodeIdStr,
              key: fieldKey,
              value: newValue,
              previousValue: prevValue,
              clientTxId: txId,
            });
          }, 100),
        );
      },
      onTabChange: (newTabId: string) => {
        nodeActiveTabMap.set(nodeIdStr, newTabId);
        showProperties(nodeData);
      },
      onFilterChange: (text: string) => {
        nodeFilterTextMap.set(nodeIdStr, text);
        showProperties(nodeData);
      },
      onResolveConflict: (fieldKey: string, resolution: "keep_local" | "accept_remote") => {
        const chosenValue = conflictMgr.resolveConflict(fieldKey, resolution);
        if (props.values) {
          props.values[fieldKey] = chosenValue;
        }
        enqueueDiagramAction({
          type: "updateProperty",
          name: nodeIdStr,
          key: fieldKey,
          value: chosenValue,
        });
        showProperties(nodeData);
      },
      onClose: () => {
        panel.classList.remove("open");
      },
      sanitize: (html: string) => DOMPurify.sanitize(html),
    },
  );
}

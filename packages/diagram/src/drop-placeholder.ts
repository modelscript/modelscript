// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DropPlaceholderOptions {
  width?: number | undefined;
  height?: number | undefined;
  isDark?: boolean | undefined;
}

/**
 * Returns `true` if a cell ID belongs to a non-interactive background, axis, stem,
 * solder dot, or placement ghost node rather than a user-selectable diagram component.
 */
export function isEphemeralDiagramNode(id: string): boolean {
  return (
    id === "__diagram_background__" ||
    id === "__diagram_axes__" ||
    id.startsWith("solder_dot_") ||
    id.startsWith("wire_crossing_") ||
    id.startsWith("__seq_stem_") ||
    id.startsWith("__alignment_guide_") ||
    id === "placement-ghost" ||
    id === "__drop_placeholder__"
  );
}

/** Expected duration of the entry bounce animation in milliseconds. */
export const DROP_BOUNCE_DURATION_MS = 240;

export interface ActiveDropPlaceholder {
  x: number;
  y: number;
  className: string;
  iconSvg?: string | null | undefined;
  timestamp: number;
}

let activeDropPlaceholder: ActiveDropPlaceholder | null = null;
let lastDropPlaceholderTime = 0;
let dropSafetyTimer: ReturnType<typeof setTimeout> | null = null;

export function getLastDropPlaceholderTime(): number {
  return lastDropPlaceholderTime;
}

export function getActiveDropPlaceholder(): ActiveDropPlaceholder | null {
  return activeDropPlaceholder;
}

export function clearActiveDropPlaceholder(): void {
  activeDropPlaceholder = null;
  if (dropSafetyTimer !== null) {
    clearTimeout(dropSafetyTimer);
    dropSafetyTimer = null;
  }
}

/**
 * Computes typical node dimensions from existing diagram components in the graph,
 * or returns language-appropriate defaults (e.g. 20x20 for Modelica/physical circuits).
 */

export interface DropPlaceholderGraphNode {
  id: string;
  width?: number | undefined;
  height?: number | undefined;
  getSize?: (() => { width: number; height: number } | undefined) | undefined;
  getBBox?: (() => { width: number; height: number } | undefined) | undefined;
}

export interface DropPlaceholderGraph {
  getNodes?: (() => DropPlaceholderGraphNode[]) | undefined;
  getCellById?: ((id: string) => unknown) | undefined;
  removeCell?: ((cell: unknown) => unknown) | undefined;
  addNode: (node: Record<string, unknown>) => unknown;
}

export function getTypicalNodeSize(g: DropPlaceholderGraph | null | undefined): { width: number; height: number } {
  if (g && typeof g.getNodes === "function") {
    const nodes = g.getNodes().filter((n) => !isEphemeralDiagramNode(n.id));
    const sizes = nodes
      .map((n) => {
        const s = n.getSize?.();
        if (s && s.width > 0 && s.height > 0) return s;
        const b = n.getBBox?.();
        if (b && b.width > 0 && b.height > 0) return { width: b.width, height: b.height };
        return { width: n.width ?? 0, height: n.height ?? 0 };
      })
      .filter((s) => s && s.width > 0 && s.height > 0 && s.width <= 300 && s.height <= 300);

    if (sizes.length > 0) {
      // Sort by area to pick median representative node
      sizes.sort((a, b) => a.width * a.height - b.width * b.height);
      const median = sizes[Math.floor(sizes.length / 2)]!;
      return { width: Math.round(median.width), height: Math.round(median.height) };
    }
  }
  // Default to 20x20 for standard Modelica circuits (standard extent {{-10, -10}, {10, 10}})
  return { width: 20, height: 20 };
}

export function ensureDiagramStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("modelscript-diagram-animations")) return;

  const style = document.createElement("style");
  style.id = "modelscript-diagram-animations";
  style.textContent = `
    @keyframes drop-placeholder-bounce {
      0% {
        opacity: 0;
        transform: scale(0.3);
      }
      40% {
        opacity: 1;
        transform: scale(1.18);
      }
      65% {
        transform: scale(0.92);
      }
      85% {
        transform: scale(1.04);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes drop-placeholder-appear {
      0% {
        opacity: 0;
        transform: scale(0.3);
      }
      40% {
        opacity: 1;
        transform: scale(1.18);
      }
      65% {
        transform: scale(0.92);
      }
      85% {
        transform: scale(1.04);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes drop-placeholder-pulse {
      0%, 100% {
        opacity: 0.9;
        transform: scale(1);
      }
      50% {
        opacity: 1;
        transform: scale(1.05);
      }
    }

    @keyframes diagram-anchor-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.7);
        filter: drop-shadow(0 0 8px rgba(6, 182, 212, 0.8));
      }
      70% {
        box-shadow: 0 0 0 16px rgba(6, 182, 212, 0);
        filter: drop-shadow(0 0 16px rgba(6, 182, 212, 0.4));
      }
      100% {
        box-shadow: 0 0 0 0 rgba(6, 182, 212, 0);
        filter: drop-shadow(0 0 4px rgba(6, 182, 212, 0.6));
      }
    }

    .modelscript-anchor-halo {
      animation: diagram-anchor-pulse 1.8s ease-out 3;
    }

    .modelscript-anchor-halo text,
    .modelscript-anchor-halo tspan {
      stroke: none !important;
    }

    [data-cell-id="__drop_placeholder__"],
    [data-cell-id="__drop_placeholder__"] image,
    [data-cell-id="__drop_placeholder__"] rect,
    [data-cell-id="placement-ghost"],
    [data-cell-id="placement-ghost"] image,
    [data-cell-id="placement-ghost"] rect {
      transform-box: fill-box !important;
      transform-origin: center center !important;
    }

    [data-cell-id="__diagram_background__"],
    [data-cell-id="__diagram_background__"] *,
    [data-cell-id="__diagram_axes__"],
    [data-cell-id="__diagram_axes__"] *,
    [data-cell-id="placement-ghost"],
    [data-cell-id="placement-ghost"] *,
    [data-cell-id="__drop_placeholder__"],
    [data-cell-id="__drop_placeholder__"] * {
      pointer-events: none !important;
    }

    /* Unified selection box & transform controls */
    .x6-widget-selection-box,
    .x6-widget-selection-inner {
      border: 1.5px solid var(--vscode-focusBorder, #0284c7) !important;
      box-shadow: 0 0 0 1px rgba(2, 132, 199, 0.18), 0 4px 12px rgba(2, 132, 199, 0.1) !important;
      border-radius: 4px;
      background-color: rgba(2, 132, 199, 0.04);
    }

    .x6-widget-selection-box-node {
      margin: -5px 0 0 -5px !important;
      padding: 4px !important;
      box-sizing: content-box !important;
      transform-origin: center center !important;
    }

    .x6-widget-selection-box-edge {
      display: none !important;
    }

    .x6-widget-transform {
      border: none !important;
      margin: -4px 0 0 -4px !important;
      padding: 4px !important;
      box-sizing: content-box !important;
    }

    /* Hide midpoint resize handles (t, b, l, r) so they never occlude or block component pins/ports */
    .x6-widget-transform-resize[data-position="t"],
    .x6-widget-transform-resize[data-position="b"],
    .x6-widget-transform-resize[data-position="l"],
    .x6-widget-transform-resize[data-position="r"],
    .x6-widget-transform-rotate {
      display: none !important;
      pointer-events: none !important;
    }

    /* Corner-only precision resize handles (Figma / Linear / KiCad grade) */
    .x6-widget-transform > div {
      width: 7px !important;
      height: 7px !important;
      background-color: var(--vscode-editor-background, #ffffff) !important;
      border: 1.5px solid var(--vscode-focusBorder, #0284c7) !important;
      border-radius: 2px !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
      transition: transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.12s ease;
    }

    .x6-widget-transform > div:hover {
      background-color: var(--vscode-focusBorder, #0284c7) !important;
      transform: scale(1.25);
    }

    /* Edge Selection and Vertex/Segment Handle Controls */
    @keyframes x6-edge-flow {
      to {
        stroke-dashoffset: -20;
      }
    }

    /* Universal base for all styles: crisp non-scaling stroke (prevents zoom blowout) */
    .x6-edge.x6-edge-selected path.connection {
      stroke: var(--vscode-focusBorder, #0284c7) !important;
      vector-effect: non-scaling-stroke !important;
    }

    .x6-edge-tool-vertex circle,
    circle.x6-edge-tool-vertex {
      cursor: grab !important;
      transition: fill 0.15s ease, r 0.15s ease;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
    }

    .x6-edge-tool-vertex circle:hover,
    circle.x6-edge-tool-vertex:hover {
      fill: var(--vscode-focusBorder, #0284c7) !important;
      cursor: grab !important;
    }

    .x6-edge-tool-segment rect,
    rect.x6-edge-tool-segment {
      cursor: move !important;
      transition: opacity 0.15s ease, fill 0.15s ease;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
    }

    .x6-edge-tool-segment rect:hover,
    rect.x6-edge-tool-segment:hover {
      fill: var(--vscode-focusBorder, #0284c7) !important;
      cursor: move !important;
    }

    /* ⚡ Minimalist CAD (Modelica, SPICE, PSCAD): Strict 1.5px non-scaling stroke, zero raster blur */
    [data-edge-selection="minimalist"] .x6-edge.x6-edge-selected path.connection {
      stroke-width: 1.5px !important;
      filter: none !important;
    }
    [data-edge-selection="minimalist"] .x6-edge-tool-vertex circle,
    [data-edge-selection="minimalist"] circle.x6-edge-tool-vertex {
      r: 3px !important;
      stroke-width: 1.5px !important;
    }
    [data-edge-selection="minimalist"] .x6-edge-tool-segment,
    [data-edge-selection="minimalist"] rect.x6-edge-tool-segment {
      display: none !important;
    }

    /* 📐 Interactive HUD (SysML v2, Simulink): Sleek 1.8px line, hover-only segment handles */
    [data-edge-selection="hud"] .x6-edge.x6-edge-selected path.connection {
      stroke-width: 1.8px !important;
      filter: drop-shadow(0 0 1.5px rgba(2, 132, 199, 0.35)) !important;
    }
    [data-edge-selection="hud"] .x6-edge-tool-segment rect,
    [data-edge-selection="hud"] rect.x6-edge-tool-segment {
      opacity: 0.15;
    }
    [data-edge-selection="hud"] .x6-edge:hover .x6-edge-tool-segment rect,
    [data-edge-selection="hud"] .x6-edge:hover rect.x6-edge-tool-segment {
      opacity: 1;
    }

    /* 🌊 Flow Trace (Olga, Fluids, SWMM): Animated marching dash to preserve physical conduit diameters */
    [data-edge-selection="trace"] .x6-edge.x6-edge-selected path.connection {
      stroke-width: 1.8px !important;
      stroke-dasharray: 6, 4 !important;
      animation: x6-edge-flow 1.2s linear infinite !important;
      filter: drop-shadow(0 0 2px rgba(2, 132, 199, 0.45)) !important;
    }

    /* 🌐 Precision Halo (Default / Ontologies): Crisp 1.5px core with soft translucent casing */
    [data-edge-selection="halo"] .x6-edge.x6-edge-selected path.connection,
    :not([data-edge-selection]) .x6-edge.x6-edge-selected path.connection {
      stroke-width: 1.5px !important;
      filter: drop-shadow(0 0 2px rgba(2, 132, 199, 0.5)) !important;
    }
    [data-edge-selection="halo"] .x6-edge-tool-segment rect,
    :not([data-edge-selection]) .x6-edge-tool-segment rect {
      opacity: 0.35;
    }
    [data-edge-selection="halo"] .x6-edge:hover .x6-edge-tool-segment rect,
    :not([data-edge-selection]) .x6-edge:hover rect.x6-edge-tool-segment {
      opacity: 1;
    }

    /* Highlight connected ports when an edge is selected */
    .x6-port.x6-port-edge-selected circle,
    .x6-port.x6-port-edge-selected rect {
      stroke: var(--vscode-focusBorder, #0284c7) !important;
      stroke-width: 2px !important;
      filter: drop-shadow(0 0 3px rgba(2, 132, 199, 0.6)) !important;
    }
    /* Level-of-Detail (LOD) Rules */
    .x6-lod-low text,
    .x6-lod-low tspan {
      display: none !important;
    }
    .x6-lod-minimal .x6-port {
      display: none !important;
    }

    /* Port Proximity Magnet Glow & Target Snap Rings */
    .x6-port-body:hover,
    .x6-port:hover circle[magnet="true"] {
      stroke: var(--ms-brand, #0891b2) !important;
      stroke-width: 2.5px !important;
      filter: drop-shadow(0 0 5px var(--ms-brand, #0891b2)) !important;
      cursor: crosshair;
    }

    circle.x6-magnet-available {
      stroke: var(--ms-brand, #0891b2) !important;
      stroke-width: 3px !important;
      fill: var(--ms-bg, #ffffff) !important;
      filter: drop-shadow(0 0 6px var(--ms-brand, #0891b2)) !important;
      animation: ms-magnet-pulse 1.4s infinite ease-in-out;
    }

    circle.x6-magnet-adsorbed {
      stroke: var(--ms-accent-cyan, #22d3ee) !important;
      stroke-width: 5px !important;
      fill: var(--ms-brand, #0891b2) !important;
      filter: drop-shadow(0 0 10px var(--ms-accent-cyan, #22d3ee)) !important;
      transform-origin: center;
      transform: scale(1.4);
      transition: transform 0.12s ease;
    }

    @keyframes ms-magnet-pulse {
      0%, 100% {
        stroke-width: 2.5px;
        opacity: 0.9;
      }
      50% {
        stroke-width: 4px;
        opacity: 1;
      }
    }

    /* Contextual Floating Edit Bar (Single-Node & Multi-Node HUD Pill) */
    .modelscript-alignment-toolbar {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 4px 6px;
      background: var(--ms-bg-soft, var(--vscode-editorWidget-background, #1e293b));
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid var(--ms-border, var(--vscode-widget-border, rgba(148, 163, 184, 0.25)));
      border-radius: 9px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24), 0 2px 6px rgba(0, 0, 0, 0.14);
      user-select: none;
      white-space: nowrap;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .modelscript-alignment-toolbar .align-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: var(--ms-text-2, var(--vscode-foreground, #cbd5e1));
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, transform 0.08s ease;
      padding: 0;
    }
    .modelscript-alignment-toolbar .align-btn:hover {
      background: var(--ms-surface-hover, rgba(56, 189, 248, 0.14));
      color: var(--ms-brand, #38bdf8);
      transform: translateY(-0.5px);
    }
    .modelscript-alignment-toolbar .align-btn:active {
      transform: scale(0.94);
    }
    .modelscript-alignment-toolbar .align-btn.align-btn-danger:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
    }
    .modelscript-alignment-toolbar .align-sep {
      width: 1px;
      height: 16px;
      background: var(--ms-divider, rgba(148, 163, 184, 0.24));
      margin: 0 2px;
      flex-shrink: 0;
    }
    .modelscript-alignment-toolbar .align-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 22px;
      padding: 0 7px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .modelscript-alignment-toolbar .align-chip-name {
      background: rgba(2, 132, 199, 0.14);
      color: var(--ms-brand, #38bdf8);
      font-family: "JetBrains Mono", "Fira Code", var(--vscode-editor-font-family, monospace);
    }
    .modelscript-alignment-toolbar .align-chip-name:hover {
      background: rgba(2, 132, 199, 0.24);
      border-color: rgba(56, 189, 248, 0.4);
    }
    .modelscript-alignment-toolbar .align-chip-param {
      background: rgba(148, 163, 184, 0.12);
      color: var(--ms-text-1, var(--vscode-foreground, #e2e8f0));
      font-family: "JetBrains Mono", "Fira Code", var(--vscode-editor-font-family, monospace);
      font-weight: 500;
    }
    .modelscript-alignment-toolbar .align-chip-param:hover {
      background: rgba(56, 189, 248, 0.14);
      border-color: rgba(56, 189, 248, 0.35);
      color: var(--ms-brand, #38bdf8);
    }
    .modelscript-alignment-toolbar .align-badge-count {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 7px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(2, 132, 199, 0.16);
      color: var(--ms-brand, #38bdf8);
    }
    .modelscript-alignment-toolbar .align-param-input {
      width: 72px;
      height: 22px;
      padding: 0 6px;
      border-radius: 4px;
      border: 1.5px solid var(--ms-brand, #0284c7);
      background: var(--vscode-input-background, #0f172a);
      color: var(--vscode-input-foreground, #f8fafc);
      font-family: "JetBrains Mono", "Fira Code", var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      outline: none;
    }

    /* Live Coordinate & Delta Nudge HUD Pill */
    .modelscript-nudge-hud {
      position: absolute;
      z-index: 1001;
      pointer-events: none;
      transform: translate(-50%, 0);
      padding: 2px 8px;
      border-radius: 5px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #f1f5f9;
      font-family: "JetBrains Mono", "Fira Code", var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.01em;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      transition: opacity 0.15s ease;
    }

    /* CAD Spacebar Hand Pan Mode */
    .x6-hand-panning,
    .x6-hand-panning * {
      cursor: grab !important;
    }
    .x6-hand-panning-active,
    .x6-hand-panning-active * {
      cursor: grabbing !important;
    }
  `;
  document.head.appendChild(style);
}

export function dropComponentGhost(
  g: DropPlaceholderGraph,
  x: number,
  y: number,
  className: string,
  iconSvg?: string | null,
  isDark?: boolean,
  width?: number,
  height?: number,
) {
  ensureDiagramStyles();
  lastDropPlaceholderTime = Date.now();
  const initialTimestamp = activeDropPlaceholder?.timestamp ?? Date.now();
  activeDropPlaceholder = {
    x,
    y,
    className,
    iconSvg: iconSvg ?? undefined,
    timestamp: initialTimestamp,
  };

  if (dropSafetyTimer !== null) {
    clearTimeout(dropSafetyTimer);
  }
  dropSafetyTimer = setTimeout(() => {
    try {
      const existing = g.getCellById?.("__drop_placeholder__");
      if (existing) g.removeCell?.(existing);
    } catch {
      // ignore
    }
    clearActiveDropPlaceholder();
  }, 3500);

  const strokeColor = isDark ? "#cccccc" : "#333333";
  const fillColor = isDark ? "rgba(204, 204, 204, 0.15)" : "rgba(51, 51, 51, 0.08)";

  // Remove any previous placeholder or ghost
  const existing = g.getCellById?.("__drop_placeholder__");
  if (existing) g.removeCell?.(existing);
  const ghost = g.getCellById?.("placement-ghost");
  if (ghost) g.removeCell?.(ghost);

  const nodeSize = width && height ? { width, height } : getTypicalNodeSize(g);
  const w = nodeSize.width;
  const h = nodeSize.height;
  const halfW = w / 2;
  const halfH = h / 2;

  if (iconSvg) {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "image",
      x: x - halfW,
      y: y - halfH,
      width: w,
      height: h,
      zIndex: 9999,
      imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`,
      attrs: {
        image: {
          preserveAspectRatio: "xMidYMid meet",
          style:
            "pointer-events: none; transform-box: fill-box; transform-origin: center center; animation: drop-placeholder-bounce 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.24s;",
        },
      },
    });
  } else {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "rect",
      x: x - halfW,
      y: y - halfH,
      width: w,
      height: h,
      zIndex: 9999,
      attrs: {
        body: {
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          strokeDasharray: "4 2",
          pointerEvents: "none",
          style:
            "transform-box: fill-box; transform-origin: center center; animation: drop-placeholder-bounce 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.24s;",
        },
        text: {
          text: className.split(".").pop(),
          fill: strokeColor,
          pointerEvents: "none",
          fontSize: 10,
          fontWeight: "600",
        },
      },
    });
  }
}

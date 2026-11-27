// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramMarkupNode } from "@modelscript/canvas/engine";
import { adaptSvgColors } from "./color-inversion.js";

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

    /* Zoom-driven Level-of-Detail (LOD) optimizations for large schematics */
    [data-diagram-lod="medium"] .ms-node,
    [data-diagram-lod="low"] .ms-node,
    [data-diagram-lod="medium"] .ms-edge,
    [data-diagram-lod="low"] .ms-edge {
      filter: none !important;
    }
    [data-diagram-lod="low"] .ms-port-label,
    [data-diagram-lod="low"] .ms-edge-label,
    [data-diagram-lod="low"] .compartment-row {
      display: none !important;
    }

    .modelscript-hover-halo {
      outline: none !important;
    }

    .modelscript-hover-glow {
      pointer-events: none !important;
    }

    [data-cell-id="__drop_placeholder__"],
    [data-cell-id="__drop_placeholder__"] image,
    [data-cell-id="__drop_placeholder__"] svg,
    [data-cell-id="__drop_placeholder__"] rect,
    [data-cell-id="placement-ghost"],
    [data-cell-id="placement-ghost"] image,
    [data-cell-id="placement-ghost"] svg,
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
    .ms-selection-box {
      border: 1.5px solid var(--vscode-focusBorder, #0284c7) !important;
      box-shadow: 0 0 0 1px rgba(2, 132, 199, 0.18), 0 4px 12px rgba(2, 132, 199, 0.08) !important;
      border-radius: 4px;
      background-color: transparent !important;
    }

    /* Edge Selection and Vertex/Segment Handle Controls */
    @keyframes ms-edge-flow {
      to {
        stroke-dashoffset: -20;
      }
    }

    /* Universal base for all styles: crisp non-scaling stroke (prevents zoom blowout) */
    .ms-edge.ms-edge-selected path[data-selector="line"] {
      stroke: var(--vscode-focusBorder, #0284c7) !important;
      vector-effect: non-scaling-stroke !important;
    }

    .ms-vertex-handle {
      cursor: grab !important;
      transition: fill 0.15s ease;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
      vector-effect: non-scaling-stroke !important;
    }

    .ms-vertex-handle:hover {
      fill: var(--vscode-focusBorder, #0284c7) !important;
      cursor: grab !important;
    }

    .ms-segment-handle {
      cursor: move !important;
      transition: opacity 0.15s ease, fill 0.15s ease;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
      vector-effect: non-scaling-stroke !important;
    }

    .ms-segment-handle:hover {
      fill: var(--vscode-focusBorder, #0284c7) !important;
      cursor: move !important;
    }

    /* ⚡ Minimalist CAD (Modelica, SPICE, PSCAD): Strict 1.5px non-scaling stroke, zero raster blur */
    [data-edge-selection="minimalist"] .ms-edge.ms-edge-selected path[data-selector="line"] {
      stroke-width: 1.5px !important;
      filter: none !important;
    }
    [data-edge-selection="minimalist"] .ms-vertex-handle {
      stroke-width: 1.5px !important;
      vector-effect: non-scaling-stroke !important;
    }

    /* 📐 Interactive HUD (SysML v2, Simulink): Sleek 1.8px line, hover-only segment handles */
    [data-edge-selection="hud"] .ms-edge.ms-edge-selected path[data-selector="line"] {
      stroke-width: 1.8px !important;
      filter: drop-shadow(0 0 1.5px rgba(2, 132, 199, 0.35)) !important;
    }

    /* 🌊 Flow Trace (Olga, Fluids, SWMM): Animated marching dash to preserve physical conduit diameters */
    [data-edge-selection="trace"] .ms-edge.ms-edge-selected path[data-selector="line"] {
      stroke-width: 1.8px !important;
      stroke-dasharray: 6, 4 !important;
      animation: ms-edge-flow 1.2s linear infinite !important;
      filter: drop-shadow(0 0 2px rgba(2, 132, 199, 0.45)) !important;
    }

    /* 🌐 Precision Halo (Default / Ontologies): Crisp 1.5px core with soft translucent casing */
    [data-edge-selection="halo"] .ms-edge.ms-edge-selected path[data-selector="line"],
    :not([data-edge-selection]) .ms-edge.ms-edge-selected path[data-selector="line"] {
      stroke-width: 1.5px !important;
      filter: drop-shadow(0 0 2px rgba(2, 132, 199, 0.5)) !important;
    }

    /* Highlight connected ports when an edge is selected */
    .ms-port.ms-port-edge-selected circle,
    .ms-port.ms-port-edge-selected rect {
      stroke: var(--vscode-focusBorder, #0284c7) !important;
      stroke-width: 2px !important;
      filter: drop-shadow(0 0 3px rgba(2, 132, 199, 0.6)) !important;
    }
    /* Level-of-Detail (LOD) Rules */
    .ms-lod-low text,
    .ms-lod-low tspan {
      display: none !important;
    }
    .ms-lod-minimal .ms-port {
      display: none !important;
    }

    /* Port Proximity Magnet Glow & Target Snap Rings.
       Classes are applied to the <g class="ms-port"> group, so rules target the group
       (filter) and its children (scale), which works for any port markup. */
    .ms-port {
      cursor: crosshair;
      transition: opacity 0.12s ease, filter 0.12s ease;
    }
    .ms-port:hover,
    .ms-port.ms-port-hover {
      filter: drop-shadow(0 0 5px var(--ms-brand, #0891b2)) drop-shadow(0 0 2px var(--ms-brand, #0891b2));
    }
    .ms-port:hover > *,
    .ms-port.ms-port-hover > * {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(1.3);
      transition: transform 0.1s ease;
    }

    .ms-port.ms-magnet-source {
      filter: drop-shadow(0 0 7px var(--ms-accent-cyan, #22d3ee));
    }
    .ms-port.ms-magnet-source > * {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(1.35);
    }

    .ms-port.ms-magnet-available {
      filter: drop-shadow(0 0 6px var(--ms-brand, #0891b2));
      animation: ms-magnet-pulse 1.4s infinite ease-in-out;
    }

    .ms-port.ms-magnet-incompatible {
      opacity: 0.25;
      filter: grayscale(1);
      cursor: not-allowed;
    }

    .ms-port.ms-magnet-adsorbed {
      filter: drop-shadow(0 0 12px var(--ms-accent-cyan, #22d3ee)) drop-shadow(0 0 5px var(--ms-accent-cyan, #22d3ee));
      animation: none;
    }
    .ms-port.ms-magnet-adsorbed > * {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(1.65);
      transition: transform 0.12s ease;
    }

    @keyframes ms-magnet-pulse {
      0%, 100% {
        opacity: 0.85;
      }
      50% {
        opacity: 1;
      }
    }

    /* Contextual Floating Edit Bar (Single-Node & Multi-Node HUD Pill) */
    .modelscript-alignment-toolbar {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 4px 6px;
      background: var(--ms-surface-glass, var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.94)));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--borderColor-muted, var(--ms-divider, var(--vscode-widget-border, rgba(15, 23, 42, 0.08))));
      border-radius: var(--ms-radius-lg, 12px);
      box-shadow: var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.14), 0 2px 6px rgba(0, 0, 0, 0.08));
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
    .ms-hand-panning,
    .ms-hand-panning *,
    .x6-hand-panning,
    .x6-hand-panning * {
      cursor: grab !important;
    }
    .ms-hand-panning-active,
    .ms-hand-panning-active *,
    .x6-hand-panning-active,
    .x6-hand-panning-active * {
      cursor: grabbing !important;
    }

    /* Visible focus ring for keyboard navigation */
    .ms-graph:focus-visible,
    #container:focus-visible {
      outline: 2px solid var(--ms-accent, #38bdf8);
      outline-offset: -2px;
    }

    /* Accessibility: respect prefers-reduced-motion */
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function decodeBasicXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function normalizeRootSvgMarkup(root: DiagramMarkupNode, width: number, height: number): DiagramMarkupNode[] {
  const srcAttrs = root.attrs ?? {};
  const attrs: Record<string, string | number> = {};
  let viewBox: string | undefined;
  let origW: number | undefined;
  let origH: number | undefined;

  for (const [rawKey, val] of Object.entries(srcAttrs)) {
    const lower = rawKey.toLowerCase();
    if (lower.startsWith("on") || lower === "xmlns" || lower.startsWith("xmlns:")) continue;
    if (lower === "viewbox") {
      viewBox = String(val);
      continue;
    }
    if (lower === "width") {
      const parsed = parseFloat(String(val));
      if (Number.isFinite(parsed) && parsed > 0 && !String(val).includes("%")) origW = parsed;
      continue;
    }
    if (lower === "height") {
      const parsed = parseFloat(String(val));
      if (Number.isFinite(parsed) && parsed > 0 && !String(val).includes("%")) origH = parsed;
      continue;
    }
    if (lower === "x" || lower === "y" || lower === "preserveaspectratio") continue;
    attrs[rawKey] = val;
  }

  attrs["x"] = 0;
  attrs["y"] = 0;
  attrs["width"] = width;
  attrs["height"] = height;
  attrs["viewBox"] = viewBox ?? (origW && origH ? `0 0 ${origW} ${origH}` : "0 0 64 64");
  attrs["preserveAspectRatio"] = "xMidYMid meet";

  return [
    {
      tagName: "svg",
      selector: "image",
      attrs,
      ...(root.children && root.children.length > 0 ? { children: root.children } : {}),
    },
  ];
}

function parseSvgStringFallback(svgMarkup: string): DiagramMarkupNode | null {
  const cleaned = svgMarkup
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const tokenRe = /<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const stack: DiagramMarkupNode[] = [];
  let root: DiagramMarkupNode | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(cleaned)) !== null) {
    const [, closeTag, openTag, rawAttrs, selfClose, textChunk] = match;
    if (openTag) {
      const attrs: Record<string, string | number> = {};
      if (rawAttrs) {
        attrRe.lastIndex = 0;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(rawAttrs)) !== null) {
          const name = am[1]!;
          const lower = name.toLowerCase();
          if (lower.startsWith("on")) continue;
          const canonical =
            lower === "viewbox" ? "viewBox" : lower === "preserveaspectratio" ? "preserveAspectRatio" : name;
          attrs[canonical] = decodeBasicXmlEntities(am[2] ?? am[3] ?? "");
        }
      }
      const node: DiagramMarkupNode = {
        tagName: openTag,
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      };
      const parent = stack[stack.length - 1];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else if (openTag.toLowerCase() === "svg") {
        root = node;
      }
      if (!selfClose) {
        stack.push(node);
      }
    } else if (closeTag) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tagName.toLowerCase() === closeTag.toLowerCase()) {
          stack.length = i;
          break;
        }
      }
    } else if (textChunk !== undefined && stack.length > 0) {
      const trimmed = textChunk.trim();
      if (trimmed.length > 0) {
        const parent = stack[stack.length - 1]!;
        const decoded = decodeBasicXmlEntities(textChunk);
        parent.textContent = (parent.textContent ?? "") + decoded;
      }
    }
  }

  return root;
}

/**
 * Parses an inline `<svg>...</svg>` component icon string into a `@modelscript/canvas`
 * `DiagramMarkupNode[]` tree rooted at `<svg selector="image">` so it renders directly
 * through `compileGlyphMarkup` / `materializeGlyphToSvg` without relying on `data:image/svg+xml`
 * URLs (which are intentionally blocked by SVG href sanitization).
 */
export function parseIconSvgToMarkup(
  iconSvg: string | null | undefined,
  width: number,
  height: number,
): DiagramMarkupNode[] | null {
  if (!iconSvg || !iconSvg.includes("<svg")) return null;

  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(iconSvg, "image/svg+xml");
      const rootEl = doc.documentElement;
      if (rootEl && rootEl.tagName.toLowerCase() === "svg" && !doc.querySelector("parsererror")) {
        const convertEl = (el: Element): DiagramMarkupNode => {
          const attrs: Record<string, string | number> = {};
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i]!;
            if (attr.name.toLowerCase().startsWith("on")) continue;
            attrs[attr.name] = attr.value;
          }
          const children: DiagramMarkupNode[] = [];
          let directText = "";
          for (let i = 0; i < el.childNodes.length; i++) {
            const child = el.childNodes[i]!;
            if (child.nodeType === 1) {
              children.push(convertEl(child as Element));
            } else if (child.nodeType === 3 && child.textContent) {
              directText += child.textContent;
            }
          }
          const node: DiagramMarkupNode = {
            tagName: el.tagName,
            ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
            ...(children.length > 0 ? { children } : {}),
            ...(children.length === 0 && directText.trim().length > 0 ? { textContent: directText } : {}),
          };
          return node;
        };
        return normalizeRootSvgMarkup(convertEl(rootEl), width, height);
      }
    } catch {
      // Fall through to lightweight XML parser
    }
  }

  const parsed = parseSvgStringFallback(iconSvg);
  return parsed ? normalizeRootSvgMarkup(parsed, width, height) : null;
}

const dropSafetyTimersByGraph = new WeakMap<object, ReturnType<typeof setTimeout>>();

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

  const prevGraphTimer = dropSafetyTimersByGraph.get(g);
  if (prevGraphTimer !== undefined) {
    clearTimeout(prevGraphTimer);
  }
  const timer = setTimeout(() => {
    dropSafetyTimersByGraph.delete(g);
    try {
      const existing = g.getCellById?.("__drop_placeholder__");
      if (existing) g.removeCell?.(existing);
    } catch {
      // ignore
    }
    clearActiveDropPlaceholder();
  }, 3500);
  dropSafetyTimersByGraph.set(g, timer);
  dropSafetyTimer = timer;

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

  const displaySvg = iconSvg ? (isDark ? adaptSvgColors(iconSvg, isDark) : iconSvg) : null;
  const iconMarkup = displaySvg ? parseIconSvgToMarkup(displaySvg, w, h) : null;

  if (displaySvg && iconMarkup) {
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(displaySvg)}`;
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "image",
      imageUrl: dataUrl,
      x: x - halfW,
      y: y - halfH,
      width: w,
      height: h,
      zIndex: 9999,
      markup: iconMarkup,
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
        label: {
          text: className.split(".").pop(),
          fill: strokeColor,
          pointerEvents: "none",
          fontSize: 10,
          fontWeight: "600",
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

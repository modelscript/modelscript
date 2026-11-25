// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasWireKind } from "../schema/canvas-document.js";
import { DARK_WIDGET_PALETTE, LIGHT_WIDGET_PALETTE, type CanvasWidgetPalette } from "./palette.js";

/**
 * Board presentation themes shared by every Canvas2D surface that paints a `.mscanvas`
 * document (2D infinite canvas tiles, the VR drafting desk texture, snapshots).
 *
 * A theme is pure data: the drawing code (`paintCanvasTileBody`, `paintCanvasWires`, …)
 * is identical across themes, so the blueprint desk is a restyle, not a fork.
 */
export type CanvasBoardThemeId = "blueprint" | "light" | "dark";

export const CANVAS_BOARD_THEME_ORDER: readonly CanvasBoardThemeId[] = ["blueprint", "light", "dark"];

export interface CanvasSchematicPalette {
  nodeFill: string;
  /** Optional override for the accent stroke of the core node (null keeps the tile accent). */
  coreStroke: string | null;
  headerOpacity: number;
  label: string;
  sublabel: string;
  portStroke: string;
  input: string;
  output: string;
  parameter: string;
  strokeWidth: number;
  /** Background fill behind the schematic graph area. */
  background: string;
  /** Faint grid behind the schematic graph area (null disables). */
  grid: string | null;
}

export interface CanvasEcadPalette {
  backdrop: string;
  substrate: string;
  edgeCuts: string;
  gridDot: string;
  holeRing: string;
  holeDrill: string;
  holeCross: string;
  backCopper: string;
  backVia: string;
  frontCopper: string;
  body: string;
  pad: string;
  silk: string;
  silkDim: string;
  passive: string;
  capacitor: string;
  netLabel: string;
  fetStroke: string;
}

export interface CanvasCad3DPalette {
  backdrop: string;
  metalStops: [string, string, string];
  outline: string;
  topFace: string;
  topStroke: string;
  edge: string;
  boreFill: string;
  boreStroke: string;
  label: string;
  caption: string;
}

export interface CanvasCodePalette {
  background: string;
  border: string;
  gutter: string;
  plain: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  footer: string;
}

export interface CanvasBoardTheme {
  id: CanvasBoardThemeId;
  label: string;
  /** Board paper / world background. */
  paper: string;
  /** Second paper stop for a soft radial wash (null = flat). */
  paperWash: string | null;
  /** Draw deterministic paper fibre noise (blueprint). */
  paperFiber: boolean;
  fiberColor: string;
  gridMinor: string;
  gridMajor: string;
  gridStep: number;
  gridMajorEvery: number;
  gridDot: string | null;
  /** Vignette / sheet-curl shadow colour along the sheet edges (null disables). */
  edgeShade: string | null;
  /** Card (tile) chrome. */
  cardFill: string;
  cardStroke: string;
  /** Optional double-ruled architectural inset hairline inside cards (blueprint). */
  cardInnerRule: string | null;
  cardShadow: string;
  cardShadowBlur: number;
  cardShadowOffsetY: number;
  cardHeaderFill: string;
  cardTitle: string;
  cardSubtitle: string;
  cardHairline: string;
  /** When non-null, replaces each tile's accent colour (blueprint linework is monochrome cyan/white). */
  accentOverride: string | null;
  badgeFill: string;
  badgeText: string;
  /** Inset content panel inside a card. */
  insetFill: string;
  insetStroke: string;
  text: string;
  mutedText: string;
  /** Wires & thread overlays. */
  wireColors: Record<CanvasWireKind, string>;
  wireStale: string;
  wireConflict: string;
  wireLabel: string;
  wireLabelHalo: string;
  wireEndpointStroke: string;
  /** Frames. */
  frameFillAlpha: string;
  frameTitle: string;
  frameStrokeOverride: string | null;
  /** Comment pins. */
  commentFill: string;
  commentText: string;
  /** Anchor pills. */
  pillFill: string;
  pillText: string;
  pillAnchorColors: { input: string; output: string; requirement: string };
  /** UI chrome painted by board hosts (header strips, buttons). */
  chromeFill: string;
  chromeStroke: string;
  chromeText: string;
  chromeMuted: string;
  chromeAccent: string;
  chromeAccentText: string;
  chromeButtonFill: string;
  chromeButtonHover: string;
  /** Widget/graph palettes. */
  widget: CanvasWidgetPalette;
  graphDark: boolean;
  schematic: CanvasSchematicPalette;
  ecad: CanvasEcadPalette;
  cad3d: CanvasCad3DPalette;
  code: CanvasCodePalette;
  /** Optional ANSI/ISO engineering perimeter border frame with zone markers (blueprint). */
  borderFrame: boolean;
  /** Optional corner title block (blueprint drafting sheets). */
  titleBlock: boolean;
}

const DARK_THEME: CanvasBoardTheme = {
  id: "dark",
  label: "Dark Canvas",
  paper: "#0b1120",
  paperWash: null,
  paperFiber: false,
  fiberColor: "rgba(255,255,255,0.02)",
  gridMinor: "rgba(30,41,59,0.0)",
  gridMajor: "rgba(30,41,59,0.0)",
  gridStep: 24,
  gridMajorEvery: 5,
  gridDot: "#1e293b",
  edgeShade: null,
  cardFill: "#111827",
  cardStroke: "#334155",
  cardInnerRule: null,
  cardShadow: "rgba(0,0,0,0.4)",
  cardShadowBlur: 24,
  cardShadowOffsetY: 8,
  cardHeaderFill: "#1e293b",
  cardTitle: "#e2e8f0",
  cardSubtitle: "#94a3b8",
  cardHairline: "#334155",
  accentOverride: null,
  badgeFill: "rgba(148,163,184,0.2)",
  badgeText: "#e2e8f0",
  insetFill: "#090f1d",
  insetStroke: "#1e293b",
  text: "#e2e8f0",
  mutedText: "#94a3b8",
  wireColors: {
    "fmi-signal": "#10b981",
    "shared-parameter": "#38bdf8",
    "requirement-trace": "#a855f7",
    "annotation-link": "#94a3b8",
  },
  wireStale: "#f59e0b",
  wireConflict: "#ef4444",
  wireLabel: "#f8fafc",
  wireLabelHalo: "rgba(11,17,32,0.85)",
  wireEndpointStroke: "#0b1120",
  frameFillAlpha: "22",
  frameTitle: "#cbd5e1",
  frameStrokeOverride: null,
  commentFill: "#fef08a",
  commentText: "#0f172a",
  pillFill: "#0f172a",
  pillText: "#e2e8f0",
  pillAnchorColors: { input: "#38bdf8", output: "#10b981", requirement: "#a855f7" },
  chromeFill: "#0f172a",
  chromeStroke: "#334155",
  chromeText: "#f8fafc",
  chromeMuted: "#94a3b8",
  chromeAccent: "#38bdf8",
  chromeAccentText: "#0b1120",
  chromeButtonFill: "#1e293b",
  chromeButtonHover: "#334155",
  widget: { ...DARK_WIDGET_PALETTE },
  graphDark: true,
  schematic: {
    nodeFill: "#132038",
    coreStroke: null,
    headerOpacity: 0.2,
    label: "#f8fafc",
    sublabel: "#94a3b8",
    portStroke: "#090f1d",
    input: "#38bdf8",
    output: "#10b981",
    parameter: "#f59e0b",
    strokeWidth: 1.6,
    background: "#090f1d",
    grid: "rgba(148, 163, 184, 0.1)",
  },
  ecad: {
    backdrop: "#06130d",
    substrate: "#0b2b1d",
    edgeCuts: "#f59e0b",
    gridDot: "rgba(148, 163, 184, 0.14)",
    holeRing: "#fbbf24",
    holeDrill: "#06130d",
    holeCross: "rgba(251, 191, 36, 0.55)",
    backCopper: "#3b82f6",
    backVia: "#60a5fa",
    frontCopper: "#ef4444",
    body: "#1e293b",
    pad: "#fbbf24",
    silk: "#e2e8f0",
    silkDim: "#334155",
    passive: "#0f172a",
    capacitor: "#b45309",
    netLabel: "#fca5a5",
    fetStroke: "#fbbf24",
  },
  cad3d: {
    backdrop: "#111827",
    metalStops: ["#94a3b8", "#475569", "#1e293b"],
    outline: "#ec4899",
    topFace: "rgba(203,213,225,0.2)",
    topStroke: "#e2e8f0",
    edge: "rgba(226,232,240,0.4)",
    boreFill: "#0f172a",
    boreStroke: "#38bdf8",
    label: "#38bdf8",
    caption: "#94a3b8",
  },
  code: {
    background: "#090f1d",
    border: "#1e293b",
    gutter: "#475569",
    plain: "#e2e8f0",
    keyword: "#c084fc",
    string: "#34d399",
    number: "#fbbf24",
    comment: "#64748b",
    footer: "#64748b",
  },
  borderFrame: false,
  titleBlock: false,
};

const LIGHT_THEME: CanvasBoardTheme = {
  ...DARK_THEME,
  id: "light",
  label: "Studio Light",
  paper: "#f8fafc",
  paperWash: null,
  paperFiber: false,
  fiberColor: "rgba(15,23,42,0.02)",
  gridMinor: "rgba(203, 213, 225, 0.42)",
  gridMajor: "rgba(203, 213, 225, 0.42)",
  gridStep: 48,
  gridMajorEvery: 1,
  gridDot: "#cbd5e1",
  edgeShade: null,
  cardFill: "#ffffff",
  cardStroke: "#cbd5e1",
  cardInnerRule: null,
  cardShadow: "rgba(15, 23, 42, 0.09)",
  cardShadowBlur: 16,
  cardShadowOffsetY: 5,
  cardHeaderFill: "#ffffff",
  cardTitle: "#0f172a",
  cardSubtitle: "#475569",
  cardHairline: "#e2e8f0",
  accentOverride: null,
  badgeFill: "#e0f2fe",
  badgeText: "#0369a1",
  insetFill: "#f8fafc",
  insetStroke: "#e2e8f0",
  text: "#0f172a",
  mutedText: "#64748b",
  wireColors: {
    "fmi-signal": "#059669",
    "shared-parameter": "#0284c7",
    "requirement-trace": "#7c3aed",
    "annotation-link": "#64748b",
  },
  wireStale: "#d97706",
  wireConflict: "#dc2626",
  wireLabel: "#0f172a",
  wireLabelHalo: "rgba(248,250,252,0.9)",
  wireEndpointStroke: "#ffffff",
  frameFillAlpha: "14",
  frameTitle: "#334155",
  frameStrokeOverride: null,
  commentFill: "#fef08a",
  commentText: "#0f172a",
  pillFill: "#f1f5f9",
  pillText: "#0f172a",
  pillAnchorColors: { input: "#0284c7", output: "#059669", requirement: "#7c3aed" },
  chromeFill: "#ffffff",
  chromeStroke: "#cbd5e1",
  chromeText: "#0f172a",
  chromeMuted: "#64748b",
  chromeAccent: "#0284c7",
  chromeAccentText: "#ffffff",
  chromeButtonFill: "#f1f5f9",
  chromeButtonHover: "#e0f2fe",
  widget: { ...LIGHT_WIDGET_PALETTE },
  graphDark: false,
  schematic: {
    nodeFill: "#f8fafc",
    coreStroke: null,
    headerOpacity: 0.12,
    label: "#0f172a",
    sublabel: "#475569",
    portStroke: "#ffffff",
    input: "#0284c7",
    output: "#059669",
    parameter: "#d97706",
    strokeWidth: 2,
    background: "#ffffff",
    grid: null,
  },
  ecad: {
    backdrop: "#f0fdf4",
    substrate: "#dcfce7",
    edgeCuts: "#d97706",
    gridDot: "rgba(15, 23, 42, 0.12)",
    holeRing: "#d97706",
    holeDrill: "#f0fdf4",
    holeCross: "rgba(217, 119, 6, 0.55)",
    backCopper: "#2563eb",
    backVia: "#3b82f6",
    frontCopper: "#dc2626",
    body: "#1e293b",
    pad: "#d97706",
    silk: "#f8fafc",
    silkDim: "#94a3b8",
    passive: "#334155",
    capacitor: "#b45309",
    netLabel: "#b91c1c",
    fetStroke: "#d97706",
  },
  cad3d: {
    backdrop: "#f8fafc",
    metalStops: ["#e2e8f0", "#94a3b8", "#475569"],
    outline: "#0284c7",
    topFace: "rgba(2,132,199,0.1)",
    topStroke: "#0284c7",
    edge: "rgba(51,65,85,0.45)",
    boreFill: "#f1f5f9",
    boreStroke: "#0284c7",
    label: "#0369a1",
    caption: "#334155",
  },
  code: {
    background: "#f8fafc",
    border: "#e2e8f0",
    gutter: "#94a3b8",
    plain: "#0f172a",
    keyword: "#7c3aed",
    string: "#047857",
    number: "#b45309",
    comment: "#64748b",
    footer: "#64748b",
  },
  borderFrame: false,
  titleBlock: false,
};

/** Prussian-blue cyanotype drafting sheet: white/ice-cyan linework on fibrous blue paper. */
const BLUEPRINT_THEME: CanvasBoardTheme = {
  ...DARK_THEME,
  id: "blueprint",
  label: "Blueprint",
  paper: "#0a2e52",
  paperWash: "#0d3b66",
  paperFiber: true,
  fiberColor: "rgba(214, 236, 255, 0.055)",
  gridMinor: "rgba(186, 230, 253, 0.11)",
  gridMajor: "rgba(224, 242, 254, 0.28)",
  gridStep: 16,
  gridMajorEvery: 5,
  gridDot: null,
  edgeShade: "rgba(3, 16, 34, 0.52)",
  cardFill: "#0e3d6b",
  cardStroke: "rgba(240, 249, 255, 0.88)",
  cardInnerRule: "rgba(125, 211, 252, 0.34)",
  cardShadow: "rgba(2, 12, 28, 0.52)",
  cardShadowBlur: 14,
  cardShadowOffsetY: 6,
  cardHeaderFill: "#12497e",
  cardTitle: "#f0f9ff",
  cardSubtitle: "#a5d8ff",
  cardHairline: "rgba(186, 230, 253, 0.58)",
  accentOverride: "#7dd3fc",
  badgeFill: "rgba(125, 211, 252, 0.18)",
  badgeText: "#e0f2fe",
  insetFill: "#0b345c",
  insetStroke: "rgba(186, 230, 253, 0.48)",
  text: "#f0f9ff",
  mutedText: "#a5d8ff",
  wireColors: {
    "fmi-signal": "#f0f9ff",
    "shared-parameter": "#7dd3fc",
    "requirement-trace": "#c4b5fd",
    "annotation-link": "#bae6fd",
  },
  wireStale: "#fcd34d",
  wireConflict: "#fca5a5",
  wireLabel: "#f0f9ff",
  wireLabelHalo: "rgba(10, 46, 82, 0.94)",
  wireEndpointStroke: "#0a2e52",
  frameFillAlpha: "00",
  frameTitle: "#e0f2fe",
  frameStrokeOverride: "rgba(224, 242, 254, 0.58)",
  commentFill: "#fef9c3",
  commentText: "#0f172a",
  pillFill: "rgba(10, 46, 82, 0.92)",
  pillText: "#e0f2fe",
  pillAnchorColors: { input: "#7dd3fc", output: "#f0f9ff", requirement: "#c4b5fd" },
  chromeFill: "#082543",
  chromeStroke: "rgba(186, 230, 253, 0.58)",
  chromeText: "#f0f9ff",
  chromeMuted: "#a5d8ff",
  chromeAccent: "#7dd3fc",
  chromeAccentText: "#082543",
  chromeButtonFill: "#0f3f6e",
  chromeButtonHover: "#185691",
  widget: {
    background: "#0b345c",
    border: "rgba(186, 230, 253, 0.62)",
    grid: "rgba(186, 230, 253, 0.17)",
    text: "#f0f9ff",
    mutedText: "#a5d8ff",
    headerBackground: "#12497e",
    stripe: "rgba(240, 249, 255, 0.05)",
    highlightText: "#fef3c7",
  },
  graphDark: true,
  schematic: {
    nodeFill: "#0e3d6b",
    coreStroke: "#f0f9ff",
    headerOpacity: 0.16,
    label: "#f0f9ff",
    sublabel: "#a5d8ff",
    portStroke: "#0a2e52",
    input: "#7dd3fc",
    output: "#f0f9ff",
    parameter: "#fcd34d",
    strokeWidth: 1.5,
    background: "#0b345c",
    grid: "rgba(186, 230, 253, 0.11)",
  },
  ecad: {
    backdrop: "#0b345c",
    substrate: "#0e3d6b",
    edgeCuts: "#f0f9ff",
    gridDot: "rgba(186, 230, 253, 0.18)",
    holeRing: "#e0f2fe",
    holeDrill: "#0b345c",
    holeCross: "rgba(224, 242, 254, 0.52)",
    backCopper: "#7dd3fc",
    backVia: "#bae6fd",
    frontCopper: "#f0f9ff",
    body: "#0a2e52",
    pad: "#bae6fd",
    silk: "#f0f9ff",
    silkDim: "rgba(186, 230, 253, 0.42)",
    passive: "#0a2e52",
    capacitor: "#7dd3fc",
    netLabel: "#fcd34d",
    fetStroke: "#e0f2fe",
  },
  cad3d: {
    backdrop: "#0b345c",
    metalStops: ["rgba(186,230,253,0.36)", "rgba(125,211,252,0.18)", "rgba(10,46,82,0.34)"],
    outline: "#f0f9ff",
    topFace: "rgba(224,242,254,0.14)",
    topStroke: "#e0f2fe",
    edge: "rgba(224,242,254,0.58)",
    boreFill: "#0a2e52",
    boreStroke: "#7dd3fc",
    label: "#e0f2fe",
    caption: "#a5d8ff",
  },
  code: {
    background: "#0b345c",
    border: "rgba(186, 230, 253, 0.48)",
    gutter: "rgba(165, 216, 255, 0.62)",
    plain: "#f0f9ff",
    keyword: "#7dd3fc",
    string: "#bbf7d0",
    number: "#fcd34d",
    comment: "rgba(165, 216, 255, 0.72)",
    footer: "#a5d8ff",
  },
  borderFrame: true,
  titleBlock: true,
};

export const CANVAS_BOARD_THEMES: Readonly<Record<CanvasBoardThemeId, CanvasBoardTheme>> = {
  blueprint: BLUEPRINT_THEME,
  light: LIGHT_THEME,
  dark: DARK_THEME,
};

/**
 * Resolves a board theme by id (`"blueprint" | "light" | "dark"`, plus legacy `"studio"` alias).
 * Falls back to `fallback` (default `"dark"`, matching the 2D infinite canvas default).
 */
export function resolveCanvasBoardTheme(
  id: CanvasBoardThemeId | string | null | undefined,
  fallback: CanvasBoardThemeId = "dark",
): CanvasBoardTheme {
  if (id === "blueprint" || id === "light" || id === "dark") {
    return CANVAS_BOARD_THEMES[id];
  }
  if (id === "studio") {
    return CANVAS_BOARD_THEMES.light;
  }
  return CANVAS_BOARD_THEMES[fallback];
}

/** Cycles to the next board theme in `CANVAS_BOARD_THEME_ORDER` (blueprint → light → dark → blueprint). */
export function nextCanvasBoardTheme(id: CanvasBoardThemeId): CanvasBoardThemeId {
  const idx = CANVAS_BOARD_THEME_ORDER.indexOf(id);
  return CANVAS_BOARD_THEME_ORDER[(idx + 1) % CANVAS_BOARD_THEME_ORDER.length] ?? "blueprint";
}

/** Applies the theme's monochrome accent override (blueprint) or keeps the semantic accent colour. */
export function themedAccent(theme: CanvasBoardTheme, accent: string): string {
  return theme.accentOverride ?? accent;
}

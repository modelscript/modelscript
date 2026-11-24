// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  type EngineeringDomainId,
  type GalleryComponentItem,
} from "../componentGalleryCatalog.js";

/**
 * Pure Wrist-Tool Visibility Gate, Floating 2D Library Filtering/Pagination,
 * and Pull-to-Materialize (2D Card → Extruded 3D Component) Morph State Machine.
 */

export type MaterializePhase = "idle" | "peeling" | "morphing" | "materialized" | "cancel-return";

export interface MaterializeTransitionResult {
  readonly phase: MaterializePhase;
  /** Normalized `[0..1]` extrusion progress driving Z-scale (`0.04 -> 1.0`) and holographic rim glow. */
  readonly morphProgress: number;
  /** True on the rising edge when the 2D card crosses the pull threshold and materializes into 3D. */
  readonly justMaterialized: boolean;
  /** True when the user pushes an unplaced part back onto the panel to cancel cleanly. */
  readonly shouldCancelOnRelease: boolean;
}

export interface MaterializeThresholds {
  /** Minimum perpendicular pull off the 2D panel before morphing begins (default: 0.008m). */
  peelStartMeters?: number | undefined;
  /** Pull distance where the 2D icon pops into a full extruded 3D component (default: 0.045m). */
  materializeMeters?: number | undefined;
  /** Distance back toward the panel plane where an unplaced 3D part cancels cleanly (default: 0.028m). */
  cancelReturnMeters?: number | undefined;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Evaluates the pull-to-materialize transition as a user grabs a 2D icon card on the
 * Floating Library Panel and pulls it outward along the panel's front normal into 3D space.
 */
export function evaluateMaterializeTransition(
  signedPullDistanceMeters: number,
  alreadyMaterialized: boolean,
  thresholds: MaterializeThresholds = {},
): MaterializeTransitionResult {
  const peelStart = thresholds.peelStartMeters ?? 0.008;
  const matThreshold = thresholds.materializeMeters ?? 0.045;
  const cancelReturn = thresholds.cancelReturnMeters ?? 0.028;

  const d = Number.isFinite(signedPullDistanceMeters) ? signedPullDistanceMeters : 0;

  if (alreadyMaterialized) {
    if (d <= cancelReturn) {
      const shrink = smoothstep(Math.max(0, d) / Math.max(1e-4, cancelReturn));
      return {
        phase: "cancel-return",
        morphProgress: Math.max(0.12, shrink),
        justMaterialized: false,
        shouldCancelOnRelease: true,
      };
    }
    return {
      phase: "materialized",
      morphProgress: 1,
      justMaterialized: false,
      shouldCancelOnRelease: false,
    };
  }

  if (d >= matThreshold) {
    return {
      phase: "materialized",
      morphProgress: 1,
      justMaterialized: true,
      shouldCancelOnRelease: false,
    };
  }

  if (d > peelStart) {
    const raw = (d - peelStart) / Math.max(1e-4, matThreshold - peelStart);
    return {
      phase: "morphing",
      morphProgress: smoothstep(raw),
      justMaterialized: false,
      shouldCancelOnRelease: true,
    };
  }

  return {
    phase: "peeling",
    morphProgress: 0,
    justMaterialized: false,
    shouldCancelOnRelease: true,
  };
}

/**
 * Evaluates whether the non-dominant wrist is angled toward the user's face (palm-gaze guard)
 * using Schmitt hysteresis so the wrist micro-dock reveals naturally without visual chatter.
 */
export function evaluateWristPalmVisibility(
  wristInnerNormal: readonly [number, number, number],
  toHeadUnitVector: readonly [number, number, number],
  currentlyVisible: boolean,
  engageCosAngle = 0.56, // ~56°
  releaseCosAngle = 0.36, // ~69°
): { readonly visible: boolean; readonly opacity: number } {
  const dot =
    wristInnerNormal[0] * toHeadUnitVector[0] +
    wristInnerNormal[1] * toHeadUnitVector[1] +
    wristInnerNormal[2] * toHeadUnitVector[2];
  if (!Number.isFinite(dot)) {
    return { visible: false, opacity: 0 };
  }
  const visible = currentlyVisible ? dot >= releaseCosAngle : dot >= engageCosAngle;
  if (!visible) {
    return { visible: false, opacity: 0 };
  }
  const t = (dot - releaseCosAngle) / Math.max(1e-4, 0.85 - releaseCosAngle);
  return { visible: true, opacity: smoothstep(t) };
}

/* -------------------------------------------------------------------------- */
/*  Library Panel Filtering, Quick Presets & 4×3 Grid Layout                  */
/* -------------------------------------------------------------------------- */

export interface LibraryPresetChip {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
}

export const VR_LIBRARY_PRESET_CHIPS: readonly LibraryPresetChip[] = [
  { id: "all", label: "Featured", keywords: [] },
  { id: "rlc", label: "RLC & Passive", keywords: ["resistor", "capacitor", "inductor", "ground", "diode"] },
  { id: "sources", label: "Sources", keywords: ["voltage", "current", "source", "step", "sine", "battery"] },
  { id: "control", label: "Control & PID", keywords: ["pid", "gain", "integrator", "sensor", "opamp", "sum"] },
  { id: "mech", label: "Motors & Mech", keywords: ["motor", "spring", "damper", "inertia", "gear", "flange", "joint"] },
  {
    id: "fluid",
    label: "Thermal & Fluid",
    keywords: ["pipe", "valve", "pump", "tank", "thermal", "heat", "capacitor"],
  },
] as const;

export const LIBRARY_PANEL_CANVAS_W = 1440;
export const LIBRARY_PANEL_CANVAS_H = 1040;
export const LIBRARY_GRID_COLS = 4;
export const LIBRARY_GRID_ROWS = 3;
export const LIBRARY_PAGE_SIZE = LIBRARY_GRID_COLS * LIBRARY_GRID_ROWS;

export interface LibraryCardRect {
  readonly indexOnPage: number;
  readonly item: GalleryComponentItem;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LibraryTabRect {
  readonly domain: EngineeringDomainId;
  readonly label: string;
  readonly accent: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LibraryPresetRect {
  readonly preset: LibraryPresetChip;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LibraryPanelLayout {
  readonly closeBtnRect: { x: number; y: number; w: number; h: number };
  readonly prevBtnRect: { x: number; y: number; w: number; h: number };
  readonly nextBtnRect: { x: number; y: number; w: number; h: number };
  readonly domainTabs: readonly LibraryTabRect[];
  readonly presetChips: readonly LibraryPresetRect[];
  readonly cards: readonly LibraryCardRect[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalFiltered: number;
}

/** Filters the unified component catalog by domain tab and VR quick-preset chip (or search query). */
export function filterLibraryCatalog(
  catalog: readonly GalleryComponentItem[] = GALLERY_COMPONENTS,
  domain: EngineeringDomainId = "all",
  presetId = "all",
  searchQuery = "",
): GalleryComponentItem[] {
  const preset = VR_LIBRARY_PRESET_CHIPS.find((p) => p.id === presetId);
  const q = searchQuery.trim().toLowerCase();

  return catalog.filter((item) => {
    if (domain !== "all" && item.category !== domain) return false;
    const haystack = `${item.shortName} ${item.fqn} ${item.summary} ${item.keywords.join(" ")}`.toLowerCase();
    if (preset && preset.keywords.length > 0) {
      if (!preset.keywords.some((kw) => haystack.includes(kw))) return false;
    }
    if (q && !haystack.includes(q)) return false;
    return true;
  });
}

/**
 * Pure layout calculator shared identically between `FloatingLibraryPanel3D` Canvas2D painting
 * and 3D ray/touch hit-testing so visual cards and interactive grab hitboxes align pixel-for-pixel.
 */
export function buildLibraryPanelLayout(
  catalog: readonly GalleryComponentItem[],
  domain: EngineeringDomainId,
  presetId: string,
  requestedPage: number,
  searchQuery = "",
): LibraryPanelLayout {
  const filtered = filterLibraryCatalog(catalog, domain, presetId, searchQuery);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE));
  const page = Math.max(0, Math.min(totalPages - 1, Math.floor(requestedPage)));
  const pageItems = filtered.slice(page * LIBRARY_PAGE_SIZE, (page + 1) * LIBRARY_PAGE_SIZE);

  // Domain filter tabs along row 1 (y = 82)
  const tabPad = 10;
  const tabStartX = 36;
  const tabTotalW = LIBRARY_PANEL_CANVAS_W - 72;
  const tabCount = DOMAIN_FILTERS.length;
  const tabW = Math.floor((tabTotalW - tabPad * (tabCount - 1)) / tabCount);
  const domainTabs: LibraryTabRect[] = DOMAIN_FILTERS.map((f, i) => ({
    domain: f.id,
    label: f.label,
    accent: f.accent,
    x: tabStartX + i * (tabW + tabPad),
    y: 84,
    w: tabW,
    h: 50,
  }));

  // Quick-preset chips along row 2 (y = 148)
  const chipGap = 12;
  const chipCount = VR_LIBRARY_PRESET_CHIPS.length;
  const chipW = Math.floor((tabTotalW - chipGap * (chipCount - 1)) / chipCount);
  const presetChips: LibraryPresetRect[] = VR_LIBRARY_PRESET_CHIPS.map((preset, i) => ({
    preset,
    x: tabStartX + i * (chipW + chipGap),
    y: 148,
    w: chipW,
    h: 42,
  }));

  // 4×3 Component 2D Icon Card Grid (y = 208 .. 940)
  const gridLeft = 36;
  const gridTop = 208;
  const gridGapX = 20;
  const gridGapY = 18;
  const cardW = Math.floor((tabTotalW - gridGapX * (LIBRARY_GRID_COLS - 1)) / LIBRARY_GRID_COLS);
  const cardH = 228;

  const cards: LibraryCardRect[] = pageItems.map((item, idx) => {
    const col = idx % LIBRARY_GRID_COLS;
    const row = Math.floor(idx / LIBRARY_GRID_COLS);
    return {
      indexOnPage: idx,
      item,
      x: gridLeft + col * (cardW + gridGapX),
      y: gridTop + row * (cardH + gridGapY),
      w: cardW,
      h: cardH,
    };
  });

  return {
    closeBtnRect: { x: LIBRARY_PANEL_CANVAS_W - 88, y: 18, w: 52, h: 48 },
    prevBtnRect: { x: 36, y: LIBRARY_PANEL_CANVAS_H - 76, w: 168, h: 52 },
    nextBtnRect: { x: LIBRARY_PANEL_CANVAS_W - 204, y: LIBRARY_PANEL_CANVAS_H - 76, w: 168, h: 52 },
    domainTabs,
    presetChips,
    cards,
    page,
    totalPages,
    totalFiltered: filtered.length,
  };
}

export type LibraryPanelHit =
  | { kind: "close" }
  | { kind: "prev" }
  | { kind: "next" }
  | { kind: "domain"; domain: EngineeringDomainId }
  | { kind: "preset"; presetId: string }
  | { kind: "card"; card: LibraryCardRect }
  | null;

function inRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Hit-tests logical canvas pixel coordinates `(px, py)` against the floating 2D library panel layout. */
export function hitTestLibraryPanel(layout: LibraryPanelLayout, px: number, py: number): LibraryPanelHit {
  if (inRect(px, py, layout.closeBtnRect)) return { kind: "close" };
  if (inRect(px, py, layout.prevBtnRect)) return { kind: "prev" };
  if (inRect(px, py, layout.nextBtnRect)) return { kind: "next" };
  for (const tab of layout.domainTabs) {
    if (inRect(px, py, tab)) return { kind: "domain", domain: tab.domain };
  }
  for (const chip of layout.presetChips) {
    if (inRect(px, py, chip)) return { kind: "preset", presetId: chip.preset.id };
  }
  for (const card of layout.cards) {
    if (inRect(px, py, card)) return { kind: "card", card };
  }
  return null;
}

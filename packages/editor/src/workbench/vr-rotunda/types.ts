// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  type CanvasDocument,
  type CanvasPeerPresence,
  type CanvasTile,
  type SpatialPlane3D,
  type SurfacePresentationMode,
  type WorldBounds,
} from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import type React from "react";
import type { GalleryComponentItem } from "../componentGalleryCatalog.js";
import type { SpatialDiagramSnapMode, SpatialNodePose3D } from "./spatial-diagram-state.js";
import type { ExtrudedWaferStyle } from "./svg-extruder.js";

/** Selectable 3D VR / Spatial environments for the Engineering Rotunda. */
export type RotundaEnvironmentId = "warehouse" | "office" | "outdoors" | "dark-lab" | "passthrough";

/** Physical model scale presentation on the central plinth. */
export type RotundaScaleMode = "tabletop" | "real-scale";

/** Surface rendering mode for the hero 3D assembly. */
export type RotundaRenderStyle = "shaded" | "wireframe" | "xray";

/** Physics / CAE field overlay on the hero 3D assembly. */
export type RotundaCaeOverlay = "none" | "fea-stress" | "cfd-flow" | "thermal";

/** Section cut axis orientation for the interactive clipping plane. */
export type RotundaClipAxis = "x" | "y" | "z";

/** Category of a 3D model entry displayed in the Orbital Carousel. */
export type RotundaModelKind =
  | "cad"
  | "fea"
  | "cfd"
  | "multibody"
  | "gcode"
  | "step"
  | "urdf"
  | "vtk"
  | "drone"
  | "wind-turbine"
  | "satellite"
  | "ev-battery"
  | "octopus-rov"
  | "generic";

/** Metadata describing one of the 5 Engineering Rotunda environments. */
export interface RotundaEnvironmentMeta {
  id: RotundaEnvironmentId;
  label: string;
  shortLabel: string;
  description: string;
  accentColor: string;
  orbColor: string;
  skyColor: string;
}

export const ROTUNDA_ENVIRONMENTS: readonly RotundaEnvironmentMeta[] = [
  {
    id: "warehouse",
    label: "Sunlit Factory",
    shortLabel: "Factory",
    description:
      "Bright sunlit high-bay modern factory hangar with clerestory windows, light polished concrete floor, and safety bay markings.",
    accentColor: "#eab308",
    orbColor: "#f59e0b",
    skyColor: "#cbd5e1",
  },
  {
    id: "office",
    label: "Design Studio",
    shortLabel: "Office",
    description: "Airy sunlit architectural design studio with warm oak louvers and bright diffused daylight.",
    accentColor: "#38bdf8",
    orbColor: "#e2e8f0",
    skyColor: "#e8eef5",
  },
  {
    id: "outdoors",
    label: "Grassy Outdoors",
    shortLabel: "Grass",
    description: "Vibrant sunlit grassy meadow under crisp daylight for outdoor robotics, drones, and civil systems.",
    accentColor: "#22c55e",
    orbColor: "#4e9f3d",
    skyColor: "#8ec5f8",
  },
  {
    id: "dark-lab",
    label: "Precision Dark Lab",
    shortLabel: "Dark Lab",
    description: "High-contrast obsidian metrology floor with illuminated 10 cm / 1 m cyan grid.",
    accentColor: "#06b6d4",
    orbColor: "#0e7490",
    skyColor: "#050914",
  },
  {
    id: "passthrough",
    label: "Mixed Reality",
    shortLabel: "MR Room",
    description: "Transparent AR passthrough floating the circular plinth and 45° podium in your real room.",
    accentColor: "#a855f7",
    orbColor: "#9333ea",
    skyColor: "transparent",
  },
] as const;

/** Normalized 3D model entry hosted on the Circular Center Plinth & Orbital Carousel. */
export interface RotundaModelEntry {
  id: string;
  title: string;
  subtitle?: string | undefined;
  kind: RotundaModelKind;
  artifactUri?: string | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  /** Optional structural CAD component specs from CadViewer / Modelica annotations. */
  cadComponents?: readonly RotundaCadPartInput[] | undefined;
  /** Linked `.mscanvas` tile ID on the 45° drafting podium (for fiber-optic tethers & selection sync). */
  sourceTileId?: string | undefined;
  accentColor?: string | undefined;
  /** Optional custom R3F render callback for bespoke artifact/editor 3D content inside the plinth. */
  renderCustomContent?:
    | ((ctx: { explodeFactor: number; simulationTime: number; clippingPlanes: unknown[] }) => React.ReactNode)
    | undefined;
}

/** Lightweight structural view of a CadComponent for cross-package compatibility. */
export interface RotundaCadPartInput {
  name: string;
  shape?: string | undefined;
  color?: string | undefined;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  url?: string | undefined;
  proceduralMesh?:
    | {
        vertices: number[] | Float32Array;
        indices?: number[] | Uint32Array | Uint16Array | undefined;
        normals?: number[] | Float32Array | undefined;
        color?: string | undefined;
      }
    | undefined;
}

/** Interactive state for the Engineering Rotunda workstation. */
export interface RotundaState {
  environment: RotundaEnvironmentId;
  activeModelIndex: number;
  /** Target carousel page offset (unwrapped integer step for continuous orbital wrap animation). */
  carouselStep: number;
  plinthYaw: number;
  plinthZoom: number;
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  scaleMode: RotundaScaleMode;
  sectionCutEnabled: boolean;
  sectionCutAxis: RotundaClipAxis;
  sectionCutOffset: number;
  podiumTiltDeg: number;
  podiumVisible: boolean;
  wingsVisible: boolean;
  isPlaying: boolean;
  simulationTime: number;
  simulationDuration: number;
  selectedTileId: string | null;
  /** When non-null, zooms that single board block full-screen across the entire 45° Drafting Podium. */
  focusedTileId: string | null;
  /** Active solo subsystem ID (`null` = full Hero assembly). */
  isolatedSubsystemId: string | null;
  /** Ghosts outer enclosure shells (e.g. Octopus mantle) to inspect internal mechanisms. */
  ghostShellEnabled: boolean;
  /** Toggles dual-mode 3D callout pins (DOM in desktop, Sprite billboards in stereo VR). */
  showLabels: boolean;
  /** Toggles hands-free continuous turntable rotation of the central plinth. */
  autoTurntable: boolean;
  /** Switches left/right FloatingToolWings into live Field-Simulator Telemetry & Operation Log mode. */
  telemetryWingEnabled: boolean;
  /** Optional desktop-only Screen-Space Ambient Occlusion (strictly disabled in WebXR & AR passthrough). */
  studioSsaoEnabled: boolean;
  /** Activates the floating 3D Volumetric Schematic Diagram Editor above the Drafting Podium. */
  diagramEditorEnabled: boolean;
  /** Currently lifted schematic tile ID hosted in the 3D Diagram Editor (`null` = auto-pick first schematic tile). */
  activeDiagramTileId: string | null;
  /** Active spatial snap mode for 3D diagram node placement. */
  diagramSnapMode: SpatialDiagramSnapMode;
  /** Presentation style of auto-extruded 2D SVG components (`"tactile-tile"` chamfered wafer vs `"pure-relief"`). */
  diagramWaferStyle: ExtrudedWaferStyle;
  /** Controls visibility of the wrist-summoned world-locked floating 2D component library panel. */
  wristPaletteOpen: boolean;
}

export type RotundaAction =
  | { type: "setEnvironment"; environment: RotundaEnvironmentId }
  | { type: "pageModel"; delta: number; modelCount: number }
  | { type: "selectModelIndex"; index: number; modelCount: number }
  | { type: "rotatePlinth"; deltaYaw: number }
  | { type: "setPlinthYaw"; yaw: number }
  | { type: "adjustZoom"; delta: number }
  | { type: "setZoom"; zoom: number }
  | { type: "setExplode"; factor: number }
  | { type: "setCaeOverlay"; overlay: RotundaCaeOverlay }
  | { type: "setRenderStyle"; style: RotundaRenderStyle }
  | { type: "setScaleMode"; mode: RotundaScaleMode }
  | { type: "toggleScaleMode" }
  | { type: "toggleSectionCut" }
  | { type: "setSectionCutAxis"; axis: RotundaClipAxis }
  | { type: "setSectionCutOffset"; offset: number }
  | { type: "togglePodiumTilt" }
  | { type: "togglePodiumVisible" }
  | { type: "toggleWingsVisible" }
  | { type: "togglePlaying" }
  | { type: "setPlaying"; playing: boolean }
  | { type: "setSimulationTime"; time: number }
  | { type: "advanceSimulationTime"; delta: number }
  | { type: "selectTile"; tileId: string | null }
  | { type: "setFocusedTile"; tileId: string | null }
  | { type: "toggleFocusedTile"; tileId: string }
  | { type: "setIsolatedSubsystem"; subsystemId: string | null }
  | { type: "toggleGhostShell" }
  | { type: "setGhostShell"; enabled: boolean }
  | { type: "toggleShowLabels" }
  | { type: "setShowLabels"; visible: boolean }
  | { type: "toggleAutoTurntable" }
  | { type: "toggleTelemetryWing" }
  | { type: "setTelemetryWing"; enabled: boolean }
  | { type: "toggleStudioSsao" }
  | { type: "setStudioSsao"; enabled: boolean }
  | { type: "toggleDiagramEditor" }
  | { type: "setDiagramEditorEnabled"; enabled: boolean; tileId?: string | null | undefined }
  | { type: "setActiveDiagramTile"; tileId: string | null }
  | { type: "setDiagramSnapMode"; mode: SpatialDiagramSnapMode }
  | { type: "cycleDiagramSnapMode" }
  | { type: "toggleDiagramWaferStyle" }
  | { type: "setWristPaletteOpen"; open: boolean }
  | { type: "toggleWristPalette" }
  | { type: "resetPlinthView" };

const SNAP_MODE_ORDER: readonly SpatialDiagramSnapMode[] = ["free-3d", "domain-layers", "grid-5cm", "flat-2d"];

export function createInitialRotundaState(overrides?: Partial<RotundaState>): RotundaState {
  return {
    environment: "outdoors",
    activeModelIndex: 0,
    carouselStep: 0,
    plinthYaw: 0,
    plinthZoom: 1,
    explodeFactor: 0,
    caeOverlay: "none",
    renderStyle: "shaded",
    scaleMode: "tabletop",
    sectionCutEnabled: false,
    sectionCutAxis: "x",
    sectionCutOffset: 0,
    podiumTiltDeg: 45,
    podiumVisible: true,
    wingsVisible: true,
    isPlaying: true,
    simulationTime: 0,
    simulationDuration: 10,
    selectedTileId: null,
    focusedTileId: null,
    isolatedSubsystemId: null,
    ghostShellEnabled: false,
    showLabels: false,
    autoTurntable: false,
    telemetryWingEnabled: false,
    studioSsaoEnabled: false,
    diagramEditorEnabled: false,
    activeDiagramTileId: null,
    diagramSnapMode: "free-3d",
    diagramWaferStyle: "tactile-tile",
    wristPaletteOpen: false,
    ...overrides,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function rotundaReducer(state: RotundaState, action: RotundaAction): RotundaState {
  switch (action.type) {
    case "setEnvironment":
      return { ...state, environment: action.environment };
    case "pageModel": {
      if (action.modelCount <= 0) return state;
      const nextStep = state.carouselStep + action.delta;
      return {
        ...state,
        carouselStep: nextStep,
        activeModelIndex: wrapIndex(state.activeModelIndex + action.delta, action.modelCount),
        isolatedSubsystemId: null,
      };
    }
    case "selectModelIndex": {
      if (action.modelCount <= 0) return state;
      const target = wrapIndex(action.index, action.modelCount);
      if (target === state.activeModelIndex) return state;
      // Pick shortest orbital direction around the circular track
      let diff = target - state.activeModelIndex;
      if (diff > action.modelCount / 2) diff -= action.modelCount;
      if (diff < -action.modelCount / 2) diff += action.modelCount;
      return {
        ...state,
        carouselStep: state.carouselStep + diff,
        activeModelIndex: target,
        isolatedSubsystemId: null,
      };
    }
    case "rotatePlinth":
      return { ...state, plinthYaw: state.plinthYaw + action.deltaYaw };
    case "setPlinthYaw":
      return { ...state, plinthYaw: action.yaw };
    case "adjustZoom":
      return { ...state, plinthZoom: clampNumber(state.plinthZoom + action.delta, 0.35, 3.0) };
    case "setZoom":
      return { ...state, plinthZoom: clampNumber(action.zoom, 0.35, 3.0) };
    case "setExplode":
      return { ...state, explodeFactor: clampNumber(action.factor, 0, 1) };
    case "setCaeOverlay":
      return { ...state, caeOverlay: action.overlay };
    case "setRenderStyle":
      return { ...state, renderStyle: action.style };
    case "setScaleMode":
      return { ...state, scaleMode: action.mode };
    case "toggleScaleMode":
      return { ...state, scaleMode: state.scaleMode === "tabletop" ? "real-scale" : "tabletop" };
    case "toggleSectionCut":
      return { ...state, sectionCutEnabled: !state.sectionCutEnabled };
    case "setSectionCutAxis":
      return { ...state, sectionCutAxis: action.axis };
    case "setSectionCutOffset":
      return { ...state, sectionCutOffset: clampNumber(action.offset, -1, 1) };
    case "togglePodiumTilt":
      return { ...state, podiumTiltDeg: state.podiumTiltDeg >= 30 ? 12 : 45 };
    case "togglePodiumVisible":
      return { ...state, podiumVisible: !state.podiumVisible };
    case "toggleWingsVisible":
      return { ...state, wingsVisible: !state.wingsVisible };
    case "togglePlaying":
      return { ...state, isPlaying: !state.isPlaying };
    case "setPlaying":
      return { ...state, isPlaying: action.playing };
    case "setSimulationTime": {
      const dur = Math.max(0.1, state.simulationDuration);
      return { ...state, simulationTime: clampNumber(action.time, 0, dur) };
    }
    case "advanceSimulationTime": {
      if (!state.isPlaying) return state;
      const dur = Math.max(0.1, state.simulationDuration);
      const next = (state.simulationTime + action.delta) % dur;
      return { ...state, simulationTime: next < 0 ? next + dur : next };
    }
    case "selectTile":
      return { ...state, selectedTileId: action.tileId };
    case "setFocusedTile":
      return {
        ...state,
        focusedTileId: action.tileId,
        selectedTileId: action.tileId ?? state.selectedTileId,
      };
    case "toggleFocusedTile":
      return {
        ...state,
        focusedTileId: state.focusedTileId === action.tileId ? null : action.tileId,
        selectedTileId: action.tileId,
      };
    case "setIsolatedSubsystem":
      return {
        ...state,
        isolatedSubsystemId:
          action.subsystemId !== null && state.isolatedSubsystemId === action.subsystemId ? null : action.subsystemId,
      };
    case "toggleGhostShell":
      return { ...state, ghostShellEnabled: !state.ghostShellEnabled };
    case "setGhostShell":
      return { ...state, ghostShellEnabled: action.enabled };
    case "toggleShowLabels":
      return { ...state, showLabels: !state.showLabels };
    case "setShowLabels":
      return { ...state, showLabels: action.visible };
    case "toggleAutoTurntable":
      return { ...state, autoTurntable: !state.autoTurntable };
    case "toggleTelemetryWing":
      return { ...state, telemetryWingEnabled: !state.telemetryWingEnabled };
    case "setTelemetryWing":
      return { ...state, telemetryWingEnabled: action.enabled };
    case "toggleStudioSsao":
      return { ...state, studioSsaoEnabled: !state.studioSsaoEnabled };
    case "setStudioSsao":
      return { ...state, studioSsaoEnabled: action.enabled };
    case "toggleDiagramEditor": {
      const nextEnabled = !state.diagramEditorEnabled;
      return {
        ...state,
        diagramEditorEnabled: nextEnabled,
        wristPaletteOpen: nextEnabled ? state.wristPaletteOpen : false,
      };
    }
    case "setDiagramEditorEnabled":
      return {
        ...state,
        diagramEditorEnabled: action.enabled,
        activeDiagramTileId: action.tileId !== undefined ? action.tileId : state.activeDiagramTileId,
        wristPaletteOpen: action.enabled ? state.wristPaletteOpen : false,
      };
    case "setActiveDiagramTile":
      return { ...state, activeDiagramTileId: action.tileId };
    case "setDiagramSnapMode":
      return { ...state, diagramSnapMode: action.mode };
    case "cycleDiagramSnapMode": {
      const idx = SNAP_MODE_ORDER.indexOf(state.diagramSnapMode);
      const next = SNAP_MODE_ORDER[(idx + 1) % SNAP_MODE_ORDER.length] ?? "free-3d";
      return { ...state, diagramSnapMode: next };
    }
    case "toggleDiagramWaferStyle":
      return {
        ...state,
        diagramWaferStyle: state.diagramWaferStyle === "tactile-tile" ? "pure-relief" : "tactile-tile",
      };
    case "setWristPaletteOpen":
      return { ...state, wristPaletteOpen: action.open };
    case "toggleWristPalette":
      return {
        ...state,
        diagramEditorEnabled: true,
        wristPaletteOpen: !state.wristPaletteOpen,
      };
    case "resetPlinthView":
      return {
        ...state,
        plinthYaw: 0,
        plinthZoom: 1,
        explodeFactor: 0,
        sectionCutEnabled: false,
        sectionCutOffset: 0,
        isolatedSubsystemId: null,
        ghostShellEnabled: false,
        focusedTileId: null,
      };
  }
}

/** Shared canvas texture coordinate constants (1600x1000 high-DPI offscreen canvas). */
export const ROTUNDA_BOARD_CANVAS_WIDTH = 1600;
export const ROTUNDA_BOARD_CANVAS_HEIGHT = 1000;
export const ROTUNDA_BOARD_TEX_SCALE = 0.65;
export const ROTUNDA_BOARD_TEX_OFFSET_X = 60;
export const ROTUNDA_BOARD_TEX_OFFSET_Y = 60;

/** Interactive UI button bounds in logical 1600×1000 podium canvas UV pixels. */
export interface PodiumUiRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const PODIUM_HEADER_HEIGHT = 48;

export const PODIUM_BACK_BTN_RECT: PodiumUiRect = {
  x: 16,
  y: 8,
  width: 158,
  height: 32,
};

export const PODIUM_PREV_TILE_BTN_RECT: PodiumUiRect = {
  x: ROTUNDA_BOARD_CANVAS_WIDTH - 278,
  y: 8,
  width: 44,
  height: 32,
};

export const PODIUM_NEXT_TILE_BTN_RECT: PodiumUiRect = {
  x: ROTUNDA_BOARD_CANVAS_WIDTH - 226,
  y: 8,
  width: 44,
  height: 32,
};

export const PODIUM_RESET_PAN_BTN_RECT: PodiumUiRect = {
  x: ROTUNDA_BOARD_CANVAS_WIDTH - 320,
  y: 9,
  width: 128,
  height: 30,
};

/**
 * Computes the clickable `[⤢]` full-screen zoom button bounds in **board coordinates**
 * for a given tile so `board-painter.ts` and `DraftingPodium.tsx` hit-testing match pixel-for-pixel.
 */
export function getTileMaximizeButtonRect(b: WorldBounds, isHeroOnPlinth = false): PodiumUiRect {
  const btnSize = 30;
  const margin = 10;
  // When "ACTIVE ON PLINTH" pill is rendered at top-right, shift maximize button cleanly beside it
  const rightOffset = isHeroOnPlinth ? Math.min(Math.max(142, b.width - 20), 168) + 18 : margin;
  return {
    x: Math.max(b.x + 8, b.x + b.width - rightOffset - btnSize),
    y: b.y + 10,
    width: btnSize,
    height: btnSize,
  };
}

export function pointInPodiumRect(x: number, y: number, rect: PodiumUiRect, pad = 0): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.width + pad && y >= rect.y - pad && y <= rect.y + rect.height + pad;
}

/** Physical dimensions of the 45° Drafting Podium in meters. */
export const PODIUM_WIDTH_METERS = 1.52;
export const PODIUM_HEIGHT_METERS = 0.95;
export const PODIUM_CENTER: [number, number, number] = [0, 0.92, -0.78];

/** World center of the Circular Metrology Plinth. */
export const PLINTH_CENTER_TABLETOP: [number, number, number] = [0, 1.08, -2.25];
export const PLINTH_CENTER_REAL_SCALE: [number, number, number] = [0, 0.04, -2.65];

/**
 * Builds an exact `SpatialPlane3D` for the angled Drafting Podium so `SpatialSurfaceBridge`
 * projects 3D mouse rays and WebXR controller lasers accurately onto the 45° tilted surface.
 *
 * Tilt convention: `tiltDeg = 45` tilts the plane backward by 45° from vertical
 * (Three.js mesh rotation `[-tiltRad, 0, 0]`):
 *  - `right  = [1, 0, 0]`
 *  - `down   = [0, -cos(tilt), sin(tilt)]` (top of board further back & higher)
 *  - `normal = [0, sin(tilt), cos(tilt)]`  (faces upward & toward the user)
 */
export function buildPodiumSpatialPlane(
  tiltDeg = 45,
  center: [number, number, number] = PODIUM_CENTER,
  widthMeters = PODIUM_WIDTH_METERS,
  heightMeters = PODIUM_HEIGHT_METERS,
): SpatialPlane3D {
  const rad = (clampNumber(tiltDeg, 0, 85) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const right: [number, number, number] = [1, 0, 0];
  const down: [number, number, number] = [0, -c, s];
  const normal: [number, number, number] = [0, s, c];
  const halfW = widthMeters / 2;
  const halfH = heightMeters / 2;

  // Top-left corner (u = 0, v = 0) of the board canvas in world meters
  const origin: [number, number, number] = [
    center[0] - right[0] * halfW - down[0] * halfH,
    center[1] - right[1] * halfW - down[1] * halfH,
    center[2] - right[2] * halfW - down[2] * halfH,
  ];

  return {
    id: "podium",
    origin,
    right,
    down,
    normal,
    unitsPerMeter: ROTUNDA_BOARD_CANVAS_WIDTH / widthMeters,
  };
}

export function planeUvToBoard(u: number, v: number, panX = 0, panY = 0): { x: number; y: number } {
  return {
    x: (u - ROTUNDA_BOARD_TEX_OFFSET_X - panX) / ROTUNDA_BOARD_TEX_SCALE,
    y: (v - ROTUNDA_BOARD_TEX_OFFSET_Y - panY) / ROTUNDA_BOARD_TEX_SCALE,
  };
}

export function boardBoundsToPlaneBounds(bounds: WorldBounds, panX = 0, panY = 0): WorldBounds {
  return {
    x: ROTUNDA_BOARD_TEX_OFFSET_X + panX + bounds.x * ROTUNDA_BOARD_TEX_SCALE,
    y: ROTUNDA_BOARD_TEX_OFFSET_Y + panY + bounds.y * ROTUNDA_BOARD_TEX_SCALE,
    width: bounds.width * ROTUNDA_BOARD_TEX_SCALE,
    height: bounds.height * ROTUNDA_BOARD_TEX_SCALE,
  };
}

export function extractVtkBuffer(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array && raw.byteLength > 0) return raw;
  if (ArrayBuffer.isView(raw) && raw.byteLength > 0) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

export function isLoadableGltfUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith("data:model/gltf")) {
    return true;
  }
  if (!trimmed.startsWith("/") && !trimmed.startsWith("http") && !trimmed.startsWith("blob:")) {
    return false;
  }
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? "").toLowerCase();
  return pathOnly.endsWith(".glb") || pathOnly.endsWith(".gltf");
}

function inferModelKindFromTile(tile: CanvasTile): RotundaModelKind {
  const lang = (tile.languageId ?? "").toLowerCase();
  const uri = (tile.artifactUri ?? "").toLowerCase();
  if (lang === "fea" || uri.endsWith(".inp") || uri.endsWith(".bdf")) return "fea";
  if (lang === "cfd" || uri.endsWith(".su2") || uri.endsWith(".vtu")) return "cfd";
  if (lang === "urdf" || uri.endsWith(".urdf") || uri.endsWith(".sdf")) return "urdf";
  if (lang === "step" || uri.endsWith(".step") || uri.endsWith(".stp")) return "step";
  if (lang === "gcode" || uri.endsWith(".gcode") || uri.endsWith(".nc")) return "gcode";
  if (lang === "simpack" || lang === "gensys" || lang === "adams") return "multibody";
  if (lang === "vtk" || uri.endsWith(".vtk") || uri.endsWith(".vtp")) return "vtk";
  return "cad";
}

/**
 * Extracts Orbital Carousel 3D model entries from a `.mscanvas` `CanvasDocument`,
 * prioritizing `cad3d` tiles and falling back to representative multi-physics showcase models
 * so the circular carousel always supports paging cleanly.
 */
export function extractModelsFromCanvasDocument(doc: CanvasDocument): RotundaModelEntry[] {
  const tiles = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
  const cadTiles = tiles.filter((t) => t.archetype === "cad3d");
  const secondaryTiles = tiles.filter(
    (t) => t.archetype !== "cad3d" && (t.archetype === "schematic" || t.archetype === "fmu"),
  );

  const entries: RotundaModelEntry[] = cadTiles.map((tile) => {
    const kind = inferModelKindFromTile(tile);
    return {
      id: `tile-model-${tile.id}`,
      title: tile.title,
      subtitle: tile.artifactUri,
      kind,
      artifactUri: tile.artifactUri,
      vtkBuffer: extractVtkBuffer(tile.viewState?.["vtkBuffer"]),
      sourceTileId: tile.id,
      accentColor: kind === "fea" ? "#f97316" : kind === "cfd" ? "#06b6d4" : "#38bdf8",
    };
  });

  // Ensure users can always experience smooth orbital paging across multiple domain views
  if (entries.length === 0) {
    for (const tile of secondaryTiles.slice(0, 3)) {
      entries.push({
        id: `tile-twin-${tile.id}`,
        title: `${tile.title} (3D Digital Twin)`,
        subtitle: tile.artifactUri,
        kind: tile.archetype === "fmu" ? "multibody" : "cad",
        artifactUri: tile.artifactUri,
        sourceTileId: tile.id,
        accentColor: tile.archetype === "fmu" ? "#10b981" : "#38bdf8",
      });
    }
  }

  if (entries.length === 1) {
    const primary = entries[0]!;
    entries.push(
      {
        id: `${primary.id}-fea-twin`,
        title: `${primary.title} — Structural FEA`,
        subtitle: "Von Mises Modal Stress & Deflection",
        kind: "fea",
        sourceTileId: primary.sourceTileId,
        accentColor: "#f97316",
      },
      {
        id: `${primary.id}-cfd-twin`,
        title: `${primary.title} — Aero/Thermal CFD`,
        subtitle: "Velocity Streamlines & Pressure Field",
        kind: "cfd",
        sourceTileId: primary.sourceTileId,
        accentColor: "#06b6d4",
      },
    );
  } else if (entries.length === 0) {
    entries.push(
      {
        id: "rotunda-actuator",
        title: "Robotic Servo Actuator",
        subtitle: "STEP B-Rep Multi-Body Assembly",
        kind: "cad",
        accentColor: "#38bdf8",
      },
      {
        id: "rotunda-fea-bracket",
        title: "Aerospace Cantilever Bracket",
        subtitle: "FEA Von Mises Stress Field",
        kind: "fea",
        accentColor: "#f97316",
      },
      {
        id: "rotunda-cfd-rotor",
        title: "Turbofan Ducted Rotor",
        subtitle: "CFD Streamlines & Vorticity",
        kind: "cfd",
        accentColor: "#06b6d4",
      },
    );
  }

  return entries;
}

/** Input options for synthesizing a live `.mscanvas` board from an editor or artifact context. */
export interface BuildRotundaBoardOptions {
  title: string;
  languageId?: string | undefined;
  artifactUri?: string | undefined;
  diagramData?: Record<string, unknown> | null | undefined;
  simulationSeries?:
    | Array<{
        id: string;
        label: string;
        color?: string | undefined;
        unit?: string | undefined;
        x: number[] | Float64Array;
        y: number[] | Float64Array;
      }>
    | undefined;
  parameters?: Array<{ name: string; value: string | number; unit?: string | undefined }> | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
}

/**
 * Synthesizes a cohesive `.mscanvas` `CanvasDocument` for the 45° Drafting Podium whenever
 * the Engineering Rotunda is opened from a standalone Artifact Viewer or the Ansatz Web Editor
 * (rather than an existing `.mscanvas` file).
 */
export function buildRotundaCanvasDocument(opts: BuildRotundaBoardOptions): CanvasDocument {
  const base = createCanonicalPolyglotDemoBoard();
  const safeTitle = opts.title.trim() || "Engineering Model";
  const lang = (opts.languageId || "modelica").toLowerCase();
  const uri = opts.artifactUri || `${safeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.${lang}`;

  const tiles: Record<string, CanvasTile> = {
    tile_primary_schematic: {
      id: "tile_primary_schematic",
      title: `${safeTitle} — Schematic`,
      archetype: "schematic",
      languageId: lang,
      artifactUri: uri,
      bounds: { x: 40, y: 40, width: 660, height: 420 },
      zIndex: 1,
      viewState: opts.diagramData ? { diagramData: opts.diagramData } : {},
      pinnedAnchors: (opts.parameters ?? []).slice(0, 6).map((p) => ({
        path: p.name,
        label: p.name,
        kind: "parameter" as const,
        ...(p.unit ? { unit: p.unit } : {}),
        currentValue: p.unit ? `${p.value} ${p.unit}` : String(p.value),
      })),
    },
    tile_primary_cad: {
      id: "tile_primary_cad",
      title: `${safeTitle} — 3D Assembly`,
      archetype: "cad3d",
      languageId: lang === "fea" || lang === "cfd" || lang === "urdf" || lang === "gcode" ? lang : "step",
      artifactUri: uri,
      bounds: { x: 760, y: 40, width: 620, height: 420 },
      zIndex: 2,
      viewState: opts.vtkBuffer ? { vtkBuffer: opts.vtkBuffer } : {},
    },
    tile_primary_plot: {
      id: "tile_primary_plot",
      title: `${safeTitle} — Live Telemetry`,
      archetype: "analytics",
      languageId: "csv",
      artifactUri: `${uri}#telemetry`,
      bounds: { x: 40, y: 520, width: 660, height: 400 },
      zIndex: 3,
      viewState:
        opts.simulationSeries && opts.simulationSeries.length > 0 ? { simulationSeries: opts.simulationSeries } : {},
    },
    tile_primary_params: {
      id: "tile_primary_params",
      title: "Design Parameters & Contracts",
      archetype: "table",
      languageId: "reqif",
      artifactUri: `${uri}#params`,
      bounds: { x: 760, y: 520, width: 620, height: 400 },
      zIndex: 4,
      pinnedAnchors:
        opts.parameters && opts.parameters.length > 0
          ? opts.parameters.slice(0, 8).map((p) => ({
              path: p.name,
              label: p.name,
              kind: "parameter" as const,
              ...(p.unit ? { unit: p.unit } : {}),
              currentValue: p.unit ? `${p.value} ${p.unit}` : String(p.value),
            }))
          : [
              {
                path: "REQ-01",
                label: "Safety Factor ≥ 2.0",
                kind: "requirement" as const,
                currentValue: "PASS (2.41)",
              },
              {
                path: "REQ-02",
                label: "Peak Temp ≤ 360 K",
                kind: "requirement" as const,
                currentValue: "PASS (348 K)",
              },
              {
                path: "REQ-03",
                label: "Mass Budget ≤ 4.5 kg",
                kind: "requirement" as const,
                currentValue: "PASS (3.82 kg)",
              },
            ],
    },
  };

  return {
    ...base,
    id: `rotunda-${safeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: `${safeTitle} — VR Rotunda Board`,
    tiles,
    wires: {
      wire_schem_cad: {
        id: "wire_schem_cad",
        kind: "shared-parameter",
        origin: "auto-thread",
        source: { tileId: "tile_primary_schematic", anchorPath: "out" },
        target: { tileId: "tile_primary_cad", anchorPath: "CADPort" },
        liveValue: "Geometry Twin",
        status: "synced",
      },
      wire_schem_plot: {
        id: "wire_schem_plot",
        kind: "fmi-signal",
        origin: "auto-thread",
        source: { tileId: "tile_primary_schematic", anchorPath: "sim" },
        target: { tileId: "tile_primary_plot", anchorPath: "series" },
        liveValue: "Trajectories",
        status: "synced",
      },
      wire_cad_params: {
        id: "wire_cad_params",
        kind: "requirement-trace",
        origin: "auto-thread",
        source: { tileId: "tile_primary_cad", anchorPath: "CADPort" },
        target: { tileId: "tile_primary_params", anchorPath: "REQ-01" },
        liveValue: "Verification",
        status: "synced",
      },
    },
  };
}

/** Structural interface compatible with CadViewer's AnimationController for live Modelica-driven transforms. */
export interface RotundaComponentTransformLike {
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
}

export interface RotundaAnimationControllerLike {
  getTransform?: ((componentName: string) => RotundaComponentTransformLike | undefined) | undefined;
  getComponentTransform?: ((componentName: string) => RotundaComponentTransformLike | undefined) | undefined;
  getState?:
    (() => { currentTime?: number | undefined; mode?: string | undefined; duration?: number | undefined }) | undefined;
  hasData?: boolean | undefined;
}

/** Pre-built multi-domain VR engineering scenario pairing a 45° podium board, 3D model carousel, and ideal environment. */
export interface RotundaScenarioPreset {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  recommendedEnvironment: RotundaEnvironmentId;
  recommendedScaleMode?: RotundaScaleMode | undefined;
  recommendedCaeOverlay?: RotundaCaeOverlay | undefined;
  models: readonly RotundaModelEntry[];
  createDocument: () => CanvasDocument;
}

/** Props shared across all consumers of `EngineeringRotunda`. */
export interface EngineeringRotundaProps {
  /** Live `.mscanvas` document rendered on the 45° Drafting Podium (defaults to canonical demo board). */
  document?: CanvasDocument | undefined;
  /** Optional explicit list of 3D models for the Orbital Carousel; derived from `document` if omitted. */
  models?: readonly RotundaModelEntry[] | undefined;
  /** Optional scenario presets selectable right inside the Rotunda HUD. */
  scenarios?: readonly RotundaScenarioPreset[] | undefined;
  /** Currently active scenario preset ID (when controlled by host). */
  activeScenarioId?: string | undefined;
  /** Callback when the user picks a different VR scenario preset. */
  onSelectScenario?: ((scenarioId: string) => void) | undefined;
  /** Presentation mode: Desktop 3D Spatial or WebXR VR/AR. */
  mode?: SurfacePresentationMode | undefined;
  /** Initial environment preset. */
  initialEnvironment?: RotundaEnvironmentId | undefined;
  /** Controlled or initial simulation time in seconds. */
  simulationTime?: number | undefined;
  /** Optional callback when simulation time changes inside the Rotunda. */
  onSimulationTimeChange?: ((time: number) => void) | undefined;
  /** Optional exit callback back to 2D Canvas / Editor / Artifact view. */
  onExitTo2D?: (() => void) | undefined;
  /** Optional custom label for the exit button (defaults to `"Return to 2D Canvas"`). */
  exitTo2DLabel?: string | undefined;
  /** Optional external VR headset handoff (used inside sandboxed VS Code webviews). */
  onOpenExternalVr?: ((opts: { environment: RotundaEnvironmentId; activeModelIndex: number }) => void) | undefined;
  /** Tile selection callback synced with the host canvas/editor. */
  onTileSelect?: ((tileId: string) => void) | undefined;
  /** Tile drag write-back callback synced with the host canvas CRDT/command bus. */
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  /** Cross-domain 3D CADPort-to-2D wire creation callback. */
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
  /** Optional multiplayer peers from CanvasCrdtStore rendered as 3D VR engineer avatars around the plinth. */
  peers?: readonly CanvasPeerPresence[] | undefined;
  /** Optional live Modelica/CAD AnimationController driving exact part transforms inside HeroModelAsset. */
  animationController?: RotundaAnimationControllerLike | null | undefined;
  /** Optional title badge shown in the subtle top-left corner pill. */
  title?: string | undefined;
  /** Hide the desktop HTML HUD overlay (useful for chromeless or pure-XR embeds). */
  hideDesktopHud?: boolean | undefined;
  /** Top inset in pixels for desktop HUD overlays when a floating host navbar overlays the full-bleed VR canvas. */
  topOverlayInset?: number | undefined;
  /** Open the 3D Volumetric Schematic Diagram Editor automatically on mount. */
  initialDiagramEditorEnabled?: boolean | undefined;
  /** Optional custom or LSP-hydrated component library catalog powering the VR Wrist Floating Library Panel. */
  libraryCatalog?: readonly GalleryComponentItem[] | undefined;
  /** Canonical bidirectional write-back callback for 3D diagram node moves, spawns, deletes, and magnetic port connections. */
  onDiagramEdit?:
    | ((
        actions: DiagramEditAction[],
        context: {
          tileId: string;
          spatial3DLayout: Record<string, SpatialNodePose3D>;
          diagramData: { nodes: unknown[]; edges: unknown[] };
        },
      ) => void)
    | undefined;
}

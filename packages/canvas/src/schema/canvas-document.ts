// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical schema for `.mscanvas` Polyglot Infinite Spatial Canvas documents.
 *
 * A canvas document stores spatial layout, frames, artifact tile projections,
 * explicit & synthesized visual threads (FMI/SSP wires + shared parameter
 * Digital Thread links), anchored review comments, and camera bookmarks.
 */

export type CanvasSchemaVersion = "1.0";

/** Seven canonical rendering archetypes covering all 106 ModelScript languages. */
export type TileArchetype = "schematic" | "ecad" | "cad3d" | "table" | "analytics" | "code" | "fmu";

/** Four semantic Level-of-Detail (LOD) rendering tiers. */
export type TileLodTier = "macro" | "thumbnail" | "interactive" | "focus";

/** Toggleable visual overlay lenses on the spatial canvas. */
export type CanvasLensId = "shared-parameters" | "fmi-signals" | "requirements" | "blast-radius" | "presence";

export type AnchorSide = "left" | "right" | "top" | "bottom";

export type AnchorKind =
  "parameter" | "fmi-input" | "fmi-output" | "requirement" | "cad-feature" | "pcb-net" | "plot-metric" | "symbol";

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileAnchorSpec {
  /** Path within the artifact (e.g. "motor.J", "u_cmd", "REQ-042", "flange.mass"). */
  path: string;
  label: string;
  kind: AnchorKind;
  /** Physical unit (e.g. "kg", "N.m", "K", "rad/s", "V"). */
  unit?: string | undefined;
  /** Semantic type (e.g. "Real", "Integer", "Boolean", "String"). */
  dataType?: "Real" | "Integer" | "Boolean" | "String" | "Geometry" | undefined;
  /** Preferred edge placement when collapsed to the tile perimeter. */
  side?: AnchorSide | undefined;
  /** Normalized offset [0..1] along the preferred side. */
  sideOffset?: number | undefined;
  /** Optional live value preview string (e.g. "2.14 kg"). */
  currentValue?: string | undefined;
  /** Optional 3D model-space coordinates for STEP/CAD feature pins. */
  model3DPosition?: [number, number, number] | undefined;
  /** Optional row index for virtualized table/ReqIF tiles. */
  rowIndex?: number | undefined;
}

export interface CanvasFrame {
  id: string;
  title: string;
  bounds: WorldBounds;
  color: string;
  zIndex: number;
  locked?: boolean | undefined;
}

export interface CanvasTile {
  id: string;
  title: string;
  /** Workspace-relative path, repo URI, or Model Hub reference. */
  artifactUri: string;
  /** Canonical ModelScript language ID (one of the 106 languages or analytics virtual ID). */
  languageId: string;
  archetype: TileArchetype;
  /** Optional specific class, block, sheet, or symbol inside the artifact. */
  targetSymbol?: string | undefined;
  bounds: WorldBounds;
  zIndex: number;
  frameId?: string | undefined;
  locked?: boolean | undefined;
  /** Archetype-specific persisted view state (e.g. 3D camera, PCB layers, plot axes). */
  viewState?: Record<string, unknown> | undefined;
  /** Pinned parameters/ports surfaced directly on the tile border. */
  pinnedAnchors?: TileAnchorSpec[] | undefined;
  /** Live verification / health summary for macro LOD badges. */
  health?: "ok" | "stale" | "warning" | "error" | undefined;
}

export type CanvasWireKind = "fmi-signal" | "shared-parameter" | "requirement-trace" | "annotation-link";

export type CanvasWireOrigin = "auto-thread" | "user-authored" | "ssp-imported";

export type CanvasWireStatus = "synced" | "stale" | "conflict" | "unit-mismatch";

export interface CanvasWireEndpoint {
  tileId: string;
  anchorPath: string;
}

export interface CanvasWire {
  id: string;
  kind: CanvasWireKind;
  source: CanvasWireEndpoint;
  target: CanvasWireEndpoint;
  origin: CanvasWireOrigin;
  status?: CanvasWireStatus | undefined;
  /** Optional unit conversion or scaling expression (e.g. "x * 1000"). */
  transformExpr?: string | undefined;
  /** Live value readout or telemetry label displayed on the wire. */
  liveValue?: string | undefined;
  /** Optional explicit intermediate waypoints in world coordinates. */
  waypoints?: WorldPoint[] | undefined;
  /** Optional ThreadHypergraph slot ID backing this wire. */
  threadSlot?: number | undefined;
}

export interface CanvasCommentReply {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CanvasCommentThread {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  /** World coordinate pin (used when not anchored to a tile symbol). */
  position: WorldPoint;
  /** Optional semantic anchor so the comment follows a tile & symbol. */
  anchor?: CanvasWireEndpoint | undefined;
  replies: CanvasCommentReply[];
}

export interface CanvasCameraBookmark {
  id: string;
  name: string;
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDocument {
  schemaVersion: CanvasSchemaVersion;
  id: string;
  name: string;
  metadata: {
    createdAt: string;
    updatedAt: string;
    defaultLenses: CanvasLensId[];
  };
  frames: Record<string, CanvasFrame>;
  tiles: Record<string, CanvasTile>;
  wires: Record<string, CanvasWire>;
  comments: Record<string, CanvasCommentThread>;
  bookmarks: CanvasCameraBookmark[];
}

export function createEmptyCanvasDocument(id: string, name: string, nowIso?: string): CanvasDocument {
  const timestamp = nowIso ?? new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id,
    name,
    metadata: {
      createdAt: timestamp,
      updatedAt: timestamp,
      defaultLenses: ["shared-parameters", "fmi-signals", "requirements", "presence"],
    },
    frames: {},
    tiles: {},
    wires: {},
    comments: {},
    bookmarks: [],
  };
}

/**
 * Creates the canonical 6-artifact polyglot systems engineering board:
 * Modelica plant + Simulink controller + KiCad PCB + STEP housing +
 * ReqIF requirement table + Monte Carlo scatter plot, connected by live
 * shared-parameter threads, requirement traces, and FMI co-sim wires.
 */
export function createCanonicalPolyglotDemoBoard(nowIso = "2026-11-22T00:00:00.000Z"): CanvasDocument {
  const doc = createEmptyCanvasDocument("demo-polyglot-actuator", "Electro-Mechanical Actuator System Board", nowIso);

  doc.frames = {
    frame_controls: {
      id: "frame_controls",
      title: "Plant & Closed-Loop Controls (FMI Co-Sim)",
      bounds: { x: 40, y: 40, width: 1060, height: 480 },
      color: "#1e3a5f",
      zIndex: 0,
    },
    frame_hardware: {
      id: "frame_hardware",
      title: "ECAD & Mechanical Packaging",
      bounds: { x: 40, y: 560, width: 1060, height: 480 },
      color: "#3b2f4a",
      zIndex: 0,
    },
    frame_verification: {
      id: "frame_verification",
      title: "Requirements & Monte Carlo UQ",
      bounds: { x: 1140, y: 40, width: 620, height: 1000 },
      color: "#1f4739",
      zIndex: 0,
    },
  };

  doc.tiles = {
    tile_simulink: {
      id: "tile_simulink",
      title: "PID Torque Controller (Simulink)",
      artifactUri: "controls/torque_controller.slx",
      languageId: "simulink",
      archetype: "schematic",
      bounds: { x: 80, y: 100, width: 440, height: 360 },
      zIndex: 1,
      frameId: "frame_controls",
      health: "ok",
      pinnedAnchors: [
        {
          path: "omega_meas",
          label: "omega_meas",
          kind: "fmi-input",
          dataType: "Real",
          unit: "rad/s",
          side: "left",
          sideOffset: 0.35,
        },
        {
          path: "u_cmd",
          label: "u_cmd",
          kind: "fmi-output",
          dataType: "Real",
          unit: "V",
          side: "right",
          sideOffset: 0.4,
          currentValue: "24.0 V",
        },
        {
          path: "Kp",
          label: "Kp",
          kind: "parameter",
          dataType: "Real",
          unit: "V/(rad/s)",
          side: "bottom",
          sideOffset: 0.5,
          currentValue: "1.85",
        },
      ],
    },
    tile_modelica: {
      id: "tile_modelica",
      title: "Actuator Plant (Modelica)",
      artifactUri: "models/ActuatorPlant.mo",
      languageId: "modelica",
      archetype: "schematic",
      targetSymbol: "ActuatorPlant",
      bounds: { x: 610, y: 100, width: 450, height: 360 },
      zIndex: 2,
      frameId: "frame_controls",
      health: "ok",
      pinnedAnchors: [
        {
          path: "motor.u",
          label: "motor.u",
          kind: "fmi-input",
          dataType: "Real",
          unit: "V",
          side: "left",
          sideOffset: 0.4,
        },
        {
          path: "motor.omega",
          label: "motor.omega",
          kind: "fmi-output",
          dataType: "Real",
          unit: "rad/s",
          side: "left",
          sideOffset: 0.72,
          currentValue: "142.3 rad/s",
        },
        {
          path: "housing.mass",
          label: "housing.mass",
          kind: "parameter",
          dataType: "Real",
          unit: "kg",
          side: "bottom",
          sideOffset: 0.45,
          currentValue: "2.14 kg",
        },
        {
          path: "thermal.T_max",
          label: "thermal.T_max",
          kind: "fmi-output",
          dataType: "Real",
          unit: "K",
          side: "right",
          sideOffset: 0.5,
          currentValue: "348.2 K",
        },
      ],
    },
    tile_kicad: {
      id: "tile_kicad",
      title: "Motor Driver PCB (KiCad)",
      artifactUri: "ecad/driver_board.kicad_pcb",
      languageId: "kicad",
      archetype: "ecad",
      bounds: { x: 80, y: 620, width: 440, height: 360 },
      zIndex: 3,
      frameId: "frame_hardware",
      health: "ok",
      viewState: { layers: ["F.Cu", "B.Cu", "Edge.Cuts", "F.SilkS"] },
      pinnedAnchors: [
        {
          path: "net.VBUS_24V",
          label: "VBUS_24V",
          kind: "pcb-net",
          dataType: "Real",
          unit: "V",
          side: "top",
          sideOffset: 0.35,
          currentValue: "24.0 V",
        },
        {
          path: "board.R_th",
          label: "R_th_jc",
          kind: "parameter",
          dataType: "Real",
          unit: "K/W",
          side: "right",
          sideOffset: 0.45,
          currentValue: "1.4 K/W",
        },
      ],
    },
    tile_step: {
      id: "tile_step",
      title: "Aluminum Housing (STEP AP242)",
      artifactUri: "cad/actuator_housing.step",
      languageId: "step",
      archetype: "cad3d",
      bounds: { x: 610, y: 620, width: 450, height: 360 },
      zIndex: 4,
      frameId: "frame_hardware",
      health: "ok",
      viewState: { cameraPosition: [120, 90, 140], target: [0, 0, 0] },
      pinnedAnchors: [
        {
          path: "body.mass",
          label: "Mass",
          kind: "cad-feature",
          dataType: "Real",
          unit: "kg",
          side: "top",
          sideOffset: 0.45,
          currentValue: "2.14 kg",
          model3DPosition: [0, 0.2, 0],
        },
        {
          path: "flange.mounting_holes",
          label: "M4 Mount Pattern",
          kind: "cad-feature",
          dataType: "Geometry",
          side: "left",
          sideOffset: 0.65,
          model3DPosition: [-0.4, -0.2, 0.1],
        },
      ],
    },
    tile_reqif: {
      id: "tile_reqif",
      title: "System Requirements (ReqIF)",
      artifactUri: "reqs/actuator_specs.reqif",
      languageId: "reqif",
      archetype: "table",
      bounds: { x: 1180, y: 100, width: 540, height: 400 },
      zIndex: 5,
      frameId: "frame_verification",
      health: "ok",
      pinnedAnchors: [
        {
          path: "REQ-014",
          label: "REQ-014 Mass <= 2.5 kg",
          kind: "requirement",
          dataType: "Real",
          unit: "kg",
          side: "left",
          sideOffset: 0.3,
          rowIndex: 0,
          currentValue: "PASS (2.14 kg)",
        },
        {
          path: "REQ-042",
          label: "REQ-042 Peak Temp <= 360 K",
          kind: "requirement",
          dataType: "Real",
          unit: "K",
          side: "left",
          sideOffset: 0.65,
          rowIndex: 1,
          currentValue: "PASS (348.2 K)",
        },
      ],
    },
    tile_montecarlo: {
      id: "tile_montecarlo",
      title: "Monte Carlo Thermal/Mass UQ (N=2,000)",
      artifactUri: "studies/actuator_uq.ms-uq",
      languageId: "ms-uq",
      archetype: "analytics",
      bounds: { x: 1180, y: 560, width: 540, height: 420 },
      zIndex: 6,
      frameId: "frame_verification",
      health: "ok",
      viewState: { xAxis: "housing.mass", yAxis: "thermal.T_max", sampleCount: 2000 },
      pinnedAnchors: [
        {
          path: "input.mass",
          label: "mass (kg)",
          kind: "plot-metric",
          dataType: "Real",
          unit: "kg",
          side: "left",
          sideOffset: 0.35,
        },
        {
          path: "output.T_max_p99",
          label: "P99 T_max",
          kind: "plot-metric",
          dataType: "Real",
          unit: "K",
          side: "top",
          sideOffset: 0.5,
          currentValue: "354.6 K",
        },
      ],
    },
  };

  doc.wires = {
    wire_fmi_cmd: {
      id: "wire_fmi_cmd",
      kind: "fmi-signal",
      source: { tileId: "tile_simulink", anchorPath: "u_cmd" },
      target: { tileId: "tile_modelica", anchorPath: "motor.u" },
      origin: "user-authored",
      status: "synced",
      liveValue: "24.0 V",
    },
    wire_fmi_fb: {
      id: "wire_fmi_fb",
      kind: "fmi-signal",
      source: { tileId: "tile_modelica", anchorPath: "motor.omega" },
      target: { tileId: "tile_simulink", anchorPath: "omega_meas" },
      origin: "user-authored",
      status: "synced",
      liveValue: "142.3 rad/s",
    },
    wire_param_mass: {
      id: "wire_param_mass",
      kind: "shared-parameter",
      source: { tileId: "tile_step", anchorPath: "body.mass" },
      target: { tileId: "tile_modelica", anchorPath: "housing.mass" },
      origin: "auto-thread",
      status: "synced",
      liveValue: "2.14 kg",
    },
    wire_req_mass: {
      id: "wire_req_mass",
      kind: "requirement-trace",
      source: { tileId: "tile_step", anchorPath: "body.mass" },
      target: { tileId: "tile_reqif", anchorPath: "REQ-014" },
      origin: "auto-thread",
      status: "synced",
      liveValue: "2.14 <= 2.5 kg",
    },
    wire_req_temp: {
      id: "wire_req_temp",
      kind: "requirement-trace",
      source: { tileId: "tile_modelica", anchorPath: "thermal.T_max" },
      target: { tileId: "tile_reqif", anchorPath: "REQ-042" },
      origin: "auto-thread",
      status: "synced",
      liveValue: "348.2 <= 360 K",
    },
    wire_uq_mass: {
      id: "wire_uq_mass",
      kind: "shared-parameter",
      source: { tileId: "tile_step", anchorPath: "body.mass" },
      target: { tileId: "tile_montecarlo", anchorPath: "input.mass" },
      origin: "auto-thread",
      status: "synced",
      liveValue: "N(2.14, 0.05) kg",
    },
    wire_uq_verify: {
      id: "wire_uq_verify",
      kind: "requirement-trace",
      source: { tileId: "tile_montecarlo", anchorPath: "output.T_max_p99" },
      target: { tileId: "tile_reqif", anchorPath: "REQ-042" },
      origin: "auto-thread",
      status: "synced",
      liveValue: "P99 354.6 K PASS",
    },
  };

  doc.bookmarks = [
    { id: "bm_overview", name: "Full System Overview", x: 0, y: 0, zoom: 0.65 },
    { id: "bm_cosim", name: "Control Loop Co-Sim", x: 40, y: 40, zoom: 1.1 },
    { id: "bm_uq", name: "Verification & UQ", x: 1120, y: 40, zoom: 0.95 },
  ];

  return doc;
}

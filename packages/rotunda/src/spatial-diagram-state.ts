// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile, UnifiedPortItem } from "@modelscript/canvas";
import type { DiagramEditAction, DiagramPalette, DiagramPortSignature } from "@modelscript/diagram/protocol";
import {
  extractVrDiagramData,
  type VrDiagramDataLike,
  type VrDiagramEdgeLike,
  type VrDiagramNodeLike,
} from "./board-painter.js";
import type { EngineeringDomainId, GalleryComponentItem } from "./componentGalleryCatalog.js";
import { clampNumber } from "./types.js";

/**
 * Pure 3D Spatial Diagram Graph State, Bidirectional 2D↔3D Coordinate Mapping,
 * Domain Layering, Catalog Port Synthesis, Undo/Redo History & Canonical LSP Edit Emitter.
 */

export type SpatialPortDomain =
  "electrical" | "mechanical" | "thermal" | "fluid" | "signal" | "power" | "systems" | "generic";

export type SpatialPortPolarity = "positive" | "negative" | "input" | "output" | "inout";

export type SpatialDiagramSnapMode = "free-3d" | "domain-layers" | "grid-5cm" | "flat-2d";

export interface SpatialNodePose3D {
  /** Local coordinates inside the 3D Diagram Stage volume (meters). */
  position: [number, number, number];
  /** Unit quaternion `[x, y, z, w]`. */
  quaternion: [number, number, number, number];
  /** Uniform scale multiplier (default `1.0`). */
  scale: number;
  /** Optional semantic domain layer index (`0=Control`, `1=Electrical`, `2=Mechanical`, `3=Thermal/Fluid`). */
  domainLayer?: number | undefined;
}

export interface SpatialDiagramPort3D {
  readonly nodeId: string;
  readonly portId: string;
  readonly label: string;
  /** Local offset relative to the extruded node center (meters, Y-up). */
  readonly localPosition: [number, number, number];
  /** Outward unit normal in node local space for smooth tangent-aligned wire launch. */
  readonly localNormal: [number, number, number];
  readonly domain: SpatialPortDomain;
  readonly polarity: SpatialPortPolarity;
  readonly color: string;
  /** Preserved canonical connector class FQN (e.g. Modelica.Electrical.Analog.Interfaces.PositivePin). */
  readonly connectorType?: string | undefined;
  /** Preserved structural connector signature for Modelica §9.3 plug-compatibility checks. */
  readonly portSignature?: DiagramPortSignature | undefined;
  /** Preserved SysML v2 / Modelica conjugation flag. */
  readonly isConjugated?: boolean | undefined;
  /** Preserved raw port direction (`"in" | "out" | "inout"`). */
  readonly direction?: string | undefined;
}

export interface SpatialCoordFrame2DTo3D {
  readonly centerX2D: number;
  readonly centerY2D: number;
  readonly metersPerUnit: number;
}

export interface SpatialDiagramStageTransform {
  position: [number, number, number];
  yaw: number;
  scale: number;
}

export interface SpatialDiagramSnapshot {
  readonly nodes: VrDiagramNodeLike[];
  readonly edges: VrDiagramEdgeLike[];
  readonly poses: Record<string, SpatialNodePose3D>;
}

export interface SpatialDiagramState {
  readonly tileId: string;
  readonly nodes: VrDiagramNodeLike[];
  readonly edges: VrDiagramEdgeLike[];
  readonly poses: Record<string, SpatialNodePose3D>;
  readonly coordFrame: SpatialCoordFrame2DTo3D;
  readonly selectedNodeIds: string[];
  readonly selectedEdgeId: string | null;
  readonly stageTransform: SpatialDiagramStageTransform;
  readonly undoStack: SpatialDiagramSnapshot[];
  readonly redoStack: SpatialDiagramSnapshot[];
}

export const DIAGRAM_STAGE_DEFAULT_CENTER: [number, number, number] = [0, 1.32, -0.68];
export const DIAGRAM_STAGE_HALF_EXTENTS: [number, number, number] = [0.76, 0.44, 0.36];
export const DOMAIN_LAYER_Z_PLANES: readonly {
  readonly index: number;
  readonly id: SpatialPortDomain;
  readonly label: string;
  readonly zMeters: number;
  readonly color: string;
}[] = [
  { index: 0, id: "signal", label: "Control & Signals", zMeters: 0.16, color: "#6366f1" },
  { index: 1, id: "electrical", label: "Electrical & Power", zMeters: 0.0, color: "#3b82f6" },
  { index: 2, id: "mechanical", label: "Mechanics & Robotics", zMeters: -0.16, color: "#0d9488" },
  { index: 3, id: "thermal", label: "Thermal & Fluids", zMeters: -0.32, color: "#ef4444" },
] as const;

export const DOMAIN_COLORS: Record<SpatialPortDomain, string> = {
  electrical: "#2563eb",
  power: "#d97706",
  mechanical: "#0d9488",
  thermal: "#ef4444",
  fluid: "#0284c7",
  signal: "#6366f1",
  systems: "#8b5cf6",
  generic: "#38bdf8",
};

const MAX_UNDO_HISTORY = 50;

export function inferDomainFromText(text: string): SpatialPortDomain {
  const lower = text.toLowerCase();
  if (/thermal|heat|temp|conduct|convect|radiat|cooling/.test(lower)) return "thermal";
  if (/fluid|pipe|valve|pump|tank|hydraulic|pneumatic|pressure|flow|epanet|swmm|olga/.test(lower)) return "fluid";
  if (/power|grid|bus|transformer|generator|inverter|pscad|psse|three.?phase/.test(lower)) return "power";
  if (/electr|resistor|capacit|induct|volt|current|opamp|diode|mosfet|ground|spice|pin|rlc/.test(lower)) {
    return "electrical";
  }
  if (/mech|rotat|translat|spring|damper|mass|inertia|flange|gear|motor|joint|body|robot|urdf|adams/.test(lower)) {
    return "mechanical";
  }
  if (/block|control|pid|gain|step|sine|integrat|sum|sensor|signal|simulink|input|output/.test(lower)) {
    return "signal";
  }
  if (/sysml|req|system|state|fmu|ssp/.test(lower)) return "systems";
  return "generic";
}

export function inferDomainLayerIndex(domain: SpatialPortDomain): number {
  switch (domain) {
    case "signal":
    case "systems":
      return 0;
    case "electrical":
    case "power":
      return 1;
    case "mechanical":
      return 2;
    case "thermal":
    case "fluid":
      return 3;
    default:
      return 1;
  }
}

export function categoryToSpatialDomain(category: Exclude<EngineeringDomainId, "all">): SpatialPortDomain {
  switch (category) {
    case "electrical":
      return "electrical";
    case "mechanics":
    case "robotics-cad":
      return "mechanical";
    case "fluids-thermal":
      return "fluid";
    case "control":
      return "signal";
    case "power-grids":
      return "power";
    case "systems":
      return "systems";
  }
}

/** Computes a calibrated 2D diagram → 3D stage meter coordinate mapping from an initial node set. */
export function computeCoordFrame2DTo3D(nodes: readonly VrDiagramNodeLike[]): SpatialCoordFrame2DTo3D {
  if (nodes.length === 0) {
    return { centerX2D: 0, centerY2D: 0, metersPerUnit: 0.0022 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    const x = typeof n.x === "number" && Number.isFinite(n.x) ? n.x : i * 140;
    const y = typeof n.y === "number" && Number.isFinite(n.y) ? n.y : 0;
    const w = typeof n.width === "number" && n.width > 0 ? n.width : 84;
    const h = typeof n.height === "number" && n.height > 0 ? n.height : 56;
    if (x < minX) minX = x;
    if (x + w > maxX) maxX = x + w;
    if (y < minY) minY = y;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { centerX2D: 0, centerY2D: 0, metersPerUnit: 0.0022 };
  }
  const spanX = Math.max(120, maxX - minX);
  const spanY = Math.max(80, maxY - minY);
  const scaleX = 1.08 / spanX;
  const scaleY = 0.62 / spanY;
  const metersPerUnit = clampNumber(Math.min(scaleX, scaleY), 0.0012, 0.0034);
  return {
    centerX2D: (minX + maxX) * 0.5,
    centerY2D: (minY + maxY) * 0.5,
    metersPerUnit,
  };
}

/** Projects 2D schematic center coordinates into 3D stage local meters (Y-up). */
export function diagram2DToStage3D(
  x2D: number,
  y2D: number,
  frame: SpatialCoordFrame2DTo3D,
  zMeters = 0,
): [number, number, number] {
  const lx = (x2D - frame.centerX2D) * frame.metersPerUnit;
  const ly = -(y2D - frame.centerY2D) * frame.metersPerUnit;
  return [Number.isFinite(lx) ? lx : 0, Number.isFinite(ly) ? ly : 0, Number.isFinite(zMeters) ? zMeters : 0];
}

/** Projects 3D stage local meters back into canonical 2D diagram coordinates (Y-down). */
export function stage3DToDiagram2D(
  pos3D: readonly [number, number, number],
  frame: SpatialCoordFrame2DTo3D,
): { x: number; y: number } {
  const inv = frame.metersPerUnit > 1e-6 ? 1 / frame.metersPerUnit : 450;
  const x = frame.centerX2D + pos3D[0] * inv;
  const y = frame.centerY2D - pos3D[1] * inv;
  return {
    x: Number.isFinite(x) ? Math.round(x * 10) / 10 : 0,
    y: Number.isFinite(y) ? Math.round(y * 10) / 10 : 0,
  };
}

/** Extracts normalized 3D port descriptors in node-local meters for any `VrDiagramNodeLike`. */
export function extractNodePorts3D(
  node: VrDiagramNodeLike,
  nodeWidthMeters: number,
  nodeHeightMeters: number,
  waferFrontZ = 0.0045,
): SpatialDiagramPort3D[] {
  const nodeId = node.id ?? node.properties?.name ?? "node";
  const w2d = typeof node.width === "number" && node.width > 0 ? node.width : 80;
  const h2d = typeof node.height === "number" && node.height > 0 ? node.height : 56;
  const classHint = `${node.properties?.className ?? ""} ${node.label ?? ""} ${node.properties?.name ?? ""}`;
  const defaultDomain = inferDomainFromText(classHint);

  const rawItems: UnifiedPortItem[] = Array.isArray(node.ports)
    ? node.ports
    : Array.isArray(node.ports?.items)
      ? node.ports.items
      : [];

  if (rawItems.length === 0) {
    // Synthesize ergonomic default left/right ports so every schematic node can be wired in 3D
    const color = DOMAIN_COLORS[defaultDomain];
    return [
      {
        nodeId,
        portId: "in",
        label: "in",
        localPosition: [-nodeWidthMeters * 0.5 - 0.008, 0, waferFrontZ],
        localNormal: [-1, 0, 0],
        domain: defaultDomain,
        polarity: "input",
        color,
      },
      {
        nodeId,
        portId: "out",
        label: "out",
        localPosition: [nodeWidthMeters * 0.5 + 0.008, 0, waferFrontZ],
        localNormal: [1, 0, 0],
        domain: defaultDomain,
        polarity: "output",
        color,
      },
    ];
  }

  const out: SpatialDiagramPort3D[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) continue;
    const portId = item.id || `port_${i}`;
    const args = (item.args ?? {}) as { x?: number | string; y?: number | string; angle?: number };
    const px = typeof args.x === "number" ? args.x : parsePortCoord(args.x, w2d, i === 0 ? 0 : w2d);
    const py = typeof args.y === "number" ? args.y : parsePortCoord(args.y, h2d, h2d * 0.5);

    // Normalized [-0.5 .. +0.5] relative to node box
    const nx = clampNumber(px / w2d - 0.5, -0.58, 0.58);
    const ny = clampNumber(-(py / h2d - 0.5), -0.58, 0.58);

    // Push ports slightly proud of the chamfered wafer edge so sockets are effortlessly grabbable
    const outX = Math.abs(nx) >= Math.abs(ny) ? Math.sign(nx || (i % 2 === 0 ? -1 : 1)) : 0;
    const outY = Math.abs(ny) > Math.abs(nx) ? Math.sign(ny) : 0;
    const localX = nx * nodeWidthMeters + outX * 0.0085;
    const localY = ny * nodeHeightMeters + outY * 0.0085;

    const rawPort = item as UnifiedPortItem & {
      connectorType?: string | undefined;
      portSignature?: DiagramPortSignature | undefined;
      isConjugated?: boolean | undefined;
      direction?: string | undefined;
      domain?: string | undefined;
    };
    const portHint = `${portId} ${item.group ?? ""} ${rawPort.connectorType ?? ""} ${classHint}`;
    const explicitDomain = typeof rawPort.domain === "string" ? inferDomainFromText(rawPort.domain) : null;
    const domain =
      explicitDomain && explicitDomain !== "generic"
        ? explicitDomain
        : inferPortDomain(portId, item.group, defaultDomain);
    const polarity =
      rawPort.direction === "in"
        ? "input"
        : rawPort.direction === "out"
          ? "output"
          : rawPort.direction === "inout"
            ? "inout"
            : inferPortPolarity(portId, item.group, nx);
    const color = resolvePortColor(domain, polarity, item);

    out.push({
      nodeId,
      portId,
      label: portId,
      localPosition: [localX, localY, waferFrontZ],
      localNormal: [outX, outY, 0],
      domain: domain === "generic" ? inferDomainFromText(portHint) : domain,
      polarity,
      color,
      ...(rawPort.connectorType ? { connectorType: rawPort.connectorType } : {}),
      ...(rawPort.portSignature ? { portSignature: rawPort.portSignature } : {}),
      ...(rawPort.isConjugated !== undefined ? { isConjugated: rawPort.isConjugated } : {}),
      ...(rawPort.direction ? { direction: rawPort.direction } : {}),
    });
  }
  return out;
}

function parsePortCoord(raw: number | string | undefined, span: number, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const pct = Number.parseFloat(trimmed.slice(0, -1));
      if (Number.isFinite(pct)) return (pct / 100) * span;
    }
    const n = Number.parseFloat(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function inferPortDomain(portId: string, group: string | undefined, fallback: SpatialPortDomain): SpatialPortDomain {
  const key = `${portId} ${group ?? ""}`.toLowerCase();
  if (/\b(p|n|pin|v_p|v_n|terminal|plug|anode|cathode|gate|drain|source|base|collector|emitter)\b/.test(key)) {
    return fallback === "power" ? "power" : "electrical";
  }
  if (/flange|frame_a|frame_b|shaft|torque|bearing/.test(key)) return "mechanical";
  if (/heat|thermal|t_port|q_flow/.test(key)) return "thermal";
  if (/fluid|port_a|port_b|inlet|outlet|pipe|medium/.test(key)) return fallback === "thermal" ? "thermal" : "fluid";
  if (/^(u|y|u1|u2|y1|y2|in|out|in_p|in_n|ref|err|cmd|meas|clk|rst)$/.test(portId.toLowerCase())) {
    return fallback === "electrical" && /^(in_p|in_n|out)$/.test(portId.toLowerCase()) ? "electrical" : "signal";
  }
  return fallback;
}

function inferPortPolarity(portId: string, group: string | undefined, nx: number): SpatialPortPolarity {
  const lower = portId.toLowerCase();
  const grp = (group ?? "").toLowerCase();
  if (lower === "p" || lower.endsWith("_p") || lower === "flange_a" || lower === "port_a" || lower === "frame_a") {
    return "positive";
  }
  if (lower === "n" || lower.endsWith("_n") || lower === "flange_b" || lower === "port_b" || lower === "frame_b") {
    return "negative";
  }
  if (/^in|^u\d*$|^ref|^cmd|input/.test(lower) || grp.includes("in")) return "input";
  if (/^out|^y\d*$|output/.test(lower) || grp.includes("out")) return "output";
  return nx < 0 ? "positive" : "negative";
}

function resolvePortColor(domain: SpatialPortDomain, _polarity: SpatialPortPolarity, item: UnifiedPortItem): string {
  const attrs = item.attrs as Record<string, Record<string, unknown>> | undefined;
  const circleStroke = attrs?.["circle"]?.["stroke"] ?? attrs?.["portBody"]?.["stroke"];
  const circleFill = attrs?.["circle"]?.["fill"] ?? attrs?.["portBody"]?.["fill"];
  if (typeof circleStroke === "string" && circleStroke.startsWith("#") && circleStroke !== "#ffffff") {
    return circleStroke;
  }
  if (typeof circleFill === "string" && circleFill.startsWith("#") && circleFill !== "#ffffff") {
    return circleFill;
  }
  return DOMAIN_COLORS[domain];
}

/**
 * Synthesizes authentic 2D port items for any `GalleryComponentItem` so newly materialized
 * 3D components pulled from the VR Wrist Library are immediately wireable with realistic pins.
 */
export function inferCatalogItemPorts(item: GalleryComponentItem): UnifiedPortItem[] {
  const domain = categoryToSpatialDomain(item.category);
  const color = DOMAIN_COLORS[domain];
  const lowerFqn = `${item.fqn} ${item.shortName}`.toLowerCase();
  const params = item.portsAndParams.toLowerCase();

  if (lowerFqn.includes("ground")) {
    return [{ id: "p", group: "electrical", args: { x: 40, y: 7 }, attrs: { circle: { fill: color, stroke: color } } }];
  }
  if (lowerFqn.includes("opamp")) {
    return [
      { id: "in_p", group: "electrical", args: { x: 6, y: 20 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "in_n", group: "electrical", args: { x: 6, y: 36 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
      { id: "out", group: "electrical", args: { x: 74, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
    ];
  }
  if (lowerFqn.includes("mosfet") || lowerFqn.includes("transistor") || lowerFqn.includes("igbt")) {
    return [
      { id: "G", group: "electrical", args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "D", group: "electrical", args: { x: 48, y: 6 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "S", group: "electrical", args: { x: 48, y: 50 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
    ];
  }
  if (lowerFqn.includes("sensor")) {
    return [
      { id: "p", group: domain, args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "n", group: domain, args: { x: 74, y: 28 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
      { id: "y", group: "signal", args: { x: 40, y: 52 }, attrs: { circle: { fill: "#6366f1", stroke: "#6366f1" } } },
    ];
  }
  if (domain === "electrical" || domain === "power" || /\bp\s*,\s*n\b/.test(params)) {
    return [
      { id: "p", group: domain, args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "n", group: domain, args: { x: 74, y: 28 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
    ];
  }
  if (domain === "mechanical" || params.includes("flange")) {
    return [
      { id: "flange_a", group: "mechanical", args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
      {
        id: "flange_b",
        group: "mechanical",
        args: { x: 74, y: 28 },
        attrs: { circle: { fill: "#ffffff", stroke: color } },
      },
    ];
  }
  if (domain === "fluid" || domain === "thermal") {
    return [
      { id: "port_a", group: domain, args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
      { id: "port_b", group: domain, args: { x: 74, y: 28 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
    ];
  }
  return [
    { id: "u", group: "signal", args: { x: 6, y: 28 }, attrs: { circle: { fill: color, stroke: color } } },
    { id: "y", group: "signal", args: { x: 74, y: 28 }, attrs: { circle: { fill: "#ffffff", stroke: color } } },
  ];
}

/** Generates a collision-free component instance identifier (e.g. `R1`, `R2`, `C1`, `pid1`). */
export function generateUniqueComponentName(
  item: Pick<GalleryComponentItem, "shortName" | "declarationSnippet">,
  existingIds: ReadonlySet<string>,
): string {
  // Try to extract canonical prefix from declarationSnippet (e.g. `... Resistor R1(...)` -> `R`)
  let prefix = "";
  const declMatch = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*;?\s*$/.exec(item.declarationSnippet.trim());
  if (declMatch?.[1]) {
    prefix = declMatch[1].replace(/\d+$/, "");
  }
  if (!prefix) {
    const clean = item.shortName.replace(/[^A-Za-z0-9]/g, "");
    prefix = clean ? `${clean.charAt(0).toLowerCase()}${clean.slice(1)}` : "comp";
  }

  let idx = 1;
  while (existingIds.has(`${prefix}${idx}`)) {
    idx++;
  }
  return `${prefix}${idx}`;
}

/** Builds a rich default 3D starter circuit whenever a schematic tile has no serialized `diagramData`. */
export function buildDefaultStarterDiagramData(tile?: CanvasTile | null): VrDiagramDataLike {
  const title = tile?.targetSymbol ?? tile?.title ?? "RLC Servo Drive";
  const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56" fill="none"';

  const mkSvgNode = (
    id: string,
    label: string,
    className: string,
    x: number,
    y: number,
    svg: string,
    ports: UnifiedPortItem[],
  ): VrDiagramNodeLike => ({
    id,
    shape: "svg-component",
    x,
    y,
    width: 80,
    height: 56,
    label,
    properties: { name: id, className },
    data: { iconSvg: svg, domain: inferDomainFromText(className) },
    ports: { items: ports },
  });

  const nodes: VrDiagramNodeLike[] = [
    mkSvgNode(
      "V1",
      "V1 (120V)",
      "Modelica.Electrical.Analog.Sources.SineVoltage",
      40,
      140,
      `<svg ${S}><line x1="6" y1="28" x2="23" y2="28" stroke="#3b82f6" stroke-width="2.2"/><circle cx="40" cy="28" r="17" stroke="currentColor" stroke-width="2.2" fill="rgba(59,130,246,0.10)"/><path d="M30 28 C33 19, 37 19, 40 28 C43 37, 47 37, 50 28" stroke="#3b82f6" stroke-width="2.2" fill="none"/><line x1="57" y1="28" x2="74" y2="28" stroke="#3b82f6" stroke-width="2.2"/></svg>`,
      [
        { id: "p", group: "electrical", args: { x: 6, y: 28 } },
        { id: "n", group: "electrical", args: { x: 74, y: 28 } },
      ],
    ),
    mkSvgNode(
      "R1",
      "R1 (100Ω)",
      "Modelica.Electrical.Analog.Basic.Resistor",
      195,
      70,
      `<svg ${S}><line x1="6" y1="28" x2="22" y2="28" stroke="#3b82f6" stroke-width="2.2"/><rect x="22" y="19" width="36" height="18" rx="1.5" stroke="currentColor" stroke-width="2.2" fill="rgba(59,130,246,0.12)"/><line x1="58" y1="28" x2="74" y2="28" stroke="#3b82f6" stroke-width="2.2"/></svg>`,
      [
        { id: "p", group: "electrical", args: { x: 6, y: 28 } },
        { id: "n", group: "electrical", args: { x: 74, y: 28 } },
      ],
    ),
    mkSvgNode(
      "L1",
      "L1 (10mH)",
      "Modelica.Electrical.Analog.Basic.Inductor",
      350,
      70,
      `<svg ${S}><line x1="6" y1="30" x2="18" y2="30" stroke="#3b82f6" stroke-width="2.2"/><path d="M18 30 A5.5 7 0 0 1 29 30 A5.5 7 0 0 1 40 30 A5.5 7 0 0 1 51 30 A5.5 7 0 0 1 62 30" stroke="currentColor" stroke-width="2.3" fill="none"/><line x1="62" y1="30" x2="74" y2="30" stroke="#3b82f6" stroke-width="2.2"/></svg>`,
      [
        { id: "p", group: "electrical", args: { x: 6, y: 28 } },
        { id: "n", group: "electrical", args: { x: 74, y: 28 } },
      ],
    ),
    mkSvgNode(
      "C1",
      "C1 (47µF)",
      "Modelica.Electrical.Analog.Basic.Capacitor",
      350,
      205,
      `<svg ${S}><line x1="6" y1="28" x2="35" y2="28" stroke="#3b82f6" stroke-width="2.2"/><line x1="35" y1="13" x2="35" y2="43" stroke="currentColor" stroke-width="2.8"/><line x1="45" y1="13" x2="45" y2="43" stroke="currentColor" stroke-width="2.8"/><line x1="45" y1="28" x2="74" y2="28" stroke="#3b82f6" stroke-width="2.2"/></svg>`,
      [
        { id: "p", group: "electrical", args: { x: 6, y: 28 } },
        { id: "n", group: "electrical", args: { x: 74, y: 28 } },
      ],
    ),
    mkSvgNode(
      "Gnd",
      "Ground",
      "Modelica.Electrical.Analog.Basic.Ground",
      195,
      225,
      `<svg ${S}><line x1="40" y1="10" x2="40" y2="28" stroke="#3b82f6" stroke-width="2.4"/><line x1="22" y1="28" x2="58" y2="28" stroke="currentColor" stroke-width="2.6"/><line x1="28" y1="35" x2="52" y2="35" stroke="currentColor" stroke-width="2.4"/><line x1="34" y1="42" x2="46" y2="42" stroke="currentColor" stroke-width="2.2"/></svg>`,
      [{ id: "p", group: "electrical", args: { x: 40, y: 8 } }],
    ),
    mkSvgNode(
      "PID1",
      title.length <= 14 ? title : "PID Ctrl",
      "Modelica.Blocks.Continuous.LimPID",
      195,
      -45,
      `<svg ${S}><rect x="14" y="10" width="52" height="36" rx="4" stroke="#6366f1" stroke-width="2.2" fill="rgba(99,102,241,0.12)"/><path d="M22 36 C30 18, 42 18, 58 18" stroke="currentColor" stroke-width="2.2" fill="none"/><line x1="4" y1="28" x2="14" y2="28" stroke="#6366f1" stroke-width="2.2"/><line x1="66" y1="28" x2="76" y2="28" stroke="#6366f1" stroke-width="2.2"/></svg>`,
      [
        { id: "u", group: "signal", args: { x: 4, y: 28 } },
        { id: "y", group: "signal", args: { x: 76, y: 28 } },
      ],
    ),
  ];

  const edges: VrDiagramEdgeLike[] = [
    {
      id: "e_v1_r1",
      source: { cell: "V1", port: "n" },
      target: { cell: "R1", port: "p" },
      attrs: { line: { stroke: "#3b82f6", strokeWidth: 2 } },
    },
    {
      id: "e_r1_l1",
      source: { cell: "R1", port: "n" },
      target: { cell: "L1", port: "p" },
      attrs: { line: { stroke: "#3b82f6", strokeWidth: 2 } },
    },
    {
      id: "e_l1_c1",
      source: { cell: "L1", port: "n" },
      target: { cell: "C1", port: "p" },
      attrs: { line: { stroke: "#3b82f6", strokeWidth: 2 } },
    },
    {
      id: "e_c1_gnd",
      source: { cell: "C1", port: "n" },
      target: { cell: "Gnd", port: "p" },
      attrs: { line: { stroke: "#3b82f6", strokeWidth: 2 } },
    },
    {
      id: "e_v1_gnd",
      source: { cell: "V1", port: "p" },
      target: { cell: "Gnd", port: "p" },
      attrs: { line: { stroke: "#3b82f6", strokeWidth: 2 } },
    },
  ];

  return { nodes, edges };
}

/** Extracts persisted `spatial3DLayout` from a tile's `viewState`, if present. */
export function extractPersistedSpatial3DLayout(
  viewState: Record<string, unknown> | undefined,
): Record<string, SpatialNodePose3D> {
  const raw = viewState?.["spatial3DLayout"];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SpatialNodePose3D> = {};
  for (const [id, candidate] of Object.entries(raw as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object") continue;
    const rec = candidate as Record<string, unknown>;
    const pos = rec["position"];
    const quat = rec["quaternion"];
    if (Array.isArray(pos) && pos.length === 3 && pos.every((n) => typeof n === "number" && Number.isFinite(n))) {
      const q: [number, number, number, number] =
        Array.isArray(quat) && quat.length === 4 && quat.every((n) => typeof n === "number" && Number.isFinite(n))
          ? [quat[0]!, quat[1]!, quat[2]!, quat[3]!]
          : [0, 0, 0, 1];
      out[id] = {
        position: [pos[0]!, pos[1]!, pos[2]!],
        quaternion: q,
        scale: typeof rec["scale"] === "number" && rec["scale"] > 0.1 ? rec["scale"] : 1,
        domainLayer: typeof rec["domainLayer"] === "number" ? rec["domainLayer"] : undefined,
      };
    }
  }
  return out;
}

/** Initializes a complete `SpatialDiagramState` from a schematic `CanvasTile` (with optional persisted 3D poses). */
export function createSpatialDiagramStateFromTile(tile: CanvasTile | null | undefined): SpatialDiagramState {
  const tileId = tile?.id ?? "tile_primary_schematic";
  const extracted = extractVrDiagramData(tile?.viewState?.["diagramData"]);
  const source = extracted ?? buildDefaultStarterDiagramData(tile);
  const persisted = extractPersistedSpatial3DLayout(tile?.viewState);

  const nodes: VrDiagramNodeLike[] = source.nodes.map((n, idx) => ({
    ...n,
    id: n.id ?? `node_${idx}`,
  }));
  const edges: VrDiagramEdgeLike[] = source.edges.map((e, idx) => ({
    ...e,
    id: e.id ?? `edge_${idx}`,
  }));

  const coordFrame = computeCoordFrame2DTo3D(nodes);
  const poses: Record<string, SpatialNodePose3D> = {};

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const id = n.id!;
    const existingPose = persisted[id];
    if (existingPose) {
      poses[id] = existingPose;
      continue;
    }
    const w = typeof n.width === "number" && n.width > 0 ? n.width : 80;
    const h = typeof n.height === "number" && n.height > 0 ? n.height : 56;
    const cx2d = (typeof n.x === "number" ? n.x : i * 140) + w * 0.5;
    const cy2d = (typeof n.y === "number" ? n.y : 0) + h * 0.5;
    const domain = inferDomainFromText(`${n.properties?.className ?? ""} ${n.label ?? ""} ${id}`);
    const layerIdx = inferDomainLayerIndex(domain);
    // Subtle organic depth separation by domain layer on initial lift so 3D feels volumetric immediately
    const initialZ = (1 - layerIdx) * 0.055;
    poses[id] = {
      position: diagram2DToStage3D(cx2d, cy2d, coordFrame, initialZ),
      quaternion: [0, 0, 0, 1],
      scale: 1,
      domainLayer: layerIdx,
    };
  }

  return {
    tileId,
    nodes,
    edges,
    poses,
    coordFrame,
    selectedNodeIds: [],
    selectedEdgeId: null,
    stageTransform: {
      position: [...DIAGRAM_STAGE_DEFAULT_CENTER],
      yaw: 0,
      scale: 1,
    },
    undoStack: [],
    redoStack: [],
  };
}

function captureSnapshot(state: SpatialDiagramState): SpatialDiagramSnapshot {
  const posesClone: Record<string, SpatialNodePose3D> = {};
  for (const [k, v] of Object.entries(state.poses)) {
    posesClone[k] = {
      position: [v.position[0], v.position[1], v.position[2]],
      quaternion: [v.quaternion[0], v.quaternion[1], v.quaternion[2], v.quaternion[3]],
      scale: v.scale,
      domainLayer: v.domainLayer,
    };
  }
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    edges: state.edges.map((e) => ({ ...e })),
    poses: posesClone,
  };
}

function pushUndo(state: SpatialDiagramState): SpatialDiagramSnapshot[] {
  const next = [...state.undoStack, captureSnapshot(state)];
  return next.length > MAX_UNDO_HISTORY ? next.slice(next.length - MAX_UNDO_HISTORY) : next;
}

export interface SpatialEditResult {
  readonly state: SpatialDiagramState;
  readonly actions: DiagramEditAction[];
}

/** Commits a 3D node move/rotate with undo snapshot and emits canonical 2D `DiagramEditAction`. */
export function commitMoveSpatialNode(
  state: SpatialDiagramState,
  nodeId: string,
  nextPose: SpatialNodePose3D,
): SpatialEditResult {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return { state, actions: [] };

  const w = typeof node.width === "number" && node.width > 0 ? node.width : 80;
  const h = typeof node.height === "number" && node.height > 0 ? node.height : 56;
  const center2D = stage3DToDiagram2D(nextPose.position, state.coordFrame);
  const nextX = Math.round((center2D.x - w * 0.5) * 10) / 10;
  const nextY = Math.round((center2D.y - h * 0.5) * 10) / 10;

  // Derive planar Z-rotation degrees from quaternion for 2D Placement fidelity
  const [qx, qy, qz, qw] = nextPose.quaternion;
  const rotRad = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
  const rotDeg = Math.round(((rotRad * 180) / Math.PI) * 10) / 10;

  const undoStack = pushUndo(state);
  const nextNodes = state.nodes.map((n) => (n.id === nodeId ? { ...n, x: nextX, y: nextY, angle: rotDeg } : n));
  const nextPoses: Record<string, SpatialNodePose3D> = {
    ...state.poses,
    [nodeId]: nextPose,
  };

  const actions: DiagramEditAction[] = [
    {
      type: "move",
      items: [
        {
          id: nodeId,
          name: node.properties?.name ?? nodeId,
          x: nextX,
          y: nextY,
          width: w,
          height: h,
          rotation: rotDeg,
        },
      ],
    },
  ];

  return {
    state: {
      ...state,
      nodes: nextNodes,
      poses: nextPoses,
      selectedNodeIds: [nodeId],
      selectedEdgeId: null,
      undoStack,
      redoStack: [],
    },
    actions,
  };
}

/** Resolves `(nodeId, portId)` endpoints from a `VrDiagramEdgeLike`. */
export function resolveEdgeEndpoints(edge: VrDiagramEdgeLike): {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
} | null {
  const srcNode = typeof edge.source === "string" ? edge.source : edge.source?.cell;
  const tgtNode = typeof edge.target === "string" ? edge.target : edge.target?.cell;
  if (!srcNode || !tgtNode) return null;
  const srcPort = typeof edge.source === "object" && edge.source?.port ? edge.source.port : "out";
  const tgtPort = typeof edge.target === "object" && edge.target?.port ? edge.target.port : "in";
  return {
    sourceNodeId: srcNode,
    sourcePortId: srcPort,
    targetNodeId: tgtNode,
    targetPortId: tgtPort,
  };
}

/** Commits a new magnetic 3D wire connection between two ports (preventing duplicates). */
export function commitConnectSpatialPorts(
  state: SpatialDiagramState,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  strokeColor = "#3b82f6",
): SpatialEditResult {
  if (sourceNodeId === targetNodeId && sourcePortId === targetPortId) {
    return { state, actions: [] };
  }
  // Duplicate check (undirected physical connection parity)
  const exists = state.edges.some((e) => {
    const ep = resolveEdgeEndpoints(e);
    if (!ep) return false;
    const forward =
      ep.sourceNodeId === sourceNodeId &&
      ep.sourcePortId === sourcePortId &&
      ep.targetNodeId === targetNodeId &&
      ep.targetPortId === targetPortId;
    const reverse =
      ep.sourceNodeId === targetNodeId &&
      ep.sourcePortId === targetPortId &&
      ep.targetNodeId === sourceNodeId &&
      ep.targetPortId === sourcePortId;
    return forward || reverse;
  });
  if (exists) return { state, actions: [] };

  const edgeId = `wire3d_${sourceNodeId}_${sourcePortId}__${targetNodeId}_${targetPortId}_${state.edges.length + 1}`;
  const newEdge: VrDiagramEdgeLike = {
    id: edgeId,
    source: { cell: sourceNodeId, port: sourcePortId },
    target: { cell: targetNodeId, port: targetPortId },
    attrs: {
      line: {
        stroke: strokeColor,
        strokeWidth: 2.2,
      },
    },
  };

  const srcNode = state.nodes.find((n) => n.id === sourceNodeId);
  const tgtNode = state.nodes.find((n) => n.id === targetNodeId);
  const actions: DiagramEditAction[] = [
    {
      type: "connect",
      source: srcNode?.properties?.name ?? sourceNodeId,
      sourcePort: sourcePortId,
      target: tgtNode?.properties?.name ?? targetNodeId,
      targetPort: targetPortId,
    },
  ];

  return {
    state: {
      ...state,
      edges: [...state.edges, newEdge],
      selectedEdgeId: edgeId,
      selectedNodeIds: [],
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/** Disconnects an existing 3D wire edge (e.g. via yank-to-disconnect or Delete). */
export function commitDisconnectSpatialEdge(state: SpatialDiagramState, edgeId: string): SpatialEditResult {
  const targetEdge = state.edges.find((e) => e.id === edgeId);
  if (!targetEdge) return { state, actions: [] };
  const ep = resolveEdgeEndpoints(targetEdge);
  const srcNode = ep ? state.nodes.find((n) => n.id === ep.sourceNodeId) : undefined;
  const tgtNode = ep ? state.nodes.find((n) => n.id === ep.targetNodeId) : undefined;

  const actions: DiagramEditAction[] = ep
    ? [
        {
          type: "disconnect",
          source: srcNode?.properties?.name ?? ep.sourceNodeId,
          sourcePort: ep.sourcePortId,
          target: tgtNode?.properties?.name ?? ep.targetNodeId,
          targetPort: ep.targetPortId,
        },
      ]
    : [];

  return {
    state: {
      ...state,
      edges: state.edges.filter((e) => e.id !== edgeId),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/**
 * Commits a newly materialized 3D component spawned from the VR Wrist Library Panel,
 * optionally including an immediate auto-snap-weld connection in one atomic batch.
 */
export function commitSpawnCatalogComponent(
  state: SpatialDiagramState,
  item: GalleryComponentItem,
  pose: SpatialNodePose3D,
  snapWeld?: {
    readonly spawnedPortId: string;
    readonly targetNodeId: string;
    readonly targetPortId: string;
    readonly strokeColor?: string | undefined;
  },
): SpatialEditResult & { readonly spawnedNodeId: string } {
  const existingIds = new Set(state.nodes.map((n) => n.id ?? ""));
  const uniqueName = generateUniqueComponentName(item, existingIds);
  const w = 80;
  const h = 56;
  const center2D = stage3DToDiagram2D(pose.position, state.coordFrame);
  const x2D = Math.round((center2D.x - w * 0.5) * 10) / 10;
  const y2D = Math.round((center2D.y - h * 0.5) * 10) / 10;
  const ports = inferCatalogItemPorts(item);
  const domain = categoryToSpatialDomain(item.category);

  const newNode: VrDiagramNodeLike = {
    id: uniqueName,
    shape: "svg-component",
    x: x2D,
    y: y2D,
    width: w,
    height: h,
    label: uniqueName,
    properties: {
      name: uniqueName,
      className: item.fqn,
    },
    data: {
      iconSvg: item.schematicSvg,
      summary: item.summary,
      portsAndParams: item.portsAndParams,
      domain,
    },
    ports: { items: ports },
  };

  const actions: DiagramEditAction[] = [
    {
      type: "addComponent",
      className: item.fqn,
      name: uniqueName,
      x: x2D,
      y: y2D,
    },
  ];

  let nextEdges = state.edges;
  if (snapWeld) {
    const tgtNode = state.nodes.find((n) => n.id === snapWeld.targetNodeId);
    const weldEdge: VrDiagramEdgeLike = {
      id: `wire3d_weld_${uniqueName}_${snapWeld.spawnedPortId}__${snapWeld.targetNodeId}_${snapWeld.targetPortId}`,
      source: { cell: uniqueName, port: snapWeld.spawnedPortId },
      target: { cell: snapWeld.targetNodeId, port: snapWeld.targetPortId },
      attrs: {
        line: {
          stroke: snapWeld.strokeColor ?? DOMAIN_COLORS[domain],
          strokeWidth: 2.2,
        },
      },
    };
    nextEdges = [...state.edges, weldEdge];
    actions.push({
      type: "connect",
      source: uniqueName,
      sourcePort: snapWeld.spawnedPortId,
      target: tgtNode?.properties?.name ?? snapWeld.targetNodeId,
      targetPort: snapWeld.targetPortId,
    });
  }

  const nextPose: SpatialNodePose3D = {
    ...pose,
    domainLayer: pose.domainLayer ?? inferDomainLayerIndex(domain),
  };

  return {
    spawnedNodeId: uniqueName,
    state: {
      ...state,
      nodes: [...state.nodes, newNode],
      edges: nextEdges,
      poses: {
        ...state.poses,
        [uniqueName]: nextPose,
      },
      selectedNodeIds: [uniqueName],
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/** Deletes a component and all attached wires (undoable, emitting `deleteComponents`). */
export function commitDeleteSpatialNode(state: SpatialDiagramState, nodeId: string): SpatialEditResult {
  const target = state.nodes.find((n) => n.id === nodeId);
  if (!target) return { state, actions: [] };

  const nextPoses: Record<string, SpatialNodePose3D> = {};
  for (const [key, pose] of Object.entries(state.poses)) {
    if (key !== nodeId) {
      nextPoses[key] = pose;
    }
  }

  const nextEdges = state.edges.filter((e) => {
    const ep = resolveEdgeEndpoints(e);
    return !ep || (ep.sourceNodeId !== nodeId && ep.targetNodeId !== nodeId);
  });

  const actions: DiagramEditAction[] = [
    {
      type: "deleteComponents",
      names: [target.properties?.name ?? nodeId],
    },
  ];

  return {
    state: {
      ...state,
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: nextEdges,
      poses: nextPoses,
      selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/** Reorganizes all components cleanly onto parallel domain depth planes (or flattens to `z = 0`). */
export function applyAutoDomainLayerLayout(state: SpatialDiagramState, flattenTo2D = false): SpatialDiagramState {
  const nextPoses: Record<string, SpatialNodePose3D> = {};
  for (const n of state.nodes) {
    const id = n.id ?? "";
    const cur = state.poses[id];
    if (!cur) continue;
    const domain = inferDomainFromText(`${n.properties?.className ?? ""} ${n.label ?? ""} ${id}`);
    const layerIdx = inferDomainLayerIndex(domain);
    const layerMeta = DOMAIN_LAYER_Z_PLANES[layerIdx] ?? DOMAIN_LAYER_Z_PLANES[1]!;
    nextPoses[id] = {
      ...cur,
      position: [cur.position[0], cur.position[1], flattenTo2D ? 0 : layerMeta.zMeters],
      quaternion: [0, 0, 0, 1],
      domainLayer: layerIdx,
    };
  }
  return {
    ...state,
    poses: nextPoses,
    undoStack: pushUndo(state),
    redoStack: [],
  };
}

/** Pops one snapshot from the undo stack and pushes current state onto redo. */
export function undoSpatialDiagram(state: SpatialDiagramState): SpatialDiagramState {
  if (state.undoStack.length === 0) return state;
  const previous = state.undoStack[state.undoStack.length - 1]!;
  return {
    ...state,
    nodes: previous.nodes,
    edges: previous.edges,
    poses: previous.poses,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, captureSnapshot(state)].slice(-MAX_UNDO_HISTORY),
  };
}

/** Pops one snapshot from the redo stack and pushes current state onto undo. */
export function redoSpatialDiagram(state: SpatialDiagramState): SpatialDiagramState {
  if (state.redoStack.length === 0) return state;
  const next = state.redoStack[state.redoStack.length - 1]!;
  return {
    ...state,
    nodes: next.nodes,
    edges: next.edges,
    poses: next.poses,
    undoStack: [...state.undoStack, captureSnapshot(state)].slice(-MAX_UNDO_HISTORY),
    redoStack: state.redoStack.slice(0, -1),
  };
}

/** Batch-moves multiple selected 3D nodes atomically in a single `move` `DiagramEditAction`. */
export function commitMoveSpatialNodes(
  state: SpatialDiagramState,
  updates: Readonly<Record<string, SpatialNodePose3D>>,
): SpatialEditResult {
  const movedIds = Object.keys(updates).filter((id) => state.nodes.some((n) => n.id === id));
  if (movedIds.length === 0) return { state, actions: [] };

  const items: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }> = [];

  const nextPoses: Record<string, SpatialNodePose3D> = { ...state.poses };
  const nextNodes = state.nodes.map((node) => {
    const id = node.id ?? "";
    const nextPose = updates[id];
    if (!nextPose) return node;

    const w = typeof node.width === "number" && node.width > 0 ? node.width : 80;
    const h = typeof node.height === "number" && node.height > 0 ? node.height : 56;
    const center2D = stage3DToDiagram2D(nextPose.position, state.coordFrame);
    const nextX = Math.round((center2D.x - w * 0.5) * 10) / 10;
    const nextY = Math.round((center2D.y - h * 0.5) * 10) / 10;

    const [qx, qy, qz, qw] = nextPose.quaternion;
    const rotRad = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    const rotDeg = Math.round(((rotRad * 180) / Math.PI) * 10) / 10;

    nextPoses[id] = nextPose;
    items.push({
      id,
      name: node.properties?.name ?? id,
      x: nextX,
      y: nextY,
      width: w,
      height: h,
      rotation: rotDeg,
    });
    return { ...node, x: nextX, y: nextY, angle: rotDeg };
  });

  if (items.length === 0) return { state, actions: [] };

  return {
    state: {
      ...state,
      nodes: nextNodes,
      poses: nextPoses,
      selectedNodeIds: movedIds,
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "move", items }],
  };
}

/** Batch-deletes multiple selected 3D nodes and their incident edges in one `deleteComponents` action. */
export function commitDeleteSpatialNodes(state: SpatialDiagramState, nodeIds: readonly string[]): SpatialEditResult {
  const idSet = new Set(nodeIds);
  const targets = state.nodes.filter((n) => n.id && idSet.has(n.id));
  if (targets.length === 0) return { state, actions: [] };

  const nextPoses: Record<string, SpatialNodePose3D> = {};
  for (const [key, pose] of Object.entries(state.poses)) {
    if (!idSet.has(key)) nextPoses[key] = pose;
  }

  const nextEdges = state.edges.filter((e) => {
    const ep = resolveEdgeEndpoints(e);
    return !ep || (!idSet.has(ep.sourceNodeId) && !idSet.has(ep.targetNodeId));
  });

  const names = targets.map((t) => t.properties?.name ?? t.id!);
  return {
    state: {
      ...state,
      nodes: state.nodes.filter((n) => !n.id || !idSet.has(n.id)),
      edges: nextEdges,
      poses: nextPoses,
      selectedNodeIds: state.selectedNodeIds.filter((id) => !idSet.has(id)),
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "deleteComponents", names }],
  };
}

/**
 * Atomically reconnects an existing 3D wire edge to new endpoints, emitting a single canonical
 * `{ type: "reconnect" }` `DiagramEditAction` instead of separate `disconnect` + `connect`.
 */
export function commitReconnectSpatialEdge(
  state: SpatialDiagramState,
  edgeId: string,
  newSourceNodeId: string,
  newSourcePortId: string,
  newTargetNodeId: string,
  newTargetPortId: string,
  strokeColor?: string,
): SpatialEditResult {
  const existing = state.edges.find((e) => e.id === edgeId);
  if (!existing) return { state, actions: [] };
  const oldEp = resolveEdgeEndpoints(existing);
  if (!oldEp) return { state, actions: [] };

  if (newSourceNodeId === newTargetNodeId && newSourcePortId === newTargetPortId) {
    return { state, actions: [] };
  }

  // No-op if re-attached to the exact same undirected pair
  const sameForward =
    oldEp.sourceNodeId === newSourceNodeId &&
    oldEp.sourcePortId === newSourcePortId &&
    oldEp.targetNodeId === newTargetNodeId &&
    oldEp.targetPortId === newTargetPortId;
  const sameReverse =
    oldEp.sourceNodeId === newTargetNodeId &&
    oldEp.sourcePortId === newTargetPortId &&
    oldEp.targetNodeId === newSourceNodeId &&
    oldEp.targetPortId === newSourcePortId;
  if (sameForward || sameReverse) return { state, actions: [] };

  // Prevent duplicate connection with another existing edge
  const duplicate = state.edges.some((e) => {
    if (e.id === edgeId) return false;
    const ep = resolveEdgeEndpoints(e);
    if (!ep) return false;
    return (
      (ep.sourceNodeId === newSourceNodeId &&
        ep.sourcePortId === newSourcePortId &&
        ep.targetNodeId === newTargetNodeId &&
        ep.targetPortId === newTargetPortId) ||
      (ep.sourceNodeId === newTargetNodeId &&
        ep.sourcePortId === newTargetPortId &&
        ep.targetNodeId === newSourceNodeId &&
        ep.targetPortId === newSourcePortId)
    );
  });
  if (duplicate) return { state, actions: [] };

  const resolveName = (nid: string) => state.nodes.find((n) => n.id === nid)?.properties?.name ?? nid;
  const nextEdges = state.edges.map((e) =>
    e.id === edgeId
      ? {
          ...e,
          source: { cell: newSourceNodeId, port: newSourcePortId },
          target: { cell: newTargetNodeId, port: newTargetPortId },
          ...(strokeColor ? { attrs: { ...e.attrs, line: { ...e.attrs?.["line"], stroke: strokeColor } } } : {}),
        }
      : e,
  );

  const actions: DiagramEditAction[] = [
    {
      type: "reconnect",
      edgeId,
      oldSource: resolveName(oldEp.sourceNodeId),
      oldSourcePort: oldEp.sourcePortId,
      oldTarget: resolveName(oldEp.targetNodeId),
      oldTargetPort: oldEp.targetPortId,
      newSource: resolveName(newSourceNodeId),
      newSourcePort: newSourcePortId,
      newTarget: resolveName(newTargetNodeId),
      newTargetPort: newTargetPortId,
    },
  ];

  return {
    state: {
      ...state,
      edges: nextEdges,
      selectedEdgeId: edgeId,
      selectedNodeIds: [],
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/** Rotates a 3D node by `deltaDegrees` around Z and emits a canonical `{ type: "rotate" }` action. */
export function commitRotateSpatialNode(
  state: SpatialDiagramState,
  nodeId: string,
  deltaDegrees = 90,
): SpatialEditResult {
  const node = state.nodes.find((n) => n.id === nodeId);
  const pose = state.poses[nodeId];
  if (!node || !pose) return { state, actions: [] };

  const w = typeof node.width === "number" && node.width > 0 ? node.width : 80;
  const h = typeof node.height === "number" && node.height > 0 ? node.height : 56;
  const curDeg = typeof node.angle === "number" && Number.isFinite(node.angle) ? node.angle : 0;
  const nextDeg = (((curDeg + deltaDegrees) % 360) + 360) % 360;
  const halfRad = ((nextDeg * Math.PI) / 180) * 0.5;
  const nextPose: SpatialNodePose3D = {
    ...pose,
    quaternion: [0, 0, Math.sin(halfRad), Math.cos(halfRad)],
  };

  const center2D = stage3DToDiagram2D(pose.position, state.coordFrame);
  const x2D = Math.round((center2D.x - w * 0.5) * 10) / 10;
  const y2D = Math.round((center2D.y - h * 0.5) * 10) / 10;

  return {
    state: {
      ...state,
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, angle: nextDeg } : n)),
      poses: { ...state.poses, [nodeId]: nextPose },
      selectedNodeIds: [nodeId],
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [
      {
        type: "rotate",
        item: {
          id: nodeId,
          name: node.properties?.name ?? nodeId,
          x: x2D,
          y: y2D,
          width: w,
          height: h,
          rotation: nextDeg,
        },
      },
    ],
  };
}

/** Flips a 3D node horizontally (`x`) or vertically (`y`) and emits a canonical `rotate` action with `flipX`/`flipY`. */
export function commitFlipSpatialNode(
  state: SpatialDiagramState,
  nodeId: string,
  axis: "x" | "y" = "x",
): SpatialEditResult {
  const node = state.nodes.find((n) => n.id === nodeId);
  const pose = state.poses[nodeId];
  if (!node || !pose) return { state, actions: [] };

  const w = typeof node.width === "number" && node.width > 0 ? node.width : 80;
  const h = typeof node.height === "number" && node.height > 0 ? node.height : 56;
  const curDeg = typeof node.angle === "number" && Number.isFinite(node.angle) ? node.angle : 0;
  const center2D = stage3DToDiagram2D(pose.position, state.coordFrame);
  const x2D = Math.round((center2D.x - w * 0.5) * 10) / 10;
  const y2D = Math.round((center2D.y - h * 0.5) * 10) / 10;

  const prevFlipX = Boolean((node.data as Record<string, unknown> | undefined)?.["flipX"]);
  const prevFlipY = Boolean((node.data as Record<string, unknown> | undefined)?.["flipY"]);
  const flipX = axis === "x" ? !prevFlipX : prevFlipX;
  const flipY = axis === "y" ? !prevFlipY : prevFlipY;

  return {
    state: {
      ...state,
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), flipX, flipY } } : n)),
      selectedNodeIds: [nodeId],
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [
      {
        type: "rotate",
        item: {
          id: nodeId,
          name: node.properties?.name ?? nodeId,
          x: x2D,
          y: y2D,
          width: w,
          height: h,
          rotation: curDeg,
          flipX,
          flipY,
        },
      },
    ],
  };
}

/** Resizes a 3D node and emits a canonical `{ type: "resize" }` action. */
export function commitResizeSpatialNode(
  state: SpatialDiagramState,
  nodeId: string,
  nextWidth: number,
  nextHeight: number,
): SpatialEditResult {
  const node = state.nodes.find((n) => n.id === nodeId);
  const pose = state.poses[nodeId];
  if (!node || !pose) return { state, actions: [] };

  const w = Math.max(24, Math.round(nextWidth * 10) / 10);
  const h = Math.max(24, Math.round(nextHeight * 10) / 10);
  const curDeg = typeof node.angle === "number" && Number.isFinite(node.angle) ? node.angle : 0;
  const center2D = stage3DToDiagram2D(pose.position, state.coordFrame);
  const x2D = Math.round((center2D.x - w * 0.5) * 10) / 10;
  const y2D = Math.round((center2D.y - h * 0.5) * 10) / 10;

  const origW = typeof node.width === "number" && node.width > 0 ? node.width : 80;
  const nextScale = clampNumber(w / origW, 0.5, 2.5);

  return {
    state: {
      ...state,
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, x: x2D, y: y2D, width: w, height: h } : n)),
      poses: { ...state.poses, [nodeId]: { ...pose, scale: nextScale } },
      selectedNodeIds: [nodeId],
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [
      {
        type: "resize",
        item: {
          id: nodeId,
          name: node.properties?.name ?? nodeId,
          x: x2D,
          y: y2D,
          width: w,
          height: h,
          rotation: curDeg,
        },
      },
    ],
  };
}

/** Duplicates one or more selected 3D nodes (plus internal edges) via `addComponent` or `pasteSubgraph`. */
export function commitDuplicateSpatialNodes(
  state: SpatialDiagramState,
  nodeIds: readonly string[],
): SpatialEditResult & { readonly duplicatedNodeIds: string[] } {
  const idSet = new Set(nodeIds);
  const sources = state.nodes.filter((n) => n.id && idSet.has(n.id));
  if (sources.length === 0) return { state, actions: [], duplicatedNodeIds: [] };

  const existingIds = new Set(state.nodes.map((n) => n.id ?? ""));
  const oldToNewId = new Map<string, string>();
  const oldToIdx = new Map<string, number>();
  const newNodes: VrDiagramNodeLike[] = [];
  const nextPoses: Record<string, SpatialNodePose3D> = { ...state.poses };
  const pasteNodes: { className: string; x: number; y: number; rotation?: number }[] = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    const srcId = src.id!;
    const className = src.properties?.className ?? src.label ?? "Modelica.Blocks.Interfaces.RealInput";
    const shortName = className.split(".").pop() ?? srcId;
    const newId = generateUniqueComponentName({ shortName, declarationSnippet: `${className} ${srcId}` }, existingIds);
    existingIds.add(newId);
    oldToNewId.set(srcId, newId);
    oldToIdx.set(srcId, i);

    const srcPose = state.poses[srcId] ?? {
      position: [0, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: 1,
    };
    const nextPos: [number, number, number] = [
      srcPose.position[0] + 0.14,
      srcPose.position[1] - 0.08,
      srcPose.position[2],
    ];
    nextPoses[newId] = { ...srcPose, position: nextPos };

    const w = typeof src.width === "number" && src.width > 0 ? src.width : 80;
    const h = typeof src.height === "number" && src.height > 0 ? src.height : 56;
    const center2D = stage3DToDiagram2D(nextPos, state.coordFrame);
    const x2D = Math.round((center2D.x - w * 0.5) * 10) / 10;
    const y2D = Math.round((center2D.y - h * 0.5) * 10) / 10;

    newNodes.push({
      ...src,
      id: newId,
      x: x2D,
      y: y2D,
      label: newId,
      properties: { ...(src.properties ?? {}), name: newId, className },
    });
    pasteNodes.push({
      className,
      x: x2D,
      y: y2D,
      ...(typeof src.angle === "number" && src.angle !== 0 ? { rotation: src.angle } : {}),
    });
  }

  const newEdges: VrDiagramEdgeLike[] = [];
  const pasteEdges: { sourceIdx: number; sourcePort?: string; targetIdx: number; targetPort?: string }[] = [];
  for (const e of state.edges) {
    const ep = resolveEdgeEndpoints(e);
    if (!ep) continue;
    const srcIdx = oldToIdx.get(ep.sourceNodeId);
    const tgtIdx = oldToIdx.get(ep.targetNodeId);
    const newSrc = oldToNewId.get(ep.sourceNodeId);
    const newTgt = oldToNewId.get(ep.targetNodeId);
    if (srcIdx !== undefined && tgtIdx !== undefined && newSrc && newTgt) {
      newEdges.push({
        ...e,
        id: `wire3d_dup_${newSrc}_${ep.sourcePortId}__${newTgt}_${ep.targetPortId}`,
        source: { cell: newSrc, port: ep.sourcePortId },
        target: { cell: newTgt, port: ep.targetPortId },
      });
      pasteEdges.push({
        sourceIdx: srcIdx,
        sourcePort: ep.sourcePortId,
        targetIdx: tgtIdx,
        targetPort: ep.targetPortId,
      });
    }
  }

  const duplicatedNodeIds = newNodes.map((n) => n.id!);
  const actions: DiagramEditAction[] =
    newNodes.length === 1 && pasteEdges.length === 0
      ? [
          {
            type: "addComponent",
            className: pasteNodes[0]!.className,
            name: duplicatedNodeIds[0],
            x: pasteNodes[0]!.x,
            y: pasteNodes[0]!.y,
            ...(pasteNodes[0]!.rotation !== undefined ? { rotation: pasteNodes[0]!.rotation } : {}),
          },
        ]
      : [{ type: "pasteSubgraph", nodes: pasteNodes, edges: pasteEdges }];

  return {
    duplicatedNodeIds,
    state: {
      ...state,
      nodes: [...state.nodes, ...newNodes],
      edges: [...state.edges, ...newEdges],
      poses: nextPoses,
      selectedNodeIds: duplicatedNodeIds,
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

function spatialDomainToCategory(domain: SpatialPortDomain): Exclude<EngineeringDomainId, "all"> {
  switch (domain) {
    case "electrical":
      return "electrical";
    case "mechanical":
      return "mechanics";
    case "fluid":
    case "thermal":
      return "fluids-thermal";
    case "signal":
      return "control";
    case "power":
      return "power-grids";
    case "systems":
      return "systems";
    default:
      return "systems";
  }
}

/**
 * Adapts a live LSP `DiagramPalette` (`DiagramMethods.getPalette`) into `GalleryComponentItem[]`
 * so the VR Matrix Stockroom displays active-language and workspace components alongside defaults.
 */
export function diagramPaletteToGalleryCatalog(
  palette: DiagramPalette | null | undefined,
  languageId = "modelica",
  fallbackCatalog: readonly GalleryComponentItem[] = [],
): GalleryComponentItem[] {
  const out: GalleryComponentItem[] = [];
  const seenFqns = new Set<string>();

  if (palette && Array.isArray(palette.categories)) {
    for (const cat of palette.categories) {
      if (!cat || !Array.isArray(cat.items)) continue;
      for (const item of cat.items) {
        if (!item?.className || seenFqns.has(item.className)) continue;
        seenFqns.add(item.className);
        const domain = inferDomainFromText(`${cat.name} ${item.className} ${item.label} ${languageId}`);
        const category = spatialDomainToCategory(domain);
        const shortName = item.label || item.className.split(".").pop() || item.className;
        const cleanPrefix = shortName.replace(/[^A-Za-z0-9]/g, "");
        const instName = cleanPrefix ? `${cleanPrefix.charAt(0).toLowerCase()}${cleanPrefix.slice(1)}1` : "comp1";
        const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56" fill="none"><rect x="12" y="10" width="56" height="36" rx="5" stroke="${DOMAIN_COLORS[domain]}" stroke-width="2.2" fill="rgba(56,189,248,0.12)"/><line x1="4" y1="28" x2="12" y2="28" stroke="${DOMAIN_COLORS[domain]}" stroke-width="2.2"/><line x1="68" y1="28" x2="76" y2="28" stroke="${DOMAIN_COLORS[domain]}" stroke-width="2.2"/></svg>`;

        out.push({
          id: `lsp_${languageId}_${item.className.replace(/[^A-Za-z0-9_]/g, "_")}`,
          kind: "model",
          category,
          shortName,
          fqn: item.className,
          packageName: cat.name || languageId,
          packageVersion: "1.0.0",
          library: cat.name || languageId.toUpperCase(),
          summary: item.description || `${shortName} (${cat.name || languageId})`,
          portsAndParams: item.defaultProps ? Object.keys(item.defaultProps).join(", ") : "",
          declarationSnippet: `${item.className} ${instName};`,
          keywords: [shortName.toLowerCase(), languageId.toLowerCase()],
          schematicSvg: item.iconSvg && item.iconSvg.trim().startsWith("<") ? item.iconSvg : defaultSvg,
        });
      }
    }
  }

  for (const fb of fallbackCatalog) {
    if (!seenFqns.has(fb.fqn)) {
      seenFqns.add(fb.fqn);
      out.push(fb);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Manual Edge Waypoint Routing (`moveEdge`)                                 */
/* -------------------------------------------------------------------------- */

/** Replaces an edge's manual waypoints (in 3D stage meters) and emits a canonical `moveEdge` action. */
export function commitMoveEdgeWaypoints(
  state: SpatialDiagramState,
  edgeId: string,
  vertices3D: readonly (readonly [number, number, number])[],
): SpatialEditResult {
  const edge = state.edges.find((e) => e.id === edgeId);
  if (!edge) return { state, actions: [] };
  const ep = resolveEdgeEndpoints(edge);
  if (!ep) return { state, actions: [] };

  const points2D = vertices3D.map((v) => stage3DToDiagram2D(v, state.coordFrame));
  const resolveName = (nid: string) => state.nodes.find((n) => n.id === nid)?.properties?.name ?? nid;
  const nextEdges = state.edges.map((e) => (e.id === edgeId ? ({ ...e, vertices: points2D } as VrDiagramEdgeLike) : e));

  const actions: DiagramEditAction[] = [
    {
      type: "moveEdge",
      edges: [
        {
          id: edgeId,
          source: `${resolveName(ep.sourceNodeId)}.${ep.sourcePortId}`,
          target: `${resolveName(ep.targetNodeId)}.${ep.targetPortId}`,
          points: points2D,
        },
      ],
    },
  ];

  return {
    state: {
      ...state,
      edges: nextEdges,
      selectedEdgeId: edgeId,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions,
  };
}

/** Inserts a new 3D waypoint into an edge and emits `moveEdge`. */
export function commitAddEdgeWaypoint(
  state: SpatialDiagramState,
  edgeId: string,
  pos3D: readonly [number, number, number],
  insertIndex?: number,
): SpatialEditResult {
  const edge = state.edges.find((e) => e.id === edgeId);
  if (!edge) return { state, actions: [] };
  const existing2D = Array.isArray((edge as { vertices?: { x: number; y: number }[] }).vertices)
    ? ((edge as { vertices?: { x: number; y: number }[] }).vertices ?? [])
    : [];
  const existing3D: [number, number, number][] = existing2D.map((pt) =>
    diagram2DToStage3D(pt.x, pt.y, state.coordFrame, pos3D[2]),
  );
  const idx = insertIndex !== undefined ? Math.max(0, Math.min(existing3D.length, insertIndex)) : existing3D.length;
  const next3D = [
    ...existing3D.slice(0, idx),
    [pos3D[0], pos3D[1], pos3D[2]] as [number, number, number],
    ...existing3D.slice(idx),
  ];
  return commitMoveEdgeWaypoints(state, edgeId, next3D);
}

/** Removes a waypoint by index from an edge and emits `moveEdge`. */
export function commitRemoveEdgeWaypoint(
  state: SpatialDiagramState,
  edgeId: string,
  vertexIndex: number,
): SpatialEditResult {
  const edge = state.edges.find((e) => e.id === edgeId);
  if (!edge) return { state, actions: [] };
  const existing2D = Array.isArray((edge as { vertices?: { x: number; y: number }[] }).vertices)
    ? ((edge as { vertices?: { x: number; y: number }[] }).vertices ?? [])
    : [];
  if (vertexIndex < 0 || vertexIndex >= existing2D.length) return { state, actions: [] };
  const next3D = existing2D
    .filter((_, i) => i !== vertexIndex)
    .map((pt) => diagram2DToStage3D(pt.x, pt.y, state.coordFrame, 0));
  return commitMoveEdgeWaypoints(state, edgeId, next3D);
}

/* -------------------------------------------------------------------------- */
/*  2D Drafting Aids: Align, Distribute, Smart Guides, Nudge & Solder Dots    */
/* -------------------------------------------------------------------------- */

export type SpatialAlignmentMode =
  | "align-left"
  | "align-right"
  | "align-center"
  | "align-top"
  | "align-bottom"
  | "align-middle"
  | "distribute-horizontal"
  | "distribute-vertical";

/** Aligns or evenly distributes selected 3D nodes in stage X/Y space and emits a single batch `move`. */
export function commitAlignSpatialNodes(
  state: SpatialDiagramState,
  nodeIds: readonly string[],
  mode: SpatialAlignmentMode,
): SpatialEditResult {
  const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => Boolean(state.poses[id]));
  const minCount = mode.startsWith("distribute-") ? 3 : 2;
  if (uniqueIds.length < minCount) return { state, actions: [] };

  const entries = uniqueIds.map((id) => ({ id, pose: state.poses[id]! }));
  const updates: Record<string, SpatialNodePose3D> = {};

  switch (mode) {
    case "align-left": {
      const targetX = Math.min(...entries.map((e) => e.pose.position[0]));
      for (const e of entries)
        updates[e.id] = { ...e.pose, position: [targetX, e.pose.position[1], e.pose.position[2]] };
      break;
    }
    case "align-right": {
      const targetX = Math.max(...entries.map((e) => e.pose.position[0]));
      for (const e of entries)
        updates[e.id] = { ...e.pose, position: [targetX, e.pose.position[1], e.pose.position[2]] };
      break;
    }
    case "align-center": {
      const minX = Math.min(...entries.map((e) => e.pose.position[0]));
      const maxX = Math.max(...entries.map((e) => e.pose.position[0]));
      const midX = (minX + maxX) * 0.5;
      for (const e of entries) updates[e.id] = { ...e.pose, position: [midX, e.pose.position[1], e.pose.position[2]] };
      break;
    }
    case "align-top": {
      const targetY = Math.max(...entries.map((e) => e.pose.position[1]));
      for (const e of entries)
        updates[e.id] = { ...e.pose, position: [e.pose.position[0], targetY, e.pose.position[2]] };
      break;
    }
    case "align-bottom": {
      const targetY = Math.min(...entries.map((e) => e.pose.position[1]));
      for (const e of entries)
        updates[e.id] = { ...e.pose, position: [e.pose.position[0], targetY, e.pose.position[2]] };
      break;
    }
    case "align-middle": {
      const minY = Math.min(...entries.map((e) => e.pose.position[1]));
      const maxY = Math.max(...entries.map((e) => e.pose.position[1]));
      const midY = (minY + maxY) * 0.5;
      for (const e of entries) updates[e.id] = { ...e.pose, position: [e.pose.position[0], midY, e.pose.position[2]] };
      break;
    }
    case "distribute-horizontal": {
      const sorted = [...entries].sort((a, b) => a.pose.position[0] - b.pose.position[0]);
      const firstX = sorted[0]!.pose.position[0];
      const lastX = sorted[sorted.length - 1]!.pose.position[0];
      const step = (lastX - firstX) / (sorted.length - 1);
      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i]!;
        updates[e.id] = { ...e.pose, position: [firstX + step * i, e.pose.position[1], e.pose.position[2]] };
      }
      break;
    }
    case "distribute-vertical": {
      const sorted = [...entries].sort((a, b) => a.pose.position[1] - b.pose.position[1]);
      const firstY = sorted[0]!.pose.position[1];
      const lastY = sorted[sorted.length - 1]!.pose.position[1];
      const step = (lastY - firstY) / (sorted.length - 1);
      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i]!;
        updates[e.id] = { ...e.pose, position: [e.pose.position[0], firstY + step * i, e.pose.position[2]] };
      }
      break;
    }
  }

  return commitMoveSpatialNodes(state, updates);
}

/** Nudges selected 3D nodes by `(dx, dy, dz)` stage meters and emits a single batch `move`. */
export function commitNudgeSpatialNodes(
  state: SpatialDiagramState,
  nodeIds: readonly string[],
  dxMeters: number,
  dyMeters: number,
  dzMeters = 0,
): SpatialEditResult {
  const updates: Record<string, SpatialNodePose3D> = {};
  for (const id of nodeIds) {
    const pose = state.poses[id];
    if (!pose) continue;
    updates[id] = {
      ...pose,
      position: [pose.position[0] + dxMeters, pose.position[1] + dyMeters, pose.position[2] + dzMeters],
    };
  }
  return commitMoveSpatialNodes(state, updates);
}

export interface SpatialAlignmentGuide {
  readonly axis: "x" | "y";
  readonly coord: number;
  readonly min: number;
  readonly max: number;
  readonly z: number;
}

/**
 * Computes live magnetic smart-alignment guides while dragging a node in 3D space.
 * Snaps `candidatePos` onto matching X or Y centerlines of sibling nodes within `thresholdMeters`.
 */
export function computeSpatialSmartGuides(
  movingNodeId: string,
  candidatePos: readonly [number, number, number],
  poses: Readonly<Record<string, SpatialNodePose3D>>,
  thresholdMeters = 0.016,
  excludeIds?: ReadonlySet<string>,
): { readonly snappedPos: [number, number, number]; readonly guides: SpatialAlignmentGuide[] } {
  let bestDx = thresholdMeters;
  let snapX: number | null = null;
  let matchXPeer: SpatialNodePose3D | null = null;

  let bestDy = thresholdMeters;
  let snapY: number | null = null;
  let matchYPeer: SpatialNodePose3D | null = null;

  for (const [id, pose] of Object.entries(poses)) {
    if (id === movingNodeId || excludeIds?.has(id)) continue;
    const dx = Math.abs(pose.position[0] - candidatePos[0]);
    if (dx < bestDx) {
      bestDx = dx;
      snapX = pose.position[0];
      matchXPeer = pose;
    }
    const dy = Math.abs(pose.position[1] - candidatePos[1]);
    if (dy < bestDy) {
      bestDy = dy;
      snapY = pose.position[1];
      matchYPeer = pose;
    }
  }

  const finalX = snapX ?? candidatePos[0];
  const finalY = snapY ?? candidatePos[1];
  const guides: SpatialAlignmentGuide[] = [];

  if (snapX !== null && matchXPeer) {
    guides.push({
      axis: "x",
      coord: snapX,
      min: Math.min(finalY, matchXPeer.position[1]) - 0.08,
      max: Math.max(finalY, matchXPeer.position[1]) + 0.08,
      z: (candidatePos[2] + matchXPeer.position[2]) * 0.5,
    });
  }
  if (snapY !== null && matchYPeer) {
    guides.push({
      axis: "y",
      coord: snapY,
      min: Math.min(finalX, matchYPeer.position[0]) - 0.08,
      max: Math.max(finalX, matchYPeer.position[0]) + 0.08,
      z: (candidatePos[2] + matchYPeer.position[2]) * 0.5,
    });
  }

  return {
    snappedPos: [finalX, finalY, candidatePos[2]],
    guides,
  };
}

/** Counts incident edges per `"nodeId::portId"` so T-junctions (`count >= 3`) render 3D solder dots. */
export function computePortJunctionCounts(edges: readonly VrDiagramEdgeLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const ep = resolveEdgeEndpoints(e);
    if (!ep) continue;
    const kSrc = `${ep.sourceNodeId}::${ep.sourcePortId}`;
    const kTgt = `${ep.targetNodeId}::${ep.targetPortId}`;
    counts.set(kSrc, (counts.get(kSrc) ?? 0) + 1);
    counts.set(kTgt, (counts.get(kTgt) ?? 0) + 1);
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/*  Icon Layer Editor (`add/update/delete/reorderIconPrimitive`)              */
/* -------------------------------------------------------------------------- */

export type VrIconPrimitiveKind = "Rectangle" | "Ellipse" | "Line" | "Polygon" | "Text";

function buildDefaultIconPrimitive(kind: VrIconPrimitiveKind): Record<string, unknown> {
  switch (kind) {
    case "Rectangle":
      return {
        type: "Rectangle",
        extent: [
          [-50, -35],
          [50, 35],
        ],
        lineColor: [37, 99, 235],
        fillColor: [219, 234, 254],
        fillPattern: "FillPattern.Solid",
        lineThickness: 0.5,
      };
    case "Ellipse":
      return {
        type: "Ellipse",
        extent: [
          [-40, -40],
          [40, 40],
        ],
        lineColor: [13, 148, 136],
        fillColor: [204, 251, 241],
        fillPattern: "FillPattern.Solid",
        lineThickness: 0.5,
      };
    case "Line":
      return {
        type: "Line",
        points: [
          [-60, 0],
          [60, 0],
        ],
        color: [37, 99, 235],
        thickness: 0.5,
      };
    case "Polygon":
      return {
        type: "Polygon",
        points: [
          [0, 45],
          [-45, -35],
          [45, -35],
        ],
        lineColor: [217, 119, 6],
        fillColor: [254, 243, 199],
        fillPattern: "FillPattern.Solid",
        lineThickness: 0.5,
      };
    case "Text":
      return {
        type: "Text",
        extent: [
          [-60, -20],
          [60, 20],
        ],
        textString: "%name",
        lineColor: [15, 23, 42],
      };
  }
}

function buildIconPrimitiveSvg(kind: VrIconPrimitiveKind): string {
  const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56" fill="none"';
  switch (kind) {
    case "Rectangle":
      return `<svg ${S}><rect x="12" y="10" width="56" height="36" rx="2" stroke="#2563eb" stroke-width="2.4" fill="rgba(59,130,246,0.18)"/></svg>`;
    case "Ellipse":
      return `<svg ${S}><ellipse cx="40" cy="28" rx="26" ry="20" stroke="#0d9488" stroke-width="2.4" fill="rgba(13,148,136,0.18)"/></svg>`;
    case "Line":
      return `<svg ${S}><line x1="8" y1="28" x2="72" y2="28" stroke="#2563eb" stroke-width="3"/></svg>`;
    case "Polygon":
      return `<svg ${S}><polygon points="40,8 12,48 68,48" stroke="#d97706" stroke-width="2.4" fill="rgba(245,158,11,0.18)"/></svg>`;
    case "Text":
      return `<svg ${S}><rect x="10" y="14" width="60" height="28" rx="4" stroke="#64748b" stroke-dasharray="4 3" stroke-width="1.6"/><text x="40" y="33" text-anchor="middle" fill="#f8fafc" font-size="14" font-family="monospace">%name</text></svg>`;
  }
}

/** Adds an Icon layer graphic primitive and emits `{ type: "addIconPrimitive" }`. */
export function commitAddIconPrimitive(
  state: SpatialDiagramState,
  kind: VrIconPrimitiveKind,
  overrides?: Record<string, unknown>,
): SpatialEditResult & { readonly primitiveIndex: number } {
  const existingIconNodes = state.nodes.filter((n) => String(n.id ?? "").startsWith("__icon_gfx_"));
  const primitiveIndex = existingIconNodes.length;
  const primitive = { ...buildDefaultIconPrimitive(kind), ...(overrides ?? {}) };
  const nodeId = `__icon_gfx_${primitiveIndex}`;
  const offset = primitiveIndex * 0.04;
  const pose: SpatialNodePose3D = {
    position: [offset, -offset * 0.5, 0.01 * primitiveIndex],
    quaternion: [0, 0, 0, 1],
    scale: 1,
    domainLayer: 1,
  };
  const center2D = stage3DToDiagram2D(pose.position, state.coordFrame);
  const newNode: VrDiagramNodeLike = {
    id: nodeId,
    shape: "svg-component",
    x: center2D.x - 40,
    y: center2D.y - 28,
    width: 80,
    height: 56,
    label: `${kind} #${primitiveIndex + 1}`,
    properties: { name: nodeId, className: `Icon.${kind}` },
    data: { iconSvg: buildIconPrimitiveSvg(kind), primitive, primitiveIndex },
    ports: { items: [] },
  };

  return {
    primitiveIndex,
    state: {
      ...state,
      nodes: [...state.nodes, newNode],
      poses: { ...state.poses, [nodeId]: pose },
      selectedNodeIds: [nodeId],
      selectedEdgeId: null,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "addIconPrimitive", primitive }],
  };
}

/** Updates an Icon layer graphic primitive by index and emits `{ type: "updateIconPrimitive" }`. */
export function commitUpdateIconPrimitive(
  state: SpatialDiagramState,
  index: number,
  patch: Record<string, unknown>,
): SpatialEditResult {
  const nextNodes = state.nodes.map((n) => {
    const pIdx = (n.data as { primitiveIndex?: number } | undefined)?.primitiveIndex;
    if (String(n.id ?? "").startsWith("__icon_gfx_") && pIdx === index) {
      const prevPrim = ((n.data as { primitive?: Record<string, unknown> } | undefined)?.primitive ?? {}) as Record<
        string,
        unknown
      >;
      return { ...n, data: { ...(n.data ?? {}), primitive: { ...prevPrim, ...patch } } };
    }
    return n;
  });

  return {
    state: {
      ...state,
      nodes: nextNodes,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "updateIconPrimitive", index, patch }],
  };
}

/** Deletes an Icon layer graphic primitive by index and emits `{ type: "deleteIconPrimitive" }`. */
export function commitDeleteIconPrimitive(state: SpatialDiagramState, index: number): SpatialEditResult {
  const target = state.nodes.find(
    (n) =>
      String(n.id ?? "").startsWith("__icon_gfx_") &&
      (n.data as { primitiveIndex?: number } | undefined)?.primitiveIndex === index,
  );
  const nextNodes = state.nodes
    .filter((n) => n !== target)
    .map((n) => {
      const pIdx = (n.data as { primitiveIndex?: number } | undefined)?.primitiveIndex;
      if (String(n.id ?? "").startsWith("__icon_gfx_") && typeof pIdx === "number" && pIdx > index) {
        return { ...n, data: { ...(n.data ?? {}), primitiveIndex: pIdx - 1 } };
      }
      return n;
    });
  const nextPoses = target?.id
    ? Object.fromEntries(Object.entries(state.poses).filter(([k]) => k !== target.id))
    : { ...state.poses };

  return {
    state: {
      ...state,
      nodes: nextNodes,
      poses: nextPoses,
      selectedNodeIds: target?.id ? state.selectedNodeIds.filter((id) => id !== target.id) : state.selectedNodeIds,
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "deleteIconPrimitive", index }],
  };
}

/** Reorders an Icon layer graphic primitive z-order and emits `{ type: "reorderIconPrimitive" }`. */
export function commitReorderIconPrimitive(
  state: SpatialDiagramState,
  fromIndex: number,
  toIndex: number,
): SpatialEditResult {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return { state, actions: [] };
  const iconNodes = state.nodes.filter((n) => String(n.id ?? "").startsWith("__icon_gfx_"));
  const otherNodes = state.nodes.filter((n) => !String(n.id ?? "").startsWith("__icon_gfx_"));
  if (fromIndex >= iconNodes.length || toIndex >= iconNodes.length) return { state, actions: [] };

  const reordered = [...iconNodes];
  const [moved] = reordered.splice(fromIndex, 1);
  if (!moved) return { state, actions: [] };
  reordered.splice(toIndex, 0, moved);

  const reindexed = reordered.map((n, idx) => ({
    ...n,
    data: { ...(n.data ?? {}), primitiveIndex: idx },
  }));

  return {
    state: {
      ...state,
      nodes: [...otherNodes, ...reindexed],
      undoStack: pushUndo(state),
      redoStack: [],
    },
    actions: [{ type: "reorderIconPrimitive", fromIndex, toIndex }],
  };
}

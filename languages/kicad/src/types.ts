// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Semantic AST & ECAD Data Types.
 */

export interface SourceSpan {
  startOffset: number;
  endOffset: number;
}

export type SExprNode = SExprList | SExprAtom;

export interface SExprList {
  kind: "list";
  head: string;
  items: SExprNode[];
  span: SourceSpan;
}

export interface SExprAtom {
  kind: "atom";
  value: string;
  quoted: boolean;
  span: SourceSpan;
}

export type KiCadDocumentKind = "kicad_pcb" | "kicad_sch" | "kicad_symbol_lib" | "footprint" | "unknown";

export interface KiCadNet {
  id: number;
  name: string;
  span?: SourceSpan;
}

export interface KiCadLayerDef {
  id: number;
  name: string;
  type: string;
  userName?: string;
}

export interface KiCadStackupLayer {
  name: string;
  type: string;
  thicknessMm?: number;
  material?: string;
  dielectricConstant?: number;
  lossTangent?: number;
}

export interface KiCadPad {
  number: string;
  padType: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  /** Local pad position relative to footprint origin (mm). */
  at: [number, number];
  /** Global board position after footprint translation + rotation (mm). */
  boardPos: [number, number];
  rotation: number;
  size: [number, number];
  drill: number;
  layers: string[];
  netId: number;
  netName: string;
}

export interface KiCadFootprint {
  libId: string;
  refDes: string;
  value: string;
  mpn?: string;
  dnp?: boolean;
  layer: string;
  at: [number, number];
  rotation: number;
  pads: KiCadPad[];
  span?: SourceSpan;
}

export interface KiCadSegment {
  start: [number, number];
  end: [number, number];
  width: number;
  layer: string;
  netId: number;
  netName: string;
  span?: SourceSpan;
}

export interface KiCadArc {
  start: [number, number];
  mid: [number, number];
  end: [number, number];
  width: number;
  layer: string;
  netId: number;
  netName: string;
  span?: SourceSpan;
}

export interface KiCadVia {
  at: [number, number];
  size: number;
  drill: number;
  layers: string[];
  netId: number;
  netName: string;
  span?: SourceSpan;
}

export interface KiCadZone {
  netId: number;
  netName: string;
  layer: string;
  clearance?: number;
  vertices: [number, number][];
  span?: SourceSpan;
}

export interface KiCadBoard {
  kind: "kicad_pcb";
  version: string;
  generator: string;
  layers: KiCadLayerDef[];
  stackup: KiCadStackupLayer[];
  nets: KiCadNet[];
  footprints: KiCadFootprint[];
  segments: KiCadSegment[];
  arcs: KiCadArc[];
  vias: KiCadVia[];
  zones: KiCadZone[];
  outline: [number, number][];
  diagnostics: KiCadDiagnostic[];
}

export type KiCadPinElectricalType =
  | "input"
  | "output"
  | "bidirectional"
  | "tri_state"
  | "passive"
  | "free"
  | "unspecified"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "no_connect";

export interface KiCadLibPin {
  number: string;
  name: string;
  electricalType: KiCadPinElectricalType;
  /** Pin tip position in symbol-library coordinates (Y-up, mm). */
  at: [number, number];
  rotation: number;
}

export interface KiCadLibSymbol {
  libId: string;
  isPower: boolean;
  pins: KiCadLibPin[];
}

export interface KiCadSymbolPinInstance {
  number: string;
  name: string;
  electricalType: KiCadPinElectricalType;
  /** Resolved schematic sheet position (Y-down, mm). */
  sheetPos: [number, number];
}

export interface KiCadSymbolInstance {
  libId: string;
  refDes: string;
  value: string;
  footprint?: string;
  simDevice?: string;
  simParams?: string;
  at: [number, number];
  rotation: number;
  mirror?: "x" | "y";
  pins: KiCadSymbolPinInstance[];
  span?: SourceSpan;
}

export interface KiCadWire {
  start: [number, number];
  end: [number, number];
}

export interface KiCadJunction {
  at: [number, number];
}

export interface KiCadNoConnect {
  at: [number, number];
}

export interface KiCadLabel {
  kind: "label" | "global_label" | "hierarchical_label";
  name: string;
  at: [number, number];
}

export interface KiCadSchematic {
  kind: "kicad_sch";
  version: string;
  generator: string;
  libSymbols: Record<string, KiCadLibSymbol>;
  symbols: KiCadSymbolInstance[];
  wires: KiCadWire[];
  junctions: KiCadJunction[];
  noConnects: KiCadNoConnect[];
  labels: KiCadLabel[];
  diagnostics: KiCadDiagnostic[];
}

export interface KiCadDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  span?: SourceSpan;
}

export type KiCadDocument =
  | KiCadBoard
  | KiCadSchematic
  | { kind: "kicad_symbol_lib" | "footprint" | "unknown"; root: SExprList | null; diagnostics: KiCadDiagnostic[] };

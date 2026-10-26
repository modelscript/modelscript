// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Strongly Typed AST & Domain Schema for US EPA Storm Water Management Model (SWMM 5.x) Networks.
 */

export interface SwmmRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type SwmmFlowUnits = "CFS" | "GPM" | "MGD" | "CMS" | "LPS" | "MLD";
export type SwmmRoutingModel = "STEADY" | "KINWAVE" | "DYNWAVE";

export interface SwmmJunction {
  id: string;
  elevation: number; // Invert elevation [m or ft]
  maxDepth: number; // Maximum depth [m or ft]
  initDepth?: number | undefined;
  surDepth?: number | undefined; // Surcharge depth
  aPond?: number | undefined; // Ponded surface area
  range: SwmmRange;
}

export interface SwmmOutfall {
  id: string;
  elevation: number;
  type: "FREE" | "NORMAL" | "FIXED" | "TIDAL";
  stage?: number | undefined;
  tseries?: string | undefined;
  gated?: boolean | undefined;
  range: SwmmRange;
}

export interface SwmmStorage {
  id: string;
  elevation: number;
  maxDepth: number;
  initDepth?: number | undefined;
  shape: string; // 'TABULAR' | 'FUNCTIONAL' | 'CYLINDRICAL'
  range: SwmmRange;
}

export interface SwmmConduit {
  id: string;
  inletNode: string;
  outletNode: string;
  length: number; // Length [m or ft]
  roughness: number; // Manning's n
  inOffset?: number | undefined;
  outOffset?: number | undefined;
  initFlow?: number | undefined;
  maxFlow?: number | undefined;
  range: SwmmRange;
}

export interface SwmmPump {
  id: string;
  inletNode: string;
  outletNode: string;
  pumpCurve?: string | undefined;
  initStatus?: "ON" | "OFF" | undefined;
  startupDepth?: number | undefined;
  shutoffDepth?: number | undefined;
  range: SwmmRange;
}

export interface SwmmOrifice {
  id: string;
  inletNode: string;
  outletNode: string;
  type: "SIDE" | "BOTTOM";
  offset: number;
  dischargeCoeff: number;
  range: SwmmRange;
}

export interface SwmmWeir {
  id: string;
  inletNode: string;
  outletNode: string;
  type: "TRANSVERSE" | "SIDEFLOW" | "V-NOTCH" | "TRAPEZOIDAL";
  offset: number;
  dischargeCoeff: number;
  range: SwmmRange;
}

export interface SwmmCrossSection {
  linkId: string;
  shape: "CIRCULAR" | "RECT_CLOSED" | "RECT_OPEN" | "TRAPEZOIDAL" | "TRIANGULAR" | "PARABOLIC" | "CUSTOM";
  geom1: number; // Max depth or diameter
  geom2?: number | undefined; // Bottom width
  geom3?: number | undefined; // Side slope
  geom4?: number | undefined; // Side slope
  barrels?: number | undefined;
  range: SwmmRange;
}

export interface SwmmSubcatchment {
  id: string;
  rainGage?: string | undefined;
  outlet: string; // Outlet node or other subcatchment
  area: number; // Catchment area [ha or ac]
  impervPct: number; // Percent impervious [%]
  width: number; // Characteristic overland flow width [m or ft]
  slopePct: number; // Surface slope [%]
  range: SwmmRange;
}

export interface SwmmDeck {
  title?: string | undefined;
  flowUnits: SwmmFlowUnits;
  routingModel: SwmmRoutingModel;
  options: Record<string, string | number>;
  junctions: Map<string, SwmmJunction>;
  outfalls: Map<string, SwmmOutfall>;
  storage: Map<string, SwmmStorage>;
  conduits: Map<string, SwmmConduit>;
  pumps: Map<string, SwmmPump>;
  orifices: Map<string, SwmmOrifice>;
  weirs: Map<string, SwmmWeir>;
  crossSections: Map<string, SwmmCrossSection>;
  subcatchments: Map<string, SwmmSubcatchment>;
  range?: SwmmRange | undefined;
}

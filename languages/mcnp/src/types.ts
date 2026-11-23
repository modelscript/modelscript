// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Core Data Model & AST Types for MCNP 3-Block Transport Decks.
 */

export type McnpParticleType = "N" | "P" | "E";

export type McnpSurfaceType =
  | "P"
  | "PX"
  | "PY"
  | "PZ"
  | "SO"
  | "S"
  | "SX"
  | "SY"
  | "SZ"
  | "C/X"
  | "C/Y"
  | "C/Z"
  | "CX"
  | "CY"
  | "CZ"
  | "K/X"
  | "K/Y"
  | "K/Z"
  | "KX"
  | "KY"
  | "KZ"
  | "GQ"
  | "RPP"
  | "RCC"
  | "SPH";

export type McnpSurfaceBoundary = "*" | "+";

export type McnpTallyType = 1 | 2 | 4 | 5 | 6 | 8;

export type McnpCsgExpr =
  | {
      kind: "surface";
      id: number;
      sense: 1 | -1;
    }
  | {
      kind: "complement";
      cellId?: number | undefined;
      expr?: McnpCsgExpr | undefined;
    }
  | {
      kind: "union";
      operands: McnpCsgExpr[];
    }
  | {
      kind: "intersection";
      operands: McnpCsgExpr[];
    };

export interface McnpCellCard {
  id: number;
  materialId: number;
  /** Signed density: negative = mass density (g/cm^3), positive = atom density (atoms/barn-cm). */
  density?: number | undefined;
  csg: McnpCsgExpr | null;
  csgRaw: string;
  imp: Record<string, number>;
  vol?: number | undefined;
  u?: number | undefined;
  fill?: number | undefined;
  tmp?: number | undefined;
  trcl?: number | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
  comment?: string | undefined;
}

export interface McnpSurfaceCard {
  id: number;
  boundary?: McnpSurfaceBoundary | undefined;
  transformId?: number | undefined;
  type: McnpSurfaceType;
  params: number[];
  line: number;
  startOffset: number;
  endOffset: number;
  comment?: string | undefined;
}

export interface McnpIsotopeEntry {
  zaid: string;
  /** Numeric ZZZAAA identifier (e.g. 92235). */
  zaidNum: number;
  /** Optional cross-section library suffix (e.g. "80c"). */
  library?: string | undefined;
  /** Positive = atom fraction, negative = weight fraction. */
  fraction: number;
}

export interface McnpMaterialCard {
  id: number;
  isotopes: McnpIsotopeEntry[];
  thermalLaw?: string | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
  comment?: string | undefined;
}

export interface McnpSdefCard {
  pos?: [number, number, number] | undefined;
  vec?: [number, number, number] | undefined;
  dir?: number | undefined;
  erg?: number | undefined;
  par?: string | undefined;
  rad?: number | undefined;
  cel?: number | undefined;
  raw: string;
  line: number;
}

export interface McnpKcodeCard {
  /** Number of source histories per cycle. */
  nsrck: number;
  /** Initial guess for k_eff. */
  rkk: number;
  /** Number of inactive cycles to skip. */
  ikz: number;
  /** Total number of cycles. */
  kct: number;
  line: number;
}

export interface McnpSourceSpec {
  sdef?: McnpSdefCard | undefined;
  kcode?: McnpKcodeCard | undefined;
  ksrc: Array<[number, number, number]>;
}

export interface McnpTallyCard {
  id: number;
  type: McnpTallyType;
  particle: string;
  /** Cell IDs (F4/F6/F8) or surface IDs (F1/F2). */
  targets: number[];
  /** Point detector (x, y, z, R0) for F5. */
  point?: [number, number, number, number] | undefined;
  energyBins?: number[] | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface McnpPhysCard {
  particle: string;
  params: number[];
  line: number;
}

export interface McnpDuplicateEntry {
  id: number;
  line: number;
}

export interface McnpParseError {
  line: number;
  column: number;
  message: string;
}

export interface McnpDeck {
  title: string;
  cells: Map<number, McnpCellCard>;
  surfaces: Map<number, McnpSurfaceCard>;
  materials: Map<number, McnpMaterialCard>;
  tallies: Map<number, McnpTallyCard>;
  mode: McnpParticleType[];
  source: McnpSourceSpec;
  nps?: number | undefined;
  npsLine?: number | undefined;
  phys: McnpPhysCard[];
  comments: Array<{ line: number; text: string }>;
  parseErrors: McnpParseError[];
  duplicateCellIds: McnpDuplicateEntry[];
  duplicateSurfaceIds: McnpDuplicateEntry[];
  duplicateMaterialIds: McnpDuplicateEntry[];
}

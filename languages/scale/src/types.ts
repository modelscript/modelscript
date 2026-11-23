// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Core Type Definitions for ORNL SCALE / KENO V.a-VI / ORIGEN Decks.
 */

export interface ScaleRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export type ScaleSequenceType =
  "csas6" | "csas5" | "csas25" | "csas26" | "origen" | "t-depl" | "t5-depl" | "t6-depl" | "triton" | "unknown";

export const KNOWN_SCALE_SEQUENCES: ReadonlySet<string> = new Set([
  "csas6",
  "csas5",
  "csas25",
  "csas26",
  "origen",
  "t-depl",
  "t5-depl",
  "t6-depl",
  "triton",
  "arp",
  "keno-va",
  "keno-vi",
  "mavric",
  "monaco",
]);

export interface ScaleCompositionEntry {
  materialName: string;
  mixtureId: number;
  density?: number | undefined;
  volumeFraction?: number | undefined;
  temperature?: number | undefined;
  enrichment?: number | undefined;
  isotopes: Record<string, number>;
  rawLine?: string | undefined;
  range?: ScaleRange | undefined;
}

export interface ScaleCellDataEntry {
  cellType: string;
  parameters: Record<string, number | string>;
  rawLine: string;
  range?: ScaleRange | undefined;
}

export interface ScaleParamBlock {
  parameters: Record<string, number | string>;
  range?: ScaleRange | undefined;
}

export interface ScaleBoundsBlock {
  all?: string | undefined;
  xMinus?: string | undefined;
  xPlus?: string | undefined;
  yMinus?: string | undefined;
  yPlus?: string | undefined;
  zMinus?: string | undefined;
  zPlus?: string | undefined;
  rawEntries: Record<string, string>;
  range?: ScaleRange | undefined;
}

export type KenoBodyKind = "cylinder" | "sphere" | "cuboid" | "hexprism";

export interface KenoGeometryBody {
  id: number;
  kind: KenoBodyKind;
  /** Cylinder: radius; Sphere: radius; Hexprism: flat-to-flat half-width (apothem) */
  radius?: number | undefined;
  /** Cylinder/Hexprism: zMax (+Z); Cuboid: xMax */
  xPlus?: number | undefined;
  xMinus?: number | undefined;
  yPlus?: number | undefined;
  yMinus?: number | undefined;
  zPlus?: number | undefined;
  zMinus?: number | undefined;
  /** Optional center/origin shift [x, y, z] in cm */
  origin?: [number, number, number] | undefined;
  rawLine?: string | undefined;
  range?: ScaleRange | undefined;
}

export interface KenoMediaRecord {
  mixtureId: number;
  volumeFraction: number;
  /** Signed region body references: positive = inside body, negative = outside body */
  regions: number[];
  rawLine?: string | undefined;
  range?: ScaleRange | undefined;
}

export interface KenoHoleRecord {
  unitId: number;
  origin: [number, number, number];
  range?: ScaleRange | undefined;
}

export interface KenoArrayPlacement {
  arrayId: number;
  regionId: number;
  origin?: [number, number, number] | undefined;
  range?: ScaleRange | undefined;
}

export interface KenoUnit {
  id: number;
  isGlobal: boolean;
  comment?: string | undefined;
  bodies: KenoGeometryBody[];
  media: KenoMediaRecord[];
  holes: KenoHoleRecord[];
  arrayPlacements: KenoArrayPlacement[];
  boundaryBodyId?: number | undefined;
  range?: ScaleRange | undefined;
}

export interface KenoArrayDef {
  id: number;
  araType?: string | undefined;
  nux: number;
  nuy: number;
  nuz: number;
  fill: number[];
  range?: ScaleRange | undefined;
}

export interface OrigenTimeSpec {
  unit: "seconds" | "minutes" | "hours" | "days" | "years";
  values: number[];
  /** Converted to seconds */
  valuesSeconds: number[];
  range?: ScaleRange | undefined;
}

export interface OrigenMaterialNuclide {
  /** Normalized nuclide ID, e.g. "U-235", "I-135", "Xe-135" */
  nuclide: string;
  /** Initial quantity (atoms, moles, or grams depending on unit) */
  amount: number;
  unit: "atoms" | "moles" | "grams" | "kg";
  range?: ScaleRange | undefined;
}

export interface OrigenCase {
  id: string;
  library?: string | undefined;
  nuclides: OrigenMaterialNuclide[];
  time?: OrigenTimeSpec | undefined;
  /** Specific power per step (MW/MTU or W) */
  power: number[];
  /** Neutron flux per step (n / (cm^2 * s)) */
  flux: number[];
  save: boolean;
  range?: ScaleRange | undefined;
}

export interface ScaleReadBlockRecord {
  kind: string;
  closed: boolean;
  range: ScaleRange;
}

export interface ScaleDeck {
  uri?: string | undefined;
  sequence: string;
  sequenceType: ScaleSequenceType;
  title: string;
  crossSectionLib?: string | undefined;
  compositions: ScaleCompositionEntry[];
  cellData: ScaleCellDataEntry[];
  params: ScaleParamBlock;
  bounds?: ScaleBoundsBlock | undefined;
  units: Map<number, KenoUnit>;
  duplicateUnitIds: Array<{ id: number; range?: ScaleRange | undefined }>;
  arrays: Map<number, KenoArrayDef>;
  duplicateArrayIds: Array<{ id: number; range?: ScaleRange | undefined }>;
  origenCases: OrigenCase[];
  readBlocks: ScaleReadBlockRecord[];
  syntaxErrors: Array<{ message: string; range?: ScaleRange | undefined }>;
}

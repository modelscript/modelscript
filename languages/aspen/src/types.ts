// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — Strongly Typed AST and Data Structures for Aspen Plus Chemical Process Flowsheets.
 */

export interface SourceLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type AspenBlockType =
  | "FLASH2"
  | "FLASH3"
  | "RADFRAC"
  | "HEATX"
  | "HEATER"
  | "PUMP"
  | "COMPR"
  | "VALVE"
  | "RCSTR"
  | "RSTOIC"
  | "MIXER"
  | "FSPLIT"
  | "CUSTOM";

export interface AspenComponent {
  id: string;
  formula?: string | undefined;
  name?: string | undefined;
  loc: SourceLocation;
}

export interface AspenFlowsheetEntry {
  blockId: string;
  inlets: string[];
  outlets: string[];
  loc: SourceLocation;
}

export interface AspenStream {
  id: string;
  temperature?: number | undefined; // Celsius (default in MET) or K
  pressure?: number | undefined; // bar or atm
  moleFlow?: number | undefined; // kmol/hr
  massFlow?: number | undefined; // kg/hr
  moleFractions: Map<string, number>;
  loc: SourceLocation;
}

export interface AspenRadFracFeed {
  stream: string;
  stage: number;
}

export interface AspenRadFracProduct {
  stream: string;
  stage: number;
  phase: "L" | "V";
}

export interface AspenBlock {
  id: string;
  type: AspenBlockType;
  params: Record<string, number | string>;
  nStages?: number | undefined;
  feedStages?: AspenRadFracFeed[] | undefined;
  products?: AspenRadFracProduct[] | undefined;
  colSpecs?: Record<string, number> | undefined;
  loc: SourceLocation;
}

export interface AspenDeck {
  title?: string | undefined;
  units?: string | undefined; // 'MET' | 'ENG' | 'SI'
  components: Map<string, AspenComponent>;
  duplicateComponents?: AspenComponent[] | undefined;
  propertyMethod?: string | undefined; // e.g. 'NRTL', 'UNIQUAC', 'PENG-ROB', 'SRK', 'IDEAL'
  flowsheet: AspenFlowsheetEntry[];
  streams: Map<string, AspenStream>;
  blocks: Map<string, AspenBlock>;
  loc?: SourceLocation | undefined;
}

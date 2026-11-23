// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST and semantic types for Caltech Intermediate Form 2.0 (CIF, 1979).
 *
 * Per Mead & Conway (1980), CIF coordinates are integers in centimicrons
 * (100 CIF units = 1 µm) scaled by symbol definition factors `a / b`.
 */

export interface CifPoint {
  x: number;
  y: number;
}

export interface CifSourceSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export type CifTransform =
  { kind: "T"; x: number; y: number } | { kind: "MX" } | { kind: "MY" } | { kind: "R"; x: number; y: number };

export interface CifBoxCommand extends CifSourceSpan {
  kind: "B";
  length: number;
  width: number;
  center: CifPoint;
  direction?: CifPoint;
}

export interface CifPolygonCommand extends CifSourceSpan {
  kind: "P";
  points: CifPoint[];
}

export interface CifRoundflashCommand extends CifSourceSpan {
  kind: "R";
  diameter: number;
  center: CifPoint;
}

export interface CifWireCommand extends CifSourceSpan {
  kind: "W";
  width: number;
  points: CifPoint[];
}

export interface CifLayerCommand extends CifSourceSpan {
  kind: "L";
  layer: string;
}

export interface CifCallCommand extends CifSourceSpan {
  kind: "C";
  symbolId: number;
  transforms: CifTransform[];
}

export interface CifDefStartCommand extends CifSourceSpan {
  kind: "DS";
  symbolId: number;
  a: number;
  b: number;
}

export interface CifDefFinishCommand extends CifSourceSpan {
  kind: "DF";
}

export interface CifDefDeleteCommand extends CifSourceSpan {
  kind: "DD";
  symbolId: number;
}

export interface CifUserExtensionCommand extends CifSourceSpan {
  kind: "User";
  digit: number;
  text: string;
}

export interface CifCommentCommand extends CifSourceSpan {
  kind: "Comment";
  text: string;
}

export interface CifEndCommand extends CifSourceSpan {
  kind: "E";
}

export type CifCommand =
  | CifBoxCommand
  | CifPolygonCommand
  | CifRoundflashCommand
  | CifWireCommand
  | CifLayerCommand
  | CifCallCommand
  | CifDefStartCommand
  | CifDefFinishCommand
  | CifDefDeleteCommand
  | CifUserExtensionCommand
  | CifCommentCommand
  | CifEndCommand;

export interface CifSymbolDef {
  id: number;
  name?: string;
  scaleA: number;
  scaleB: number;
  commands: CifCommand[];
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  closed: boolean;
}

export interface CifParseError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface CifDocument {
  symbols: Map<number, CifSymbolDef>;
  symbolOrder: number[];
  duplicateSymbolIds: Array<{ id: number; line: number; column: number }>;
  unmatchedDefFinishes: Array<{ line: number; column: number }>;
  nestedDefStarts: Array<{ id: number; parentId: number; line: number; column: number }>;
  topLevelCommands: CifCommand[];
  allCommands: CifCommand[];
  hasEndCommand: boolean;
  parseErrors: CifParseError[];
  rawLength: number;
}

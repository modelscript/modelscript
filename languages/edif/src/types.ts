// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for EDIF 2.0.0 (Electronic Design Interchange Format).
 */

export interface EdifSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}

export interface EdifNameRef {
  name: string;
  originalName?: string | undefined;
  span?: EdifSpan | undefined;
}

export type EdifPropertyValue =
  | { kind: "string"; value: string }
  | { kind: "integer"; value: number }
  | { kind: "number"; value: number; mantissa?: number | undefined; exponent?: number | undefined }
  | { kind: "boolean"; value: boolean }
  | { kind: "identifier"; value: string };

export interface EdifProperty {
  name: string;
  originalName?: string | undefined;
  value: EdifPropertyValue;
  owner?: string | undefined;
  unit?: string | undefined;
  span?: EdifSpan | undefined;
}

export type EdifPortDirection = "INPUT" | "OUTPUT" | "INOUT" | string;

export interface EdifPort {
  name: string;
  originalName?: string | undefined;
  direction?: EdifPortDirection | undefined;
  width?: number | undefined;
  properties: EdifProperty[];
  span?: EdifSpan | undefined;
}

export interface EdifViewRef {
  viewName: string;
  cellName?: string | undefined;
  libraryName?: string | undefined;
  span?: EdifSpan | undefined;
}

export interface EdifInstance {
  name: string;
  originalName?: string | undefined;
  viewRef: EdifViewRef;
  properties: EdifProperty[];
  designator?: string | undefined;
  span?: EdifSpan | undefined;
}

export interface EdifPortRef {
  portName: string;
  memberIndex?: number | undefined;
  instanceName?: string | undefined;
  span?: EdifSpan | undefined;
}

export interface EdifNet {
  name: string;
  originalName?: string | undefined;
  joined: EdifPortRef[];
  properties: EdifProperty[];
  span?: EdifSpan | undefined;
}

export interface EdifView {
  name: string;
  originalName?: string | undefined;
  viewType: string;
  ports: EdifPort[];
  instances: EdifInstance[];
  nets: EdifNet[];
  properties: EdifProperty[];
  hasContents: boolean;
  span?: EdifSpan | undefined;
}

export interface EdifCell {
  name: string;
  originalName?: string | undefined;
  cellType: string;
  views: EdifView[];
  properties: EdifProperty[];
  span?: EdifSpan | undefined;
}

export interface EdifLibrary {
  name: string;
  originalName?: string | undefined;
  isExternal: boolean;
  edifLevel?: number | undefined;
  technology?: Record<string, unknown> | undefined;
  cells: EdifCell[];
  properties: EdifProperty[];
  span?: EdifSpan | undefined;
}

export interface EdifDesign {
  name: string;
  originalName?: string | undefined;
  cellName: string;
  libraryName?: string | undefined;
  viewName?: string | undefined;
  properties: EdifProperty[];
  span?: EdifSpan | undefined;
}

export interface EdifStatus {
  written?: {
    timeStamp?: number[] | undefined;
    author?: string | undefined;
    program?: string | undefined;
    programVersion?: string | undefined;
    comment?: string | undefined;
  };
  span?: EdifSpan | undefined;
}

export interface EdifSyntaxError {
  message: string;
  span: EdifSpan;
}

export interface EdifDocument {
  name: string;
  originalName?: string | undefined;
  edifVersion?: [number, number, number] | number[] | undefined;
  edifVersionSpan?: EdifSpan | undefined;
  edifLevel?: number | undefined;
  edifLevelSpan?: EdifSpan | undefined;
  keywordLevel?: number | undefined;
  status?: EdifStatus | undefined;
  externals: EdifLibrary[];
  libraries: EdifLibrary[];
  design?: EdifDesign | undefined;
  properties: EdifProperty[];
  syntaxErrors: EdifSyntaxError[];
  span?: EdifSpan | undefined;
}

/**
 * Flattened netlist representation produced by `flattenEdifNetlist`.
 */
export interface FlattenedEdifPin {
  instanceName?: string | undefined;
  portName: string;
  direction?: EdifPortDirection | undefined;
}

export interface FlattenedEdifInstance {
  name: string;
  cellType: string;
  cellName: string;
  libraryName: string;
  viewName: string;
  /** Maps local port name (uppercased or original) to global flattened net name. */
  portToNet: Record<string, string>;
  /** Numeric and string properties resolved on this leaf instance. */
  properties: Record<string, number | string | boolean>;
}

export interface FlattenedEdifNet {
  name: string;
  pins: FlattenedEdifPin[];
  isTopPort: boolean;
  topPortName?: string | undefined;
  topPortDirection?: EdifPortDirection | undefined;
}

export interface FlattenedEdifNetlist {
  designName: string;
  topCellName: string;
  topLibraryName: string;
  topPorts: EdifPort[];
  instances: FlattenedEdifInstance[];
  nets: FlattenedEdifNet[];
}

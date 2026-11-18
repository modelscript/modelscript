// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — Core AST & Domain Types for GridLAB-D (.glm) Models.
 */

export interface GlmSourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface GlmDirective {
  kind: "set" | "define" | "include" | "global";
  name: string;
  value: string;
  span: GlmSourceSpan;
}

export interface GlmClock {
  timezone?: string | undefined;
  starttime?: string | undefined;
  stoptime?: string | undefined;
  timestamp?: string | undefined;
  properties: Record<string, string>;
  span: GlmSourceSpan;
}

export interface GlmModule {
  name: string;
  properties: Record<string, string>;
  span: GlmSourceSpan;
}

export interface GlmSchedule {
  name: string;
  body: string;
  span: GlmSourceSpan;
}

export interface GlmClassField {
  type: string;
  name: string;
  unit?: string | undefined;
}

export interface GlmClassDef {
  name: string;
  fields: GlmClassField[];
  span: GlmSourceSpan;
}

export interface GlmObject {
  className: string;
  name?: string | undefined;
  id?: string | undefined;
  parent?: string | undefined;
  properties: Record<string, string>;
  children: GlmObject[];
  span: GlmSourceSpan;
}

export interface GlmModel {
  directives: GlmDirective[];
  clock?: GlmClock | undefined;
  modules: GlmModule[];
  classes: GlmClassDef[];
  schedules: GlmSchedule[];
  objects: GlmObject[];
  /** Flattened list of all objects including nested children. */
  allObjects: GlmObject[];
  /** Lookup map of named objects (both `name` and `className:id` forms). */
  objectsByName: Map<string, GlmObject>;
  /** Module lookup by name. */
  modulesByName: Map<string, GlmModule>;
}

export type GlmDiagnosticSeverity = "error" | "warning" | "info";

export interface GlmDiagnostic {
  code: string;
  severity: GlmDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  objectName?: string | undefined;
}

export interface GlmComplex {
  re: number;
  im: number;
  unit?: string | undefined;
}

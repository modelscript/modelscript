/**
 * Query, lint, and compilation pipeline types for DSL grammars.
 */

import type { CodeGraph } from "./codegraph.js";
import type { u16, u32 } from "./primitives.js";
import type { QueryDB, SymbolEntry } from "./types.js";

export type ASTQueryFunction<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
> = (graph: CodeGraph<ModelAttrs, RuleName, FieldName>, queryArg: u32, ...args: any[]) => u32 | boolean | void;

export type ASTLintFunction<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (
  graph: CodeGraph<ModelAttrs, RuleName, FieldName>,
  queryArg: u32,
  $: Record<string, u16> & Record<RuleName, u16>,
) => void;

export interface DiagnosticContext<FieldName extends string = string> {
  /** The full source text of the referenced AST node */
  text: string;
  /** Explicit field accessor */
  field(name: FieldName | (string & {})): string;
  /** Treats the underlying argument as a numeric value (count, dimension, constant, etc.) */
  asNumber(): number;
  /** Treats the underlying argument as a string pool symbol / identifier ID */
  asSymbol(): string;
  /** String coercion returns the text of the node or numeric representation */
  toString(): string;
  /** ValueOf returns the underlying raw number or node pointer */
  valueOf(): number;
  /** Backward compatible child field dictionary */
  fields: Record<FieldName | (string & {}), string>;
  /** Direct field text access (e.g. `target.name` or `target.type`) */
  [field: string]: any;
}

export interface CompilerLintFix<RuleName extends string = string, FieldName extends string = string> {
  title: string | ((target: DiagnosticContext<FieldName>) => string);
  kind?: "quickfix" | "refactor";
  isPreferred?: boolean;
  generateEdit?: (
    db: any,
    node: number,
    $: Record<string, number>,
  ) => {
    startByte: number;
    endByte: number;
    newText: string;
  } | null;
}

export interface CompilerLint<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  nodes?: NoInfer<RuleName>[];
  query: string | ASTLintFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  code?: string | number;
  message:
    | string
    | ((
        target: DiagnosticContext<FieldName>,
        arg0: DiagnosticContext<FieldName>,
        arg1: DiagnosticContext<FieldName>,
        arg2: DiagnosticContext<FieldName>,
      ) => string);
  severity: "error" | "warning" | "info";
  fixes?: CompilerLintFix<RuleName, FieldName>[];
}

export interface ModelProperty {
  type: "u8" | "u16" | "u32" | "i32" | "f32" | "f64" | "bool" | "flag" | "string" | "ref" | "tensor";
  default?: number | boolean | string;
}

export interface CompilationPipeline<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  label: string;
  target: "dae" | "blt" | "ast" | "wat" | "json" | "binary";
  passes: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>[];
}

export interface LintRangeOptions {
  field?: string;
  startCharOffset?: number;
  endCharOffset?: number;
  startByte?: number;
  endByte?: number;
  code?: number;
}

export interface LintResult {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  field?: string;
  startCharOffset?: number;
  endCharOffset?: number;
  startByte?: number;
  endByte?: number;
  code?: number;
}

export function warning(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "warning", ...options };
}

export function error(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "error", ...options };
}

export function info(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "info", ...options };
}

export function hint(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "hint", ...options };
}

export type QueryFnOrObject =
  | ((db: QueryDB, self: SymbolEntry, ...args: any[]) => any)
  | {
      execute: (db: QueryDB, self: SymbolEntry, ...args: any[]) => any;
      recovery?: (self: SymbolEntry, ...args: any[]) => any;
    };

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Query, lint, and compilation pipeline types for DSL grammars.
 */

import type { CodeGraph } from "./codegraph.js";
import type { u16, u32 } from "./primitives.js";

/**
 * Signature of an arena-native AST query function operating directly on linear-memory `CodeGraph` nodes.
 */
export type ASTQueryFunction<
  RuleName extends string = string,
  FieldName extends string = string,
  _QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
> = (graph: CodeGraph<ModelAttrs, RuleName, FieldName>, queryArg: u32, ...args: any[]) => u32 | boolean | void;

/**
 * Signature of an arena-native CST lint function that inspects `CodeGraph` nodes and emits diagnostics via `graph.diagnostic()`.
 */
export type ASTLintFunction<
  RuleName extends string = string,
  FieldName extends string = string,
  _QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (
  graph: CodeGraph<ModelAttrs, RuleName, FieldName>,
  queryArg: u32,
  $: Record<string, u16> & Record<RuleName, u16>,
) => void;

/**
 * Wrapper around a diagnostic target or argument AST node passed to `CompilerLint.message` formatters.
 */
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

/**
 * Describes an automated code action (quick-fix or refactoring) attached to a `CompilerLint` diagnostic.
 */
export interface CompilerLintFix<_RuleName extends string = string, FieldName extends string = string> {
  /** Human-readable title displayed in the IDE code action menu, or a formatter computing it from the target node. */
  title: string | ((target: DiagnosticContext<FieldName>) => string);
  /** Classification of the code action (`"quickfix"` or `"refactor"`). */
  kind?: "quickfix" | "refactor" | undefined;
  /** Whether this fix should be marked as the preferred default action in the IDE. */
  isPreferred?: boolean | undefined;
  /** Computes the byte/offset text replacement edit to apply when the user invokes this fix. */
  generateEdit?:
    | ((
        db: any,
        node: number,
        $: Record<string, number>,
      ) => {
        startByte: number;
        endByte: number;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        newText: string;
      } | null)
    | undefined;
}

/**
 * Declarative specification of a CST/AST compiler lint rule evaluated over a `CodeGraph`.
 */
export interface CompilerLint<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Grammar rule names (node kinds) that trigger evaluation of this lint rule. */
  nodes?: NoInfer<RuleName>[] | undefined;
  /** Named query or inline `ASTLintFunction` executed for each matching AST node. */
  query: string | ASTLintFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  /** Unique diagnostic error/warning code (e.g., `1001` or `"M1001"`). */
  code?: string | number | undefined;
  /** Static diagnostic message string or formatter function receiving the target node and up to three diagnostic arguments. */
  message:
    | string
    | ((
        target: DiagnosticContext<FieldName>,
        arg0: DiagnosticContext<FieldName>,
        arg1: DiagnosticContext<FieldName>,
        arg2: DiagnosticContext<FieldName>,
      ) => string);
  /** Diagnostic severity level emitted when this lint rule triggers. */
  severity: "error" | "warning" | "info";
  /** Optional quick-fix or refactoring code actions offered for diagnostics produced by this rule. */
  fixes?: CompilerLintFix<RuleName, FieldName>[] | undefined;
}

/**
 * Schema descriptor for a typed attribute column stored in a `CodeGraph` model table.
 */
export interface ModelProperty {
  /** Primitive storage type of the model attribute column in linear memory. */
  type: "u8" | "u16" | "u32" | "i32" | "f32" | "f64" | "bool" | "flag" | "string" | "ref" | "tensor";
  /** Optional default value initialized when a model entity is allocated. */
  default?: number | boolean | string | undefined;
}

/**
 * Ordered sequence of `ASTQueryFunction` lowering or transformation passes targeting a specific compilation output format.
 */
export interface CompilationPipeline<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Human-readable name identifying this compilation pipeline. */
  label: string;
  /** Target representation produced by this pipeline. */
  target: "dae" | "blt" | "ast" | "wat" | "json" | "binary";
  /** Ordered list of compilation passes executed sequentially over the `CodeGraph`. */
  passes: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>[];
}

/**
 * Optional source range and error code overrides for symbol-level lint diagnostics.
 */
export interface LintRangeOptions {
  /** Name of the specific AST field on the symbol to highlight as the diagnostic span. */
  field?: string | undefined;
  /** Zero-indexed starting character offset of the diagnostic span. */
  startOffset?: number | undefined;
  /** Zero-indexed ending character offset (exclusive) of the diagnostic span. */
  endOffset?: number | undefined;
  /** Deprecated alias for `startOffset`. */
  startCharOffset?: number | undefined;
  /** Deprecated alias for `endOffset`. */
  endCharOffset?: number | undefined;
  /** Starting UTF-8 byte offset of the diagnostic span. */
  startByte?: number | undefined;
  /** Ending UTF-8 byte offset (exclusive) of the diagnostic span. */
  endByte?: number | undefined;
  /** Numeric diagnostic code associated with the lint result. */
  code?: number | undefined;
}

/**
 * A diagnostic object returned by symbol-level `lint` hooks in `DefConfig`, `RefConfig`, or Salsa `lint__` queries.
 */
export interface LintResult {
  /** Formatted human-readable diagnostic message text. */
  message: string;
  /** Severity classification of the diagnostic. */
  severity: "error" | "warning" | "info" | "hint";
  /** Optional AST field name whose source span should be highlighted. */
  field?: string | undefined;
  /** Zero-indexed starting character offset of the diagnostic span. */
  startOffset?: number | undefined;
  /** Zero-indexed ending character offset (exclusive) of the diagnostic span. */
  endOffset?: number | undefined;
  /** Deprecated alias for `startOffset`. */
  startCharOffset?: number | undefined;
  /** Deprecated alias for `endOffset`. */
  endCharOffset?: number | undefined;
  /** Starting UTF-8 byte offset of the diagnostic span. */
  startByte?: number | undefined;
  /** Ending UTF-8 byte offset (exclusive) of the diagnostic span. */
  endByte?: number | undefined;
  /** Numeric diagnostic error/warning code. */
  code?: number | undefined;
}

/**
 * Constructs a `"warning"`-severity `LintResult` with optional source span and code overrides.
 */
export function warning(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "warning", ...options };
}

/**
 * Constructs an `"error"`-severity `LintResult` with optional source span and code overrides.
 */
export function error(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "error", ...options };
}

/**
 * Constructs an `"info"`-severity `LintResult` with optional source span and code overrides.
 */
export function info(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "info", ...options };
}

/**
 * Constructs a `"hint"`-severity `LintResult` with optional source span and code overrides.
 */
export function hint(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "hint", ...options };
}

/**
 * A semantic Salsa query definition: either a direct query evaluator function `(db, self, ...args) => result`
 * or an object pairing an `execute` function with an optional cycle `recovery` fallback handler.
 */
export type QueryFnOrObject =
  | ((db: any, self: any, ...args: any[]) => any)
  | {
      /** Evaluates the semantic query for `self` against the memoized `db`. */
      execute(db: any, self: any, ...args: any[]): any;
      /** Fallback handler invoked when a dependency cycle is detected during query evaluation. */
      recovery?(self: any, ...args: any[]): any;
    };

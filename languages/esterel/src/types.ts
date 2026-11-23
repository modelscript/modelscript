// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST and semantic types for Esterel synchronous reactive modules.
 */

export interface SourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type EsterelSignalDirection = "input" | "output" | "inputoutput" | "sensor";

export interface EsterelSignalDecl {
  name: string;
  direction: EsterelSignalDirection;
  valueType?: string | undefined;
  initialValue?: string | undefined;
  combineOp?: string | undefined;
  span: SourceSpan;
}

export type EsterelRelationKind = "exclusion" | "implication";

export interface EsterelRelation {
  kind: EsterelRelationKind;
  /** Signals participating in `S1 # S2 # ...` or `[lhs, rhs]` for `lhs => rhs`. */
  signals: string[];
  span: SourceSpan;
}

export type EsterelSignalExpr =
  | { kind: "signal"; name: string; span: SourceSpan }
  | { kind: "not"; operand: EsterelSignalExpr; span: SourceSpan }
  | { kind: "and"; left: EsterelSignalExpr; right: EsterelSignalExpr; span: SourceSpan }
  | { kind: "or"; left: EsterelSignalExpr; right: EsterelSignalExpr; span: SourceSpan }
  | { kind: "tick"; span: SourceSpan };

export interface EsterelAwaitCase {
  immediate: boolean;
  count?: number | undefined;
  expr: EsterelSignalExpr;
  body?: EsterelStatement | undefined;
  span: SourceSpan;
}

export interface EsterelTrapHandler {
  trapName: string;
  body: EsterelStatement;
  span: SourceSpan;
}

export interface EsterelSignalRenaming {
  formal: string;
  actual: string;
}

export type EsterelStatement =
  | { kind: "nothing"; span: SourceSpan }
  | { kind: "pause"; span: SourceSpan }
  | { kind: "halt"; span: SourceSpan }
  | { kind: "emit"; signal: string; value?: string | undefined; span: SourceSpan }
  | { kind: "sustain"; signal: string; value?: string | undefined; span: SourceSpan }
  | {
      kind: "present";
      expr: EsterelSignalExpr;
      thenBranch: EsterelStatement;
      elseBranch?: EsterelStatement | undefined;
      span: SourceSpan;
    }
  | {
      kind: "await";
      immediate: boolean;
      count?: number | undefined;
      expr: EsterelSignalExpr;
      body?: EsterelStatement | undefined;
      cases?: EsterelAwaitCase[] | undefined;
      span: SourceSpan;
    }
  | { kind: "loop"; body: EsterelStatement; eachExpr?: EsterelSignalExpr | undefined; span: SourceSpan }
  | {
      kind: "every";
      immediate: boolean;
      expr: EsterelSignalExpr;
      body: EsterelStatement;
      span: SourceSpan;
    }
  | {
      kind: "abort";
      weak: boolean;
      body: EsterelStatement;
      immediate: boolean;
      count?: number | undefined;
      expr: EsterelSignalExpr;
      handler?: EsterelStatement | undefined;
      span: SourceSpan;
    }
  | {
      kind: "suspend";
      body: EsterelStatement;
      immediate: boolean;
      expr: EsterelSignalExpr;
      span: SourceSpan;
    }
  | {
      kind: "trap";
      traps: string[];
      body: EsterelStatement;
      handlers: EsterelTrapHandler[];
      span: SourceSpan;
    }
  | { kind: "exit"; trapName: string; span: SourceSpan }
  | {
      kind: "signal";
      signals: EsterelSignalDecl[];
      body: EsterelStatement;
      span: SourceSpan;
    }
  | {
      kind: "run";
      moduleName: string;
      renamings: EsterelSignalRenaming[];
      span: SourceSpan;
    }
  | { kind: "seq"; statements: EsterelStatement[]; span: SourceSpan }
  | { kind: "par"; branches: EsterelStatement[]; span: SourceSpan };

export interface EsterelModule {
  name: string;
  signals: EsterelSignalDecl[];
  relations: EsterelRelation[];
  body: EsterelStatement;
  span: SourceSpan;
}

export interface EsterelSyntaxError {
  code: string;
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface EsterelProgram {
  modules: EsterelModule[];
  errors: EsterelSyntaxError[];
  source: string;
}

export interface EsterelDiagnostic {
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  moduleName?: string | undefined;
  symbol?: string | undefined;
}

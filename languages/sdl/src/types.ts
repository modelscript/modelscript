// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core AST and semantic model types for ITU-T Z.100 SDL-88 (Phrase Representation).
 */

export interface SdlSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

export interface SdlSyntaxError extends SdlSpan {
  message: string;
}

export interface SdlSignalDecl extends SdlSpan {
  name: string;
  parameterSorts: string[];
}

export interface SdlChannelPath {
  from: string;
  to: string;
  signals: string[];
}

export interface SdlChannelDecl extends SdlSpan {
  name: string;
  noDelay?: boolean;
  delaySeconds?: number;
  paths: SdlChannelPath[];
}

export interface SdlSignalRouteDecl extends SdlSpan {
  name: string;
  paths: SdlChannelPath[];
}

export interface SdlConnectDecl extends SdlSpan {
  channel: string;
  signalRoutes: string[];
}

export interface SdlVarDecl extends SdlSpan {
  name: string;
  sort: string;
  initialValue?: string;
}

export interface SdlTimerDecl extends SdlSpan {
  name: string;
  parameterSorts: string[];
  defaultDuration?: number;
}

export type SdlAction =
  | {
      kind: "output";
      signal: string;
      args: string[];
      to?: string;
      via?: string;
      span: SdlSpan;
    }
  | {
      kind: "task";
      assignments: Array<{ target: string; expression: string }>;
      rawText: string;
      span: SdlSpan;
    }
  | {
      kind: "set";
      durationExpr: string;
      timer: string;
      args: string[];
      span: SdlSpan;
    }
  | {
      kind: "reset";
      timer: string;
      args: string[];
      span: SdlSpan;
    }
  | {
      kind: "decision";
      question: string;
      branches: SdlDecisionBranch[];
      span: SdlSpan;
    };

export interface SdlDecisionBranch {
  /** Condition value (e.g. "true", "false", "= 0", "> 1") or "ELSE". */
  condition: string;
  isElse: boolean;
  actions: SdlAction[];
  terminator?: SdlTerminator;
  span: SdlSpan;
}

export type SdlTerminator = { kind: "nextstate"; targetState: string; span: SdlSpan } | { kind: "stop"; span: SdlSpan };

export interface SdlTransition extends SdlSpan {
  actions: SdlAction[];
  terminator?: SdlTerminator;
}

export interface SdlInputClause extends SdlSpan {
  signal: string;
  variables: string[];
  transition: SdlTransition;
}

export interface SdlStateDecl extends SdlSpan {
  /** State name(s) — SDL allows comma-separated state lists or `*`. */
  names: string[];
  inputs: SdlInputClause[];
}

export interface SdlProcessDecl extends SdlSpan {
  name: string;
  initialInstances: number;
  maxInstances?: number;
  variables: SdlVarDecl[];
  timers: SdlTimerDecl[];
  start?: SdlTransition;
  states: SdlStateDecl[];
}

export interface SdlBlockDecl extends SdlSpan {
  name: string;
  signals: SdlSignalDecl[];
  signalRoutes: SdlSignalRouteDecl[];
  connects: SdlConnectDecl[];
  processes: SdlProcessDecl[];
}

export interface SdlSystemModel {
  name: string;
  span: SdlSpan;
  signals: SdlSignalDecl[];
  channels: SdlChannelDecl[];
  blocks: SdlBlockDecl[];
  /** Additional top-level systems if multiple SYSTEM blocks appeared (for duplicate detection). */
  extraSystems: Array<{ name: string; span: SdlSpan }>;
  syntaxErrors: SdlSyntaxError[];
}

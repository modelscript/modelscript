// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for SIMSCRIPT II.5 (RAND Discrete-Event Simulation Language, 1962-1968).
 */

export type SimscriptEntityKind = "temporary" | "permanent" | "process" | "resource" | "event";

export type SimscriptSetDiscipline = "FIFO" | "LIFO" | "RANKED";

export type SimscriptStatMeasure = "MEAN" | "MAX" | "MIN" | "NUMBER" | "SUM" | "STD.DEV" | "VARIANCE";

export interface SourceSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface SimscriptDistributionExpr {
  kind: "EXPONENTIAL.F" | "NORMAL.F" | "UNIFORM.F" | "POISSON.F" | "ERLANG.F" | "CONSTANT";
  args: number[];
  stream: number;
  raw: string;
}

export interface SimscriptEntityDecl {
  name: string;
  kind: SimscriptEntityKind;
  attributes: string[];
  ownedSets: string[];
  belongsToSets: string[];
  capacity?: number | undefined;
  span: SourceSpan;
}

export interface SimscriptDefineDecl {
  names: string[];
  dataType: "REAL" | "INTEGER" | "ALPHA" | "TEXT" | "SET" | "VARIABLE";
  setDiscipline?: SimscriptSetDiscipline | undefined;
  dimensions?: number | undefined;
  span: SourceSpan;
}

export interface SimscriptStatDecl {
  kind: "TALLY" | "ACCUMULATE";
  statName: string;
  measure: SimscriptStatMeasure;
  target: string;
  span: SourceSpan;
}

export type SimscriptStatement =
  | {
      kind: "CREATE";
      entity: string;
      every?: boolean | undefined;
      count?: number | undefined;
      span: SourceSpan;
    }
  | {
      kind: "DESTROY";
      entity: string;
      span: SourceSpan;
    }
  | {
      kind: "ACTIVATE";
      processName: string;
      delay?: SimscriptDistributionExpr | undefined;
      units?: string | undefined;
      now: boolean;
      span: SourceSpan;
    }
  | {
      kind: "SCHEDULE";
      eventName: string;
      delay?: SimscriptDistributionExpr | undefined;
      units?: string | undefined;
      now: boolean;
      span: SourceSpan;
    }
  | {
      kind: "WORK";
      duration: SimscriptDistributionExpr;
      units?: string | undefined;
      span: SourceSpan;
    }
  | {
      kind: "WAIT";
      duration: SimscriptDistributionExpr;
      units?: string | undefined;
      span: SourceSpan;
    }
  | {
      kind: "REQUEST";
      quantity: number;
      resource: string;
      priority?: number | undefined;
      span: SourceSpan;
    }
  | {
      kind: "RELINQUISH";
      quantity: number;
      resource: string;
      span: SourceSpan;
    }
  | {
      kind: "FILE";
      entity: string;
      setName: string;
      span: SourceSpan;
    }
  | {
      kind: "REMOVE";
      entity: string;
      position?: "FIRST" | "LAST" | undefined;
      setName: string;
      span: SourceSpan;
    }
  | {
      kind: "LET";
      target: string;
      expression: string;
      numericValue?: number | undefined;
      span: SourceSpan;
    }
  | {
      kind: "START_SIMULATION";
      span: SourceSpan;
    }
  | {
      kind: "FOR_LOOP";
      variable: string;
      start: number;
      end: number;
      body: SimscriptStatement[];
      span: SourceSpan;
    }
  | {
      kind: "PRINT";
      text: string;
      span: SourceSpan;
    }
  | {
      kind: "RETURN";
      span: SourceSpan;
    }
  | {
      kind: "STOP";
      span: SourceSpan;
    };

export interface SimscriptRoutineBlock {
  kind: "MAIN" | "PROCESS" | "EVENT" | "ROUTINE";
  name: string;
  parameters: string[];
  statements: SimscriptStatement[];
  span: SourceSpan;
}

export interface SimscriptPreamble {
  present: boolean;
  hasEnd: boolean;
  entities: SimscriptEntityDecl[];
  defines: SimscriptDefineDecl[];
  stats: SimscriptStatDecl[];
  sets: Map<string, SimscriptSetDiscipline>;
  span?: SourceSpan | undefined;
}

export interface SimscriptSyntaxError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface SimscriptModel {
  name: string;
  preamble: SimscriptPreamble;
  main?: SimscriptRoutineBlock | undefined;
  processes: Map<string, SimscriptRoutineBlock>;
  events: Map<string, SimscriptRoutineBlock>;
  routines: Map<string, SimscriptRoutineBlock>;
  resourceCapacities: Map<string, number>;
  variables: Map<string, number>;
  syntaxErrors: SimscriptSyntaxError[];
}

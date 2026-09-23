// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Static Activity Flow Soundness & Deadlock Analyzer.
 *
 * Implements static Control Flow Analysis (CFA), Petri Net workflow soundness,
 * and path-sensitive Definite Assignment for SysML v2 activities and actions:
 *   1. Join-Decide Deadlock: Join node synchronizing mutually exclusive branches of a decide node.
 *   2. Path-Sensitive Definite Output Assignment: Verifying 'out' parameters are assigned across all execution paths.
 *   3. Missing Input Items: Unbound input pins on action nodes.
 *   4. Workflow Soundness: Verifying proper termination and absence of dead actions.
 */

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import {
  analyzeActivityCfa,
  extractActivityGraphFromQueryDB,
  extractActivityGraphFromText,
  type ActivityGraph,
  type CfaDiagnostic,
} from "./activity-cfa.js";
import type { ParsedActionElement, ParsedSuccession } from "./fuml-bridge.js";

export type ActivityDiagnostic = CfaDiagnostic;

export interface ActivitySoundnessResult {
  isSound: boolean;
  diagnostics: ActivityDiagnostic[];
  deadlockNodes: string[];
  unreachableActions: string[];
  unassignedOutputs: string[];
  summary: string;
}

/**
 * Backward-compatible adapter that parses textual SysML v2 into ParsedActionElement array.
 */
export function parseActivityElements(sysmlSource: string): {
  actions: ParsedActionElement[];
  successions: ParsedSuccession[];
  declaredOutputs: string[];
} {
  const graph: ActivityGraph = extractActivityGraphFromText(sysmlSource);

  const actions: ParsedActionElement[] = graph.nodes.map((n) => ({
    name: n.name,
    kind: n.kind as ParsedActionElement["kind"],
    inputs: n.inputs.map((p) => ({ name: p.name, type: p.type || "Any" })),
    outputs: n.outputs.map((p) => ({ name: p.name, type: p.type || "Any" })),
    assignments: n.assignments.map((a) => ({ target: a.target, expr: a.expr })),
    startByte: n.startByte,
    endByte: n.endByte,
  }));

  const successions: ParsedSuccession[] = graph.flows.map((f) => ({
    source: f.source,
    target: f.target,
    guard: f.guard,
    startByte: f.startByte,
    endByte: f.endByte,
  }));

  const declaredOutputs = graph.declaredOutputs.map((p) => p.name);

  return { actions, successions, declaredOutputs };
}

/**
 * Analyzes a SysML v2 activity model for control flow anomalies, deadlocks, and workflow soundness.
 */
export function checkActivitySoundness(sysmlSource: string): ActivitySoundnessResult {
  const graph = extractActivityGraphFromText(sysmlSource);
  const result = analyzeActivityCfa(graph);

  return {
    isSound: result.isSound,
    diagnostics: result.diagnostics,
    deadlockNodes: result.deadlockNodes,
    unreachableActions: result.unreachableActions,
    unassignedOutputs: result.unassignedOutputs,
    summary: result.summary,
  };
}

/**
 * Salsa / QueryDB-native activity soundness verification for a specific action symbol.
 */
export function checkActivitySoundnessForSymbol(db: QueryDB, actionSymbol: SymbolEntry): ActivitySoundnessResult {
  const graph = extractActivityGraphFromQueryDB(db, actionSymbol);
  const result = analyzeActivityCfa(graph);

  return {
    isSound: result.isSound,
    diagnostics: result.diagnostics,
    deadlockNodes: result.deadlockNodes,
    unreachableActions: result.unreachableActions,
    unassignedOutputs: result.unassignedOutputs,
    summary: result.summary,
  };
}

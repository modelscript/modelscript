// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ActivityEdgeKind,
  ActivityNodeKind,
  DAEBuilder,
  executeArenaStatements,
  PinDirection,
  WasmFumlEngine,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { extractActivityGraphFromQueryDB, extractActivityGraphFromText, type ActivityGraph } from "./activity-cfa.js";
import { SysmlExprParser, tokenizeSysml } from "./sysml2-dae-lowerer.js";

export interface ParsedActionElement {
  name: string;
  kind: "action" | "merge" | "decide" | "fork" | "join";
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  assignments: { target: string; expr: string }[];
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ParsedSuccession {
  source: string;
  target: string;
  guard?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export type FumlActionBehavior = NonNullable<Parameters<WasmFumlEngine["addNode"]>[2]>;

export class SysML2FumlBridge {
  /**
   * Compiles SysML v2 action / activity model into an executable WasmFumlEngine.
   * Accepts either raw SysML v2 source string or Salsa QueryDB + root SymbolEntry.
   */
  static compile(
    input: string | QueryDB,
    customBehaviorsOrSymbol?: Record<string, FumlActionBehavior> | SymbolEntry,
    customBehaviors?: Record<string, FumlActionBehavior>,
  ): WasmFumlEngine {
    const engine = new WasmFumlEngine();

    let graph: ActivityGraph;
    let behaviors: Record<string, FumlActionBehavior> | undefined;

    if (typeof input === "string") {
      graph = extractActivityGraphFromText(input);
      behaviors = customBehaviorsOrSymbol as Record<string, FumlActionBehavior> | undefined;
    } else {
      const db = input as QueryDB;
      const rootSym = customBehaviorsOrSymbol as SymbolEntry;
      graph = extractActivityGraphFromQueryDB(db, rootSym);
      behaviors = customBehaviors;
    }

    const { nodes: actions, flows: successions } = graph;

    // 1. Register nodes in WasmFumlEngine
    const nodeMap = new Map<string, number>();

    // Initial node
    const initNodeId = engine.addNode("__initial__", ActivityNodeKind.Initial);

    for (const act of actions) {
      let nodeKind = ActivityNodeKind.Action;
      if (act.kind === "decide") nodeKind = ActivityNodeKind.Decision;
      else if (act.kind === "merge") nodeKind = ActivityNodeKind.Merge;
      else if (act.kind === "fork") nodeKind = ActivityNodeKind.Fork;
      else if (act.kind === "join") nodeKind = ActivityNodeKind.Join;

      // Behavior builder
      let behavior = behaviors?.[act.name];
      if (!behavior && act.assignments.length > 0) {
        behavior = (_inputs, context) => {
          for (const asgn of act.assignments) {
            try {
              // Bytecode-driven evaluation via DAEBuilder arena execution
              const evaluated = evaluateDiscreteAssignment(asgn.target, asgn.expr, context);
              context[asgn.target] = evaluated;
            } catch {
              // Fallback
              context[asgn.target] = asgn.expr;
            }
          }
          return undefined;
        };
      }

      const nodeId = engine.addNode(act.name, nodeKind, behavior);
      nodeMap.set(act.name, nodeId);

      // Add pins
      for (const pin of act.inputs) {
        engine.addPin(nodeId, pin.name, PinDirection.Input, pin.type);
      }
      for (const pin of act.outputs) {
        engine.addPin(nodeId, pin.name, PinDirection.Output, pin.type);
      }
    }

    // ActivityFinal node
    const finalNodeId = engine.addNode("__final__", ActivityNodeKind.ActivityFinal);

    // 2. Connect edges
    const targets = new Set(successions.map((s) => s.target));
    const sources = new Set(successions.map((s) => s.source));

    // Connect Initial node to actions that are entry points
    if (successions.length === 0) {
      if (actions.length > 0) {
        const tgtId = nodeMap.get(actions[0]!.name)!;
        engine.addEdge(initNodeId, tgtId, ActivityEdgeKind.Control);
      }
    } else {
      for (const act of actions) {
        // Must have outgoing transitions (or be root) and no incoming transitions
        if (!targets.has(act.name) && sources.has(act.name) && act.kind !== "merge" && act.kind !== "join") {
          const tgtId = nodeMap.get(act.name)!;
          engine.addEdge(initNodeId, tgtId, ActivityEdgeKind.Control);
        }
      }
    }

    // Connect specified successions
    for (const s of successions) {
      const srcId = nodeMap.get(s.source);
      const tgtId = nodeMap.get(s.target);
      if (srcId && tgtId) {
        const edgeKind = s.kind === "object" ? ActivityEdgeKind.Object : ActivityEdgeKind.Control;
        engine.addEdge(srcId, tgtId, edgeKind);
      }
    }

    // Connect terminal actions to ActivityFinal
    if (successions.length === 0) {
      if (actions.length > 0) {
        const srcId = nodeMap.get(actions[actions.length - 1]!.name)!;
        engine.addEdge(srcId, finalNodeId, ActivityEdgeKind.Control);
      }
    } else {
      for (const act of actions) {
        if (targets.has(act.name) && !sources.has(act.name) && act.kind !== "fork" && act.kind !== "decide") {
          const srcId = nodeMap.get(act.name)!;
          engine.addEdge(srcId, finalNodeId, ActivityEdgeKind.Control);
        }
      }
    }

    return engine;
  }
}

/**
 * Bytecode-driven discrete expression evaluator for fUML assignments using DAEBuilder arena execution.
 */
function evaluateDiscreteAssignment(
  target: string,
  expr: string,
  context: Record<string, unknown>,
): number | boolean | string | undefined {
  const trimmed = expr.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed);

  try {
    const arena = new DAEBuilder();
    const tokens = tokenizeSysml(trimmed);
    const parser = new SysmlExprParser(tokens, arena);
    const rhsExprId = parser.parse();

    const targetNameId = arena.interner.intern(target);
    const targetExprId = arena.addName(targetNameId);
    const stmtIdx = arena.addAssignmentStmt(targetExprId, rhsExprId);

    // Populate variable values in linear array indexed by interner string ID
    const valuesByStringId = new Float64Array(arena.interner.size + 32);
    for (const [key, val] of Object.entries(context)) {
      if (typeof val === "number") {
        const id = arena.interner.intern(key);
        if (id < valuesByStringId.length) valuesByStringId[id] = val;
      } else if (typeof val === "boolean") {
        const id = arena.interner.intern(key);
        if (id < valuesByStringId.length) valuesByStringId[id] = val ? 1 : 0;
      }
    }

    // Execute the assignment statement in DAE arena bytecode
    executeArenaStatements(arena, stmtIdx, 1, valuesByStringId);

    const result = valuesByStringId[targetNameId];
    return typeof context[target] === "boolean" ? Boolean(result) : result;
  } catch {
    return expr;
  }
}

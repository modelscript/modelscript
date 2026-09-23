// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ActivityEdgeKind,
  ActivityNodeKind,
  PinDirection,
  WasmFumlEngine,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { extractActivityGraphFromQueryDB, extractActivityGraphFromText, type ActivityGraph } from "./activity-cfa.js";

export interface ParsedActionElement {
  name: string;
  kind: "action" | "merge" | "decide" | "fork" | "join";
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  assignments: { target: string; expr: string }[];
  startByte?: number;
  endByte?: number;
}

export interface ParsedSuccession {
  source: string;
  target: string;
  guard?: string;
  startByte?: number;
  endByte?: number;
}

export class SysML2FumlBridge {
  /**
   * Compiles SysML v2 action / activity model into an executable WasmFumlEngine.
   * Accepts either raw SysML v2 source string or Salsa QueryDB + root SymbolEntry.
   */
  static compile(
    input: string | QueryDB,
    customBehaviorsOrSymbol?:
      | Record<string, (inputs: Record<string, any>, context: Record<string, any>) => Record<string, any> | undefined>
      | SymbolEntry,
    customBehaviors?: Record<
      string,
      (inputs: Record<string, any>, context: Record<string, any>) => Record<string, any> | undefined
    >,
  ): WasmFumlEngine {
    const engine = new WasmFumlEngine();

    let graph: ActivityGraph;
    let behaviors:
      | Record<string, (inputs: Record<string, any>, context: Record<string, any>) => Record<string, any> | undefined>
      | undefined;

    if (typeof input === "string") {
      graph = extractActivityGraphFromText(input);
      behaviors = customBehaviorsOrSymbol as Record<string, any>;
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
              // Arithmetic evaluation supporting context variable references
              const evaluated = evaluateExpression(asgn.expr, context);
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
 * Safe discrete expression evaluator for fUML assignments.
 */
function evaluateExpression(expr: string, context: Record<string, any>): any {
  const trimmed = expr.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Replace context variable names with their values
  let sanitized = trimmed;
  for (const [key, val] of Object.entries(context)) {
    if (typeof val === "number" || typeof val === "boolean") {
      const varRegex = new RegExp(`\\b${key}\\b`, "g");
      sanitized = sanitized.replace(varRegex, String(val));
    }
  }

  // Evaluate simple arithmetic expression (+, -, *, /, %, numbers, parentheses)
  if (/^[\d\s+\-*/%().]+$/.test(sanitized)) {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${sanitized});`)();
  }

  return expr;
}

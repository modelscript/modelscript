// SPDX-License-Identifier: AGPL-3.0-or-later

import { ActivityEdgeKind, ActivityNodeKind, PinDirection, WasmFumlEngine } from "@modelscript/runtime";

export interface ParsedActionElement {
  name: string;
  kind: "action" | "merge" | "decide" | "fork" | "join";
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  assignments: { target: string; expr: string }[];
}

export interface ParsedSuccession {
  source: string;
  target: string;
  guard?: string;
}

export class SysML2FumlBridge {
  /**
   * Compiles SysML v2 action / activity textual model into an executable WasmFumlEngine.
   */
  static compile(
    sysmlSource: string,
    customBehaviors?: Record<
      string,
      (inputs: Record<string, any>, context: Record<string, any>) => Record<string, any> | undefined
    >,
  ): WasmFumlEngine {
    const engine = new WasmFumlEngine();

    const actions: ParsedActionElement[] = [];
    const successions: ParsedSuccession[] = [];

    // 1. Extract action definitions and action usages
    // Format: action [name] { ... } or action [name];
    const actionHeaderRegex = /\baction\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = actionHeaderRegex.exec(sysmlSource)) !== null) {
      const name = aMatch[1];
      const afterNamePos = aMatch.index + aMatch[0].length;
      let delimPos = -1;
      let isBrace = false;
      for (let i = afterNamePos; i < sysmlSource.length; i++) {
        const c = sysmlSource[i];
        if (c === ";") {
          delimPos = i;
          isBrace = false;
          break;
        } else if (c === "{") {
          delimPos = i;
          isBrace = true;
          break;
        }
      }
      if (delimPos === -1) break;
      let body = "";
      if (isBrace) {
        const closeBrace = sysmlSource.indexOf("}", delimPos + 1);
        if (closeBrace !== -1) {
          body = sysmlSource.slice(delimPos + 1, closeBrace);
          actionHeaderRegex.lastIndex = closeBrace + 1;
        } else {
          actionHeaderRegex.lastIndex = delimPos + 1;
        }
      } else {
        actionHeaderRegex.lastIndex = delimPos + 1;
      }

      // Extract pins within action body
      const inputs: { name: string; type: string }[] = [];
      const outputs: { name: string; type: string }[] = [];
      const assignments: { target: string; expr: string }[] = [];

      const pinRegex = /\b(in|out)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_.]+);/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pinRegex.exec(body)) !== null) {
        if (pMatch[1] === "in") {
          inputs.push({ name: pMatch[2], type: pMatch[3] });
        } else {
          outputs.push({ name: pMatch[2], type: pMatch[3] });
        }
      }

      // Extract assignments: assign [var] := [expr];
      const assignRegex = /\bassign\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([^;]+);/g;
      let asMatch: RegExpExecArray | null;
      while ((asMatch = assignRegex.exec(body)) !== null) {
        assignments.push({ target: asMatch[1], expr: asMatch[2].trim() });
      }

      actions.push({
        name,
        kind: "action",
        inputs,
        outputs,
        assignments,
      });
    }

    // 2. Extract control nodes (merge, decide, fork, join)
    const controlNodeRegex = /\b(merge|decide|fork|join)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = controlNodeRegex.exec(sysmlSource)) !== null) {
      const cKind = cMatch[1] as "merge" | "decide" | "fork" | "join";
      const cName = cMatch[2];
      actions.push({
        name: cName,
        kind: cKind,
        inputs: [],
        outputs: [],
        assignments: [],
      });
    }

    // 3. Extract successions: first [source] then [target];
    const succRegex =
      /\b(?:first\s+([A-Za-z0-9_.]+)\s+then\s+([A-Za-z0-9_.]+)|succession\s+([A-Za-z0-9_.]+)\s+then\s+([A-Za-z0-9_.]+));/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = succRegex.exec(sysmlSource)) !== null) {
      const src = sMatch[1] || sMatch[3];
      const tgt = sMatch[2] || sMatch[4];
      successions.push({ source: src, target: tgt });
    }

    // 4. Register nodes in WasmFumlEngine
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
      let behavior = customBehaviors?.[act.name];
      if (!behavior && act.assignments.length > 0) {
        behavior = (_inputs, context) => {
          for (const asgn of act.assignments) {
            try {
              // Basic arithmetic evaluation supporting context variable references
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

    // 5. Connect edges
    const targets = new Set(successions.map((s) => s.target));
    const sources = new Set(successions.map((s) => s.source));

    // Connect Initial node to actions that are entry points
    if (successions.length === 0) {
      if (actions.length > 0) {
        const tgtId = nodeMap.get(actions[0].name)!;
        engine.addEdge(initNodeId, tgtId, ActivityEdgeKind.Control);
      }
    } else {
      for (const act of actions) {
        // Must have outgoing transitions (or be the single designated root) and no incoming transitions
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
        engine.addEdge(srcId, tgtId, ActivityEdgeKind.Control);
      }
    }

    // Connect terminal actions to ActivityFinal
    if (successions.length === 0) {
      if (actions.length > 0) {
        const srcId = nodeMap.get(actions[actions.length - 1].name)!;
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

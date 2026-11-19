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
import { evaluateSysML2Constraint, parseSysML2Expression, type SysML2ExprAst } from "./evaluator.js";
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

function collectAstIdentifiers(ast: SysML2ExprAst, out: Set<string>): void {
  switch (ast.kind) {
    case "Identifier":
      out.add(ast.name);
      break;
    case "NumberLiteral":
    case "BooleanLiteral":
    case "StringLiteral":
      break;
    case "UnaryExpr":
      collectAstIdentifiers(ast.operand, out);
      break;
    case "BinaryExpr":
      collectAstIdentifiers(ast.left, out);
      collectAstIdentifiers(ast.right, out);
      break;
    case "ConditionalExpr":
      collectAstIdentifiers(ast.condition, out);
      collectAstIdentifiers(ast.thenExpr, out);
      collectAstIdentifiers(ast.elseExpr, out);
      break;
    case "CallExpr":
      for (const a of ast.args) collectAstIdentifiers(a, out);
      break;
  }
}

function unwrapOuterGuardDelimiters(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1).trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let outer = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0 && i < s.length - 1) {
          outer = false;
          break;
        }
      }
    }
    if (outer && depth === 0) s = s.slice(1, -1).trim();
    else break;
  }
  return s;
}

function isGuardLiterallyFalse(guardText: string | undefined): boolean {
  if (!guardText) return false;
  const cleaned = unwrapOuterGuardDelimiters(guardText);
  const lower = cleaned.toLowerCase();
  if (lower === "false" || lower === "not true" || lower === "!true") {
    return true;
  }
  if (lower === "else" || lower === "default" || lower === "true" || lower === "") {
    return false;
  }
  try {
    const ast = parseSysML2Expression(cleaned);
    const idents = new Set<string>();
    collectAstIdentifiers(ast, idents);
    if (idents.size === 0) {
      return !evaluateSysML2Constraint(ast, {}).satisfied;
    }
    // Catch top-level conjunction with a literal false (`false and x > 0`)
    if (ast.kind === "BinaryExpr" && ast.op === "and") {
      if (
        (ast.left.kind === "BooleanLiteral" && !ast.left.value) ||
        (ast.right.kind === "BooleanLiteral" && !ast.right.value)
      ) {
        return true;
      }
    }
  } catch {
    // Keep edge if guard cannot be statically refuted
  }
  return false;
}

function isElseGuard(guardText: string | undefined): boolean {
  if (!guardText) return false;
  const low = unwrapOuterGuardDelimiters(guardText).toLowerCase();
  return low === "else" || low === "default";
}

function buildFumlEdgeGuard(
  guardText: string | undefined,
): ((context: Record<string, unknown>, tokenValue?: unknown) => boolean) | undefined {
  if (!guardText) return undefined;
  const cleaned = unwrapOuterGuardDelimiters(guardText);
  const lower = cleaned.toLowerCase();
  if (!cleaned || lower === "true") return undefined;
  if (lower === "else" || lower === "default") return () => true;

  let ast: SysML2ExprAst;
  const referencedVars = new Set<string>();
  try {
    ast = parseSysML2Expression(cleaned);
    collectAstIdentifiers(ast, referencedVars);
  } catch {
    return undefined;
  }

  return (context: Record<string, unknown>, tokenValue?: unknown): boolean => {
    for (const v of referencedVars) {
      if (!(v in context)) {
        return true;
      }
    }
    const env: Record<string, number | boolean | string> = {};
    for (const [k, val] of Object.entries(context)) {
      if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") {
        env[k] = val;
      }
    }
    if (typeof tokenValue === "number" || typeof tokenValue === "boolean" || typeof tokenValue === "string") {
      env["value"] = tokenValue;
    }
    return evaluateSysML2Constraint(ast, env).satisfied;
  };
}

function resolveNodeBaseName(endpoint: string, nodeMap: ReadonlyMap<string, number>): string | undefined {
  if (nodeMap.has(endpoint)) return endpoint;
  const dotIdx = endpoint.indexOf(".");
  if (dotIdx > 0) {
    const base = endpoint.slice(0, dotIdx);
    if (nodeMap.has(base)) return base;
  }
  return undefined;
}

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
      const db = input;
      const rootSym = customBehaviorsOrSymbol as SymbolEntry;
      graph = extractActivityGraphFromQueryDB(db, rootSym);
      behaviors = customBehaviors;
    }

    const { nodes: actions, flows: rawSuccessions } = graph;
    // Drop edges whose guard is tautologically false (`if false`, `if not true`, etc.)
    const successions = rawSuccessions.filter((s) => !isGuardLiterallyFalse(s.guard));

    // 1. Register nodes in WasmFumlEngine
    const nodeMap = new Map<string, number>();
    const actionKindByName = new Map<string, ActivityGraph["nodes"][number]["kind"]>();

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
      actionKindByName.set(act.name, act.kind);

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

    // 2. Connect edges (with normalized pin endpoints and ordered `else` guards)
    const targets = new Set<string>();
    const sources = new Set<string>();
    for (const s of successions) {
      const srcBase = resolveNodeBaseName(s.source, nodeMap);
      const tgtBase = resolveNodeBaseName(s.target, nodeMap);
      if (srcBase && tgtBase) {
        sources.add(srcBase);
        targets.add(tgtBase);
      }
    }

    // Connect Initial node to actions that are entry points
    if (sources.size === 0 && targets.size === 0) {
      if (actions.length > 0) {
        const tgtId = nodeMap.get(actions[0]!.name)!;
        engine.addEdge(initNodeId, tgtId, ActivityEdgeKind.Control);
      }
    } else {
      for (const act of actions) {
        if (!targets.has(act.name) && sources.has(act.name) && act.kind !== "merge" && act.kind !== "join") {
          const tgtId = nodeMap.get(act.name)!;
          engine.addEdge(initNodeId, tgtId, ActivityEdgeKind.Control);
        }
      }
    }

    // Order `else` / `default` branches after explicit guarded branches so Decision evaluates specific guards first
    const orderedSuccessions = [...successions].sort((a, b) => {
      const aElse = isElseGuard(a.guard) ? 1 : 0;
      const bElse = isElseGuard(b.guard) ? 1 : 0;
      return aElse - bElse;
    });

    // If an Action node has guarded outgoing control edges, route them via a synthetic Decision router node
    const actionGuardRouterIds = new Map<string, number>();
    for (const s of orderedSuccessions) {
      const srcBase = resolveNodeBaseName(s.source, nodeMap);
      const tgtBase = resolveNodeBaseName(s.target, nodeMap);
      if (!srcBase || !tgtBase) continue;
      if (s.kind !== "object" && s.guard && s.guard.trim() && s.guard.trim().toLowerCase() !== "true") {
        if (actionKindByName.get(srcBase) === "action" && !actionGuardRouterIds.has(srcBase)) {
          const routerId = engine.addNode(`__guard_${srcBase}__`, ActivityNodeKind.Decision);
          engine.addEdge(nodeMap.get(srcBase)!, routerId, ActivityEdgeKind.Control);
          actionGuardRouterIds.set(srcBase, routerId);
        }
      }
    }

    // Connect specified successions with guard callbacks and pin IDs
    for (const s of orderedSuccessions) {
      const srcBase = resolveNodeBaseName(s.source, nodeMap);
      const tgtBase = resolveNodeBaseName(s.target, nodeMap);
      if (!srcBase || !tgtBase) continue;

      const tgtId = nodeMap.get(tgtBase)!;
      const edgeKind = s.kind === "object" ? ActivityEdgeKind.Object : ActivityEdgeKind.Control;
      const srcId =
        edgeKind === ActivityEdgeKind.Control && actionGuardRouterIds.has(srcBase)
          ? actionGuardRouterIds.get(srcBase)!
          : nodeMap.get(srcBase)!;

      const guardFn = buildFumlEdgeGuard(s.guard);
      const sourcePinId = s.source.includes(".") ? engine.getPinId(s.source) : undefined;
      const targetPinId = s.target.includes(".") ? engine.getPinId(s.target) : undefined;

      engine.addEdge(srcId, tgtId, edgeKind, {
        guard: guardFn,
        sourcePinId,
        targetPinId,
      });
    }

    // Connect terminal actions to ActivityFinal
    if (sources.size === 0 && targets.size === 0) {
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

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis, Clock Calculus, Type Checking, and Causality Linter for `@modelscript/lustre`.
 *
 * Implements rules `LUST1001`–`LUST5006`:
 *   - Syntax errors (`LUST1001`)
 *   - Duplicate node / variable declarations (`LUST2001`, `LUST2002`)
 *   - Undefined variable / node references (`LUST2003`, `LUST2004`)
 *   - Type checking for `bool`, `int`, `real` (`LUST3001`, `LUST3003`)
 *   - Clock calculus checking for `when`, `current`, `merge`, binary ops (`LUST3002`)
 *   - Instantaneous algebraic causality cycle detection without `pre` (`LUST4001`)
 *   - Uninitialized `pre` without `->` guard (`LUST4002`)
 *   - Output completeness, single assignment, input protection, pure functions, assertions (`LUST5001`–`LUST5006`)
 */

import { LUSTRE_OPERATOR_SPECS } from "../catalog/lustre-std-schemas.js";
import { LustreErrorCode, type LustreDiagnostic } from "../errors.js";
import { parseLustre } from "../parser/lustre-parser.js";
import type {
  LustreClock,
  LustreExpr,
  LustreNodeDecl,
  LustreProgram,
  LustreSpan,
  LustreType,
  LustreVarDecl,
} from "../types.js";

export { LustreErrorCode, type LustreDiagnostic };

function formatType(t: LustreType): string {
  if (t.kind === "base") return t.name;
  if (t.kind === "named") return t.name;
  return `${formatType(t.element)}^${t.size}`;
}

export function formatClock(c: LustreClock): string {
  if (c.kind === "base") return "base";
  const parent = c.parent.kind === "base" ? "" : `${formatClock(c.parent)} `;
  return `${parent}on ${c.negated ? "not " : ""}${c.clockVar}`;
}

function clocksEqual(a: LustreClock, b: LustreClock): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "base") return true;
  if (b.kind === "on") {
    return a.clockVar === b.clockVar && a.negated === b.negated && clocksEqual(a.parent, b.parent);
  }
  return false;
}

function resolveTypeAlias(t: LustreType, typeMap: Map<string, LustreType>, depth = 0): string {
  if (depth > 8) return formatType(t);
  if (t.kind === "base") return t.name;
  if (t.kind === "named") {
    const aliased = typeMap.get(t.name);
    if (aliased) return resolveTypeAlias(aliased, typeMap, depth + 1);
    return t.name;
  }
  return `${resolveTypeAlias(t.element, typeMap, depth + 1)}^${t.size}`;
}

function exprSummary(expr: LustreExpr): string {
  switch (expr.kind) {
    case "bool":
      return String(expr.value);
    case "int":
    case "real":
      return String(expr.value);
    case "var":
      return expr.name;
    case "unary":
      return `${expr.op}(${exprSummary(expr.operand)})`;
    case "binary":
      return `${exprSummary(expr.left)} ${expr.op} ${exprSummary(expr.right)}`;
    case "if":
      return `if ${exprSummary(expr.cond)} then ... else ...`;
    case "merge":
      return `merge ${expr.clockVar} (...) (...)`;
    case "call":
      return `${expr.callee}(...)`;
    case "tuple":
      return `(${expr.elements.map(exprSummary).join(", ")})`;
    case "array":
      return `[${expr.elements.map(exprSummary).join(", ")}]`;
    case "index":
      return `${exprSummary(expr.array)}[${exprSummary(expr.index)}]`;
  }
}

function makeDiag(
  spec: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span?: LustreSpan,
  extra?: { nodeName?: string; symbolName?: string },
): LustreDiagnostic {
  return {
    code: spec.code,
    id: spec.id,
    rule: spec.rule,
    severity: spec.severity,
    message,
    startOffset: span?.startOffset,
    endOffset: span?.endOffset,
    line: span?.line,
    column: span?.column,
    endLine: span?.endLine,
    endColumn: span?.endColumn,
    nodeName: extra?.nodeName,
    symbolName: extra?.symbolName,
  };
}

interface NodeSignature {
  inputs: string[];
  outputs: string[];
  kind: "node" | "function";
}

function buildBuiltinSignatures(): Map<string, NodeSignature> {
  const sigs = new Map<string, NodeSignature>();
  sigs.set("int", { inputs: ["real"], outputs: ["int"], kind: "function" });
  sigs.set("real", { inputs: ["int"], outputs: ["real"], kind: "function" });
  sigs.set("floor", { inputs: ["real"], outputs: ["int"], kind: "function" });
  for (const op of LUSTRE_OPERATOR_SPECS) {
    const sig: NodeSignature = {
      inputs: op.inputs.map((i) => i.type),
      outputs: op.outputs.map((o) => o.type),
      kind: "node",
    };
    sigs.set(op.name, sig);
    for (const alias of op.aliases ?? []) {
      sigs.set(alias, sig);
    }
  }
  return sigs;
}

/**
 * Runs full static analysis (syntax, naming, types, clocks, causality, initialization, completeness)
 * on a parsed `LustreProgram`.
 */
export function lintLustre(program: LustreProgram): LustreDiagnostic[] {
  const diags: LustreDiagnostic[] = [];

  // 1. Propagate syntax errors (LUST1001)
  for (const err of program.syntaxErrors) {
    diags.push(makeDiag(LustreErrorCode.SYNTAX_ERROR, LustreErrorCode.SYNTAX_ERROR.message(err.message), err.span));
  }

  // 2. Collect top-level types, constants, and node signatures
  const typeMap = new Map<string, LustreType>();
  for (const td of program.types) {
    if (td.alias) typeMap.set(td.name, td.alias);
  }

  const constTypes = new Map<string, string>();
  const seenConsts = new Set<string>();
  for (const c of program.consts) {
    if (seenConsts.has(c.name)) {
      diags.push(
        makeDiag(
          LustreErrorCode.DUPLICATE_VARIABLE,
          LustreErrorCode.DUPLICATE_VARIABLE.message(c.name, "global const"),
          c.span,
          { symbolName: c.name },
        ),
      );
    } else {
      seenConsts.add(c.name);
    }
    if (c.type) {
      constTypes.set(c.name, resolveTypeAlias(c.type, typeMap));
    } else if (c.value) {
      if (c.value.kind === "bool") constTypes.set(c.name, "bool");
      else if (c.value.kind === "int") constTypes.set(c.name, "int");
      else if (c.value.kind === "real") constTypes.set(c.name, "real");
      else constTypes.set(c.name, "unknown");
    } else {
      constTypes.set(c.name, "unknown");
    }
  }

  const nodeSigs = buildBuiltinSignatures();
  const seenNodes = new Set<string>();
  for (const node of program.nodes) {
    if (seenNodes.has(node.name)) {
      diags.push(
        makeDiag(LustreErrorCode.DUPLICATE_NODE, LustreErrorCode.DUPLICATE_NODE.message(node.name), node.span, {
          nodeName: node.name,
        }),
      );
    } else {
      seenNodes.add(node.name);
    }
    nodeSigs.set(node.name, {
      inputs: node.inputs.map((v) => resolveTypeAlias(v.type, typeMap)),
      outputs: node.outputs.map((v) => resolveTypeAlias(v.type, typeMap)),
      kind: node.kind,
    });
  }

  // 3. Analyze each node/function
  for (const node of program.nodes) {
    lintNode(node, typeMap, constTypes, nodeSigs, diags);
  }

  return diags;
}

interface InferredInfo {
  type: string; // "bool" | "int" | "real" | "unknown" | tuple string
  clock: LustreClock | null; // null = polymorphic (e.g., literal constant)
}

function lintNode(
  node: LustreNodeDecl,
  typeMap: Map<string, LustreType>,
  constTypes: Map<string, string>,
  nodeSigs: Map<string, NodeSignature>,
  diags: LustreDiagnostic[],
): void {
  const varMap = new Map<string, LustreVarDecl>();
  const varResolvedType = new Map<string, string>();
  const inputNames = new Set<string>();
  const outputNames = new Set<string>();
  const localNames = new Set<string>();
  const referencedVars = new Set<string>();

  for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
    if (varMap.has(v.name)) {
      diags.push(
        makeDiag(
          LustreErrorCode.DUPLICATE_VARIABLE,
          LustreErrorCode.DUPLICATE_VARIABLE.message(v.name, node.name),
          v.span,
          { nodeName: node.name, symbolName: v.name },
        ),
      );
    } else {
      varMap.set(v.name, v);
      varResolvedType.set(v.name, resolveTypeAlias(v.type, typeMap));
    }
    if (v.role === "input") inputNames.add(v.name);
    else if (v.role === "output") outputNames.add(v.name);
    else localNames.add(v.name);
  }

  // Track definitions for completeness & single-assignment
  const definedVars = new Set<string>();
  // Instantaneous dependency graph (var -> Set<var> not guarded by `pre`)
  const instDeps = new Map<string, Set<string>>();

  const addInstDep = (lhsName: string, depName: string): void => {
    let set = instDeps.get(lhsName);
    if (!set) {
      set = new Set<string>();
      instDeps.set(lhsName, set);
    }
    set.add(depName);
  };

  /**
   * Walks expression to:
   *  - resolve identifiers (`LUST2003`, `LUST2004`)
   *  - infer type (`LUST3001`, `LUST3003`)
   *  - check clock calculus (`LUST3002`)
   *  - collect instantaneous dependencies (`LUST4001`)
   *  - check uninitialized `pre` (`LUST4002`)
   *  - check temporal operators in `function` (`LUST5004`)
   */
  const checkExpr = (
    expr: LustreExpr,
    currentLhs: string[] | null,
    insidePre: boolean,
    guardedByArrowRhs: boolean,
  ): InferredInfo => {
    switch (expr.kind) {
      case "bool":
        return { type: "bool", clock: null };
      case "int":
        return { type: "int", clock: null };
      case "real":
        return { type: "real", clock: null };
      case "var": {
        referencedVars.add(expr.name);
        if (!insidePre && currentLhs) {
          for (const lhs of currentLhs) addInstDep(lhs, expr.name);
        }
        const decl = varMap.get(expr.name);
        if (decl) {
          return { type: varResolvedType.get(expr.name) ?? "unknown", clock: decl.clock };
        }
        const cType = constTypes.get(expr.name);
        if (cType !== undefined) {
          return { type: cType, clock: null };
        }
        diags.push(
          makeDiag(
            LustreErrorCode.UNDEFINED_VARIABLE,
            LustreErrorCode.UNDEFINED_VARIABLE.message(expr.name, node.name),
            expr.span,
            { nodeName: node.name, symbolName: expr.name },
          ),
        );
        return { type: "unknown", clock: null };
      }
      case "unary": {
        if (expr.op === "pre") {
          if (node.kind === "function") {
            diags.push(
              makeDiag(
                LustreErrorCode.PRE_IN_FUNCTION,
                LustreErrorCode.PRE_IN_FUNCTION.message("pre", node.name),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          if (!guardedByArrowRhs) {
            diags.push(
              makeDiag(
                LustreErrorCode.UNINITIALIZED_PRE,
                LustreErrorCode.UNINITIALIZED_PRE.message(exprSummary(expr), node.name),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          const inner = checkExpr(expr.operand, currentLhs, true, guardedByArrowRhs);
          return inner;
        }
        if (expr.op === "current") {
          const inner = checkExpr(expr.operand, currentLhs, insidePre, guardedByArrowRhs);
          const parentClock: LustreClock =
            inner.clock && inner.clock.kind === "on" ? inner.clock.parent : { kind: "base" };
          return { type: inner.type, clock: parentClock };
        }
        const inner = checkExpr(expr.operand, currentLhs, insidePre, guardedByArrowRhs);
        if (expr.op === "not") {
          if (inner.type !== "unknown" && inner.type !== "bool") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("bool", inner.type, "unary 'not'"),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          return { type: "bool", clock: inner.clock };
        }
        // unary '-'
        if (inner.type !== "unknown" && inner.type !== "int" && inner.type !== "real") {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message("int | real", inner.type, "unary '-'"),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        return inner;
      }
      case "binary": {
        if (expr.op === "->") {
          if (node.kind === "function") {
            diags.push(
              makeDiag(
                LustreErrorCode.PRE_IN_FUNCTION,
                LustreErrorCode.PRE_IN_FUNCTION.message("->", node.name),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          const l = checkExpr(expr.left, currentLhs, insidePre, guardedByArrowRhs);
          const r = checkExpr(expr.right, currentLhs, insidePre, true);
          if (l.type !== "unknown" && r.type !== "unknown" && l.type !== r.type) {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message(l.type, r.type, "operator '->'"),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          if (l.clock && r.clock && !clocksEqual(l.clock, r.clock)) {
            diags.push(
              makeDiag(
                LustreErrorCode.CLOCK_MISMATCH,
                LustreErrorCode.CLOCK_MISMATCH.message(formatClock(l.clock), formatClock(r.clock), "operator '->'"),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          return { type: l.type !== "unknown" ? l.type : r.type, clock: l.clock ?? r.clock };
        }

        if (expr.op === "when") {
          const l = checkExpr(expr.left, currentLhs, insidePre, guardedByArrowRhs);
          const r = checkExpr(expr.right, currentLhs, insidePre, guardedByArrowRhs);
          if (r.type !== "unknown" && r.type !== "bool") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("bool", r.type, "clock condition of 'when'"),
                expr.right.span,
                { nodeName: node.name },
              ),
            );
          }
          let clockVar = "c";
          let negated = false;
          if (expr.right.kind === "var") {
            clockVar = expr.right.name;
          } else if (expr.right.kind === "unary" && expr.right.op === "not" && expr.right.operand.kind === "var") {
            clockVar = expr.right.operand.name;
            negated = true;
          }
          const parentClock = l.clock ?? { kind: "base" };
          return {
            type: l.type,
            clock: { kind: "on", clockVar, negated, parent: parentClock },
          };
        }

        const l = checkExpr(expr.left, currentLhs, insidePre, guardedByArrowRhs);
        const r = checkExpr(expr.right, currentLhs, insidePre, guardedByArrowRhs);

        // Clock compatibility check
        if (l.clock && r.clock && !clocksEqual(l.clock, r.clock)) {
          diags.push(
            makeDiag(
              LustreErrorCode.CLOCK_MISMATCH,
              LustreErrorCode.CLOCK_MISMATCH.message(
                formatClock(l.clock),
                formatClock(r.clock),
                `binary operator '${expr.op}'`,
              ),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        const mergedClock = l.clock ?? r.clock;

        if (expr.op === "and" || expr.op === "or" || expr.op === "xor" || expr.op === "=>") {
          if (l.type !== "unknown" && l.type !== "bool") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("bool", l.type, `left operand of '${expr.op}'`),
                expr.left.span,
                { nodeName: node.name },
              ),
            );
          }
          if (r.type !== "unknown" && r.type !== "bool") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("bool", r.type, `right operand of '${expr.op}'`),
                expr.right.span,
                { nodeName: node.name },
              ),
            );
          }
          return { type: "bool", clock: mergedClock };
        }

        if (expr.op === "div" || expr.op === "mod") {
          if (l.type !== "unknown" && l.type !== "int") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("int", l.type, `left operand of '${expr.op}'`),
                expr.left.span,
                { nodeName: node.name },
              ),
            );
          }
          if (r.type !== "unknown" && r.type !== "int") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("int", r.type, `right operand of '${expr.op}'`),
                expr.right.span,
                { nodeName: node.name },
              ),
            );
          }
          return { type: "int", clock: mergedClock };
        }

        if (expr.op === "+" || expr.op === "-" || expr.op === "*" || expr.op === "/") {
          if (l.type !== "unknown" && l.type !== "int" && l.type !== "real") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("int | real", l.type, `left operand of '${expr.op}'`),
                expr.left.span,
                { nodeName: node.name },
              ),
            );
          }
          if (r.type !== "unknown" && r.type !== "int" && r.type !== "real") {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message("int | real", r.type, `right operand of '${expr.op}'`),
                expr.right.span,
                { nodeName: node.name },
              ),
            );
          }
          if (l.type !== "unknown" && r.type !== "unknown" && l.type !== r.type) {
            diags.push(
              makeDiag(
                LustreErrorCode.TYPE_MISMATCH,
                LustreErrorCode.TYPE_MISMATCH.message(l.type, r.type, `binary operator '${expr.op}'`),
                expr.span,
                { nodeName: node.name },
              ),
            );
          }
          return { type: l.type !== "unknown" ? l.type : r.type, clock: mergedClock };
        }

        // Relational operators (=, <>, <, <=, >, >=)
        if (l.type !== "unknown" && r.type !== "unknown" && l.type !== r.type) {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message(l.type, r.type, `relational operator '${expr.op}'`),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        return { type: "bool", clock: mergedClock };
      }
      case "if": {
        const c = checkExpr(expr.cond, currentLhs, insidePre, guardedByArrowRhs);
        const t = checkExpr(expr.thenExpr, currentLhs, insidePre, guardedByArrowRhs);
        const e = checkExpr(expr.elseExpr, currentLhs, insidePre, guardedByArrowRhs);
        if (c.type !== "unknown" && c.type !== "bool") {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message("bool", c.type, "'if' condition"),
              expr.cond.span,
              { nodeName: node.name },
            ),
          );
        }
        if (t.type !== "unknown" && e.type !== "unknown" && t.type !== e.type) {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message(t.type, e.type, "'if ... then ... else' branches"),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        if (t.clock && e.clock && !clocksEqual(t.clock, e.clock)) {
          diags.push(
            makeDiag(
              LustreErrorCode.CLOCK_MISMATCH,
              LustreErrorCode.CLOCK_MISMATCH.message(
                formatClock(t.clock),
                formatClock(e.clock),
                "'if ... then ... else' branches",
              ),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        return { type: t.type !== "unknown" ? t.type : e.type, clock: c.clock ?? t.clock ?? e.clock };
      }
      case "merge": {
        referencedVars.add(expr.clockVar);
        if (!insidePre && currentLhs) {
          for (const lhs of currentLhs) addInstDep(lhs, expr.clockVar);
        }
        const clkDecl = varMap.get(expr.clockVar);
        if (!clkDecl) {
          diags.push(
            makeDiag(
              LustreErrorCode.UNDEFINED_VARIABLE,
              LustreErrorCode.UNDEFINED_VARIABLE.message(expr.clockVar, node.name),
              expr.span,
              { nodeName: node.name, symbolName: expr.clockVar },
            ),
          );
        }
        const t = checkExpr(expr.trueExpr, currentLhs, insidePre, guardedByArrowRhs);
        const f = checkExpr(expr.falseExpr, currentLhs, insidePre, guardedByArrowRhs);
        if (t.type !== "unknown" && f.type !== "unknown" && t.type !== f.type) {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message(t.type, f.type, "'merge' branches"),
              expr.span,
              { nodeName: node.name },
            ),
          );
        }
        return { type: t.type !== "unknown" ? t.type : f.type, clock: clkDecl?.clock ?? { kind: "base" } };
      }
      case "call": {
        const argInfos = expr.args.map((a) => checkExpr(a, currentLhs, insidePre, guardedByArrowRhs));
        const sig = nodeSigs.get(expr.callee);
        if (!sig) {
          diags.push(
            makeDiag(
              LustreErrorCode.UNDEFINED_NODE,
              LustreErrorCode.UNDEFINED_NODE.message(expr.callee, node.name),
              expr.span,
              { nodeName: node.name, symbolName: expr.callee },
            ),
          );
          return { type: "unknown", clock: null };
        }
        if (sig.inputs.length !== expr.args.length) {
          diags.push(
            makeDiag(
              LustreErrorCode.NODE_ARITY_MISMATCH,
              LustreErrorCode.NODE_ARITY_MISMATCH.message(expr.callee, sig.inputs.length, expr.args.length),
              expr.span,
              { nodeName: node.name, symbolName: expr.callee },
            ),
          );
        } else {
          for (let i = 0; i < sig.inputs.length; i++) {
            const expected = sig.inputs[i]!;
            const actual = argInfos[i]!.type;
            if (actual !== "unknown" && expected !== "unknown" && actual !== expected) {
              diags.push(
                makeDiag(
                  LustreErrorCode.TYPE_MISMATCH,
                  LustreErrorCode.TYPE_MISMATCH.message(expected, actual, `argument ${i + 1} of '${expr.callee}'`),
                  expr.args[i]!.span,
                  { nodeName: node.name, symbolName: expr.callee },
                ),
              );
            }
          }
        }
        const firstClock = argInfos.find((a) => a.clock !== null)?.clock ?? null;
        return {
          type: sig.outputs.length === 1 ? sig.outputs[0]! : `(${sig.outputs.join(", ")})`,
          clock: firstClock,
        };
      }
      case "tuple": {
        const infos = expr.elements.map((e) => checkExpr(e, currentLhs, insidePre, guardedByArrowRhs));
        return {
          type: `(${infos.map((i) => i.type).join(", ")})`,
          clock: infos.find((i) => i.clock !== null)?.clock ?? null,
        };
      }
      case "array": {
        const infos = expr.elements.map((e) => checkExpr(e, currentLhs, insidePre, guardedByArrowRhs));
        const elemType = infos[0]?.type ?? "unknown";
        return { type: `${elemType}^${expr.elements.length}`, clock: infos[0]?.clock ?? null };
      }
      case "index": {
        const arr = checkExpr(expr.array, currentLhs, insidePre, guardedByArrowRhs);
        const idx = checkExpr(expr.index, currentLhs, insidePre, guardedByArrowRhs);
        if (idx.type !== "unknown" && idx.type !== "int") {
          diags.push(
            makeDiag(
              LustreErrorCode.TYPE_MISMATCH,
              LustreErrorCode.TYPE_MISMATCH.message("int", idx.type, "array subscript"),
              expr.index.span,
              { nodeName: node.name },
            ),
          );
        }
        const base = arr.type.includes("^") ? arr.type.slice(0, arr.type.lastIndexOf("^")) : "unknown";
        return { type: base, clock: arr.clock };
      }
    }
  };

  // 4. Check equations
  for (const eq of node.equations) {
    for (const name of eq.lhs) {
      if (inputNames.has(name)) {
        diags.push(
          makeDiag(
            LustreErrorCode.INPUT_ASSIGNMENT,
            LustreErrorCode.INPUT_ASSIGNMENT.message(name, node.name),
            eq.span,
            { nodeName: node.name, symbolName: name },
          ),
        );
      } else if (!varMap.has(name)) {
        diags.push(
          makeDiag(
            LustreErrorCode.UNDEFINED_VARIABLE,
            LustreErrorCode.UNDEFINED_VARIABLE.message(name, node.name),
            eq.span,
            { nodeName: node.name, symbolName: name },
          ),
        );
      }
      if (definedVars.has(name)) {
        diags.push(
          makeDiag(
            LustreErrorCode.MULTIPLE_DEFINITION,
            LustreErrorCode.MULTIPLE_DEFINITION.message(name, node.name),
            eq.span,
            { nodeName: node.name, symbolName: name },
          ),
        );
      }
      definedVars.add(name);
    }

    const rhsInfo = checkExpr(eq.rhs, eq.lhs, false, false);

    if (eq.lhs.length === 1) {
      const lhsName = eq.lhs[0]!;
      const lhsDecl = varMap.get(lhsName);
      const lhsType = varResolvedType.get(lhsName);
      if (lhsType && rhsInfo.type !== "unknown" && !rhsInfo.type.startsWith("(") && lhsType !== rhsInfo.type) {
        diags.push(
          makeDiag(
            LustreErrorCode.TYPE_MISMATCH,
            LustreErrorCode.TYPE_MISMATCH.message(lhsType, rhsInfo.type, `equation for '${lhsName}'`),
            eq.span,
            { nodeName: node.name, symbolName: lhsName },
          ),
        );
      }
      if (lhsDecl && rhsInfo.clock && !clocksEqual(lhsDecl.clock, rhsInfo.clock)) {
        diags.push(
          makeDiag(
            LustreErrorCode.CLOCK_MISMATCH,
            LustreErrorCode.CLOCK_MISMATCH.message(
              formatClock(lhsDecl.clock),
              formatClock(rhsInfo.clock),
              `equation for '${lhsName}'`,
            ),
            eq.span,
            { nodeName: node.name, symbolName: lhsName },
          ),
        );
      }
    }
  }

  // 5. Check assertions
  for (const a of node.assertions) {
    const info = checkExpr(a.expr, null, false, false);
    if (info.type !== "unknown" && info.type !== "bool") {
      diags.push(
        makeDiag(
          LustreErrorCode.ASSERTION_NOT_BOOL,
          LustreErrorCode.ASSERTION_NOT_BOOL.message(info.type, node.name),
          a.span,
          { nodeName: node.name },
        ),
      );
    }
  }

  // 6. Missing output equations (LUST5001)
  for (const out of node.outputs) {
    if (!definedVars.has(out.name)) {
      diags.push(
        makeDiag(
          LustreErrorCode.MISSING_OUTPUT_EQUATION,
          LustreErrorCode.MISSING_OUTPUT_EQUATION.message(out.name, node.name),
          out.span,
          { nodeName: node.name, symbolName: out.name },
        ),
      );
    }
  }

  // 7. Unused local variables (LUST5006)
  for (const loc of node.locals) {
    if (!referencedVars.has(loc.name) && !outputNames.has(loc.name)) {
      diags.push(
        makeDiag(
          LustreErrorCode.UNUSED_LOCAL_VARIABLE,
          LustreErrorCode.UNUSED_LOCAL_VARIABLE.message(loc.name, node.name),
          loc.span,
          { nodeName: node.name, symbolName: loc.name },
        ),
      );
    }
  }

  // 8. Instantaneous algebraic causality cycle detection (LUST4001)
  detectCausalityCycles(node, instDeps, diags);
}

function detectCausalityCycles(
  node: LustreNodeDecl,
  instDeps: Map<string, Set<string>>,
  diags: LustreDiagnostic[],
): void {
  // 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (u: string): void => {
    state.set(u, 1);
    stack.push(u);
    const neighbors = instDeps.get(u);
    if (neighbors) {
      for (const v of neighbors) {
        const st = state.get(v) ?? 0;
        if (st === 1) {
          const idx = stack.indexOf(v);
          const cycleNodes = [...stack.slice(idx), v];
          const key = [...cycleNodes].sort().join(",");
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            const eq = node.equations.find((e) => e.lhs.includes(v));
            diags.push(
              makeDiag(
                LustreErrorCode.CAUSALITY_CYCLE,
                LustreErrorCode.CAUSALITY_CYCLE.message(cycleNodes.join(" -> "), node.name),
                eq?.span ?? node.span,
                { nodeName: node.name, symbolName: v },
              ),
            );
          }
        } else if (st === 0 && instDeps.has(v)) {
          dfs(v);
        }
      }
    }
    stack.pop();
    state.set(u, 2);
  };

  for (const v of instDeps.keys()) {
    if ((state.get(v) ?? 0) === 0) {
      dfs(v);
    }
  }
}

/**
 * Convenience helper: parses and lints Lustre source code in one call.
 */
export function lintLustreSource(source: string): LustreDiagnostic[] {
  return lintLustre(parseLustre(source));
}

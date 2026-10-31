// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Direct Linear-Memory DAE Lowering.
 *
 * Emits continuous variables, branch potentials, currents, and differential
 * dynamic states (ddt -> der) directly into ModelScript's zero-GC `DAEBuilder` arena.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  UnaryOp,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { VerilogAExpr, VerilogAModule, VerilogAStatement } from "../types.js";

const DEFAULT_VT = 0.0258519; // Thermal voltage at 300 K (k*T/q)
const DEFAULT_TEMP = 300.15; // Room temperature (K)

export function lowerVerilogAToDae(module: VerilogAModule, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? module.name;
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  // 1. Declare Parameters in Arena
  const paramVarMap = new Map<string, number>();
  const paramExprMap = new Map<string, number>();

  for (const param of module.parameters) {
    const pNameId = interner.intern(param.name);
    const pVarIdx = arena.addVariable(
      param.name,
      param.type === "integer" ? VarType.Integer : VarType.Real,
      Variability.Parameter,
      Causality.Local,
    );
    const pExprId = arena.addExpression(ExprKind.Name, pNameId);
    paramVarMap.set(param.name, pVarIdx);
    paramExprMap.set(param.name, pExprId);

    const val = typeof param.defaultValue === "number" ? param.defaultValue : 0.0;
    const litId = arena.addRealLiteral(val);
    arena.addEquation(EqKind.Simple, pExprId, litId);
  }

  // 2. Collect Nodes (Ports + Internal Nodes + Ground)
  const nodeNames = new Set<string>();
  nodeNames.add("0");

  for (const p of module.ports) {
    nodeNames.add(p.name);
  }
  for (const n of module.internalNodes) {
    nodeNames.add(n);
  }

  // Also collect nodes referenced in branch contributions or accesses
  if (module.analogBlock) {
    collectNodesFromStatements(module.analogBlock.statements, nodeNames);
  }

  // 3. Declare Node Voltage Variables in DAE Arena
  const nodeVarMap = new Map<string, number>();
  const nodeExprMap = new Map<string, number>();

  for (const node of nodeNames) {
    const isGround = node === "0" || node.toLowerCase() === "gnd";
    const vName = isGround ? "v_0" : `v_${node}`;
    const nameId = interner.intern(vName);
    const varIdx = arena.addVariable(
      vName,
      VarType.Real,
      isGround ? Variability.Constant : Variability.Continuous,
      isGround ? Causality.Input : Causality.Local,
    );
    const exprId = arena.addExpression(ExprKind.Name, nameId);
    nodeVarMap.set(node, varIdx);
    nodeExprMap.set(node, exprId);

    if (isGround) {
      const zeroLit = arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, exprId, zeroLit);
    }
  }

  // 4. Declare Module Variables (e.g. real Vd, Id, Qd)
  const varMap = new Map<string, number>();
  const varExprMap = new Map<string, number>();

  for (const v of module.variables) {
    const vNameId = interner.intern(v.name);
    const vIdx = arena.addVariable(
      v.name,
      v.type === "integer" ? VarType.Integer : VarType.Real,
      Variability.Continuous,
      Causality.Local,
    );
    const vExprId = arena.addExpression(ExprKind.Name, vNameId);
    varMap.set(v.name, vIdx);
    varExprMap.set(v.name, vExprId);
  }

  // 5. Track KCL contributions per node: node -> exprId[]
  const nodeKcl = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const addCurrentToNode = (node: string, currentExprId: number, isLeaving: boolean) => {
    const isGround = node === "0" || node.toLowerCase() === "gnd";
    if (isGround) return;
    const list = nodeKcl.get(node) ?? [];
    list.push({ exprId: currentExprId, isLeaving });
    nodeKcl.set(node, list);
  };

  const branchCurrentExprMap = new Map<string, number>();
  const getOrAddBranchCurrent = (n1: string, n2: string): number => {
    const key = `${n1}:${n2}`;
    const existing = branchCurrentExprMap.get(key);
    if (existing !== undefined) return existing;

    const branchCurrentName = `i_${n1}_${n2}`;
    const bNameId = interner.intern(branchCurrentName);
    arena.addVariable(branchCurrentName, VarType.Real, Variability.Continuous, Causality.Local);
    const bExprId = arena.addExpression(ExprKind.Name, bNameId);
    branchCurrentExprMap.set(key, bExprId);

    addCurrentToNode(n1, bExprId, true);
    addCurrentToNode(n2, bExprId, false);
    return bExprId;
  };

  const varAssignments = new Map<string, number>();
  const branchContributions = new Map<string, { nature: "I" | "V"; n1: string; n2: string; exprIds: number[] }>();

  // Helper context for expression compiler
  const compilerCtx: CompilerContext = {
    arena,
    interner,
    nodeExprMap,
    paramExprMap,
    varExprMap,
    varAssignments,
    getOrAddBranchCurrent,
  };

  // 6. Compile Statements in Analog Block
  if (module.analogBlock) {
    compileStatements(module.analogBlock.statements, compilerCtx, branchContributions);
  }

  // 7. Emit Equations for Module Variables (1 equation per variable)
  for (const v of module.variables) {
    const lhsExpr = varExprMap.get(v.name);
    if (lhsExpr !== undefined) {
      const rhsExpr = varAssignments.get(v.name) ?? arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
    }
  }

  // 8. Emit Accumulated Branch Constitutive Equations (1 equation per branch)
  const constrainedBranches = new Set<string>();
  for (const [, bInfo] of branchContributions.entries()) {
    const firstExpr = bInfo.exprIds[0];
    if (firstExpr === undefined) continue;
    let sumRhs = firstExpr;
    for (let i = 1; i < bInfo.exprIds.length; i++) {
      const e = bInfo.exprIds[i];
      if (e !== undefined) {
        sumRhs = arena.addExpression(ExprKind.Binary, BinOp.Add, sumRhs, e);
      }
    }

    const pairKey = `${bInfo.n1}:${bInfo.n2}`;
    const bCurrExpr = getOrAddBranchCurrent(bInfo.n1, bInfo.n2);
    if (bInfo.nature === "I" && !constrainedBranches.has(pairKey)) {
      arena.addEquation(EqKind.Simple, bCurrExpr, sumRhs);
      constrainedBranches.add(pairKey);
    } else if (bInfo.nature === "V" && !constrainedBranches.has(pairKey)) {
      const v1Expr = nodeExprMap.get(bInfo.n1) ?? arena.addRealLiteral(0.0);
      const v2Expr = nodeExprMap.get(bInfo.n2) ?? arena.addRealLiteral(0.0);
      const vDiff = arena.addExpression(ExprKind.Binary, BinOp.Sub, v1Expr, v2Expr);
      arena.addEquation(EqKind.Simple, vDiff, sumRhs);
      constrainedBranches.add(pairKey);
    } else {
      // Additional nature on same node pair
      const auxName = `b_${bKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const auxId = interner.intern(auxName);
      arena.addVariable(auxName, VarType.Real, Variability.Continuous, Causality.Local);
      const auxExpr = arena.addExpression(ExprKind.Name, auxId);
      arena.addEquation(EqKind.Simple, auxExpr, sumRhs);
    }
  }

  // If any branch current was referenced in an expression (e.g. I(p, n)) without a branch contribution on (p, n),
  // bind it to 0.0 so it is not left unconstrained
  for (const [pairKey, bExprId] of branchCurrentExprMap.entries()) {
    if (!constrainedBranches.has(pairKey)) {
      arena.addEquation(EqKind.Simple, bExprId, arena.addRealLiteral(0.0));
      constrainedBranches.add(pairKey);
    }
  }

  // 9. Emit KCL Equations for All Non-Ground Nodes (1 equation per non-ground node)
  for (const node of nodeNames) {
    const isGround = node === "0" || node.toLowerCase() === "gnd";
    if (isGround) continue;

    const contributions = nodeKcl.get(node) ?? [];
    if (contributions.length === 0) {
      const vExpr = nodeExprMap.get(node) ?? arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, vExpr, arena.addRealLiteral(0.0));
      continue;
    }

    let sumExprId: number | undefined;
    for (const c of contributions) {
      const termExpr = c.isLeaving ? c.exprId : arena.addUnaryExpr(UnaryOp.Negate, c.exprId);

      if (sumExprId === undefined) {
        sumExprId = termExpr;
      } else {
        sumExprId = arena.addExpression(ExprKind.Binary, BinOp.Add, sumExprId, termExpr);
      }
    }

    if (sumExprId !== undefined) {
      const zeroLit = arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, sumExprId, zeroLit);
    }
  }

  return arena;
}

interface CompilerContext {
  arena: DAEBuilder;
  interner: StringInterner;
  nodeExprMap: Map<string, number>;
  paramExprMap: Map<string, number>;
  varExprMap: Map<string, number>;
  varAssignments: Map<string, number>;
  getOrAddBranchCurrent: (n1: string, n2: string) => number;
}

type BranchContribMap = Map<string, { nature: "I" | "V"; n1: string; n2: string; exprIds: number[] }>;

function recordBranchContribution(
  map: BranchContribMap,
  nature: "I" | "V",
  n1: string,
  n2: string,
  exprId: number,
): void {
  const key = `${nature}:${n1}:${n2}`;
  const entry = map.get(key) ?? { nature, n1, n2, exprIds: [] };
  entry.exprIds.push(exprId);
  map.set(key, entry);
}

function sumExprList(arena: DAEBuilder, exprIds: number[]): number {
  const first = exprIds[0];
  if (first === undefined) return arena.addRealLiteral(0.0);
  let acc = first;
  for (let i = 1; i < exprIds.length; i++) {
    const e = exprIds[i];
    if (e !== undefined) {
      acc = arena.addExpression(ExprKind.Binary, BinOp.Add, acc, e);
    }
  }
  return acc;
}

function collectNodesFromStatements(stmts: VerilogAStatement[], nodeSet: Set<string>): void {
  for (const stmt of stmts) {
    if (stmt.kind === "block") {
      collectNodesFromStatements(stmt.statements, nodeSet);
    } else if (stmt.kind === "if") {
      collectNodesFromExpr(stmt.condition, nodeSet);
      collectNodesFromStatements(stmt.thenBranch, nodeSet);
      if (stmt.elseBranch) collectNodesFromStatements(stmt.elseBranch, nodeSet);
    } else if (stmt.kind === "contribution") {
      nodeSet.add(stmt.lhs.node1);
      if (stmt.lhs.node2) nodeSet.add(stmt.lhs.node2);
      collectNodesFromExpr(stmt.rhs, nodeSet);
    } else if (stmt.kind === "assignment") {
      collectNodesFromExpr(stmt.rhs, nodeSet);
    }
  }
}

function collectNodesFromExpr(expr: VerilogAExpr, nodeSet: Set<string>): void {
  if (expr.kind === "branch_access") {
    nodeSet.add(expr.node1);
    if (expr.node2) nodeSet.add(expr.node2);
  } else if (expr.kind === "binary") {
    collectNodesFromExpr(expr.left, nodeSet);
    collectNodesFromExpr(expr.right, nodeSet);
  } else if (expr.kind === "unary") {
    collectNodesFromExpr(expr.argument, nodeSet);
  } else if (expr.kind === "ternary") {
    collectNodesFromExpr(expr.condition, nodeSet);
    collectNodesFromExpr(expr.consequent, nodeSet);
    collectNodesFromExpr(expr.alternate, nodeSet);
  } else if (expr.kind === "call") {
    for (const arg of expr.args) {
      collectNodesFromExpr(arg, nodeSet);
    }
  }
}

function compileStatements(
  stmts: VerilogAStatement[],
  ctx: CompilerContext,
  branchContributions: BranchContribMap,
): void {
  const { arena } = ctx;

  for (const stmt of stmts) {
    if (stmt.kind === "block") {
      compileStatements(stmt.statements, ctx, branchContributions);
      continue;
    }

    if (stmt.kind === "assignment") {
      const rhsExpr = compileExpression(stmt.rhs, ctx);
      ctx.varAssignments.set(stmt.variable, rhsExpr);
      continue;
    }

    if (stmt.kind === "if") {
      const condExpr = compileExpression(stmt.condition, ctx);

      const thenVars = new Map<string, number>(ctx.varAssignments);
      const thenBranches: BranchContribMap = new Map();
      compileStatements(stmt.thenBranch, { ...ctx, varAssignments: thenVars }, thenBranches);

      const elseVars = new Map<string, number>(ctx.varAssignments);
      const elseBranches: BranchContribMap = new Map();
      if (stmt.elseBranch) {
        compileStatements(stmt.elseBranch, { ...ctx, varAssignments: elseVars }, elseBranches);
      }

      // Merge variable assignments across then/else branches using addIfElse
      const allModifiedVars = new Set<string>();
      for (const [k, v] of thenVars.entries()) {
        if (ctx.varAssignments.get(k) !== v) allModifiedVars.add(k);
      }
      for (const [k, v] of elseVars.entries()) {
        if (ctx.varAssignments.get(k) !== v) allModifiedVars.add(k);
      }

      for (const vName of allModifiedVars) {
        const fallback = ctx.varAssignments.get(vName) ?? arena.addRealLiteral(0.0);
        const tVal = thenVars.get(vName) ?? fallback;
        const eVal = elseVars.get(vName) ?? fallback;
        ctx.varAssignments.set(vName, arena.addIfElse(condExpr, tVal, eVal));
      }

      // Merge branch contributions across then/else branches using addIfElse
      const allBranchKeys = new Set<string>([...thenBranches.keys(), ...elseBranches.keys()]);
      for (const bKey of allBranchKeys) {
        const tEntry = thenBranches.get(bKey);
        const eEntry = elseBranches.get(bKey);
        const meta = tEntry ?? eEntry;
        if (!meta) continue;
        const tSum = tEntry ? sumExprList(arena, tEntry.exprIds) : arena.addRealLiteral(0.0);
        const eSum = eEntry ? sumExprList(arena, eEntry.exprIds) : arena.addRealLiteral(0.0);
        const condBranchExpr = arena.addIfElse(condExpr, tSum, eSum);
        recordBranchContribution(branchContributions, meta.nature, meta.n1, meta.n2, condBranchExpr);
      }
      continue;
    }

    if (stmt.kind === "contribution") {
      const { lhs, rhs } = stmt;
      const rhsExpr = compileExpression(rhs, ctx);
      const n1 = lhs.node1;
      const n2 = lhs.node2 ?? "0";
      const nature: "I" | "V" = lhs.nature === "V" || lhs.nature === "Potential" ? "V" : "I";
      recordBranchContribution(branchContributions, nature, n1, n2, rhsExpr);
    }
  }
}

function compileExpression(expr: VerilogAExpr, ctx: CompilerContext): number {
  const { arena, interner, nodeExprMap, paramExprMap, varExprMap } = ctx;

  switch (expr.kind) {
    case "number":
      return arena.addRealLiteral(expr.value);

    case "identifier": {
      const paramExpr = paramExprMap.get(expr.name);
      if (paramExpr !== undefined) {
        return paramExpr;
      }
      const varExpr = varExprMap.get(expr.name);
      if (varExpr !== undefined) {
        return varExpr;
      }
      if (expr.name === "$vt") {
        return arena.addRealLiteral(DEFAULT_VT);
      }
      if (expr.name === "$temperature") {
        return arena.addRealLiteral(DEFAULT_TEMP);
      }
      const id = interner.intern(expr.name);
      return arena.addExpression(ExprKind.Name, id);
    }

    case "branch_access": {
      const n1 = expr.node1;
      const n2 = expr.node2 ?? "0";
      if (expr.nature === "I" || expr.nature === "Flow") {
        return ctx.getOrAddBranchCurrent(n1, n2);
      }
      const v1 = nodeExprMap.get(n1) ?? arena.addRealLiteral(0.0);
      const v2 = nodeExprMap.get(n2) ?? arena.addRealLiteral(0.0);
      return arena.addExpression(ExprKind.Binary, BinOp.Sub, v1, v2);
    }

    case "binary": {
      const l = compileExpression(expr.left, ctx);
      const r = compileExpression(expr.right, ctx);
      let op: BinOp;
      switch (expr.op) {
        case "+":
          op = BinOp.Add;
          break;
        case "-":
          op = BinOp.Sub;
          break;
        case "*":
          op = BinOp.Mul;
          break;
        case "/":
          op = BinOp.Div;
          break;
        case "^":
        case "**":
          op = BinOp.Pow;
          break;
        case "<":
          op = BinOp.Lt;
          break;
        case "<=":
          op = BinOp.Lte;
          break;
        case ">":
          op = BinOp.Gt;
          break;
        case ">=":
          op = BinOp.Gte;
          break;
        case "==":
          op = BinOp.Eq;
          break;
        case "!=":
          op = BinOp.Neq;
          break;
        case "&&":
          op = BinOp.And;
          break;
        case "||":
          op = BinOp.Or;
          break;
        default:
          op = BinOp.Add;
          break;
      }
      return arena.addExpression(ExprKind.Binary, op, l, r);
    }

    case "unary": {
      const arg = compileExpression(expr.argument, ctx);
      if (expr.op === "-") {
        return arena.addUnaryExpr(UnaryOp.Negate, arg);
      }
      if (expr.op === "!") {
        return arena.addUnaryExpr(UnaryOp.Not, arg);
      }
      return arg;
    }

    case "ternary": {
      const cond = compileExpression(expr.condition, ctx);
      const cons = compileExpression(expr.consequent, ctx);
      const alt = compileExpression(expr.alternate, ctx);
      return arena.addIfElse(cond, cons, alt);
    }

    case "call": {
      const firstArg = expr.args[0];

      // ddt(q) -> der(q)
      if (expr.func === "ddt" && firstArg) {
        const argExpr = compileExpression(firstArg, ctx);
        return arena.addExpression(ExprKind.Der, argExpr);
      }

      // limexp(x) or exp(x)
      if ((expr.func === "limexp" || expr.func === "exp") && firstArg) {
        const argExpr = compileExpression(firstArg, ctx);
        const expName = interner.intern("exp");
        const expIdent = arena.addExpression(ExprKind.Name, expName);
        return arena.addExpression(ExprKind.Call, expIdent, argExpr);
      }

      // Math calls: sin, cos, sqrt, ln
      if (firstArg) {
        const argExpr = compileExpression(firstArg, ctx);
        const funcNameId = interner.intern(expr.func);
        const funcIdent = arena.addExpression(ExprKind.Name, funcNameId);
        return arena.addExpression(ExprKind.Call, funcIdent, argExpr);
      }

      return arena.addRealLiteral(0.0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic Automatic Differentiation & Small-Signal Stamp Compiler (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

const DUMMY_RANGE = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

function makeNum(v: number): VerilogAExpr {
  return { kind: "number", value: v, raw: String(v), sourceRange: DUMMY_RANGE };
}

function makeBin(op: "+" | "-" | "*" | "/" | "**", left: VerilogAExpr, right: VerilogAExpr): VerilogAExpr {
  return simplifyVerilogAExpr({
    kind: "binary",
    op,
    left,
    right,
    sourceRange: left.sourceRange ?? DUMMY_RANGE,
  });
}

function makeUnary(op: "+" | "-" | "!", argument: VerilogAExpr): VerilogAExpr {
  return simplifyVerilogAExpr({
    kind: "unary",
    op,
    argument,
    sourceRange: argument.sourceRange ?? DUMMY_RANGE,
  });
}

function makeCall(func: string, args: VerilogAExpr[]): VerilogAExpr {
  return {
    kind: "call",
    func,
    args,
    sourceRange: args[0]?.sourceRange ?? DUMMY_RANGE,
  };
}

function isZeroExpr(e: VerilogAExpr): boolean {
  return e.kind === "number" && e.value === 0;
}

function isOneExpr(e: VerilogAExpr): boolean {
  return e.kind === "number" && e.value === 1;
}

/**
 * Algebraically simplifies a `VerilogAExpr` (constant folding, 0*x=0, 1*x=x, x+0=x, x^1=x, x^0=1).
 */
export function simplifyVerilogAExpr(expr: VerilogAExpr): VerilogAExpr {
  if (expr.kind === "unary") {
    const arg = simplifyVerilogAExpr(expr.argument);
    if (expr.op === "+") return arg;
    if (expr.op === "-" && arg.kind === "number") return makeNum(-arg.value);
    if (expr.op === "-" && arg.kind === "unary" && arg.op === "-") return arg.argument;
    return { ...expr, argument: arg };
  }

  if (expr.kind === "ternary") {
    const cond = simplifyVerilogAExpr(expr.condition);
    const cons = simplifyVerilogAExpr(expr.consequent);
    const alt = simplifyVerilogAExpr(expr.alternate);
    if (isZeroExpr(cons) && isZeroExpr(alt)) return makeNum(0);
    return { ...expr, condition: cond, consequent: cons, alternate: alt };
  }

  if (expr.kind === "call") {
    return { ...expr, args: expr.args.map(simplifyVerilogAExpr) };
  }

  if (expr.kind !== "binary") return expr;

  const l = simplifyVerilogAExpr(expr.left);
  const r = simplifyVerilogAExpr(expr.right);

  if (l.kind === "number" && r.kind === "number") {
    switch (expr.op) {
      case "+":
        return makeNum(l.value + r.value);
      case "-":
        return makeNum(l.value - r.value);
      case "*":
        return makeNum(l.value * r.value);
      case "/":
        return r.value !== 0 ? makeNum(l.value / r.value) : { ...expr, left: l, right: r };
      case "^":
      case "**":
        return makeNum(Math.pow(l.value, r.value));
    }
  }

  switch (expr.op) {
    case "+":
      if (isZeroExpr(l)) return r;
      if (isZeroExpr(r)) return l;
      break;
    case "-":
      if (isZeroExpr(r)) return l;
      if (isZeroExpr(l)) return makeUnary("-", r);
      break;
    case "*":
      if (isZeroExpr(l) || isZeroExpr(r)) return makeNum(0);
      if (isOneExpr(l)) return r;
      if (isOneExpr(r)) return l;
      break;
    case "/":
      if (isZeroExpr(l)) return makeNum(0);
      if (isOneExpr(r)) return l;
      break;
    case "^":
    case "**":
      if (isZeroExpr(r)) return makeNum(1);
      if (isOneExpr(r)) return l;
      break;
  }

  return { ...expr, left: l, right: r };
}

function branchCanonicalKey(nature: string, n1: string, n2?: string | undefined): string {
  return n2 ? `${nature}(${n1},${n2})` : `${nature}(${n1})`;
}

/**
 * Symbolically differentiates a Verilog-A expression `expr` with respect to `targetVar`
 * (which may be a variable identifier like `"Vd"` or a branch access like `"V(a,c)"` or node `"a"`).
 * Automatically applies chain rule through `varDefs` if intermediate variable assignments are provided.
 */
export function differentiateVerilogAExpr(
  expr: VerilogAExpr,
  targetVar: string,
  varDefs?: Map<string, VerilogAExpr>,
): VerilogAExpr {
  const normTarget = targetVar.replace(/\s+/g, "");

  switch (expr.kind) {
    case "number":
      return makeNum(0);

    case "identifier": {
      if (expr.name === normTarget) {
        return makeNum(1);
      }
      const def = varDefs?.get(expr.name);
      if (def) {
        return differentiateVerilogAExpr(def, normTarget, varDefs);
      }
      return makeNum(0);
    }

    case "branch_access": {
      const bKey = branchCanonicalKey(expr.nature, expr.node1, expr.node2);
      if (bKey === normTarget) {
        return makeNum(1);
      }
      if (expr.nature === "V" || expr.nature === "Potential") {
        // Also support differentiating with respect to node potential v_<node> or <node>
        if (normTarget === expr.node1 || normTarget === `v_${expr.node1}`) {
          return makeNum(1);
        }
        if (expr.node2 && (normTarget === expr.node2 || normTarget === `v_${expr.node2}`)) {
          return makeNum(-1);
        }
      }
      return makeNum(0);
    }

    case "unary": {
      const dArg = differentiateVerilogAExpr(expr.argument, normTarget, varDefs);
      if (expr.op === "-") return makeUnary("-", dArg);
      if (expr.op === "+") return dArg;
      return makeNum(0);
    }

    case "ternary": {
      const dCons = differentiateVerilogAExpr(expr.consequent, normTarget, varDefs);
      const dAlt = differentiateVerilogAExpr(expr.alternate, normTarget, varDefs);
      return simplifyVerilogAExpr({
        kind: "ternary",
        condition: expr.condition,
        consequent: dCons,
        alternate: dAlt,
        sourceRange: expr.sourceRange,
      });
    }

    case "binary": {
      const u = expr.left;
      const v = expr.right;
      const du = differentiateVerilogAExpr(u, normTarget, varDefs);
      const dv = differentiateVerilogAExpr(v, normTarget, varDefs);

      switch (expr.op) {
        case "+":
          return makeBin("+", du, dv);
        case "-":
          return makeBin("-", du, dv);
        case "*":
          // d(u*v) = du*v + u*dv
          return makeBin("+", makeBin("*", du, v), makeBin("*", u, dv));
        case "/":
          // d(u/v) = (du*v - u*dv) / (v ** 2)
          return makeBin("/", makeBin("-", makeBin("*", du, v), makeBin("*", u, dv)), makeBin("**", v, makeNum(2)));
        case "^":
        case "**": {
          // If exponent is constant or dv == 0: v * u^(v - 1) * du
          const term1 = makeBin("*", makeBin("*", v, makeBin("**", u, makeBin("-", v, makeNum(1)))), du);
          if (isZeroExpr(dv)) return term1;
          const term2 = makeBin("*", makeBin("*", expr, makeCall("ln", [u])), dv);
          return makeBin("+", term1, term2);
        }
        default:
          return makeNum(0);
      }
    }

    case "call": {
      const arg0 = expr.args[0];
      if (!arg0) return makeNum(0);
      const dArg0 = differentiateVerilogAExpr(arg0, normTarget, varDefs);
      if (isZeroExpr(dArg0) && expr.args.length === 1) return makeNum(0);

      switch (expr.func) {
        case "exp":
        case "limexp":
          return makeBin("*", makeCall(expr.func, [arg0]), dArg0);
        case "ln":
        case "log":
          return makeBin("/", dArg0, arg0);
        case "sqrt":
          return makeBin("/", dArg0, makeBin("*", makeNum(2), makeCall("sqrt", [arg0])));
        case "sin":
          return makeBin("*", makeCall("cos", [arg0]), dArg0);
        case "cos":
          return makeUnary("-", makeBin("*", makeCall("sin", [arg0]), dArg0));
        case "tanh": {
          const sech2 = makeBin("-", makeNum(1), makeBin("**", makeCall("tanh", [arg0]), makeNum(2)));
          return makeBin("*", sech2, dArg0);
        }
        case "pow": {
          const arg1 = expr.args[1] ?? makeNum(1);
          return differentiateVerilogAExpr(makeBin("**", arg0, arg1), normTarget, varDefs);
        }
        case "ddt":
          // Derivative of ddt(q) is handled by separating static and dynamic charge parts
          return makeCall("ddt", [dArg0]);
        default:
          return makeNum(0);
      }
    }
  }
}

/**
 * Formats a `VerilogAExpr` back into readable Verilog-A expression syntax.
 */
export function formatVerilogAExpr(expr: VerilogAExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "identifier":
      return expr.name;
    case "branch_access":
      return branchCanonicalKey(expr.nature, expr.node1, expr.node2);
    case "unary":
      return `(${expr.op}${formatVerilogAExpr(expr.argument)})`;
    case "binary":
      return `(${formatVerilogAExpr(expr.left)} ${expr.op} ${formatVerilogAExpr(expr.right)})`;
    case "ternary":
      return `(${formatVerilogAExpr(expr.condition)} ? ${formatVerilogAExpr(expr.consequent)} : ${formatVerilogAExpr(expr.alternate)})`;
    case "call":
      return `${expr.func}(${expr.args.map(formatVerilogAExpr).join(", ")})`;
  }
}

/**
 * Evaluates a `VerilogAExpr` numerically given an environment of variable/parameter/node values.
 */
export function evaluateVerilogAExpr(
  expr: VerilogAExpr,
  env: Record<string, number>,
  varDefs?: Map<string, VerilogAExpr>,
): number {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "identifier": {
      const val = env[expr.name];
      if (val !== undefined) return val;
      if (expr.name === "$vt") return env["$vt"] ?? DEFAULT_VT;
      if (expr.name === "$temperature") return env["$temperature"] ?? DEFAULT_TEMP;
      const def = varDefs?.get(expr.name);
      if (def) return evaluateVerilogAExpr(def, env, varDefs);
      return 0;
    }
    case "branch_access": {
      const bKey = branchCanonicalKey(expr.nature, expr.node1, expr.node2);
      const bVal = env[bKey];
      if (bVal !== undefined) return bVal;
      const v1 = env[expr.node1] ?? env[`v_${expr.node1}`] ?? 0;
      const v2 = expr.node2 ? (env[expr.node2] ?? env[`v_${expr.node2}`] ?? 0) : 0;
      return v1 - v2;
    }
    case "unary": {
      const val = evaluateVerilogAExpr(expr.argument, env, varDefs);
      if (expr.op === "-") return -val;
      if (expr.op === "!") return val === 0 ? 1 : 0;
      return val;
    }
    case "ternary": {
      const cond = evaluateVerilogAExpr(expr.condition, env, varDefs);
      return cond !== 0
        ? evaluateVerilogAExpr(expr.consequent, env, varDefs)
        : evaluateVerilogAExpr(expr.alternate, env, varDefs);
    }
    case "binary": {
      const l = evaluateVerilogAExpr(expr.left, env, varDefs);
      const r = evaluateVerilogAExpr(expr.right, env, varDefs);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r !== 0 ? l / r : 0;
        case "^":
        case "**":
          return Math.pow(l, r);
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "==":
          return l === r ? 1 : 0;
        case "!=":
          return l !== r ? 1 : 0;
        case "&&":
          return l !== 0 && r !== 0 ? 1 : 0;
        case "||":
          return l !== 0 || r !== 0 ? 1 : 0;
      }
      return 0;
    }
    case "call": {
      const args = expr.args.map((a) => evaluateVerilogAExpr(a, env, varDefs));
      const x = args[0] ?? 0;
      switch (expr.func) {
        case "exp":
        case "limexp":
          return Math.exp(Math.min(80, x));
        case "ln":
        case "log":
          return Math.log(Math.max(1e-30, x));
        case "sqrt":
          return Math.sqrt(Math.max(0, x));
        case "sin":
          return Math.sin(x);
        case "cos":
          return Math.cos(x);
        case "tanh":
          return Math.tanh(x);
        case "abs":
          return Math.abs(x);
        case "pow":
          return Math.pow(x, args[1] ?? 1);
        default:
          return 0;
      }
    }
  }
}

export interface VerilogABranchStampEntry {
  branchKey: string;
  node1: string;
  node2: string;
  posNode: string;
  negNode: string;
  staticCurrentExpr: VerilogAExpr;
  dynamicChargeExpr: VerilogAExpr;
  /** Partial derivatives dI_static / dV_branch (small-signal conductances g) */
  conductanceDerivatives: Map<string, VerilogAExpr>;
  /** Partial derivatives dQ_dynamic / dV_branch (small-signal capacitances c) */
  capacitanceDerivatives: Map<string, VerilogAExpr>;
}

export interface VerilogACompiledStamp {
  moduleName: string;
  nodes: string[];
  varDefs: Map<string, VerilogAExpr>;
  branches: VerilogABranchStampEntry[];
  /**
   * Evaluates small-signal conductance matrix G (dI/dV) and capacitance matrix C (dQ/dV)
   * at a given operating point `env` (mapping node/branch/parameter names to numeric values).
   */
  evaluateAt: (env: Record<string, number>) => {
    branchCurrents: Map<string, number>;
    branchCharges: Map<string, number>;
    conductances: Map<string, Map<string, number>>;
    capacitances: Map<string, Map<string, number>>;
    branches: Array<{
      branchKey: string;
      posNode: string;
      negNode: string;
      staticCurrent: number;
      dynamicCharge: number;
      conductances: Record<string, number>;
      capacitances: Record<string, number>;
    }>;
  };
  evaluate: (env: Record<string, number>) => {
    branchCurrents: Map<string, number>;
    branchCharges: Map<string, number>;
    conductances: Map<string, Map<string, number>>;
    capacitances: Map<string, Map<string, number>>;
    branches: Array<{
      branchKey: string;
      posNode: string;
      negNode: string;
      staticCurrent: number;
      dynamicCharge: number;
      conductances: Record<string, number>;
      capacitances: Record<string, number>;
    }>;
  };
}

function exprContainsDdt(expr: VerilogAExpr, varDefs?: Map<string, VerilogAExpr>): boolean {
  if (expr.kind === "call") {
    if (expr.func === "ddt") return true;
    return expr.args.some((a) => exprContainsDdt(a, varDefs));
  }
  if (expr.kind === "binary") {
    return exprContainsDdt(expr.left, varDefs) || exprContainsDdt(expr.right, varDefs);
  }
  if (expr.kind === "unary") {
    return exprContainsDdt(expr.argument, varDefs);
  }
  if (expr.kind === "ternary") {
    return (
      exprContainsDdt(expr.condition, varDefs) ||
      exprContainsDdt(expr.consequent, varDefs) ||
      exprContainsDdt(expr.alternate, varDefs)
    );
  }
  if (expr.kind === "identifier" && varDefs) {
    const def = varDefs.get(expr.name);
    if (def) return exprContainsDdt(def, varDefs);
  }
  return false;
}

function splitStaticAndDynamicExpr(
  expr: VerilogAExpr,
  varDefs?: Map<string, VerilogAExpr>,
): {
  staticExpr: VerilogAExpr;
  chargeExpr: VerilogAExpr;
} {
  if (expr.kind === "identifier" && varDefs) {
    const def = varDefs.get(expr.name);
    if (def && exprContainsDdt(def, varDefs)) {
      return splitStaticAndDynamicExpr(def, varDefs);
    }
  }
  if (expr.kind === "call" && expr.func === "ddt" && expr.args[0]) {
    return {
      staticExpr: makeNum(0),
      chargeExpr: expr.args[0],
    };
  }
  if (expr.kind === "binary" && (expr.op === "+" || expr.op === "-")) {
    const leftParts = splitStaticAndDynamicExpr(expr.left, varDefs);
    const rightParts = splitStaticAndDynamicExpr(expr.right, varDefs);
    return {
      staticExpr: makeBin(expr.op, leftParts.staticExpr, rightParts.staticExpr),
      chargeExpr: makeBin(expr.op, leftParts.chargeExpr, rightParts.chargeExpr),
    };
  }
  if (expr.kind === "unary" && expr.op === "-") {
    const sub = splitStaticAndDynamicExpr(expr.argument, varDefs);
    return {
      staticExpr: makeUnary("-", sub.staticExpr),
      chargeExpr: makeUnary("-", sub.chargeExpr),
    };
  }
  return {
    staticExpr: expr,
    chargeExpr: makeNum(0),
  };
}

/**
 * Compiles a `VerilogAModule` into symbolic small-signal conductance ($G = \partial I / \partial V$)
 * and capacitance ($C = \partial Q / \partial V$) Jacobian stamp expressions and a numerical evaluator.
 */
export function compileVerilogAStamp(module: VerilogAModule): VerilogACompiledStamp {
  const varDefs = new Map<string, VerilogAExpr>();
  const rawBranchContribs = new Map<string, { n1: string; n2: string; exprs: VerilogAExpr[] }>();
  const branchTargets = new Set<string>();
  const nodeSet = new Set<string>(module.ports.map((p) => p.name));
  for (const n of module.internalNodes) nodeSet.add(n);

  const walkStmts = (stmts: VerilogAStatement[]) => {
    for (const s of stmts) {
      if (s.kind === "block") {
        walkStmts(s.statements);
      } else if (s.kind === "assignment") {
        varDefs.set(s.variable, s.rhs);
      } else if (s.kind === "if") {
        // Convert if/else statement assignments and contributions into ternary expressions
        const thenDefs = new Map<string, VerilogAExpr>();
        const elseDefs = new Map<string, VerilogAExpr>();
        for (const ts of s.thenBranch) {
          if (ts.kind === "assignment") thenDefs.set(ts.variable, ts.rhs);
        }
        for (const es of s.elseBranch ?? []) {
          if (es.kind === "assignment") elseDefs.set(es.variable, es.rhs);
        }
        const allVars = new Set([...thenDefs.keys(), ...elseDefs.keys()]);
        for (const v of allVars) {
          const prev = varDefs.get(v) ?? makeNum(0);
          varDefs.set(v, {
            kind: "ternary",
            condition: s.condition,
            consequent: thenDefs.get(v) ?? prev,
            alternate: elseDefs.get(v) ?? prev,
            sourceRange: s.sourceRange,
          });
        }
      } else if (s.kind === "contribution" && (s.lhs.nature === "I" || s.lhs.nature === "Flow")) {
        const n1 = s.lhs.node1;
        const n2 = s.lhs.node2 ?? "0";
        nodeSet.add(n1);
        if (n2 !== "0") nodeSet.add(n2);
        const bKey = branchCanonicalKey("I", n1, s.lhs.node2);
        const vKey = branchCanonicalKey("V", n1, s.lhs.node2);
        branchTargets.add(vKey);
        const entry = rawBranchContribs.get(bKey) ?? { n1, n2, exprs: [] };
        entry.exprs.push(s.rhs);
        rawBranchContribs.set(bKey, entry);
      }
    }
  };

  if (module.analogBlock) {
    walkStmts(module.analogBlock.statements);
  }

  for (const v of module.variables) {
    branchTargets.add(v.name);
  }
  for (const n of nodeSet) {
    branchTargets.add(n);
  }

  const branches: VerilogABranchStampEntry[] = [];
  for (const [bKey, info] of rawBranchContribs.entries()) {
    let totalStatic = makeNum(0);
    let totalCharge = makeNum(0);
    for (const rhs of info.exprs) {
      const { staticExpr, chargeExpr } = splitStaticAndDynamicExpr(rhs, varDefs);
      totalStatic = makeBin("+", totalStatic, staticExpr);
      totalCharge = makeBin("+", totalCharge, chargeExpr);
    }

    const conductanceDerivatives = new Map<string, VerilogAExpr>();
    const capacitanceDerivatives = new Map<string, VerilogAExpr>();

    for (const target of branchTargets) {
      const dI = simplifyVerilogAExpr(differentiateVerilogAExpr(totalStatic, target, varDefs));
      if (!isZeroExpr(dI)) {
        conductanceDerivatives.set(target, dI);
      }
      const dQ = simplifyVerilogAExpr(differentiateVerilogAExpr(totalCharge, target, varDefs));
      if (!isZeroExpr(dQ)) {
        capacitanceDerivatives.set(target, dQ);
      }
    }

    branches.push({
      branchKey: bKey,
      node1: info.n1,
      node2: info.n2,
      posNode: info.n1,
      negNode: info.n2,
      staticCurrentExpr: totalStatic,
      dynamicChargeExpr: totalCharge,
      conductanceDerivatives,
      capacitanceDerivatives,
    });
  }

  const defaultParamEnv: Record<string, number> = {
    $vt: DEFAULT_VT,
    $temperature: DEFAULT_TEMP,
  };
  for (const p of module.parameters) {
    if (typeof p.defaultValue === "number") {
      defaultParamEnv[p.name] = p.defaultValue;
    }
  }

  const evaluateAt = (userEnv: Record<string, number>) => {
    const env: Record<string, number> = { ...defaultParamEnv, ...userEnv };
    const branchCurrents = new Map<string, number>();
    const branchCharges = new Map<string, number>();
    const conductances = new Map<string, Map<string, number>>();
    const capacitances = new Map<string, Map<string, number>>();
    const evaluatedBranches: Array<{
      branchKey: string;
      posNode: string;
      negNode: string;
      staticCurrent: number;
      dynamicCharge: number;
      conductances: Record<string, number>;
      capacitances: Record<string, number>;
    }> = [];

    for (const b of branches) {
      const staticCurrent = evaluateVerilogAExpr(b.staticCurrentExpr, env, varDefs);
      const dynamicCharge = evaluateVerilogAExpr(b.dynamicChargeExpr, env, varDefs);
      branchCurrents.set(b.branchKey, staticCurrent);
      branchCharges.set(b.branchKey, dynamicCharge);

      const gMap = new Map<string, number>();
      const gRec: Record<string, number> = {};
      for (const [target, dExpr] of b.conductanceDerivatives) {
        const val = evaluateVerilogAExpr(dExpr, env, varDefs);
        gMap.set(target, val);
        gRec[target] = val;
      }
      conductances.set(b.branchKey, gMap);

      const cMap = new Map<string, number>();
      const cRec: Record<string, number> = {};
      for (const [target, dExpr] of b.capacitanceDerivatives) {
        const val = evaluateVerilogAExpr(dExpr, env, varDefs);
        cMap.set(target, val);
        cRec[target] = val;
      }
      capacitances.set(b.branchKey, cMap);

      evaluatedBranches.push({
        branchKey: b.branchKey,
        posNode: b.posNode,
        negNode: b.negNode,
        staticCurrent,
        dynamicCharge,
        conductances: gRec,
        capacitances: cRec,
      });
    }

    return {
      branchCurrents,
      branchCharges,
      conductances,
      capacitances,
      branches: evaluatedBranches,
    };
  };

  return {
    moduleName: module.name,
    nodes: Array.from(nodeSet),
    varDefs,
    branches,
    evaluateAt,
    evaluate: evaluateAt,
  };
}

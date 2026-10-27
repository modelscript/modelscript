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

  // Helper context for expression compiler
  const compilerCtx: CompilerContext = {
    arena,
    interner,
    nodeExprMap,
    paramExprMap,
    varExprMap,
  };

  // 6. Compile Statements in Analog Block
  if (module.analogBlock) {
    compileStatements(module.analogBlock.statements, compilerCtx, addCurrentToNode);
  }

  // 7. Emit KCL Equations for Nodes with Current Contributions
  for (const contributions of nodeKcl.values()) {
    if (contributions.length === 0) continue;

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
}

function collectNodesFromStatements(stmts: VerilogAStatement[], nodeSet: Set<string>): void {
  for (const stmt of stmts) {
    if (stmt.kind === "block") {
      collectNodesFromStatements(stmt.statements, nodeSet);
    } else if (stmt.kind === "if") {
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
  } else if (expr.kind === "call") {
    for (const arg of expr.args) {
      collectNodesFromExpr(arg, nodeSet);
    }
  }
}

function compileStatements(
  stmts: VerilogAStatement[],
  ctx: CompilerContext,
  addCurrentToNode: (node: string, currentExprId: number, isLeaving: boolean) => void,
): void {
  const { arena, interner, varExprMap, nodeExprMap } = ctx;

  for (const stmt of stmts) {
    if (stmt.kind === "block") {
      compileStatements(stmt.statements, ctx, addCurrentToNode);
      continue;
    }

    if (stmt.kind === "assignment") {
      const lhsExpr = varExprMap.get(stmt.variable);
      if (lhsExpr !== undefined) {
        const rhsExpr = compileExpression(stmt.rhs, ctx);
        arena.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
      continue;
    }

    if (stmt.kind === "if") {
      compileStatements(stmt.thenBranch, ctx, addCurrentToNode);
      if (stmt.elseBranch) {
        compileStatements(stmt.elseBranch, ctx, addCurrentToNode);
      }
      continue;
    }

    if (stmt.kind === "contribution") {
      const { lhs, rhs } = stmt;
      const rhsExpr = compileExpression(rhs, ctx);

      if (lhs.nature === "I" || lhs.nature === "Flow") {
        const n1 = lhs.node1;
        const n2 = lhs.node2 ?? "0";
        const branchCurrentName = `i_${n1}_${n2}`;
        const bNameId = interner.intern(branchCurrentName);
        arena.addVariable(branchCurrentName, VarType.Real, Variability.Continuous, Causality.Local);
        const bExprId = arena.addExpression(ExprKind.Name, bNameId);
        arena.addEquation(EqKind.Simple, bExprId, rhsExpr);

        addCurrentToNode(n1, bExprId, true);
        addCurrentToNode(n2, bExprId, false);
      } else if (lhs.nature === "V" || lhs.nature === "Potential") {
        const n1 = lhs.node1;
        const n2 = lhs.node2 ?? "0";
        const v1Expr = nodeExprMap.get(n1) ?? arena.addRealLiteral(0.0);
        const v2Expr = nodeExprMap.get(n2) ?? arena.addRealLiteral(0.0);
        const vDiff = arena.addExpression(ExprKind.Binary, BinOp.Sub, v1Expr, v2Expr);
        arena.addEquation(EqKind.Simple, vDiff, rhsExpr);
      }
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
      return arg;
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

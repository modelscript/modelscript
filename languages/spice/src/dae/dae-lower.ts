// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Direct WebAssembly Linear-Memory DAE Arena Lowerer.
 *
 * Directly lowers a SPICE netlist into ModelScript's zero-GC DAE arena (`DAEBuilder`).
 * Encodes node voltages, branch currents, and reactive dynamic states (der(v_C), der(i_L))
 * into flat Struct-of-Arrays integer columns with zero intermediate AST wrapper allocations.
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
import { flattenSpiceCircuit } from "../solvers/mna.js";
import type { SpiceCircuit } from "../types.js";

export function lowerSpiceToDae(circuit: SpiceCircuit, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? (circuit.title || "SpiceCircuit");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const components = flattenSpiceCircuit(circuit);

  // Collect all unique nodes
  const nodeNames = new Set<string>();
  nodeNames.add("0");
  for (const comp of components) {
    for (const node of comp.nodes) {
      nodeNames.add(node);
    }
  }

  // 1. Declare Node Voltage Variables in DAE Arena
  const nodeVarMap = new Map<string, number>(); // node name -> arena var index
  const nodeExprMap = new Map<string, number>(); // node name -> arena ExprId

  for (const node of nodeNames) {
    const isGround = node === "0" || node.toUpperCase() === "GND";
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

    // If ground, fix to 0.0: v_0 = 0.0
    if (isGround) {
      const zeroLit = arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, exprId, zeroLit);
    }
  }

  // 2. Declare Component Currents and Constitutive Equations
  // Track node current contributions for KCL: node -> { exprId: number, isLeaving: boolean }[]
  const nodeKcl = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const addCurrentToNode = (node: string, currentExprId: number, isLeaving: boolean) => {
    const list = nodeKcl.get(node) ?? [];
    list.push({ exprId: currentExprId, isLeaving });
    nodeKcl.set(node, list);
  };

  for (const comp of components) {
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";
    const v1Expr = nodeExprMap.get(n1) ?? arena.addRealLiteral(0.0);
    const v2Expr = nodeExprMap.get(n2) ?? arena.addRealLiteral(0.0);

    // Potential difference across component: v_diff = v1 - v2
    const vDiffExpr = arena.addBinaryExpr(BinOp.Sub, v1Expr, v2Expr);

    // Component current variable: i_<compName>
    const iName = `i_${comp.name}`;
    const iNameId = interner.intern(iName);
    arena.addVariable(iName, VarType.Real, Variability.Continuous, Causality.Local);
    const iExprId = arena.addExpression(ExprKind.Name, iNameId);

    // Connect to KCL: current leaves n1, enters n2
    addCurrentToNode(n1, iExprId, true);
    addCurrentToNode(n2, iExprId, false);

    switch (comp.kind) {
      case "R": {
        // Resistor: v_diff = i * R
        const rVal = comp.value ?? 1e3;
        const rLit = arena.addRealLiteral(rVal);
        const rhs = arena.addBinaryExpr(BinOp.Mul, iExprId, rLit);
        arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
        break;
      }
      case "C": {
        // Capacitor: i = C * der(v_diff)
        const cVal = comp.value ?? 1e-9;
        const cLit = arena.addRealLiteral(cVal);
        const derV = arena.addExpression(ExprKind.Der, vDiffExpr);
        const rhs = arena.addBinaryExpr(BinOp.Mul, cLit, derV);
        arena.addEquation(EqKind.Simple, iExprId, rhs);
        break;
      }
      case "L": {
        // Inductor: v_diff = L * der(i)
        const lVal = comp.value ?? 1e-6;
        const lLit = arena.addRealLiteral(lVal);
        const derI = arena.addExpression(ExprKind.Der, iExprId);
        const rhs = arena.addBinaryExpr(BinOp.Mul, lLit, derI);
        arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
        break;
      }
      case "V": {
        // Independent Voltage Source: v_diff = V_val
        const vVal = comp.sourceSpec?.dc ?? comp.value ?? 0.0;
        const vLit = arena.addRealLiteral(vVal);
        arena.addEquation(EqKind.Simple, vDiffExpr, vLit);
        break;
      }
      case "I": {
        // Independent Current Source: i = I_val
        const iVal = comp.sourceSpec?.dc ?? comp.value ?? 0.0;
        const iLit = arena.addRealLiteral(iVal);
        arena.addEquation(EqKind.Simple, iExprId, iLit);
        break;
      }
      case "E": {
        // VCVS: v_diff = gain * (v_c1 - v_c2)
        if (comp.controlNodes) {
          const c1 = comp.controlNodes[0] ?? "";
          const c2 = comp.controlNodes[1] ?? "";
          const vc1Expr = nodeExprMap.get(c1) ?? arena.addRealLiteral(0.0);
          const vc2Expr = nodeExprMap.get(c2) ?? arena.addRealLiteral(0.0);
          const vcDiff = arena.addBinaryExpr(BinOp.Sub, vc1Expr, vc2Expr);
          const gainLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1.0);
          const rhs = arena.addBinaryExpr(BinOp.Mul, gainLit, vcDiff);
          arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
        }
        break;
      }
      case "G": {
        // VCCS: i = gm * (v_c1 - v_c2)
        if (comp.controlNodes) {
          const c1 = comp.controlNodes[0] ?? "";
          const c2 = comp.controlNodes[1] ?? "";
          const vc1Expr = nodeExprMap.get(c1) ?? arena.addRealLiteral(0.0);
          const vc2Expr = nodeExprMap.get(c2) ?? arena.addRealLiteral(0.0);
          const vcDiff = arena.addBinaryExpr(BinOp.Sub, vc1Expr, vc2Expr);
          const gmLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1e-3);
          const rhs = arena.addBinaryExpr(BinOp.Mul, gmLit, vcDiff);
          arena.addEquation(EqKind.Simple, iExprId, rhs);
        }
        break;
      }
      default: {
        // Generic passive fallback: v_diff = i * 1e3
        const rLit = arena.addRealLiteral(1e3);
        const rhs = arena.addBinaryExpr(BinOp.Mul, iExprId, rLit);
        arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
        break;
      }
    }
  }

  // 3. Kirchhoff's Current Law (KCL) Equations at each non-ground node
  for (const [node, conns] of nodeKcl) {
    if (node === "0" || node.toUpperCase() === "GND") continue;
    if (conns.length === 0) continue;

    // Sum of currents leaving node = 0
    let kclSumExpr = -1;
    for (const conn of conns) {
      let term = conn.exprId;
      if (!conn.isLeaving) {
        // If entering, negate term
        term = arena.addUnaryExpr(UnaryOp.Negate, conn.exprId);
      }

      if (kclSumExpr === -1) {
        kclSumExpr = term;
      } else {
        kclSumExpr = arena.addBinaryExpr(BinOp.Add, kclSumExpr, term);
      }
    }

    if (kclSumExpr !== -1) {
      const zeroLit = arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, kclSumExpr, zeroLit);
    }
  }

  return arena;
}

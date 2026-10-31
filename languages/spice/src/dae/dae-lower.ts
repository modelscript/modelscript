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

const THERMAL_VOLTAGE_VT = 0.02585;
const DEFAULT_DIODE_IS = 1e-14;
const DEFAULT_DIODE_N = 1.0;

export function lowerSpiceToDae(circuit: SpiceCircuit, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? (circuit.title || "SpiceCircuit");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const components = flattenSpiceCircuit(circuit);

  const normalizeNode = (n: string | undefined): string => {
    if (!n) return "0";
    const u = n.toUpperCase();
    return u === "0" || u === "GND" ? "0" : n;
  };

  // Collect all unique nodes
  const nodeNames = new Set<string>();
  nodeNames.add("0");
  for (const comp of components) {
    for (const node of comp.nodes) {
      nodeNames.add(normalizeNode(node));
    }
    if (comp.controlNodes) {
      nodeNames.add(normalizeNode(comp.controlNodes[0]));
      nodeNames.add(normalizeNode(comp.controlNodes[1]));
    }
  }

  // 1. Declare Node Voltage Variables in DAE Arena
  const nodeVarMap = new Map<string, number>(); // node name -> arena var index
  const nodeExprMap = new Map<string, number>(); // node name -> arena ExprId

  for (const node of nodeNames) {
    const isGround = node === "0";
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

  // Pre-declare primary component current variables so F and H controlled sources can reference them
  const compCurrentExprMap = new Map<string, number>();
  for (const comp of components) {
    const iName = `i_${comp.name}`;
    const iNameId = interner.intern(iName);
    arena.addVariable(iName, VarType.Real, Variability.Continuous, Causality.Local);
    const iExprId = arena.addExpression(ExprKind.Name, iNameId);
    compCurrentExprMap.set(comp.name, iExprId);
    compCurrentExprMap.set(comp.name.toUpperCase(), iExprId);
  }

  // 2. Declare Component Currents and Constitutive Equations
  // Track node current contributions for KCL: node -> { exprId: number, isLeaving: boolean }[]
  const nodeKcl = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const addCurrentToNode = (node: string, currentExprId: number, isLeaving: boolean) => {
    const norm = normalizeNode(node);
    const list = nodeKcl.get(norm) ?? [];
    list.push({ exprId: currentExprId, isLeaving });
    nodeKcl.set(norm, list);
  };

  for (const comp of components) {
    const n1 = normalizeNode(comp.nodes[0]);
    const n2 = normalizeNode(comp.nodes[1]);
    const v1Expr = nodeExprMap.get(n1) ?? arena.addRealLiteral(0.0);
    const v2Expr = nodeExprMap.get(n2) ?? arena.addRealLiteral(0.0);

    // Potential difference across primary terminals: v_diff = v1 - v2
    const vDiffExpr = arena.addBinaryExpr(BinOp.Sub, v1Expr, v2Expr);
    const iExprId = compCurrentExprMap.get(comp.name) ?? arena.addRealLiteral(0.0);

    if (comp.kind === "Q") {
      // BJT: Collector = nodes[0], Base = nodes[1], Emitter = nodes[2]
      const nCol = normalizeNode(comp.nodes[0]);
      const nBase = normalizeNode(comp.nodes[1]);
      const nEmit = normalizeNode(comp.nodes[2]);
      const vColExpr = nodeExprMap.get(nCol) ?? arena.addRealLiteral(0.0);
      const vBaseExpr = nodeExprMap.get(nBase) ?? arena.addRealLiteral(0.0);
      const vEmitExpr = nodeExprMap.get(nEmit) ?? arena.addRealLiteral(0.0);

      // Additional base current variable i_<name>_B; primary i_<name> is collector current i_C
      const ibName = `i_${comp.name}_B`;
      const ibNameId = interner.intern(ibName);
      arena.addVariable(ibName, VarType.Real, Variability.Continuous, Causality.Local);
      const ibExprId = arena.addExpression(ExprKind.Name, ibNameId);

      // KCL: i_C leaves Collector, enters Emitter; i_B leaves Base, enters Emitter
      addCurrentToNode(nCol, iExprId, true);
      addCurrentToNode(nEmit, iExprId, false);
      addCurrentToNode(nBase, ibExprId, true);
      addCurrentToNode(nEmit, ibExprId, false);

      const modelName = (comp.model ?? "").toUpperCase();
      const model = circuit.models.get(modelName);
      const isPnp = model?.type === "PNP";
      const betaF = model?.params.get("BF") ?? 100.0;
      const betaR = model?.params.get("BR") ?? 1.0;
      const Is = model?.params.get("IS") ?? DEFAULT_DIODE_IS;
      const vtLit = arena.addRealLiteral(THERMAL_VOLTAGE_VT);
      const isLit = arena.addRealLiteral(Is);
      const oneLit = arena.addRealLiteral(1.0);

      const vbeExpr = isPnp
        ? arena.addBinaryExpr(BinOp.Sub, vEmitExpr, vBaseExpr)
        : arena.addBinaryExpr(BinOp.Sub, vBaseExpr, vEmitExpr);
      const vbcExpr = isPnp
        ? arena.addBinaryExpr(BinOp.Sub, vColExpr, vBaseExpr)
        : arena.addBinaryExpr(BinOp.Sub, vBaseExpr, vColExpr);

      // i_F = Is * (exp(vbe / Vt) - 1)
      const expBe = arena.addCallExpr("exp", [arena.addBinaryExpr(BinOp.Div, vbeExpr, vtLit)]);
      const iF = arena.addBinaryExpr(BinOp.Mul, isLit, arena.addBinaryExpr(BinOp.Sub, expBe, oneLit));

      // i_R = Is * (exp(vbc / Vt) - 1)
      const expBc = arena.addCallExpr("exp", [arena.addBinaryExpr(BinOp.Div, vbcExpr, vtLit)]);
      const iR = arena.addBinaryExpr(BinOp.Mul, isLit, arena.addBinaryExpr(BinOp.Sub, expBc, oneLit));

      // Ebers-Moll equations:
      // i_B = i_F / betaF + i_R / betaR
      // i_C = (i_F - i_R) - i_R / betaR
      const ibMag = arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Div, iF, arena.addRealLiteral(betaF)),
        arena.addBinaryExpr(BinOp.Div, iR, arena.addRealLiteral(betaR)),
      );
      const icMag = arena.addBinaryExpr(
        BinOp.Sub,
        arena.addBinaryExpr(BinOp.Sub, iF, iR),
        arena.addBinaryExpr(BinOp.Div, iR, arena.addRealLiteral(betaR)),
      );

      arena.addEquation(EqKind.Simple, ibExprId, isPnp ? arena.addUnaryExpr(UnaryOp.Negate, ibMag) : ibMag);
      arena.addEquation(EqKind.Simple, iExprId, isPnp ? arena.addUnaryExpr(UnaryOp.Negate, icMag) : icMag);
      continue;
    }

    if (comp.kind === "M") {
      // MOSFET: Drain = nodes[0], Gate = nodes[1], Source = nodes[2]
      const nDrain = normalizeNode(comp.nodes[0]);
      const nGate = normalizeNode(comp.nodes[1]);
      const nSource = normalizeNode(comp.nodes[2]);
      const vDrainExpr = nodeExprMap.get(nDrain) ?? arena.addRealLiteral(0.0);
      const vGateExpr = nodeExprMap.get(nGate) ?? arena.addRealLiteral(0.0);
      const vSourceExpr = nodeExprMap.get(nSource) ?? arena.addRealLiteral(0.0);

      // Drain-to-source current i_<name> leaves Drain, enters Source
      addCurrentToNode(nDrain, iExprId, true);
      addCurrentToNode(nSource, iExprId, false);

      // Gate current variable i_<name>_G = 0 (ensures gate node participates in KCL)
      const igName = `i_${comp.name}_G`;
      const igNameId = interner.intern(igName);
      arena.addVariable(igName, VarType.Real, Variability.Continuous, Causality.Local);
      const igExprId = arena.addExpression(ExprKind.Name, igNameId);
      addCurrentToNode(nGate, igExprId, true);
      addCurrentToNode(nSource, igExprId, false);
      arena.addEquation(EqKind.Simple, igExprId, arena.addRealLiteral(0.0));

      const modelName = (comp.model ?? "").toUpperCase();
      const model = circuit.models.get(modelName);
      const isPmos = model?.type === "PMOS";
      const absVth = Math.abs(model?.params.get("VTO") ?? (isPmos ? -0.7 : 0.7));
      const Kp = model?.params.get("KP") ?? 1e-4;
      const W = Number(comp.params.get("W") ?? 10e-6);
      const L = Number(comp.params.get("L") ?? 1e-6);
      const beta = Kp * (W / L);

      const vgsExpr = isPmos
        ? arena.addBinaryExpr(BinOp.Sub, vSourceExpr, vGateExpr)
        : arena.addBinaryExpr(BinOp.Sub, vGateExpr, vSourceExpr);
      const vdsExpr = isPmos
        ? arena.addBinaryExpr(BinOp.Sub, vSourceExpr, vDrainExpr)
        : arena.addBinaryExpr(BinOp.Sub, vDrainExpr, vSourceExpr);
      const vovExpr = arena.addBinaryExpr(BinOp.Sub, vgsExpr, arena.addRealLiteral(absVth));

      const zeroLit = arena.addRealLiteral(0.0);
      const halfLit = arena.addRealLiteral(0.5);
      const betaLit = arena.addRealLiteral(beta);

      // Cutoff: vov <= 0 -> 0
      const condCutoff = arena.addBinaryExpr(BinOp.Lte, vovExpr, zeroLit);
      // Linear (triode): vds < vov -> beta * (vov * vds - 0.5 * vds * vds)
      const condLinear = arena.addBinaryExpr(BinOp.Lt, vdsExpr, vovExpr);
      const vovVds = arena.addBinaryExpr(BinOp.Mul, vovExpr, vdsExpr);
      const halfVdsSq = arena.addBinaryExpr(BinOp.Mul, halfLit, arena.addBinaryExpr(BinOp.Mul, vdsExpr, vdsExpr));
      const linearCurrent = arena.addBinaryExpr(BinOp.Mul, betaLit, arena.addBinaryExpr(BinOp.Sub, vovVds, halfVdsSq));
      // Saturation: 0.5 * beta * vov * vov
      const satCurrent = arena.addBinaryExpr(
        BinOp.Mul,
        arena.addBinaryExpr(BinOp.Mul, halfLit, betaLit),
        arena.addBinaryExpr(BinOp.Mul, vovExpr, vovExpr),
      );

      const activeCurrent = arena.addIfElse(condLinear, linearCurrent, satCurrent);
      const idMagExpr = arena.addIfElse(condCutoff, zeroLit, activeCurrent);
      const idSignedExpr = isPmos ? arena.addUnaryExpr(UnaryOp.Negate, idMagExpr) : idMagExpr;

      arena.addEquation(EqKind.Simple, iExprId, idSignedExpr);
      continue;
    }

    // Two-terminal connection to KCL: current leaves n1, enters n2
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
      case "D": {
        // Shockley Diode: i = Is * (exp(v_diff / (N * Vt)) - 1)
        const modelName = (comp.model ?? "").toUpperCase();
        const model = circuit.models.get(modelName);
        const Is = model?.params.get("IS") ?? DEFAULT_DIODE_IS;
        const N = model?.params.get("N") ?? DEFAULT_DIODE_N;
        const nVtLit = arena.addRealLiteral(N * THERMAL_VOLTAGE_VT);
        const isLit = arena.addRealLiteral(Is);
        const oneLit = arena.addRealLiteral(1.0);
        const expArg = arena.addBinaryExpr(BinOp.Div, vDiffExpr, nVtLit);
        const expCall = arena.addCallExpr("exp", [expArg]);
        const rhs = arena.addBinaryExpr(BinOp.Mul, isLit, arena.addBinaryExpr(BinOp.Sub, expCall, oneLit));
        arena.addEquation(EqKind.Simple, iExprId, rhs);
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
        const c1 = normalizeNode(comp.controlNodes?.[0]);
        const c2 = normalizeNode(comp.controlNodes?.[1]);
        const vc1Expr = nodeExprMap.get(c1) ?? arena.addRealLiteral(0.0);
        const vc2Expr = nodeExprMap.get(c2) ?? arena.addRealLiteral(0.0);
        const vcDiff = arena.addBinaryExpr(BinOp.Sub, vc1Expr, vc2Expr);
        const gainLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1.0);
        const rhs = arena.addBinaryExpr(BinOp.Mul, gainLit, vcDiff);
        arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
        break;
      }
      case "G": {
        // VCCS: i = gm * (v_c1 - v_c2)
        const c1 = normalizeNode(comp.controlNodes?.[0]);
        const c2 = normalizeNode(comp.controlNodes?.[1]);
        const vc1Expr = nodeExprMap.get(c1) ?? arena.addRealLiteral(0.0);
        const vc2Expr = nodeExprMap.get(c2) ?? arena.addRealLiteral(0.0);
        const vcDiff = arena.addBinaryExpr(BinOp.Sub, vc1Expr, vc2Expr);
        const gmLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1e-3);
        const rhs = arena.addBinaryExpr(BinOp.Mul, gmLit, vcDiff);
        arena.addEquation(EqKind.Simple, iExprId, rhs);
        break;
      }
      case "F": {
        // CCCS: i = gain * i_ctrl
        const ctrlExpr =
          (comp.controlSource
            ? (compCurrentExprMap.get(comp.controlSource) ?? compCurrentExprMap.get(comp.controlSource.toUpperCase()))
            : undefined) ?? arena.addRealLiteral(0.0);
        const gainLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1.0);
        const rhs = arena.addBinaryExpr(BinOp.Mul, gainLit, ctrlExpr);
        arena.addEquation(EqKind.Simple, iExprId, rhs);
        break;
      }
      case "H": {
        // CCVS: v_diff = gain * i_ctrl
        const ctrlExpr =
          (comp.controlSource
            ? (compCurrentExprMap.get(comp.controlSource) ?? compCurrentExprMap.get(comp.controlSource.toUpperCase()))
            : undefined) ?? arena.addRealLiteral(0.0);
        const gainLit = arena.addRealLiteral(comp.gain ?? comp.value ?? 1.0);
        const rhs = arena.addBinaryExpr(BinOp.Mul, gainLit, ctrlExpr);
        arena.addEquation(EqKind.Simple, vDiffExpr, rhs);
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
  for (const node of nodeNames) {
    if (node === "0") continue;
    const conns = nodeKcl.get(node) ?? [];
    if (conns.length === 0) {
      const vExpr = nodeExprMap.get(node) ?? arena.addRealLiteral(0.0);
      arena.addEquation(EqKind.Simple, vExpr, arena.addRealLiteral(0.0));
      continue;
    }

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

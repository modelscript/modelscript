// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for SLAM II Combined Discrete-Continuous Models.
 *
 * Translates SLAM II `CONTINUOUS` state equations (`DD(i)`, `SS(i)`), `INTLC`
 * initial conditions, `DETECT` threshold functions, and network `RESOURCE` / `QUEUE`
 * conservation balances directly into `@modelscript/runtime`'s `IDaeBuilder`
 * linear memory representation.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import type { SlamExprNode, SlamModel } from "../types.js";

export interface SlamDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  resourceVars: string[];
  detectVars: string[];
}

export function lowerSlamToDae(builder: IDaeBuilder, model: SlamModel): SlamDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const resourceVars: string[] = [];
  const detectVars: string[] = [];
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(key, existing);
      return existing;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // Collect initial values from INTLC
  const initialValues = new Map<string, number>();
  for (const init of model.intlc) {
    if (init.numericValue !== undefined) {
      if (init.kind === "SS" && init.index !== undefined) {
        initialValues.set(`SS_${init.index}`, init.numericValue);
      } else if (init.kind === "XX" && init.index !== undefined) {
        initialValues.set(`XX_${init.index}`, init.numericValue);
      } else if (init.kind === "DD" && init.index !== undefined) {
        initialValues.set(`DD_${init.index}`, init.numericValue);
      } else {
        initialValues.set(init.target, init.numericValue);
      }
    }
  }

  // Pre-create XX parameters/variables from INTLC
  for (const init of model.intlc) {
    if (init.kind === "XX" && init.index !== undefined) {
      const varName = `XX_${init.index}`;
      getOrAddVar(varName, Variability.Parameter, init.numericValue ?? 0.0);
    }
  }

  // Pre-create declared continuous states SS_1..SS_(NNEQD+NNEQS)
  if (model.continuous) {
    const nneqd = Math.max(0, model.continuous.nnequations);
    const nneqs = Math.max(0, model.continuous.nnstates);
    for (let i = 1; i <= nneqd + nneqs; i++) {
      const name = `SS_${i}`;
      const vIdx = getOrAddVar(name, Variability.Continuous, initialValues.get(name) ?? 0.0);
      if (i <= nneqd) {
        stateVarIndices.push(vIdx);
      }
    }
  }

  // Recursive lowering of SlamExprNode directly into DAEBuilder expression IDs
  function lowerExpr(expr: SlamExprNode): number {
    switch (expr.kind) {
      case "number":
        return builder.addRealLiteral(expr.value);

      case "state": {
        if (expr.array === "SS") {
          const v = getOrAddVar(
            `SS_${expr.index}`,
            Variability.Continuous,
            initialValues.get(`SS_${expr.index}`) ?? 0.0,
          );
          return builder.addName(v);
        }
        if (expr.array === "DD") {
          const v = getOrAddVar(
            `SS_${expr.index}`,
            Variability.Continuous,
            initialValues.get(`SS_${expr.index}`) ?? 0.0,
          );
          return builder.addDer(v);
        }
        if (expr.array === "XX") {
          const v = getOrAddVar(
            `XX_${expr.index}`,
            Variability.Parameter,
            initialValues.get(`XX_${expr.index}`) ?? 0.0,
          );
          return builder.addName(v);
        }
        const v = getOrAddVar(`ATRIB_${expr.index}`, Variability.Continuous, 0.0);
        return builder.addName(v);
      }

      case "ident": {
        if (expr.name === "TNOW") {
          const tVar = getOrAddVar("time", Variability.Continuous, 0.0);
          return builder.addName(tVar);
        }
        const v = getOrAddVar(expr.name, Variability.Parameter, initialValues.get(expr.name) ?? 0.0);
        return builder.addName(v);
      }

      case "unary": {
        const inner = lowerExpr(expr.operand);
        return expr.op === "-" ? builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), inner) : inner;
      }

      case "binary": {
        const left = lowerExpr(expr.left);
        const right = lowerExpr(expr.right);
        const opMap: Record<"+" | "-" | "*" | "/" | "^", BinOp> = {
          "+": BinOp.Add,
          "-": BinOp.Sub,
          "*": BinOp.Mul,
          "/": BinOp.Div,
          "^": BinOp.Pow,
        };
        return builder.addBinaryExpr(opMap[expr.op], left, right);
      }

      case "call": {
        if (expr.args.length === 0) return builder.addRealLiteral(0.0);
        const first = lowerExpr(expr.args[0]!);
        for (let i = 1; i < expr.args.length; i++) {
          lowerExpr(expr.args[i]!);
        }
        return first;
      }
    }
  }

  // 1. Lower continuous state equations: DD(i) = rhs  and  SS(i) = rhs
  for (const eq of model.stateEquations) {
    const ssName = `SS_${eq.index}`;
    const ssVar = getOrAddVar(ssName, Variability.Continuous, initialValues.get(ssName) ?? 0.0);
    const rhsId = lowerExpr(eq.rhsExpr);

    if (eq.lhsKind === "DD") {
      if (!stateVarIndices.includes(ssVar)) {
        stateVarIndices.push(ssVar);
      }
      const derLhs = builder.addDer(ssVar);
      builder.addEquation(EqKind.Simple, derLhs, rhsId);
      equationCount++;
    } else {
      builder.addEquation(EqKind.Simple, builder.addName(ssVar), rhsId);
      equationCount++;
    }
  }

  // 2. Lower network RESOURCE capacity & utilization balances
  for (const [resName, resNode] of model.resources) {
    const cap = resNode.resourceUnits ?? 1;
    const capVar = getOrAddVar(`RES_${resName}_cap`, Variability.Parameter, cap);
    const busyVar = getOrAddVar(`RES_${resName}_busy`, Variability.Continuous, 0.0);
    const availVar = getOrAddVar(`RES_${resName}_avail`, Variability.Continuous, cap);
    const utilVar = getOrAddVar(`RES_${resName}_util`, Variability.Continuous, 0.0);

    resourceVars.push(`RES_${resName}_avail`, `RES_${resName}_util`);

    // RES_avail = RES_cap - RES_busy
    builder.addEquation(
      EqKind.Simple,
      builder.addName(availVar),
      builder.addBinaryExpr(BinOp.Sub, builder.addName(capVar), builder.addName(busyVar)),
    );
    equationCount++;

    // RES_util = RES_busy / RES_cap
    builder.addEquation(
      EqKind.Simple,
      builder.addName(utilVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(busyVar), builder.addName(capVar)),
    );
    equationCount++;
  }

  // 3. Lower QUEUE occupancy balances and DETECT zero-crossing residual functions
  for (const node of model.nodes) {
    if (node.type === "QUEUE") {
      const ifl = node.fileNumber ?? 1;
      const iq = node.initialCount ?? 0;
      const lenVar = getOrAddVar(`Q_${ifl}_len`, Variability.Continuous, iq);
      const arrVar = getOrAddVar(`Q_${ifl}_arrivals`, Variability.Continuous, iq);
      const depVar = getOrAddVar(`Q_${ifl}_departures`, Variability.Continuous, 0.0);

      // Q_len = Q_arrivals - Q_departures
      builder.addEquation(
        EqKind.Simple,
        builder.addName(lenVar),
        builder.addBinaryExpr(BinOp.Sub, builder.addName(arrVar), builder.addName(depVar)),
      );
      equationCount++;
    } else if (node.type === "DETECT") {
      const varSpec = node.detectVar ?? "SS(1)";
      const threshold = node.detectThreshold ?? 0.0;
      const m = varSpec.match(/^(SS|DD)\((\d+)\)$/i);
      const idx = m ? Number.parseInt(m[2]!, 10) : 1;
      const ssVar = getOrAddVar(`SS_${idx}`, Variability.Continuous, initialValues.get(`SS_${idx}`) ?? 0.0);
      const detName = `DETECT_${node.id}_res`;
      const detVar = getOrAddVar(detName, Variability.Continuous, (initialValues.get(`SS_${idx}`) ?? 0.0) - threshold);
      detectVars.push(detName);

      // DETECT_res = SS_i - threshold
      builder.addEquation(
        EqKind.Simple,
        builder.addName(detVar),
        builder.addBinaryExpr(BinOp.Sub, builder.addName(ssVar), builder.addRealLiteral(threshold)),
      );
      equationCount++;
    }
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
    resourceVars,
    detectVars,
  };
}

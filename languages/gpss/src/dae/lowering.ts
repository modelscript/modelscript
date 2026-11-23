// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for GPSS Discrete-Event Models.
 *
 * Lowers GPSS facilities, queues, and multi-server storages into `@modelscript/runtime`'s
 * `IDaeBuilder` linear-memory representation (fluid balance ODEs, Little's Law $L = \lambda W$,
 * utilization equations, and GPSS Standard Numerical Attributes `FR$`, `SR$`, `R$`, `Q$`).
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInGpssLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { GpssModel } from "../types.js";

export interface GpssDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function parseNumericOperand(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim().toUpperCase();
  const expMatch = /^EXP\(([^)]+)\)$/.exec(trimmed);
  if (expMatch && expMatch[1]) {
    const v = Number(expMatch[1]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }
  const v = Number(trimmed);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Extracts nominal arrival rate $\lambda$ and service rate $\mu$ from `GENERATE` and `ADVANCE` blocks.
 */
function inferNominalRates(model: GpssModel): { lambda: number; mu: number } {
  let genMean = 18.0;
  let advMean = 16.0;
  let foundGen = false;
  let foundAdv = false;

  for (const b of model.blocks) {
    if (!foundGen && b.opcode === "GENERATE") {
      genMean = parseNumericOperand(b.operands[0], 18.0);
      foundGen = true;
    } else if (!foundAdv && b.opcode === "ADVANCE") {
      advMean = parseNumericOperand(b.operands[0], 16.0);
      foundAdv = true;
    }
  }

  return {
    lambda: 1.0 / Math.max(1e-9, genMean),
    mu: 1.0 / Math.max(1e-9, advMean),
  };
}

/**
 * Lowers a parsed `GpssModel` directly into a linear-memory `IDaeBuilder`.
 */
export function lowerGpssToDae(builder: IDaeBuilder, model: GpssModel): GpssDaeLoweringResult {
  ensureBuiltInGpssLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existingIdx = builder.lookupVariable(name);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  const { lambda, mu } = inferNominalRates(model);

  // 1. Lower single-server Facilities (SEIZE / RELEASE)
  for (const fac of model.facilities) {
    const id = sanitizeId(fac);
    const rho0 = Math.min(0.99, lambda / mu);
    const lq0 = (rho0 * rho0) / Math.max(1e-6, 1.0 - rho0);
    const wq0 = lq0 / lambda;
    const w0 = wq0 + 1.0 / mu;
    const l0 = lambda * w0;

    const lamVar = getOrAddVar(`fac_${id}_lambda`, Variability.Parameter, lambda);
    const muVar = getOrAddVar(`fac_${id}_mu`, Variability.Parameter, mu);
    const rhoVar = getOrAddVar(`fac_${id}_rho`, Variability.Continuous, rho0);
    const frVar = getOrAddVar(`fac_${id}_FR`, Variability.Continuous, rho0 * 1000.0);
    const lqVar = getOrAddVar(`fac_${id}_Lq`, Variability.Continuous, lq0);
    const wqVar = getOrAddVar(`fac_${id}_Wq`, Variability.Continuous, wq0);
    const lVar = getOrAddVar(`fac_${id}_L`, Variability.Continuous, l0);
    const wVar = getOrAddVar(`fac_${id}_W`, Variability.Continuous, w0);

    // fac_rho = fac_lambda / fac_mu
    builder.addEquation(
      EqKind.Simple,
      builder.addName(rhoVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(lamVar), builder.addName(muVar)),
    );
    equationCount++;

    // fac_FR = 1000.0 * fac_rho
    builder.addEquation(
      EqKind.Simple,
      builder.addName(frVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(1000.0), builder.addName(rhoVar)),
    );
    equationCount++;

    // Little's Law: fac_L = fac_lambda * fac_W
    builder.addEquation(
      EqKind.Simple,
      builder.addName(lVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(lamVar), builder.addName(wVar)),
    );
    equationCount++;

    // Queue Little's Law: fac_Lq = fac_lambda * fac_Wq
    builder.addEquation(
      EqKind.Simple,
      builder.addName(lqVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(lamVar), builder.addName(wqVar)),
    );
    equationCount++;

    // System time balance: fac_W = fac_Wq + 1.0 / fac_mu
    builder.addEquation(
      EqKind.Simple,
      builder.addName(wVar),
      builder.addBinaryExpr(
        BinOp.Add,
        builder.addName(wqVar),
        builder.addBinaryExpr(BinOp.Div, builder.addRealLiteral(1.0), builder.addName(muVar)),
      ),
    );
    equationCount++;
  }

  // 2. Lower multi-server Storages (STORAGE / ENTER / LEAVE)
  for (const [sName, sDef] of model.storages) {
    const id = sanitizeId(sName);
    const cap = Number.isFinite(sDef.capacity) && sDef.capacity > 0 ? sDef.capacity : 1.0;
    const avgContents0 = Math.min(cap, lambda / mu);
    const rho0 = avgContents0 / cap;

    const capVar = getOrAddVar(`sto_${id}_capacity`, Variability.Parameter, cap);
    const lamVar = getOrAddVar(`sto_${id}_lambda`, Variability.Parameter, lambda);
    const muVar = getOrAddVar(`sto_${id}_mu`, Variability.Parameter, mu);
    const avgVar = getOrAddVar(`sto_${id}_S`, Variability.Continuous, avgContents0);
    const remVar = getOrAddVar(`sto_${id}_R`, Variability.Continuous, Math.max(0.0, cap - avgContents0));
    const rhoVar = getOrAddVar(`sto_${id}_rho`, Variability.Continuous, rho0);
    const srVar = getOrAddVar(`sto_${id}_SR`, Variability.Continuous, rho0 * 1000.0);

    // sto_S = sto_lambda / sto_mu
    builder.addEquation(
      EqKind.Simple,
      builder.addName(avgVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(lamVar), builder.addName(muVar)),
    );
    equationCount++;

    // sto_rho = sto_S / sto_capacity
    builder.addEquation(
      EqKind.Simple,
      builder.addName(rhoVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(avgVar), builder.addName(capVar)),
    );
    equationCount++;

    // sto_SR = 1000.0 * sto_rho
    builder.addEquation(
      EqKind.Simple,
      builder.addName(srVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(1000.0), builder.addName(rhoVar)),
    );
    equationCount++;

    // sto_R = sto_capacity - sto_S
    builder.addEquation(
      EqKind.Simple,
      builder.addName(remVar),
      builder.addBinaryExpr(BinOp.Sub, builder.addName(capVar), builder.addName(avgVar)),
    );
    equationCount++;
  }

  // 3. Lower Queues (QUEUE / DEPART) with fluid conservation ODEs
  for (const qName of model.queues) {
    const id = sanitizeId(qName);
    const qLenVar = getOrAddVar(`que_${id}_Q`, Variability.Continuous, 0.0);
    stateVarIndices.push(qLenVar);

    const inflowVar = getOrAddVar(`que_${id}_inflow`, Variability.Continuous, lambda);
    const outflowVar = getOrAddVar(`que_${id}_outflow`, Variability.Continuous, Math.min(lambda, mu));
    const waitVar = getOrAddVar(`que_${id}_Wq`, Variability.Continuous, 0.0);

    // Fluid conservation: der(que_Q) = que_inflow - que_outflow
    builder.addEquation(
      EqKind.Simple,
      builder.addDer(qLenVar),
      builder.addBinaryExpr(BinOp.Sub, builder.addName(inflowVar), builder.addName(outflowVar)),
    );
    equationCount++;

    // Queue Little's Law: que_Q = que_inflow * que_Wq
    builder.addEquation(
      EqKind.Simple,
      builder.addName(qLenVar),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(inflowVar), builder.addName(waitVar)),
    );
    equationCount++;
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

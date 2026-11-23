// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for SIMSCRIPT II.5 Discrete-Event Simulation Models.
 *
 * Lowers SIMSCRIPT II.5 resources (capacity, arrival rate, service rate, utilization,
 * queue dynamics, Little's Law L = lambda * W) and TALLY / ACCUMULATE invariants
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation.
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import {
  ensureBuiltInSimscriptLibraryRegistered,
  lookupSimscriptModelSchema,
} from "../catalog/library-package-adapter.js";
import type { SimscriptDistributionExpr, SimscriptModel, SimscriptStatement } from "../types.js";

export interface SimscriptDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

export interface SimscriptToDaeOptions {
  modelName?: string | undefined;
}

/**
 * Resolves parameter defaults for a SIMSCRIPT II.5 library primitive from `@modelscript/simscript-std-lib`.
 */
export function resolveSimscriptSchemaParamDefaults(
  modelType: string,
  overrides: Record<string, number | string | boolean> = {},
): Record<string, number | string | boolean> {
  ensureBuiltInSimscriptLibraryRegistered();
  const out: Record<string, number | string | boolean> = {};
  const schema = lookupSimscriptModelSchema(modelType);
  if (schema) {
    for (const p of schema.parameters) {
      if (p.defaultValue !== undefined) {
        out[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function distributionMean(dist: SimscriptDistributionExpr | undefined): number {
  if (!dist) return 1.0;
  switch (dist.kind) {
    case "EXPONENTIAL.F":
    case "NORMAL.F":
    case "POISSON.F":
    case "ERLANG.F":
    case "CONSTANT":
      return Math.max(1e-6, dist.args[0] ?? 1.0);
    case "UNIFORM.F": {
      const lo = dist.args[0] ?? 0.0;
      const hi = dist.args[1] ?? 1.0;
      return Math.max(1e-6, 0.5 * (lo + hi));
    }
  }
}

function flattenStatements(stmts: SimscriptStatement[]): SimscriptStatement[] {
  const out: SimscriptStatement[] = [];
  for (const s of stmts) {
    out.push(s);
    if (s.kind === "FOR_LOOP") out.push(...flattenStatements(s.body));
  }
  return out;
}

/**
 * Extracts nominal arrival rate (lambda) and per-server service rate (mu) for each resource
 * from the model's PROCESS blocks.
 */
export function inferResourceRates(
  model: SimscriptModel,
): Map<string, { capacity: number; lambda: number; mu: number }> {
  const rates = new Map<string, { capacity: number; lambda: number; mu: number }>();

  // Collect arrival rates from generator processes (processes that ACTIVATE another process in a loop or self-activate)
  const processArrivalRate = new Map<string, number>();
  for (const proc of model.processes.values()) {
    const flat = flattenStatements(proc.statements);
    let waitMean: number | undefined;
    const activated: string[] = [];
    for (const stmt of flat) {
      if (stmt.kind === "WAIT") waitMean = distributionMean(stmt.duration);
      if (stmt.kind === "ACTIVATE") {
        activated.push(stmt.processName.toUpperCase());
        if (stmt.delay && waitMean === undefined) {
          waitMean = distributionMean(stmt.delay);
        }
      }
    }
    if (waitMean !== undefined && waitMean > 0) {
      const lam = 1.0 / waitMean;
      for (const target of activated) {
        processArrivalRate.set(target, lam);
      }
    }
  }

  for (const ent of model.preamble.entities) {
    if (ent.kind !== "resource") continue;
    const resName = ent.name.toUpperCase();
    const capacity = model.resourceCapacities.get(resName) ?? ent.capacity ?? 1;
    let lambda = 0.5;
    let mu = 1.0;

    // Find process that requests this resource
    for (const [procName, proc] of model.processes) {
      const flat = flattenStatements(proc.statements);
      const usesRes = flat.some((s) => s.kind === "REQUEST" && s.resource.toUpperCase() === resName);
      if (!usesRes) continue;

      const lam = processArrivalRate.get(procName.toUpperCase());
      if (lam !== undefined) lambda = lam;

      const workStmt = flat.find((s) => s.kind === "WORK");
      if (workStmt && workStmt.kind === "WORK") {
        const svcMean = distributionMean(workStmt.duration);
        mu = 1.0 / svcMean;
      }
      break;
    }

    rates.set(resName, { capacity, lambda, mu });
  }

  return rates;
}

/**
 * Lowers a parsed `SimscriptModel` directly into an `IDaeBuilder` linear memory arena.
 */
export function lowerSimscriptToDae(builder: IDaeBuilder, model: SimscriptModel): SimscriptDaeLoweringResult {
  ensureBuiltInSimscriptLibraryRegistered();
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

    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(key, existing);
      return existing;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  const resourceRates = inferResourceRates(model);

  // 1. Lower each SIMSCRIPT resource into utilization, queue fluid balance, and Little's Law equations
  for (const [resName, info] of resourceRates) {
    const cap = Math.max(1, info.capacity);
    const lam = info.lambda;
    const mu = info.mu;
    const rhoNominal = Math.min(0.999, lam / (cap * mu));
    const wNominal = 1.0 / Math.max(1e-6, cap * mu - lam);
    const lNominal = lam * wNominal;

    const capVar = getOrAddVar(`U_${resName}`, Variability.Parameter, cap);
    const lamVar = getOrAddVar(`lambda_${resName}`, Variability.Parameter, lam);
    const muVar = getOrAddVar(`mu_${resName}`, Variability.Parameter, mu);

    const rhoVar = getOrAddVar(`rho_${resName}`, Variability.Continuous, rhoNominal);
    const busyVar = getOrAddVar(`busy_${resName}`, Variability.Continuous, rhoNominal * cap);
    const lVar = getOrAddVar(`L_${resName}`, Variability.Continuous, lNominal);
    const wVar = getOrAddVar(`W_${resName}`, Variability.Continuous, wNominal);
    const qVar = getOrAddVar(`Q_${resName}`, Variability.Continuous, Math.max(0, lNominal - rhoNominal * cap));
    stateVarIndices.push(qVar);

    // Eq 1: Utilization invariant: rho * (U * mu) = lambda
    const capMulMu = builder.addBinaryExpr(BinOp.Mul, builder.addName(capVar), builder.addName(muVar));
    const rhoLhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), capMulMu);
    builder.addEquation(EqKind.Simple, rhoLhs, builder.addName(lamVar));
    equationCount++;

    // Eq 2: Busy servers invariant: busy = rho * U
    const busyRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), builder.addName(capVar));
    builder.addEquation(EqKind.Simple, builder.addName(busyVar), busyRhs);
    equationCount++;

    // Eq 3: Little's Law invariant: L = lambda * W
    const littleRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(lamVar), builder.addName(wVar));
    builder.addEquation(EqKind.Simple, builder.addName(lVar), littleRhs);
    equationCount++;

    // Eq 4: Fluid queue balance ODE: der(Q) = lambda - busy * mu
    const derQ = builder.addDer(qVar);
    const serviceOut = builder.addBinaryExpr(BinOp.Mul, builder.addName(busyVar), builder.addName(muVar));
    const netFlow = builder.addBinaryExpr(BinOp.Sub, builder.addName(lamVar), serviceOut);
    builder.addEquation(EqKind.Simple, derQ, netFlow);
    equationCount++;
  }

  // 2. Lower TALLY and ACCUMULATE invariants into DAE observable variables & equations
  for (const st of model.preamble.stats) {
    const safeStat = st.statName.replace(/[^A-Za-z0-9_]/g, "_");
    const safeTarget = st.target.replace(/[^A-Za-z0-9_]/g, "_");
    const statVar = getOrAddVar(`${st.kind.toLowerCase()}_${safeStat}`, Variability.Continuous, 0.0);

    // Link automatic resource attributes N.X.<RES> -> busy_<RES>, N.Q.<RES> -> Q_<RES>
    const nxMatch = st.target.match(/^N\.X\.([A-Z0-9._]+)$/i);
    const nqMatch = st.target.match(/^N\.Q\.([A-Z0-9._]+)$/i);
    if (nxMatch) {
      const targetVar = getOrAddVar(`busy_${nxMatch[1]!.toUpperCase()}`, Variability.Continuous, 0.0);
      builder.addEquation(EqKind.Simple, builder.addName(statVar), builder.addName(targetVar));
      equationCount++;
    } else if (nqMatch) {
      const targetVar = getOrAddVar(`Q_${nqMatch[1]!.toUpperCase()}`, Variability.Continuous, 0.0);
      builder.addEquation(EqKind.Simple, builder.addName(statVar), builder.addName(targetVar));
      equationCount++;
    } else {
      const targetVar = getOrAddVar(`obs_${safeTarget}`, Variability.Continuous, 0.0);
      builder.addEquation(EqKind.Simple, builder.addName(statVar), builder.addName(targetVar));
      equationCount++;
    }
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * Convenience wrapper creating a new `DAEBuilder` and lowering the SIMSCRIPT II.5 model into it.
 */
export function simscriptToDae(model: SimscriptModel, options?: SimscriptToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || model.name || "SimscriptModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerSimscriptToDae(builder, model);
  return builder;
}

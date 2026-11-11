// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Deterministic Pharmacokinetic (PK) Simulator & NCA Metrics.
 *
 * Integrates 1- and 2-compartment models with oral/IV routes and computes AUC, Cmax, Tmax, and t1/2.
 */

import type { MlxtranDocument, MlxtranSimOptions, MlxtranSimResult } from "../types.js";

export function solveMlxtranPk(doc: MlxtranDocument, options?: MlxtranSimOptions): MlxtranSimResult {
  const model = doc.model;
  const tEnd = options?.tEnd ?? 24.0;
  const dt = options?.dt ?? 0.05;
  const dose = options?.dose ?? 100.0;
  const doseTime = options?.doseTime ?? 0.0;

  // Extract parameters with defaults
  const paramMap = new Map<string, number>();
  for (const inp of model.inputs) {
    paramMap.set(inp.name.toLowerCase(), inp.init ?? 1.0);
  }
  if (options?.params) {
    for (const [k, v] of Object.entries(options.params)) {
      paramMap.set(k.toLowerCase(), v);
    }
  }

  const ka = paramMap.get("ka") ?? 1.0;
  const V = paramMap.get("v") ?? 10.0;
  const Cl = paramMap.get("cl") ?? 2.0;
  const V2 = paramMap.get("v2") ?? 20.0;
  const Q = paramMap.get("q") ?? 0.0;

  const k10 = Cl / V;
  const k12 = Q / V;
  const k21 = Q / V2;

  const isOral =
    options?.route === "oral" ||
    model.equations.some((eq) => eq.lhs.toLowerCase().includes("ad") || eq.rhs.toLowerCase().includes("ka")) ||
    model.macros.some((m) => m.kind === "absorption" || m.kind === "depot");

  // State integration variables: Ad (depot), Ac (central), Ap (peripheral)
  let Ad = 0.0;
  let Ac = 0.0;
  let Ap = 0.0;

  // If dose is at t=0
  if (doseTime <= 0) {
    if (isOral) Ad += dose;
    else Ac += dose;
  }

  const times: number[] = [];
  const amounts: Record<string, number[]> = {
    Ac: [],
    ...(isOral ? { Ad: [] } : {}),
    ...(Q > 0 ? { Ap: [] } : {}),
  };
  const concentrations: Record<string, number[]> = {
    Cc: [],
  };

  const steps = Math.floor(tEnd / dt);
  let cmax = 0.0;
  let tmax = 0.0;
  let auc = 0.0;
  let prevC = 0.0;
  let prevT = 0.0;
  let doseApplied = doseTime <= 0;

  for (let s = 0; s <= steps; s++) {
    const t = s * dt;

    // Apply delayed dose if specified
    if (!doseApplied && t >= doseTime) {
      if (isOral) Ad += dose;
      else Ac += dose;
      doseApplied = true;
    }

    times.push(t);

    const Cc = Ac / V;
    concentrations["Cc"]!.push(Cc);
    amounts["Ac"]!.push(Ac);
    if (amounts["Ad"]) amounts["Ad"].push(Ad);
    if (amounts["Ap"]) amounts["Ap"].push(Ap);

    // Track Cmax and Tmax
    if (Cc > cmax) {
      cmax = Cc;
      tmax = t;
    }

    // Trapezoidal AUC accumulation
    if (s > 0) {
      auc += ((prevC + Cc) / 2) * (t - prevT);
    }
    prevC = Cc;
    prevT = t;

    // Numerical integration (Euler / RK2 step)
    const dAd_dt = isOral ? -ka * Ad : 0.0;
    const dAc_dt = (isOral ? ka * Ad : 0.0) - k10 * Ac - k12 * Ac + k21 * Ap;
    const dAp_dt = k12 * Ac - k21 * Ap;

    Ad += dAd_dt * dt;
    Ac += dAc_dt * dt;
    Ap += dAp_dt * dt;
    if (Ad < 0) Ad = 0;
    if (Ac < 0) Ac = 0;
    if (Ap < 0) Ap = 0;
  }

  // Calculate terminal half-life
  const lambdaZ = k10;
  const halfLife = Math.LN2 / (lambdaZ > 0 ? lambdaZ : 1.0);

  return {
    time: times,
    amounts,
    concentrations,
    cmax,
    tmax,
    auc,
    halfLife,
  };
}

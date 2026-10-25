// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Model, LinearSystemModel } from "../types.js";

export interface EvaluatorContext {
  stateNames: string[];
  inputNames: string[];
  outputNames: string[];
  evalModel: (x: number[], u: number[]) => { dx: number[]; y: number[] };
}

/**
 * Builds an evaluator context mapping states, inputs, and outputs from an EASY5 model.
 */
export function buildModelEvaluator(model: Easy5Model): EvaluatorContext {
  const stateNames: string[] = [];
  const stateInitial: number[] = [];
  const inputNames: string[] = [];
  const outputNames: string[] = [];

  // 1. Collect continuous states
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase().replace(/^GP\//, "");
    if (t === "IN" || t === "LA") {
      stateNames.push(`${compId}_s`);
      stateInitial.push(
        comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0),
      );
    } else if (t === "TF") {
      const den = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
      const order = Math.max(0, den.length - 1);
      for (let i = 1; i <= order; i++) {
        stateNames.push(`${compId}_x${i}`);
        stateInitial.push(0.0);
      }
    }
  }

  // 2. Collect unconnected inputs as external system inputs
  const connectedInputs = new Set<string>();
  for (const c of model.connections) {
    connectedInputs.add(`${c.toComponent}.${c.toPort}`.toUpperCase());
  }

  for (const [compId, comp] of model.components) {
    for (const [portName, port] of Object.entries(comp.ports)) {
      if (port.kind === "input") {
        const key = `${compId}.${portName}`.toUpperCase();
        if (!connectedInputs.has(key)) {
          inputNames.push(`${compId}_${portName}`);
        }
      } else if (port.kind === "output") {
        outputNames.push(`${compId}_${portName}`);
      }
    }
  }

  // If no external inputs, provide a dummy default input
  if (inputNames.length === 0) {
    inputNames.push("U_default");
  }

  // Fallback default output if none
  if (outputNames.length === 0) {
    outputNames.push("Y_default");
  }

  // Model evaluation function
  function evalModel(x: number[], u: number[]): { dx: number[]; y: number[] } {
    const varValues = new Map<string, number>();

    // Map external inputs
    for (let i = 0; i < inputNames.length; i++) {
      varValues.set(inputNames[i]!, u[i] ?? 0.0);
    }

    // Map states
    const stateMap = new Map<string, number>();
    for (let i = 0; i < stateNames.length; i++) {
      stateMap.set(stateNames[i]!, x[i] ?? 0.0);
    }

    // Iterative relaxation for algebraic equations (up to 20 passes)
    for (let iter = 0; iter < 20; iter++) {
      // Components
      for (const [compId, comp] of model.components) {
        const t = comp.type.toUpperCase().replace(/^GP\//, "");
        if (t === "GA") {
          const k = typeof comp.parameters["K"] === "number" ? comp.parameters["K"] : 1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, k * inVal);
        } else if (t === "SJ") {
          let sum = 0.0;
          for (let i = 1; i <= 4; i++) {
            const sgn = typeof comp.parameters[`SGN${i}`] === "number" ? (comp.parameters[`SGN${i}`] as number) : 1.0;
            const k = typeof comp.parameters[`K${i}`] === "number" ? (comp.parameters[`K${i}`] as number) : 1.0;
            const inVal = varValues.get(`${compId}_IN${i}`) ?? 0.0;
            sum += sgn * k * inVal;
          }
          varValues.set(`${compId}_OUT`, sum);
        } else if (t === "IN") {
          const s = stateMap.get(`${compId}_s`) ?? 0.0;
          varValues.set(`${compId}_OUT`, s);
        } else if (t === "LA") {
          const s = stateMap.get(`${compId}_s`) ?? 0.0;
          const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
          const tau1 = typeof comp.parameters["TAU1"] === "number" ? comp.parameters["TAU1"] : 0.0;
          const tau2 = typeof comp.parameters["TAU2"] === "number" ? Math.max(1e-9, comp.parameters["TAU2"]) : 1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, gain * (s + (tau1 / tau2) * (inVal - s)));
        } else if (t === "LM") {
          const ul = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
          const ll = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, Math.min(Math.max(inVal, ll), ul));
        }
      }

      // Propagate connections
      for (const conn of model.connections) {
        const fromVal = varValues.get(`${conn.fromComponent}_${conn.fromPort}`) ?? 0.0;
        varValues.set(`${conn.toComponent}_${conn.toPort}`, fromVal);
      }
    }

    // Compute state derivatives dx
    const dx: number[] = [];
    for (const [compId, comp] of model.components) {
      const t = comp.type.toUpperCase().replace(/^GP\//, "");
      if (t === "IN") {
        const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
        const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
        dx.push(gain * inVal);
      } else if (t === "LA") {
        const tau2 = typeof comp.parameters["TAU2"] === "number" ? Math.max(1e-9, comp.parameters["TAU2"]) : 1.0;
        const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
        const s = stateMap.get(`${compId}_s`) ?? 0.0;
        dx.push((inVal - s) / tau2);
      }
    }

    // Collect outputs
    const y: number[] = [];
    for (const outName of outputNames) {
      y.push(varValues.get(outName) ?? 0.0);
    }

    return { dx, y };
  }

  return {
    stateNames,
    inputNames,
    outputNames,
    evalModel,
  };
}

/**
 * Numerically linearizes an EASY5 model around operating point (x0, u0).
 * Emits continuous state-space matrices A (n x n), B (n x m), C (p x n), D (p x m).
 */
export function linearizeEasy5(
  model: Easy5Model,
  x0?: number[],
  u0?: number[],
  perturbation: number = 1e-6,
): LinearSystemModel {
  const ctx = buildModelEvaluator(model);
  const n = ctx.stateNames.length;
  const m = ctx.inputNames.length;
  const p = ctx.outputNames.length;

  const xBase = x0 && x0.length === n ? [...x0] : new Array(n).fill(0.0);
  const uBase = u0 && u0.length === m ? [...u0] : new Array(m).fill(0.0);

  // Initialize matrices
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0.0));
  const B: number[][] = Array.from({ length: n }, () => new Array(m).fill(0.0));
  const C: number[][] = Array.from({ length: p }, () => new Array(n).fill(0.0));
  const D: number[][] = Array.from({ length: p }, () => new Array(m).fill(0.0));

  const eps = Math.max(1e-12, perturbation);

  // 1. Perturb States -> columns of A and C
  for (let j = 0; j < n; j++) {
    const xPlus = [...xBase];
    const xMinus = [...xBase];
    xPlus[j] += eps;
    xMinus[j] -= eps;

    const resPlus = ctx.evalModel(xPlus, uBase);
    const resMinus = ctx.evalModel(xMinus, uBase);

    for (let i = 0; i < n; i++) {
      A[i]![j] = (resPlus.dx[i]! - resMinus.dx[i]!) / (2.0 * eps);
    }
    for (let k = 0; k < p; k++) {
      C[k]![j] = (resPlus.y[k]! - resMinus.y[k]!) / (2.0 * eps);
    }
  }

  // 2. Perturb Inputs -> columns of B and D
  for (let j = 0; j < m; j++) {
    const uPlus = [...uBase];
    const uMinus = [...uBase];
    uPlus[j] += eps;
    uMinus[j] -= eps;

    const resPlus = ctx.evalModel(xBase, uPlus);
    const resMinus = ctx.evalModel(xBase, uMinus);

    for (let i = 0; i < n; i++) {
      B[i]![j] = (resPlus.dx[i]! - resMinus.dx[i]!) / (2.0 * eps);
    }
    for (let k = 0; k < p; k++) {
      D[k]![j] = (resPlus.y[k]! - resMinus.y[k]!) / (2.0 * eps);
    }
  }

  return {
    A,
    B,
    C,
    D,
    stateNames: ctx.stateNames,
    inputNames: ctx.inputNames,
    outputNames: ctx.outputNames,
  };
}

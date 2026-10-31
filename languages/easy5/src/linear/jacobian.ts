// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CompiledFortranComponent } from "@modelscript/fortran";
import { compileUserComponentStep } from "../script/user-code.js";
import type { Easy5Model, Easy5Table, LinearSystemModel } from "../types.js";

export interface EvaluatorContext {
  stateNames: string[];
  inputNames: string[];
  outputNames: string[];
  evalModel: (x: number[], u: number[]) => { dx: number[]; y: number[] };
}

function interpolate1DTable(table: Easy5Table | undefined, xVal: number, clamp: boolean = false): number {
  if (!table || table.xValues.length === 0) return xVal;
  const xs = table.xValues;
  const ys = Array.isArray(table.data[0]) ? (table.data[0] as number[]) : (table.data as number[]);
  if (ys.length === 0) return 0.0;
  if (xs.length === 1 || ys.length === 1) return ys[0]!;

  if (xVal <= xs[0]!) {
    if (clamp) return ys[0]!;
    const dx = (xs[1] ?? xs[0]! + 1) - xs[0]!;
    const slope = dx !== 0 ? ((ys[1] ?? ys[0]!) - ys[0]!) / dx : 0.0;
    return ys[0]! + slope * (xVal - xs[0]!);
  }
  const n = Math.min(xs.length, ys.length);
  const lastX = xs[n - 1]!;
  const lastY = ys[n - 1]!;
  if (xVal >= lastX) {
    if (clamp) return lastY;
    const dx = lastX - xs[n - 2]!;
    const slope = dx !== 0 ? (lastY - ys[n - 2]!) / dx : 0.0;
    return lastY + slope * (xVal - lastX);
  }

  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (xVal >= x0 && xVal <= x1) {
      const span = x1 - x0;
      const t = span !== 0 ? (xVal - x0) / span : 0.0;
      return ys[i]! + t * (ys[i + 1]! - ys[i]!);
    }
  }
  return lastY;
}

function detectUgStateCount(userCode: string | undefined, initialStates: Record<string, number>): number {
  let maxIdx = 0;
  for (const k of Object.keys(initialStates)) {
    const m = /^S(\d+)$/i.exec(k);
    if (m) maxIdx = Math.max(maxIdx, parseInt(m[1]!, 10));
  }
  if (userCode) {
    const regex = /\bSD\s*\(\s*(\d+)\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(userCode)) !== null) {
      maxIdx = Math.max(maxIdx, parseInt(m[1]!, 10));
    }
  }
  return maxIdx;
}

/**
 * Builds an evaluator context mapping states, inputs, and outputs from an EASY5 model.
 */
export function buildModelEvaluator(model: Easy5Model): EvaluatorContext {
  const stateNames: string[] = [];
  const stateInitial: number[] = [];
  const inputNames: string[] = [];
  const outputNames: string[] = [];
  const compiledUgMap = new Map<string, { compiled: CompiledFortranComponent; numStates: number }>();

  // 1. Collect continuous states
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase().replace(/^GP\//, "");
    if (t === "IN" || t === "LA" || t === "TD") {
      stateNames.push(`${compId}_s`);
      stateInitial.push(
        comp.initialStates["S1"] ?? (typeof comp.parameters["S0"] === "number" ? comp.parameters["S0"] : 0.0),
      );
    } else if (t === "TF") {
      const den = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
      const order = Math.max(0, den.length - 1);
      for (let i = 1; i <= order; i++) {
        stateNames.push(`${compId}_x${i}`);
        stateInitial.push(comp.initialStates[`S${i}`] ?? 0.0);
      }
    } else if (t === "UG" && comp.userCode) {
      const scalarParams: Record<string, string | number> = {};
      for (const [pk, pv] of Object.entries(comp.parameters)) {
        if (typeof pv === "number" || typeof pv === "string") {
          scalarParams[pk] = pv;
        }
      }
      const compiled = compileUserComponentStep(comp.userCode, scalarParams);
      const numStates = detectUgStateCount(comp.userCode, comp.initialStates);
      compiledUgMap.set(compId, { compiled, numStates });
      for (let i = 1; i <= numStates; i++) {
        stateNames.push(`${compId}_S${i}`);
        stateInitial.push(comp.initialStates[`S${i}`] ?? 0.0);
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

    const ugDerivatives = new Map<string, number[]>();

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
        } else if (t === "IN" || t === "TD") {
          const s = stateMap.get(`${compId}_s`) ?? 0.0;
          varValues.set(`${compId}_OUT`, s);
        } else if (t === "LA") {
          const s = stateMap.get(`${compId}_s`) ?? 0.0;
          const gain = typeof comp.parameters["GAIN"] === "number" ? comp.parameters["GAIN"] : 1.0;
          const tau1 = typeof comp.parameters["TAU1"] === "number" ? comp.parameters["TAU1"] : 0.0;
          const tau2 = typeof comp.parameters["TAU2"] === "number" ? Math.max(1e-9, comp.parameters["TAU2"]) : 1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, gain * (s + (tau1 / tau2) * (inVal - s)));
        } else if (t === "TF") {
          const rawNum = Array.isArray(comp.parameters["NUM"]) ? (comp.parameters["NUM"] as number[]) : [1.0];
          const rawDen = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          const order = rawDen.length - 1;
          if (order <= 0) {
            const k = (rawNum[0] ?? 1.0) / (rawDen[0] || 1.0);
            varValues.set(`${compId}_OUT`, k * inVal);
          } else {
            const an = rawDen[0] !== 0 ? rawDen[0]! : 1.0;
            const a = rawDen.map((coef) => coef / an);
            const b = rawNum.map((coef) => coef / an);
            while (b.length < a.length) b.unshift(0.0);
            const d0 = b[0]!;
            let outVal = d0 * inVal;
            for (let i = 0; i < order; i++) {
              const bCoef = b[b.length - 1 - i]! - d0 * a[a.length - 1 - i]!;
              const xi = stateMap.get(`${compId}_x${i + 1}`) ?? 0.0;
              outVal += bCoef * xi;
            }
            varValues.set(`${compId}_OUT`, outVal);
          }
        } else if (t === "LM") {
          const ul = typeof comp.parameters["UL"] === "number" ? comp.parameters["UL"] : 1.0;
          const ll = typeof comp.parameters["LL"] === "number" ? comp.parameters["LL"] : -1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, Math.min(Math.max(inVal, ll), ul));
        } else if (t === "DZ") {
          const dbp = typeof comp.parameters["DBP"] === "number" ? comp.parameters["DBP"] : 0.1;
          const dbn = typeof comp.parameters["DBN"] === "number" ? comp.parameters["DBN"] : -0.1;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          const outVal = inVal > dbp ? inVal - dbp : inVal < dbn ? inVal - dbn : 0.0;
          varValues.set(`${compId}_OUT`, outVal);
        } else if (t === "HY") {
          const outHigh = typeof comp.parameters["OUT_HIGH"] === "number" ? comp.parameters["OUT_HIGH"] : 1.0;
          const outLow = typeof comp.parameters["OUT_LOW"] === "number" ? comp.parameters["OUT_LOW"] : -1.0;
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, inVal >= 0 ? outHigh : outLow);
        } else if (t === "SW") {
          const threshold = typeof comp.parameters["THRESHOLD"] === "number" ? comp.parameters["THRESHOLD"] : 0.0;
          const in1 = varValues.get(`${compId}_IN1`) ?? 0.0;
          const in2 = varValues.get(`${compId}_IN2`) ?? 0.0;
          const ctl = varValues.get(`${compId}_CTL`) ?? 0.0;
          varValues.set(`${compId}_OUT`, ctl >= threshold ? in1 : in2);
        } else if (t === "FN") {
          const tableName = typeof comp.parameters["TABLE"] === "string" ? comp.parameters["TABLE"] : "";
          const tbl = model.tables.get(tableName) ?? model.tables.get(tableName.toUpperCase());
          const extrap = String(comp.parameters["EXTRAP"] ?? "").toUpperCase();
          const clamp =
            extrap === "CLAMP" ||
            extrap === "BOUNDED" ||
            comp.parameters["BOUNDED"] === 1 ||
            String(comp.parameters["BOUNDED"] ?? "").toUpperCase() === "TRUE";
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          varValues.set(`${compId}_OUT`, interpolate1DTable(tbl, inVal, clamp));
        } else if (t === "UG") {
          const ugInfo = compiledUgMap.get(compId);
          if (ugInfo) {
            const { compiled, numStates } = ugInfo;
            const dimLen = Math.max(16, numStates);
            const sData = new Float64Array(dimLen);
            const sdData = new Float64Array(dimLen);
            const xpKeys = Object.keys(comp.parameters);
            const xpData = new Float64Array(Math.max(16, xpKeys.length));
            const locals: Record<string, number | boolean | string> = {};

            for (let k = 0; k < xpKeys.length; k++) {
              const pk = xpKeys[k]!;
              const pv = comp.parameters[pk];
              if (typeof pv === "number") {
                locals[pk] = pv;
                xpData[k] = pv;
              }
            }
            for (const [portName, port] of Object.entries(comp.ports)) {
              if (port.kind === "input") {
                const v = varValues.get(`${compId}_${portName}`) ?? 0.0;
                locals[portName] = v;
              }
            }
            for (let i = 1; i <= numStates; i++) {
              const sv = stateMap.get(`${compId}_S${i}`) ?? 0.0;
              sData[i - 1] = sv;
              locals[`S(${i})`] = sv;
            }

            const arrays = {
              S: { data: sData, dims: [{ lower: 1, upper: dimLen }], allocated: true },
              SD: { data: sdData, dims: [{ lower: 1, upper: dimLen }], allocated: true },
              XP: { data: xpData, dims: [{ lower: 1, upper: xpData.length }], allocated: true },
            };

            compiled.step({
              time: 0,
              dt: 0.01,
              firstStep: false,
              inputs: (p) => varValues.get(`${compId}_${p.toUpperCase()}`) ?? 0.0,
              getInput: (p) => varValues.get(`${compId}_${p.toUpperCase()}`) ?? 0.0,
              setOutput: (p, v) => varValues.set(`${compId}_${p.toUpperCase()}`, v),
              storf: new Float64Array(64),
              stori: new Int32Array(64),
              locals,
              arrays,
            });

            for (const [portName, port] of Object.entries(comp.ports)) {
              if (port.kind === "output") {
                const v = locals[portName] ?? locals[portName.toUpperCase()] ?? locals[portName.toLowerCase()];
                if (v !== undefined) {
                  varValues.set(`${compId}_${portName}`, Number(v));
                }
              }
            }

            const dList: number[] = [];
            for (let i = 1; i <= numStates; i++) {
              dList.push(sdData[i - 1] ?? 0.0);
            }
            ugDerivatives.set(compId, dList);
          }
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
      } else if (t === "TD") {
        const delay = typeof comp.parameters["DELAY"] === "number" ? Math.max(1e-6, comp.parameters["DELAY"]) : 0.1;
        const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
        const s = stateMap.get(`${compId}_s`) ?? 0.0;
        dx.push((inVal - s) / delay);
      } else if (t === "TF") {
        const rawDen = Array.isArray(comp.parameters["DEN"]) ? (comp.parameters["DEN"] as number[]) : [1.0, 1.0];
        const order = rawDen.length - 1;
        if (order > 0) {
          const an = rawDen[0] !== 0 ? rawDen[0]! : 1.0;
          const a = rawDen.map((coef) => coef / an);
          const inVal = varValues.get(`${compId}_IN`) ?? 0.0;
          for (let i = 0; i < order - 1; i++) {
            dx.push(stateMap.get(`${compId}_x${i + 2}`) ?? 0.0);
          }
          let lastDer = inVal;
          for (let i = 0; i < order; i++) {
            const coef = a[a.length - 1 - i]!;
            const xi = stateMap.get(`${compId}_x${i + 1}`) ?? 0.0;
            lastDer -= coef * xi;
          }
          dx.push(lastDer);
        }
      } else if (t === "UG") {
        const dList = ugDerivatives.get(compId);
        if (dList) {
          dx.push(...dList);
        }
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

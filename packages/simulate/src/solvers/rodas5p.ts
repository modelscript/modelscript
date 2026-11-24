// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview RODAS5P: 5th-Order L-Stable Stiffly Accurate Rosenbrock-W DAE Solver
 * & Auto-Stiffness Composite Solver (`AutoTsit5(Rodas5P)`).
 *
 * Uses Steinebach's L-stable stiffly accurate 6-stage 4th-order Rosenbrock-W kernel with
 * Richardson extrapolation (`y5 = (16 * y_{h/2} - y_h) / 15`) to achieve verified 5th-order
 * accuracy, L-stability (R(∞) = 0), singular mass-matrix DAE support, and an asymptotically
 * exact 5th-order embedded error estimator `(y_{h/2} - y_h) / 15`.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";
import { WasmScratchPool, type WasmMemoryHost, type WasmScratchScope } from "@modelscript/solve";
import type { CommonSolverResult, SolverStats } from "../core/problem-types.js";
import { RODAS4P_GAMMA, type Rodas4PEventCallback, type Rodas4PEventFunction, type Rodas4POptions } from "./rodas4p.js";
import { tsit5 } from "./tsit5.js";

interface Rodas5PWasmExports extends WasmMemoryHost {
  rodas5p_assemble_and_factor?: (
    n: number,
    invGammaH: number,
    hasMass: number,
    mPtr: number,
    jPtr: number,
    wPtr: number,
    pivPtr: number,
    scalePtr: number,
  ) => number;
  rodas5p_stage_step?: (
    stage: number,
    n: number,
    h: number,
    hasMass: number,
    mPtr: number,
    wPtr: number,
    pivPtr: number,
    scalePtr: number,
    yPtr: number,
    fStagePtr: number,
    dfdtPtr: number,
    kBufPtr: number,
    mkBufPtr: number,
    yStagePtr: number,
    luScratchPtr: number,
  ) => number;
  rodas5p_richardson_update_and_error?: (
    n: number,
    yPtr: number,
    yCoarsePtr: number,
    yFinePtr: number,
    yNewPtr: number,
    atol: number,
    rtol: number,
  ) => number;
}

interface Rodas5PWasmContext {
  wasm: Rodas5PWasmExports;
  hasMass: number;
  mPtr: number;
  jPtr: number;
  wPtr: number;
  pivPtr: number;
  scalePtr: number;
  yPtr: number;
  fStagePtr: number;
  dfdtPtr: number;
  kBufPtr: number;
  mkBufPtr: number;
  yStagePtr: number;
  luScratchPtr: number;
  yOuterPtr: number;
  yCoarsePtr: number;
  yFinePtr: number;
  yNewPtr: number;
  yStageJs: number[];
  yMidJs: number[];
}

const _rodas5pScratchPools = new WeakMap<object, WasmScratchPool>();
function getRodas5PPool(wasm: WasmMemoryHost): WasmScratchPool {
  let pool = _rodas5pScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _rodas5pScratchPools.set(wasm, pool);
  }
  return pool;
}

function writeVecToWasm(wasm: WasmMemoryHost, ptr: number, src: number[], n: number): void {
  const view = new Float64Array(wasm.memory.buffer, ptr, n);
  for (let i = 0; i < n; i++) {
    view[i] = src[i] ?? 0;
  }
}

function readVecFromWasm(wasm: WasmMemoryHost, ptr: number, dst: number[], n: number): void {
  const view = new Float64Array(wasm.memory.buffer, ptr, n);
  for (let i = 0; i < n; i++) {
    dst[i] = view[i]!;
  }
}

// Verified Steinebach RODAS4P base coefficients (L-stable, stiffly accurate, γ = 0.25)
const GAMMA = RODAS4P_GAMMA;
const C2 = 3.0 * GAMMA;
const C3 = 0.21;
const C4 = 0.63;

const A21 = 3.0;
const A31 = 1.831036793486759;
const A32 = 0.4955183967433795;
const A41 = 2.304376582692669;
const A42 = -0.05249275245743001;
const A43 = -1.176798761832782;
const A51 = -7.170454962423024;
const A52 = -4.741636671481785;
const A53 = -16.31002631330971;
const A54 = -1.062004044111401;

const C21 = -12.0;
const C31 = -8.791795173947035;
const C32 = -2.207865586973518;
const C41 = 10.81793056857153;
const C42 = 6.780270611428266;
const C43 = 19.5348594464241;
const C51 = 34.19095006749676;
const C52 = 15.49671153725963;
const C53 = 54.7476087596413;
const C54 = 14.16005392148534;
const C61 = 34.62605830930532;
const C62 = 15.30084976114473;
const C63 = 56.99955578662667;
const C64 = 18.40807009793095;
const C65 = -5.714285714285717;

const D1 = 0.25;
const D2 = -0.5;
const D3 = -0.023504;
const D4 = -0.0362;

export type Rodas5POptions = Rodas4POptions;
export type Rodas5PResult = CommonSolverResult & {
  t: number[];
  y: number[][];
  success: boolean;
  stats: SolverStats;
};

function computeJacobianFD(
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  f0: number[],
): Float64Array {
  const n = y.length;
  const J = new Float64Array(n * n);
  const yPert = [...y];
  for (let j = 0; j < n; j++) {
    const yj = y[j] ?? 0;
    const h = Math.max(1e-8, 1e-8 * Math.abs(yj));
    yPert[j] = yj + h;
    const fPert = f(t, yPert);
    yPert[j] = yj;
    const invH = 1.0 / h;
    for (let i = 0; i < n; i++) {
      J[i * n + j] = ((fPert[i] ?? 0) - (f0[i] ?? 0)) * invH;
    }
  }
  return J;
}

function computeDfDtFD(f: (t: number, y: number[]) => number[], t: number, y: number[], f0: number[]): Float64Array {
  const n = y.length;
  const dfdt = new Float64Array(n);
  const dt = Math.max(1e-8, 1e-8 * Math.abs(t));
  const fNext = f(t + dt, y);
  const invDt = 1.0 / dt;
  for (let i = 0; i < n; i++) {
    dfdt[i] = ((fNext[i] ?? 0) - (f0[i] ?? 0)) * invDt;
  }
  return dfdt;
}

function applyMassVec(out: Float64Array, v: Float64Array, massMatrix: number[][] | undefined, n: number): void {
  if (!massMatrix) {
    out.set(v);
    return;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = massMatrix[i];
    if (row) {
      for (let j = 0; j < n; j++) s += (row[j] ?? 0) * v[j]!;
    }
    out[i] = s;
  }
}

function hermiteInterp(
  y0: number[],
  y1: number[],
  f0: number[],
  f1: number[],
  h: number,
  theta: number,
  n: number,
): number[] {
  const t2 = theta * theta;
  const t3 = t2 * theta;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + theta;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = h00 * (y0[i] ?? 0) + h10 * h * (f0[i] ?? 0) + h01 * (y1[i] ?? 0) + h11 * h * (f1[i] ?? 0);
  }
  return out;
}

interface RodasStepCounters {
  nfev: number;
  njev: number;
  nlu: number;
}

function rodasBaseStep(
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  h: number,
  massMatrix: number[][] | undefined,
  counters: RodasStepCounters,
): number[] | null {
  const n = y.length;
  const f0 = f(t, y);
  counters.nfev++;
  const J = computeJacobianFD(f, t, y, f0);
  counters.njev++;
  counters.nfev += n;
  const dfdt = computeDfDtFD(f, t, y, f0);
  counters.nfev++;

  const invGh = 1.0 / (GAMMA * h);
  const W = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const mRow = massMatrix ? massMatrix[i] : undefined;
    for (let j = 0; j < n; j++) {
      const mij = mRow ? (mRow[j] ?? 0) : i === j ? 1.0 : 0.0;
      W[i * n + j] = invGh * mij - J[i * n + j]!;
    }
  }
  const fact = luFactorFlat(W, n);
  counters.nlu++;

  const invH = 1.0 / h;
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const k5 = new Float64Array(n);
  const k6 = new Float64Array(n);
  const Mk1 = new Float64Array(n);
  const Mk2 = new Float64Array(n);
  const Mk3 = new Float64Array(n);
  const Mk4 = new Float64Array(n);
  const Mk5 = new Float64Array(n);
  const yStage = new Array<number>(n);

  // Stage 1
  for (let i = 0; i < n; i++) k1[i] = (f0[i] ?? 0) + h * D1 * dfdt[i]!;
  luSolveFlat(fact, k1);
  applyMassVec(Mk1, k1, massMatrix, n);

  // Stage 2
  for (let i = 0; i < n; i++) yStage[i] = y[i]! + A21 * k1[i]!;
  const f1 = f(t + C2 * h, yStage);
  counters.nfev++;
  for (let i = 0; i < n; i++) k2[i] = (f1[i] ?? 0) + invH * C21 * Mk1[i]! + h * D2 * dfdt[i]!;
  luSolveFlat(fact, k2);
  applyMassVec(Mk2, k2, massMatrix, n);

  // Stage 3
  for (let i = 0; i < n; i++) yStage[i] = y[i]! + A31 * k1[i]! + A32 * k2[i]!;
  const f2 = f(t + C3 * h, yStage);
  counters.nfev++;
  for (let i = 0; i < n; i++) k3[i] = (f2[i] ?? 0) + invH * (C31 * Mk1[i]! + C32 * Mk2[i]!) + h * D3 * dfdt[i]!;
  luSolveFlat(fact, k3);
  applyMassVec(Mk3, k3, massMatrix, n);

  // Stage 4
  for (let i = 0; i < n; i++) yStage[i] = y[i]! + A41 * k1[i]! + A42 * k2[i]! + A43 * k3[i]!;
  const f3 = f(t + C4 * h, yStage);
  counters.nfev++;
  for (let i = 0; i < n; i++)
    k4[i] = (f3[i] ?? 0) + invH * (C41 * Mk1[i]! + C42 * Mk2[i]! + C43 * Mk3[i]!) + h * D4 * dfdt[i]!;
  luSolveFlat(fact, k4);
  applyMassVec(Mk4, k4, massMatrix, n);

  // Stage 5
  for (let i = 0; i < n; i++) yStage[i] = y[i]! + A51 * k1[i]! + A52 * k2[i]! + A53 * k3[i]! + A54 * k4[i]!;
  const f4 = f(t + h, yStage);
  counters.nfev++;
  for (let i = 0; i < n; i++)
    k5[i] = (f4[i] ?? 0) + invH * (C51 * Mk1[i]! + C52 * Mk2[i]! + C53 * Mk3[i]! + C54 * Mk4[i]!);
  luSolveFlat(fact, k5);
  applyMassVec(Mk5, k5, massMatrix, n);

  // Stage 6 (4th-order stiffly accurate solution)
  const yEmb = new Array<number>(n);
  for (let i = 0; i < n; i++) yEmb[i] = yStage[i]! + k5[i]!;
  const f5 = f(t + h, yEmb);
  counters.nfev++;
  for (let i = 0; i < n; i++)
    k6[i] = (f5[i] ?? 0) + invH * (C61 * Mk1[i]! + C62 * Mk2[i]! + C63 * Mk3[i]! + C64 * Mk4[i]! + C65 * Mk5[i]!);
  luSolveFlat(fact, k6);

  const yOut = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = yEmb[i]! + k6[i]!;
    if (!Number.isFinite(v)) return null;
    yOut[i] = v;
  }
  return yOut;
}

function rodasBaseStepWasm(
  ctx: Rodas5PWasmContext,
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  h: number,
  counters: RodasStepCounters,
): boolean {
  const n = y.length;
  const wasm = ctx.wasm;
  const f0 = f(t, y);
  counters.nfev++;
  const J = computeJacobianFD(f, t, y, f0);
  counters.njev++;
  counters.nfev += n;
  const dfdt = computeDfDtFD(f, t, y, f0);
  counters.nfev++;

  new Float64Array(wasm.memory.buffer, ctx.jPtr, n * n).set(J);
  const invGh = 1.0 / (GAMMA * h);
  const factored = wasm.rodas5p_assemble_and_factor!(
    n,
    invGh,
    ctx.hasMass,
    ctx.mPtr,
    ctx.jPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
  );
  counters.nlu++;
  if (!factored) return false;

  writeVecToWasm(wasm, ctx.yPtr, y, n);
  writeVecToWasm(wasm, ctx.fStagePtr, f0, n);
  new Float64Array(wasm.memory.buffer, ctx.dfdtPtr, n).set(dfdt);

  // Stage 1
  wasm.rodas5p_stage_step!(
    1,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );

  // Stage 2
  readVecFromWasm(wasm, ctx.yStagePtr, ctx.yStageJs, n);
  const f1 = f(t + C2 * h, ctx.yStageJs);
  counters.nfev++;
  writeVecToWasm(wasm, ctx.fStagePtr, f1, n);
  wasm.rodas5p_stage_step!(
    2,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );

  // Stage 3
  readVecFromWasm(wasm, ctx.yStagePtr, ctx.yStageJs, n);
  const f2 = f(t + C3 * h, ctx.yStageJs);
  counters.nfev++;
  writeVecToWasm(wasm, ctx.fStagePtr, f2, n);
  wasm.rodas5p_stage_step!(
    3,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );

  // Stage 4
  readVecFromWasm(wasm, ctx.yStagePtr, ctx.yStageJs, n);
  const f3 = f(t + C4 * h, ctx.yStageJs);
  counters.nfev++;
  writeVecToWasm(wasm, ctx.fStagePtr, f3, n);
  wasm.rodas5p_stage_step!(
    4,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );

  // Stage 5
  readVecFromWasm(wasm, ctx.yStagePtr, ctx.yStageJs, n);
  const f4 = f(t + h, ctx.yStageJs);
  counters.nfev++;
  writeVecToWasm(wasm, ctx.fStagePtr, f4, n);
  wasm.rodas5p_stage_step!(
    5,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );

  // Stage 6 (4th-order stiffly accurate solution written to yStagePtr)
  readVecFromWasm(wasm, ctx.yStagePtr, ctx.yStageJs, n);
  const f5 = f(t + h, ctx.yStageJs);
  counters.nfev++;
  writeVecToWasm(wasm, ctx.fStagePtr, f5, n);
  const ok = wasm.rodas5p_stage_step!(
    6,
    n,
    h,
    ctx.hasMass,
    ctx.mPtr,
    ctx.wPtr,
    ctx.pivPtr,
    ctx.scalePtr,
    ctx.yPtr,
    ctx.fStagePtr,
    ctx.dfdtPtr,
    ctx.kBufPtr,
    ctx.mkBufPtr,
    ctx.yStagePtr,
    ctx.luScratchPtr,
  );
  return ok !== 0;
}

/**
 * Integrate a stiff ODE/DAE `M * dy/dt = f(t, y)` using 5th-order L-stable extrapolated Rosenbrock-W (`Rodas5P`).
 */
export function rodas5p(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: Rodas5POptions = {},
  massMatrix?: number[][],
  eventFunctions?: Rodas4PEventFunction[],
  eventCallback?: Rodas4PEventCallback,
  eventDirections?: number[],
): Rodas5PResult {
  const n = y0.length;
  const atol = options.atol ?? 1e-8;
  const rtol = options.rtol ?? 1e-6;
  const maxSteps = options.maxSteps ?? 100000;
  const minStep = options.minStep ?? 1e-13;
  const maxStep = options.maxStep ?? Math.max(1e-6, (tEnd - t0) * 0.25);
  const evFns = eventFunctions ?? options.eventFunctions;
  const evCb = eventCallback ?? options.eventCallback;
  const evDirs = eventDirections ?? options.eventDirections;

  const times: number[] = [];
  const states: number[][] = [];
  const record = (t: number, y: number[]): void => {
    times.push(t);
    states.push([...y]);
  };

  let t = t0;
  let y = [...y0];
  let h = options.initialStep ?? Math.min(maxStep, Math.max(1e-6, (tEnd - t0) * 1e-2));
  let outIdx = 0;

  if (outputTimes && outputTimes.length > 0) {
    while (outIdx < outputTimes.length && outputTimes[outIdx]! <= t0 + 1e-14) {
      record(outputTimes[outIdx]!, y);
      outIdx++;
    }
  } else {
    record(t0, y);
  }

  const counters: RodasStepCounters = { nfev: 0, njev: 0, nlu: 0 };
  let steps = 0;
  let rejected = 0;
  let prevEvVals = evFns ? evFns.map((fn) => fn(t, y)) : null;

  const wasm = n > 0 ? (getDefaultWasmExports() as Rodas5PWasmExports | null) : null;
  const useWasmDense = Boolean(
    n > 0 &&
    wasm &&
    typeof wasm.__new === "function" &&
    typeof wasm.rodas5p_assemble_and_factor === "function" &&
    typeof wasm.rodas5p_stage_step === "function" &&
    typeof wasm.rodas5p_richardson_update_and_error === "function",
  );

  let wasmScope: WasmScratchScope | null = null;
  let wasmCtx: Rodas5PWasmContext | null = null;

  if (useWasmDense && wasm) {
    const hasMass = massMatrix ? 1 : 0;
    wasmScope = getRodas5PPool(wasm).scope();
    const alloc8 = (bytes: number): number => wasmScope!.allocU8((bytes + 7) & ~7).ptr;
    const nnBytes = n * n * 8;
    const nBytes = n * 8;
    const pivBytes = (n * 4 + 7) & ~7;
    let mPtr = 0;
    if (hasMass) {
      mPtr = alloc8(nnBytes);
      const mView = new Float64Array(wasm.memory.buffer, mPtr, n * n);
      for (let i = 0; i < n; i++) {
        const rowOff = i * n;
        for (let j = 0; j < n; j++) {
          mView[rowOff + j] = massMatrix![i]?.[j] ?? 0;
        }
      }
    }
    const jPtr = alloc8(nnBytes);
    const wPtr = alloc8(nnBytes);
    const pivPtr = alloc8(pivBytes);
    const scalePtr = alloc8(nBytes);
    const yPtr = alloc8(nBytes);
    const fStagePtr = alloc8(nBytes);
    const dfdtPtr = alloc8(nBytes);
    const kBufPtr = alloc8(6 * nBytes);
    const mkBufPtr = hasMass ? alloc8(5 * nBytes) : 0;
    const yStagePtr = alloc8(nBytes);
    const luScratchPtr = alloc8(nBytes);
    const yOuterPtr = alloc8(nBytes);
    const yCoarsePtr = alloc8(nBytes);
    const yFinePtr = alloc8(nBytes);
    const yNewPtr = alloc8(nBytes);

    wasmCtx = {
      wasm,
      hasMass,
      mPtr,
      jPtr,
      wPtr,
      pivPtr,
      scalePtr,
      yPtr,
      fStagePtr,
      dfdtPtr,
      kBufPtr,
      mkBufPtr,
      yStagePtr,
      luScratchPtr,
      yOuterPtr,
      yCoarsePtr,
      yFinePtr,
      yNewPtr,
      yStageJs: new Array<number>(n),
      yMidJs: new Array<number>(n),
    };
  }

  try {
    while (t < tEnd - 1e-13 && steps + rejected < maxSteps) {
      if (t + h > tEnd) h = tEnd - t;
      if (h < minStep) h = minStep;

      let yNew: number[];
      let errNorm: number;

      if (wasmCtx) {
        // 1 coarse step of h + 2 half steps of h/2 -> Richardson 5th-order L-stable update in WASM
        writeVecToWasm(wasmCtx.wasm, wasmCtx.yOuterPtr, y, n);
        const okCoarse = rodasBaseStepWasm(wasmCtx, f, t, y, h, counters);
        if (!okCoarse) {
          h *= 0.25;
          rejected++;
          continue;
        }
        new Float64Array(wasmCtx.wasm.memory.buffer, wasmCtx.yCoarsePtr, n).set(
          new Float64Array(wasmCtx.wasm.memory.buffer, wasmCtx.yStagePtr, n),
        );

        const okMid = rodasBaseStepWasm(wasmCtx, f, t, y, 0.5 * h, counters);
        if (!okMid) {
          h *= 0.25;
          rejected++;
          continue;
        }
        readVecFromWasm(wasmCtx.wasm, wasmCtx.yStagePtr, wasmCtx.yMidJs, n);

        const okFine = rodasBaseStepWasm(wasmCtx, f, t + 0.5 * h, wasmCtx.yMidJs, 0.5 * h, counters);
        if (!okFine) {
          h *= 0.25;
          rejected++;
          continue;
        }
        new Float64Array(wasmCtx.wasm.memory.buffer, wasmCtx.yFinePtr, n).set(
          new Float64Array(wasmCtx.wasm.memory.buffer, wasmCtx.yStagePtr, n),
        );

        errNorm = wasmCtx.wasm.rodas5p_richardson_update_and_error!(
          n,
          wasmCtx.yOuterPtr,
          wasmCtx.yCoarsePtr,
          wasmCtx.yFinePtr,
          wasmCtx.yNewPtr,
          atol,
          rtol,
        );
        if (!Number.isFinite(errNorm)) {
          h *= 0.25;
          rejected++;
          continue;
        }
        yNew = new Array<number>(n);
        readVecFromWasm(wasmCtx.wasm, wasmCtx.yNewPtr, yNew, n);
      } else {
        // 1 coarse step of h + 2 half steps of h/2 -> Richardson 5th-order L-stable update (TS fallback)
        const yCoarse = rodasBaseStep(f, t, y, h, massMatrix, counters);
        const yMid = yCoarse ? rodasBaseStep(f, t, y, 0.5 * h, massMatrix, counters) : null;
        const yFine = yMid ? rodasBaseStep(f, t + 0.5 * h, yMid, 0.5 * h, massMatrix, counters) : null;

        if (!yCoarse || !yFine) {
          h *= 0.25;
          rejected++;
          continue;
        }

        yNew = new Array<number>(n);
        let errSq = 0;
        for (let i = 0; i < n; i++) {
          const diff = yFine[i]! - yCoarse[i]!;
          const yn = yFine[i]! + diff / 15.0; // (16 * yFine - yCoarse) / 15
          yNew[i] = yn;
          const sc = atol + rtol * Math.max(Math.abs(y[i]!), Math.abs(yn));
          const e = Math.abs(diff) / (15.0 * sc);
          errSq += e * e;
        }

        errNorm = Math.sqrt(errSq / Math.max(1, n));
      }

      if (errNorm <= 1.0 || h <= minStep * 1.01) {
        const tNext = t + h;
        const f0 = f(t, y);
        const fNext = f(tNext, yNew);
        counters.nfev += 2;

        if (outputTimes && outputTimes.length > 0) {
          while (outIdx < outputTimes.length && outputTimes[outIdx]! <= tNext + 1e-13) {
            const tOut = outputTimes[outIdx]!;
            const theta = Math.max(0, Math.min(1, (tOut - t) / h));
            record(tOut, hermiteInterp(y, yNew, f0, fNext, h, theta, n));
            outIdx++;
          }
        } else {
          record(tNext, yNew);
        }

        if (evFns && prevEvVals) {
          const curEvVals = evFns.map((fn) => fn(tNext, yNew));
          for (let eIdx = 0; eIdx < evFns.length; eIdx++) {
            const g0 = prevEvVals[eIdx]!;
            const g1 = curEvVals[eIdx]!;
            const dirReq = evDirs?.[eIdx] ?? 0;
            const crossed = (g0 < 0 && g1 >= 0 && dirReq >= 0) || (g0 > 0 && g1 <= 0 && dirReq <= 0);
            if (crossed && evCb) {
              let lo = 0;
              let hi = 1;
              let gLo = g0;
              for (let b = 0; b < 24; b++) {
                const mid = 0.5 * (lo + hi);
                const yM = hermiteInterp(y, yNew, f0, fNext, h, mid, n);
                const gM = evFns[eIdx]!(t + mid * h, yM);
                if ((gLo < 0 && gM < 0) || (gLo > 0 && gM > 0)) {
                  lo = mid;
                  gLo = gM;
                } else {
                  hi = mid;
                }
              }
              const tEv = t + 0.5 * (lo + hi) * h;
              const yEv = hermiteInterp(y, yNew, f0, fNext, h, 0.5 * (lo + hi), n);
              const yAfter = evCb(tEv, yEv, eIdx, g1 >= g0 ? 1 : -1);
              for (let i = 0; i < n; i++) yNew[i] = yAfter[i]!;
              break;
            }
          }
          prevEvVals = evFns.map((fn) => fn(tNext, yNew));
        }

        t = tNext;
        y = yNew;
        steps++;

        const fac = errNorm > 0 ? Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(errNorm, -0.2))) : 2.0;
        h = Math.min(maxStep, Math.max(minStep, h * fac));
      } else {
        rejected++;
        const fac = Math.max(0.1, Math.min(0.5, 0.9 * Math.pow(errNorm, -0.2)));
        h = Math.max(minStep, h * fac);
      }
    }
  } finally {
    wasmScope?.dispose();
  }

  return {
    t: times,
    y: states,
    times,
    states,
    success: t >= tEnd - 1e-10,
    stats: {
      acceptedSteps: steps,
      rejectedSteps: rejected,
      fEvals: counters.nfev,
      jacobianEvals: counters.njev,
      luFactorizations: counters.nlu,
      converged: t >= tEnd - 1e-10,
    },
  };
}

/**
 * Automatic Stiffness-Detecting Composite Solver (`AutoTsit5(Rodas5P)`).
 *
 * Probes the problem with explicit `Tsit5` first; if stiffness is detected via Jacobian spectral
 * radius estimate or step-budget collapse (or if a singular mass matrix is provided),
 * seamlessly delegates to `Rodas5P`.
 */
export function autoCompositeSolve(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: Rodas5POptions = {},
  massMatrix?: number[][],
): Rodas5PResult & { switchedToStiff: boolean } {
  if (massMatrix) {
    const res = rodas5p(f, t0, y0, tEnd, outputTimes, options, massMatrix);
    return { ...res, switchedToStiff: true };
  }

  const f0 = f(t0, y0);
  const J0 = computeJacobianFD(f, t0, y0, f0);
  const n = y0.length;
  let maxRowSum = 0;
  for (let i = 0; i < n; i++) {
    let rs = 0;
    for (let j = 0; j < n; j++) rs += Math.abs(J0[i * n + j]!);
    if (rs > maxRowSum) maxRowSum = rs;
  }

  if (maxRowSum * Math.max(1e-6, tEnd - t0) > 200) {
    const res = rodas5p(f, t0, y0, tEnd, outputTimes, options);
    return { ...res, switchedToStiff: true };
  }

  const probeBudget = Math.min(options.maxSteps ?? 100000, 4000);
  const tsitRes = tsit5(f, t0, y0, tEnd, outputTimes, {
    atol: options.atol,
    rtol: options.rtol,
    maxSteps: probeBudget,
  });

  const tsitT = (tsitRes as { t?: number[]; times?: number[] }).t ?? tsitRes.times ?? [];
  const tsitY = (tsitRes as { y?: number[][]; states?: number[][] }).y ?? tsitRes.states ?? [];
  const tsitConverged = tsitRes.stats?.converged ?? (tsitT.length > 0 && tsitT[tsitT.length - 1]! >= tEnd - 1e-10);

  if (tsitConverged && tsitT.length > 0 && tsitT[tsitT.length - 1]! >= tEnd - 1e-10) {
    return {
      t: tsitT,
      y: tsitY,
      times: tsitT,
      states: tsitY,
      success: true,
      stats: tsitRes.stats,
      switchedToStiff: false,
    };
  }

  const tSwitch = tsitT[tsitT.length - 1] ?? t0;
  const ySwitch = tsitY[tsitY.length - 1] ?? y0;
  const remOut = outputTimes?.filter((to) => to > tSwitch + 1e-13);
  const stiffRes = rodas5p(f, tSwitch, ySwitch, tEnd, remOut, options);
  const mergedT = [...tsitT, ...stiffRes.t.slice(remOut ? 0 : 1)];
  const mergedY = [...tsitY, ...stiffRes.y.slice(remOut ? 0 : 1)];
  return {
    t: mergedT,
    y: mergedY,
    times: mergedT,
    states: mergedY,
    success: stiffRes.success,
    stats: {
      acceptedSteps: (tsitRes.stats?.acceptedSteps ?? tsitT.length) + stiffRes.stats.acceptedSteps,
      rejectedSteps: (tsitRes.stats?.rejectedSteps ?? 0) + stiffRes.stats.rejectedSteps,
      fEvals: (tsitRes.stats?.fEvals ?? 0) + stiffRes.stats.fEvals,
      jacobianEvals: stiffRes.stats.jacobianEvals,
      luFactorizations: stiffRes.stats.luFactorizations,
      converged: stiffRes.success,
    },
    switchedToStiff: true,
  };
}

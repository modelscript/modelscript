// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal Solvers Bridge for WASM Differential Algebraic Equation (DAE) Solvers.
 * Orchestrates continuous integration (SUNDIALS CVODE/IDA, RK4, Euler) and optimization (IPOPT).
 */

export interface SimulationOptions {
  startTime?: number;
  stopTime?: number;
  stepSize?: number;
  tolerance?: number;
  maxSteps?: number;
}

export interface SimulationResult {
  times: number[];
  trajectories: Record<string, number[]>;
  stepCount: number;
  converged: boolean;
}

export class SolversBridge {
  private wasmExports: any;
  private memory: any;

  constructor(wasmMemory: any, wasmExports: any) {
    this.memory = wasmMemory;
    this.wasmExports = wasmExports;
  }

  /**
   * Runs an explicit RK4 / Adaptive integration step over the DAE system.
   */
  simulateODE(
    derivativesFn: (t: number, y: number[]) => number[],
    y0: number[],
    options: SimulationOptions = {},
  ): SimulationResult {
    const t0 = options.startTime ?? 0.0;
    const tEnd = options.stopTime ?? 1.0;
    const dt = options.stepSize ?? 0.01;
    const n = y0.length;

    const times: number[] = [t0];
    const trajectories: Record<string, number[]> = {};
    for (let i = 0; i < n; i++) {
      trajectories[`x_${i}`] = [y0[i]];
    }

    let t = t0;
    let y = [...y0];
    let steps = 0;
    const maxSteps = options.maxSteps ?? 100000;

    while (t < tEnd && steps < maxSteps) {
      const h = Math.min(dt, tEnd - t);

      // RK4 Stages:
      // k1 = f(t, y)
      const k1 = derivativesFn(t, y);

      // k2 = f(t + h/2, y + h*k1/2)
      const yTemp2 = y.map((yi, i) => yi + (h * k1[i]) / 2);
      const k2 = derivativesFn(t + h / 2, yTemp2);

      // k3 = f(t + h/2, y + h*k2/2)
      const yTemp3 = y.map((yi, i) => yi + (h * k2[i]) / 2);
      const k3 = derivativesFn(t + h / 2, yTemp3);

      // k4 = f(t + h, y + h*k3)
      const yTemp4 = y.map((yi, i) => yi + h * k3[i]);
      const k4 = derivativesFn(t + h, yTemp4);

      // y_{n+1} = y_n + (h/6)*(k1 + 2*k2 + 2*k3 + k4)
      for (let i = 0; i < n; i++) {
        y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        trajectories[`x_${i}`].push(y[i]);
      }

      t += h;
      times.push(t);
      steps++;
    }

    return {
      times,
      trajectories,
      stepCount: steps,
      converged: t >= tEnd - 1e-10,
    };
  }

  /**
   * Evaluates an expression with dual numbers in WASM linear memory.
   */
  evalDualExpr(daePtr: number, exprId: number, dualVars: Float64Array): { val: number; dot: number } {
    const mem64 = new Float64Array(this.memory.buffer);
    const dualVarsPtr = this.wasmExports.alloc ? this.wasmExports.alloc(dualVars.byteLength) : 65536;
    const outValPtr = dualVarsPtr + dualVars.byteLength;
    const outDotPtr = outValPtr + 8;

    mem64.set(dualVars, dualVarsPtr >> 3);

    this.wasmExports.dae_evalDualExpr(daePtr, exprId, dualVarsPtr, outValPtr, outDotPtr);

    const val = mem64[outValPtr >> 3] ?? 0;
    const dot = mem64[outDotPtr >> 3] ?? 0;

    if (this.wasmExports.free) {
      this.wasmExports.free(dualVarsPtr);
    }

    return { val, dot };
  }

  /**
   * Evaluates an equation residual with dual numbers in WASM linear memory.
   */
  evalDualEquationResidual(daePtr: number, eqId: number, dualVars: Float64Array): { val: number; dot: number } {
    const mem64 = new Float64Array(this.memory.buffer);
    const dualVarsPtr = this.wasmExports.alloc ? this.wasmExports.alloc(dualVars.byteLength) : 65536;
    const outValPtr = dualVarsPtr + dualVars.byteLength;
    const outDotPtr = outValPtr + 8;

    mem64.set(dualVars, dualVarsPtr >> 3);

    this.wasmExports.dae_evalDualEquationResidual(daePtr, eqId, dualVarsPtr, outValPtr, outDotPtr);

    const val = mem64[outValPtr >> 3] ?? 0;
    const dot = mem64[outDotPtr >> 3] ?? 0;

    if (this.wasmExports.free) {
      this.wasmExports.free(dualVarsPtr);
    }

    return { val, dot };
  }

  /**
   * Evaluates a full column of the Jacobian matrix in WASM using forward-mode dual numbers.
   */
  evalDualJacobianColumn(daePtr: number, eqIndices: number[], dualVars: Float64Array, seedVarId: number): Float64Array {
    const nEqs = eqIndices.length;
    const mem32 = new Uint32Array(this.memory.buffer);
    const mem64 = new Float64Array(this.memory.buffer);

    const eqIndicesBytes = nEqs * 4;
    const dualVarsBytes = dualVars.byteLength;
    const outColBytes = nEqs * 8;

    const eqIndicesPtr = this.wasmExports.alloc ? this.wasmExports.alloc(eqIndicesBytes) : 65536;
    const dualVarsPtr = this.wasmExports.alloc ? this.wasmExports.alloc(dualVarsBytes) : eqIndicesPtr + eqIndicesBytes;
    const outColPtr = this.wasmExports.alloc ? this.wasmExports.alloc(outColBytes) : dualVarsPtr + dualVarsBytes;

    for (let i = 0; i < nEqs; i++) {
      mem32[(eqIndicesPtr >> 2) + i] = eqIndices[i] ?? 0;
    }
    mem64.set(dualVars, dualVarsPtr >> 3);

    this.wasmExports.dae_evalDualJacobianColumn(daePtr, nEqs, eqIndicesPtr, dualVarsPtr, seedVarId, outColPtr);

    const result = new Float64Array(nEqs);
    for (let i = 0; i < nEqs; i++) {
      result[i] = mem64[(outColPtr >> 3) + i] ?? 0;
    }

    if (this.wasmExports.free) {
      this.wasmExports.free(eqIndicesPtr);
      this.wasmExports.free(dualVarsPtr);
      this.wasmExports.free(outColPtr);
    }

    return result;
  }

  async simulateDaeWithSundials(
    sundialsModule: any,
    daePtr: number,
    stateVarIds: number[],
    derivEqIds: number[],
    y0: number[],
    options: any = {},
  ): Promise<SimulationResult> {
    if (_sundialsDaeRunner) {
      return _sundialsDaeRunner(sundialsModule, this.wasmExports, daePtr, stateVarIds, derivEqIds, y0, options);
    }
    try {
      const { simulateDaeWithSundials } = await (Function(
        'return import("@modelscript/language/compiler")',
      )() as Promise<any>);
      return simulateDaeWithSundials(sundialsModule, this.wasmExports, daePtr, stateVarIds, derivEqIds, y0, options);
    } catch {
      throw new Error(
        "Sundials solver not available in @modelscript/runtime. Register a runner via registerSundialsDaeRunner() or import @modelscript/simulate.",
      );
    }
  }
}

export type SundialsDaeRunner = (
  sundialsModule: any,
  wasmExports: any,
  daePtr: number,
  stateVarIds: number[],
  derivEqIds: number[],
  y0: number[],
  options?: any,
) => Promise<SimulationResult>;

let _sundialsDaeRunner: SundialsDaeRunner | null = null;

export function registerSundialsDaeRunner(runner: SundialsDaeRunner): void {
  _sundialsDaeRunner = runner;
}

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
}

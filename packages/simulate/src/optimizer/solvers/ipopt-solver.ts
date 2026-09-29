// SPDX-License-Identifier: AGPL-3.0-or-later

import { CoinorWasmSolver, type IpoptWasmOptions, type IpoptWasmResult } from "./coinor-wasm.js";
import { lbfgsbSolve, type LbfgsbResult } from "./lbfgsb.js";

export interface IpoptResult {
  status: string;
  objectiveValue: number;
  variables: Record<string, number[]>;
}

export class IpoptSolver {
  private wasmSolver: CoinorWasmSolver | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(
    public modelDllPath: string,
    wasmModule?: any,
  ) {
    if (wasmModule) {
      this.wasmSolver = new CoinorWasmSolver(wasmModule);
    }
  }

  public async solve(
    nVars = 0,
    nConstraints = 0,
    x0: number[] = [],
    varLB: number[] = [],
    varUB: number[] = [],
    conLB: number[] = [],
    conUB: number[] = [],
    evalObjective?: (x: number[]) => number,
    evalGradient?: (x: number[]) => number[],
    evalConstraints?: (x: number[]) => number[],
    evalJacobian?: (x: number[]) => number[],
    nnzJacobian = 0,
    options?: IpoptWasmOptions,
  ): Promise<IpoptResult> {
    if (this.wasmSolver && evalObjective && evalGradient && evalConstraints && evalJacobian) {
      const res: IpoptWasmResult = this.wasmSolver.ipopt(
        nVars,
        nConstraints,
        x0,
        varLB,
        varUB,
        conLB,
        conUB,
        evalObjective,
        evalGradient,
        evalConstraints,
        evalJacobian,
        nnzJacobian,
        options,
      );
      return {
        status: res.status === 0 ? "SUCCESS" : `IPOPT_STATUS_${res.status}`,
        objectiveValue: res.objectiveValue,
        variables: { solution: res.solution },
      };
    }

    // Fallback to pure TypeScript L-BFGS-B when WASM module is not loaded or for bound-constrained problems
    if (nVars > 0 && evalObjective && evalGradient) {
      const x0Arr = new Float64Array(x0.length === nVars ? x0 : new Array(nVars).fill(0.0));
      const lbArr = varLB.length === nVars ? new Float64Array(varLB) : undefined;
      const ubArr = varUB.length === nVars ? new Float64Array(varUB) : undefined;

      const res: LbfgsbResult = lbfgsbSolve(
        x0Arr,
        (xArr) => {
          const xVec = Array.from(xArr);
          return {
            cost: evalObjective(xVec),
            grad: new Float64Array(evalGradient(xVec)),
          };
        },
        lbArr,
        ubArr,
        {
          maxIterations: options?.maxIterations ?? 100,
          tolerance: options?.tolerance ?? 1e-6,
        },
      );

      return {
        status: res.converged ? "SUCCESS" : "MAX_ITERATIONS_REACHED",
        objectiveValue: res.cost,
        variables: { solution: Array.from(res.x) },
      };
    }

    if (nVars === 0) {
      return {
        status: "SUCCESS",
        objectiveValue: 0.0,
        variables: { solution: [] },
      };
    }

    throw new Error(
      "IpoptSolver requires either a loaded WebAssembly CoinOR module with constraint callbacks, or valid evalObjective and evalGradient callbacks for L-BFGS-B optimization.",
    );
  }
}

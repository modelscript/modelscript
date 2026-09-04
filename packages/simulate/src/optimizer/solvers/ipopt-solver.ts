// SPDX-License-Identifier: AGPL-3.0-or-later

import { CoinorWasmSolver, type IpoptWasmOptions, type IpoptWasmResult } from "./coinor-wasm.js";

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

    return {
      status: "STUB_SOLVED_SUCCESS",
      objectiveValue: 0.0,
      variables: {},
    };
  }
}

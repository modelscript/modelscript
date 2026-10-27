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

    // Fallback to pure TypeScript L-BFGS-B (with Augmented Lagrangian outer loop when constraints are present)
    if (nVars > 0 && evalObjective && evalGradient) {
      const xCurr = new Float64Array(x0.length === nVars ? x0 : new Array(nVars).fill(0.0));
      const lbArr = varLB.length === nVars ? new Float64Array(varLB) : undefined;
      const ubArr = varUB.length === nVars ? new Float64Array(varUB) : undefined;
      const tol = options?.tolerance ?? 1e-6;
      const maxIter = options?.maxIterations ?? 100;

      if (nConstraints > 0 && evalConstraints) {
        const lambda = new Float64Array(nConstraints);
        let rho = 10.0;
        const outerIterMax = 12;
        const innerIterMax = Math.max(25, Math.ceil(maxIter / 2));
        let converged = false;

        const computeConstraintJacobian = (xVec: number[], cBase: number[]): Float64Array => {
          if (evalJacobian) {
            const rawJ = evalJacobian(xVec);
            if (rawJ.length === nConstraints * nVars) {
              return new Float64Array(rawJ);
            }
          }
          const J = new Float64Array(nConstraints * nVars);
          const xPert = xVec.slice();
          for (let j = 0; j < nVars; j++) {
            const orig = xPert[j]!;
            const h = 1e-7 * Math.max(1.0, Math.abs(orig));
            xPert[j] = orig + h;
            const cPert = evalConstraints(xPert);
            xPert[j] = orig;
            for (let i = 0; i < nConstraints; i++) {
              J[i * nVars + j] = ((cPert[i] ?? 0) - (cBase[i] ?? 0)) / h;
            }
          }
          return J;
        };

        for (let outer = 0; outer < outerIterMax; outer++) {
          const innerRes: LbfgsbResult = lbfgsbSolve(
            xCurr,
            (xArr) => {
              const xVec = Array.from(xArr);
              let augCost = evalObjective(xVec);
              const gVec = evalGradient(xVec);
              const augGrad = new Float64Array(nVars);
              for (let j = 0; j < nVars; j++) augGrad[j] = gVec[j] ?? 0;

              const cVal = evalConstraints(xVec);
              const J = computeConstraintJacobian(xVec, cVal);

              for (let i = 0; i < nConstraints; i++) {
                const ci = cVal[i] ?? 0;
                const li = conLB[i] ?? -Infinity;
                const ui = conUB[i] ?? Infinity;
                const lam = lambda[i]!;
                // Project c_i(x) + lambda_i / rho onto [l_i, u_i]
                const shifted = ci + lam / rho;
                const sProj = Math.min(ui, Math.max(li, shifted));
                const diff = shifted - sProj;
                augCost += 0.5 * rho * diff * diff - (lam * lam) / (2.0 * rho);
                const effMult = rho * diff;
                for (let j = 0; j < nVars; j++) {
                  augGrad[j] = augGrad[j]! + effMult * (J[i * nVars + j] ?? 0);
                }
              }

              return { cost: augCost, grad: augGrad };
            },
            lbArr,
            ubArr,
            {
              maxIterations: innerIterMax,
              tolerance: tol,
            },
          );

          xCurr.set(innerRes.x);
          const xVec = Array.from(xCurr);
          const cVal = evalConstraints(xVec);
          let maxViol = 0;
          for (let i = 0; i < nConstraints; i++) {
            const ci = cVal[i] ?? 0;
            const li = conLB[i] ?? -Infinity;
            const ui = conUB[i] ?? Infinity;
            const lam = lambda[i]!;
            const shifted = ci + lam / rho;
            const sProj = Math.min(ui, Math.max(li, shifted));
            lambda[i] = rho * (shifted - sProj);
            const viol = Math.max(0, li - ci, ci - ui);
            if (viol > maxViol) maxViol = viol;
          }

          if (maxViol <= tol && innerRes.converged) {
            converged = true;
            break;
          }
          if (maxViol > tol) {
            rho = Math.min(rho * 5.0, 1e6);
          } else if (maxViol <= tol * 10) {
            converged = true;
            break;
          }
        }

        const xFinal = Array.from(xCurr);
        return {
          status: converged ? "SUCCESS" : "MAX_ITERATIONS_REACHED",
          objectiveValue: evalObjective(xFinal),
          variables: {
            solution: xFinal,
            multipliers: Array.from(lambda),
          },
        };
      }

      const res: LbfgsbResult = lbfgsbSolve(
        xCurr,
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
          maxIterations: maxIter,
          tolerance: tol,
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

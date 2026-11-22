// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers canonical `@modelscript/simulate` ODE/DAE solvers into the unified
 * `@modelscript/solve` dispatch registry (`solve(prob, alg, opts)`).
 */

import { bdf } from "@modelscript/runtime";
import {
  Collocation,
  EnsembleSerial,
  MethodOfSteps,
  registerSolver,
  remake,
  solve,
  SRIW1,
  Tsit5,
  type AutoSwitchAlgorithm,
  type BVPAlgorithm,
  type CommonSolveOptions,
  type DDEAlgorithm,
  type EnsembleAlgorithm,
  type ExplicitRKAlgorithm,
  type ReturnCode,
  type SDEAlgorithm,
  type StepIntegrator,
  type StiffODEAlgorithm,
  type TrajectorySolution,
  type UnifiedBVPProblem,
  type UnifiedDAEProblem,
  type UnifiedDDEProblem,
  type UnifiedEnsembleProblem,
  type UnifiedODEProblem,
  type UnifiedSDEProblem,
} from "@modelscript/solve";
import { solveBVP } from "../solvers/bvp-solver.js";
import { ddeSteps } from "../solvers/dde-solver.js";
import { solveRadauIIA } from "../solvers/radau-iia.js";
import { solveRodas4P } from "../solvers/rodas4p.js";
import { eulerMaruyama, sriw1 } from "../solvers/sde-solver.js";
import { solveTrBdf2 } from "../solvers/trbdf2.js";
import { tsit5 } from "../solvers/tsit5.js";
import { vern7, vern9 } from "../solvers/verner.js";
import type {
  CommonSolverResult,
  DAEProblem as LegacyDAEProblem,
  ODEProblem as LegacyODEProblem,
} from "./problem-types.js";

function interpolateDense(
  times: readonly number[],
  states: readonly (readonly number[])[],
  tEval: number,
  rhs?: (t: number, u: readonly number[]) => number[],
): number[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1 || tEval <= times[0]!) return [...states[0]!];
  if (tEval >= times[n - 1]!) return [...states[n - 1]!];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= tEval) lo = mid;
    else hi = mid;
  }

  const t0 = times[lo]!;
  const t1 = times[hi]!;
  const h = t1 - t0;
  const theta = h === 0 ? 0 : (tEval - t0) / h;
  const y0 = states[lo]!;
  const y1 = states[hi]!;
  const dim = y0.length;
  const out = new Array<number>(dim);

  // Use O(h^4) cubic Hermite dense output when RHS is available
  if (rhs && h > 0) {
    const f0 = rhs(t0, y0);
    const f1 = rhs(t1, y1);
    const t2 = theta * theta;
    const t3 = t2 * theta;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + theta;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    for (let i = 0; i < dim; i++) {
      out[i] = h00 * y0[i]! + h10 * h * (f0[i] ?? 0) + h01 * y1[i]! + h11 * h * (f1[i] ?? 0);
    }
    return out;
  }

  for (let i = 0; i < dim; i++) {
    out[i] = y0[i]! + theta * (y1[i]! - y0[i]!);
  }
  return out;
}

function toTrajectorySolution(
  res: CommonSolverResult,
  algorithm: string,
  durationMs: number,
  stateNames?: readonly string[],
  rhs?: (t: number, u: readonly number[]) => number[],
): TrajectorySolution {
  const converged = res.stats?.converged ?? true;
  const retcode: ReturnCode = converged ? "Success" : "Failure";
  return {
    times: res.times,
    states: res.states,
    stateNames,
    retcode,
    algorithm,
    stats: {
      acceptedSteps: res.stats?.acceptedSteps ?? Math.max(0, res.times.length - 1),
      rejectedSteps: res.stats?.rejectedSteps ?? 0,
      fEvals: res.stats?.fEvals ?? 0,
      jacEvals: res.stats?.jacobianEvals ?? 0,
      luFactorizations: res.stats?.luFactorizations ?? 0,
      durationMs,
    },
    eval: (t: number) => interpolateDense(res.times, res.states, t, rhs),
  };
}

function toLegacyODE(prob: UnifiedODEProblem): LegacyODEProblem<Record<string, number> | number[]> {
  return {
    f: (t, y, p) => prob.fn.f(t, y, p ?? prob.p),
    y0: [...prob.u0],
    tSpan: [prob.tSpan[0], prob.tSpan[1]],
    p: prob.p as Record<string, number> | number[] | undefined,
    jac: prob.fn.jac ? (t, y, p) => prob.fn.jac!(t, y, p ?? prob.p) : undefined,
  };
}

function toLegacyDAE(prob: UnifiedODEProblem | UnifiedDAEProblem): LegacyDAEProblem<Record<string, number> | number[]> {
  const massMatrix = prob.fn.massMatrix ? prob.fn.massMatrix.map((row) => [...row]) : undefined;
  return {
    f: (t, y, yp, p) => {
      if (prob.kind === "dae" && prob.residual && yp) {
        return prob.residual(t, y, yp, p ?? prob.p);
      }
      return prob.fn.f(t, y, p ?? prob.p);
    },
    y0: [...prob.u0],
    yp0: prob.kind === "dae" && prob.du0 ? [...prob.du0] : undefined,
    tSpan: [prob.tSpan[0], prob.tSpan[1]],
    massMatrix,
    differentialVars: prob.kind === "dae" && prob.differentialVars ? [...prob.differentialVars] : undefined,
    p: prob.p as Record<string, number> | number[] | undefined,
    jac: prob.fn.jac ? (t, y, p) => prob.fn.jac!(t, y, p ?? prob.p) : undefined,
  };
}

let _registered = false;

/**
 * Registers all canonical ODE/DAE solvers from `@modelscript/simulate` with `@modelscript/solve`.
 * Idempotent; called automatically when `@modelscript/simulate` is imported.
 */
export function registerSimulateSolvers(): void {
  if (_registered) return;
  _registered = true;

  // ── Tsit5 (default explicit ODE solver) ──
  registerSolver<UnifiedODEProblem, ExplicitRKAlgorithm, TrajectorySolution>(
    {
      problemKind: "ode",
      algorithmName: "Tsit5",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const t0 = performance.now();
        const res = tsit5(
          (t, y) => prob.fn.f(t, y, prob.p),
          prob.tSpan[0],
          [...prob.u0],
          prob.tSpan[1],
          opts.saveAt ? [...opts.saveAt] : undefined,
          {
            atol: opts.abstol,
            rtol: opts.reltol,
            initialStep: opts.dt,
            minStep: opts.dtMin,
            maxStep: opts.dtMax,
            maxSteps: opts.maxIters,
          },
        );
        return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
          prob.fn.f(t, u as number[], prob.p),
        );
      },
      init: (prob, _alg, opts: CommonSolveOptions): StepIntegrator => {
        const n = prob.u0.length;
        let tCurr = prob.tSpan[0];
        const tEnd = prob.tSpan[1];
        let dtCurr = opts.dt ?? Math.max(1e-6, Math.abs(tEnd - tCurr) / 50);
        const uCurr = Float64Array.from(prob.u0);
        let tPrev = tCurr;
        const uPrev = Float64Array.from(prob.u0);
        let retcode: ReturnCode = "Default";

        const integrator: StepIntegrator = {
          get t() {
            return tCurr;
          },
          get dt() {
            return dtCurr;
          },
          get u() {
            return uCurr;
          },
          get retcode() {
            return retcode;
          },
          step(): ReturnCode {
            if (retcode === "Terminated" || retcode === "Success") return retcode;
            const rem = tEnd - tCurr;
            if (Math.abs(rem) <= 1e-14) {
              retcode = "Success";
              return retcode;
            }
            const h = Math.sign(rem) * Math.min(Math.abs(rem), Math.abs(dtCurr));
            const nextT = tCurr + h;
            tPrev = tCurr;
            uPrev.set(uCurr);
            const res = tsit5((t, y) => prob.fn.f(t, y, prob.p), tCurr, Array.from(uCurr), nextT, undefined, {
              atol: opts.abstol,
              rtol: opts.reltol,
              initialStep: Math.abs(h),
            });
            const lastY = res.states[res.states.length - 1]!;
            for (let i = 0; i < n; i++) uCurr[i] = lastY[i]!;
            tCurr = res.times[res.times.length - 1] ?? nextT;
            if (Math.abs(tEnd - tCurr) <= 1e-14) {
              retcode = "Success";
            }
            return retcode;
          },
          interpolate(tEval: number): number[] {
            if (tCurr === tPrev) return Array.from(uCurr);
            const theta = Math.max(0, Math.min(1, (tEval - tPrev) / (tCurr - tPrev)));
            const out = new Array<number>(n);
            for (let i = 0; i < n; i++) out[i] = uPrev[i]! + theta * (uCurr[i]! - uPrev[i]!);
            return out;
          },
          terminate(reason: ReturnCode = "Terminated"): void {
            retcode = reason;
          },
          dispose(): void {
            // No unmanaged native handles
          },
          [Symbol.dispose](): void {
            this.dispose();
          },
        };
        return integrator;
      },
    },
    Tsit5(),
  );

  // ── Vern7 / Vern9 ──
  registerSolver<UnifiedODEProblem, ExplicitRKAlgorithm, TrajectorySolution>({
    problemKind: "ode",
    algorithmName: "Vern7",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = vern7(toLegacyODE(prob), {
        atol: opts.abstol,
        rtol: opts.reltol,
        initialStep: opts.dt,
        minStep: opts.dtMin,
        maxStep: opts.dtMax,
        maxSteps: opts.maxIters,
      });
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  registerSolver<UnifiedODEProblem, ExplicitRKAlgorithm, TrajectorySolution>({
    problemKind: "ode",
    algorithmName: "Vern9",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = vern9(toLegacyODE(prob), {
        atol: opts.abstol,
        rtol: opts.reltol,
        initialStep: opts.dt,
        minStep: opts.dtMin,
        maxStep: opts.dtMax,
        maxSteps: opts.maxIters,
      });
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── Rodas4P (stiff ODE/DAE) ──
  registerSolver<UnifiedDAEProblem, StiffODEAlgorithm, TrajectorySolution>({
    problemKind: "dae",
    algorithmName: "Rodas4P",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = solveRodas4P(toLegacyDAE(prob), {
        atol: opts.abstol,
        rtol: opts.reltol,
        initialStep: opts.dt,
        minStep: opts.dtMin,
        maxStep: opts.dtMax,
        maxSteps: opts.maxIters,
      });
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── TRBDF2 (stiff L-stable ODE/DAE) ──
  registerSolver<UnifiedDAEProblem, StiffODEAlgorithm, TrajectorySolution>({
    problemKind: "dae",
    algorithmName: "TRBDF2",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = solveTrBdf2(toLegacyDAE(prob), {
        atol: opts.abstol,
        rtol: opts.reltol,
        initialStep: opts.dt,
        minStep: opts.dtMin,
        maxStep: opts.dtMax,
        maxSteps: opts.maxIters,
      });
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── RadauIIA5 (high-order implicit RK) ──
  registerSolver<UnifiedDAEProblem, StiffODEAlgorithm, TrajectorySolution>({
    problemKind: "dae",
    algorithmName: "RadauIIA5",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = solveRadauIIA(toLegacyDAE(prob), {
        order: 5,
        atol: opts.abstol,
        rtol: opts.reltol,
        initialStepSize: opts.dt,
        minStepSize: opts.dtMin,
        maxStepSize: opts.dtMax,
        maxSteps: opts.maxIters,
      });
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── BDF (variable-order stiff ODE/DAE) ──
  registerSolver<UnifiedDAEProblem, StiffODEAlgorithm, TrajectorySolution>({
    problemKind: "dae",
    algorithmName: "BDF",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = bdf(
        (t: number, y: number[]) => prob.fn.f(t, y, prob.p),
        prob.tSpan[0],
        [...prob.u0],
        prob.tSpan[1],
        opts.saveAt ? [...opts.saveAt] : undefined,
        {
          atol: opts.abstol,
          rtol: opts.reltol,
          initialStep: opts.dt,
          maxStep: opts.dtMax,
          maxSteps: opts.maxIters,
          maxOrder: alg.maxOrder,
          jacobian: prob.fn.jac ? (t: number, y: number[]) => prob.fn.jac!(t, y, prob.p) : undefined,
        },
      );
      return toTrajectorySolution(
        {
          times: res.times,
          states: res.states,
          stats: {
            acceptedSteps: res.acceptedSteps,
            rejectedSteps: res.rejectedSteps,
            fEvals: res.fEvals,
            jacobianEvals: res.jEvals,
            luFactorizations: res.jEvals,
            converged: true,
          },
        },
        alg.name,
        performance.now() - t0,
        prob.fn.stateNames,
        (t, u) => prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── AutoSwitch (online stiffness switching: starts non-stiff, seamlessly hands off to stiff) ──
  registerSolver<UnifiedODEProblem, AutoSwitchAlgorithm, TrajectorySolution>({
    problemKind: "ode",
    algorithmName: "AutoSwitch",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const probeMaxIters = Math.min(opts.maxIters ?? 100000, 1500);
      const nonStiffSol = solve<TrajectorySolution>(prob, alg.nonStiff, {
        ...opts,
        maxIters: probeMaxIters,
      });

      const lastTime = nonStiffSol.times[nonStiffSol.times.length - 1] ?? prob.tSpan[0];
      const reachedEnd =
        Math.abs(lastTime - prob.tSpan[1]) <= 1e-9 * Math.max(1, Math.abs(prob.tSpan[1] - prob.tSpan[0]));
      const stiffDetected =
        !reachedEnd ||
        nonStiffSol.retcode !== "Success" ||
        nonStiffSol.stats.rejectedSteps > Math.max(25, nonStiffSol.stats.acceptedSteps * 0.4);

      if (!stiffDetected) {
        return nonStiffSol;
      }

      // Seamlessly hand off from the last accepted non-stiff state (or t0 if non-stiff made no progress)
      const switchIdx =
        nonStiffSol.times.length > 1 && nonStiffSol.retcode === "Success" ? nonStiffSol.times.length - 1 : 0;
      const tSwitch = switchIdx > 0 ? nonStiffSol.times[switchIdx]! : prob.tSpan[0];
      const uSwitch = switchIdx > 0 ? nonStiffSol.states[switchIdx]! : prob.u0;

      const remProb = remake(prob, { u0: [...uSwitch], tSpan: [tSwitch, prob.tSpan[1]] as const });
      const stiffSol = solve<TrajectorySolution>(remProb, alg.stiff, opts);

      const mergedTimes =
        switchIdx > 0 ? [...nonStiffSol.times.slice(0, switchIdx), ...stiffSol.times] : [...stiffSol.times];
      const mergedStates =
        switchIdx > 0 ? [...nonStiffSol.states.slice(0, switchIdx), ...stiffSol.states] : [...stiffSol.states];

      return {
        times: mergedTimes,
        states: mergedStates,
        stateNames: prob.fn.stateNames,
        retcode: stiffSol.retcode,
        algorithm: `AutoSwitch(${alg.nonStiff.name}->${alg.stiff.name})`,
        stats: {
          acceptedSteps: (switchIdx > 0 ? nonStiffSol.stats.acceptedSteps : 0) + stiffSol.stats.acceptedSteps,
          rejectedSteps: nonStiffSol.stats.rejectedSteps + stiffSol.stats.rejectedSteps,
          fEvals: nonStiffSol.stats.fEvals + stiffSol.stats.fEvals,
          jacEvals: nonStiffSol.stats.jacEvals + stiffSol.stats.jacEvals,
          luFactorizations: nonStiffSol.stats.luFactorizations + stiffSol.stats.luFactorizations,
          durationMs: performance.now() - t0,
        },
        eval: (t: number) =>
          interpolateDense(mergedTimes, mergedStates, t, (ti, u) => prob.fn.f(ti, u as number[], prob.p)),
      };
    },
  });

  // ── SDE: EulerMaruyama & SRIW1 (default) ──
  registerSolver<UnifiedSDEProblem, SDEAlgorithm, TrajectorySolution>({
    problemKind: "sde",
    algorithmName: "EulerMaruyama",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = eulerMaruyama(
        {
          f: (t, y, p) => prob.drift.f(t, y, p ?? prob.p),
          g: (t, y, p) => prob.diffusion(t, y, p ?? prob.p),
          y0: [...prob.u0],
          tSpan: [prob.tSpan[0], prob.tSpan[1]],
          noiseType: prob.noiseType,
          seed: prob.seed,
          p: prob.p as Record<string, number> | number[] | undefined,
        },
        { dt: opts.dt, seed: prob.seed, noiseType: prob.noiseType },
      );
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.drift.stateNames);
    },
  });

  registerSolver<UnifiedSDEProblem, SDEAlgorithm, TrajectorySolution>(
    {
      problemKind: "sde",
      algorithmName: "SRIW1",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const t0 = performance.now();
        const res = sriw1(
          {
            f: (t, y, p) => prob.drift.f(t, y, p ?? prob.p),
            g: (t, y, p) => prob.diffusion(t, y, p ?? prob.p),
            y0: [...prob.u0],
            tSpan: [prob.tSpan[0], prob.tSpan[1]],
            noiseType: prob.noiseType,
            seed: prob.seed,
            p: prob.p as Record<string, number> | number[] | undefined,
          },
          { atol: opts.abstol, rtol: opts.reltol, dt: opts.dt, seed: prob.seed, noiseType: prob.noiseType },
        );
        return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.drift.stateNames);
      },
    },
    SRIW1(),
  );

  // ── DDE: MethodOfSteps (default) ──
  registerSolver<UnifiedDDEProblem, DDEAlgorithm, TrajectorySolution>(
    {
      problemKind: "dde",
      algorithmName: "MethodOfSteps",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const t0 = performance.now();
        const res = ddeSteps(
          {
            f: (t, y, hist, p) => prob.f(t, y, hist, p ?? prob.p),
            h: (t, p) => prob.history(t, p ?? prob.p),
            y0: [...prob.u0],
            tSpan: [prob.tSpan[0], prob.tSpan[1]],
            constantDelays: prob.constantDelays ? [...prob.constantDelays] : undefined,
            p: prob.p as Record<string, number> | number[] | undefined,
          },
          {
            atol: opts.abstol,
            rtol: opts.reltol,
            initialStep: opts.dt,
            maxStep: opts.dtMax,
            bufferCapacity: alg.bufferCapacity,
          },
        );
        return toTrajectorySolution(res, alg.name, performance.now() - t0);
      },
    },
    MethodOfSteps(),
  );

  // ── BVP: Collocation (default) & MultipleShooting ──
  registerSolver<UnifiedBVPProblem, BVPAlgorithm, TrajectorySolution>(
    {
      problemKind: "bvp",
      algorithmName: "Collocation",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const t0 = performance.now();
        const res = solveBVP(
          {
            f: (t, y, p) => prob.fn.f(t, y, p ?? prob.p),
            bc: (ua, ub, p) => prob.bc(ua, ub, p ?? prob.p),
            yGuess: Array.isArray(prob.uGuess) ? [...prob.uGuess] : (prob.uGuess as (t: number) => number[]),
            tSpan: [prob.tSpan[0], prob.tSpan[1]],
            p: prob.p as Record<string, number> | number[] | undefined,
          },
          {
            method: "collocation-trapezoidal",
            numIntervals: alg.numIntervals,
            tolerance: opts.abstol,
            maxIterations: opts.maxIters,
          },
        );
        return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
          prob.fn.f(t, u as number[], prob.p),
        );
      },
    },
    Collocation(),
  );

  registerSolver<UnifiedBVPProblem, BVPAlgorithm, TrajectorySolution>({
    problemKind: "bvp",
    algorithmName: "MultipleShooting",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const res = solveBVP(
        {
          f: (t, y, p) => prob.fn.f(t, y, p ?? prob.p),
          bc: (ua, ub, p) => prob.bc(ua, ub, p ?? prob.p),
          yGuess: Array.isArray(prob.uGuess) ? [...prob.uGuess] : (prob.uGuess as (t: number) => number[]),
          tSpan: [prob.tSpan[0], prob.tSpan[1]],
          p: prob.p as Record<string, number> | number[] | undefined,
        },
        {
          method: "multiple-shooting",
          numIntervals: alg.numIntervals,
          tolerance: opts.abstol,
          maxIterations: opts.maxIters,
        },
      );
      return toTrajectorySolution(res, alg.name, performance.now() - t0, prob.fn.stateNames, (t, u) =>
        prob.fn.f(t, u as number[], prob.p),
      );
    },
  });

  // ── Ensemble: EnsembleSerial (default) ──
  registerSolver<UnifiedEnsembleProblem, EnsembleAlgorithm, TrajectorySolution[]>(
    {
      problemKind: "ensemble",
      algorithmName: "EnsembleSerial",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const results: TrajectorySolution[] = [];
        for (let i = 0; i < prob.trajectories; i++) {
          const subProb = prob.probFunc(prob.baseProblem, i);
          results.push(solve<TrajectorySolution>(subProb, alg.subAlgorithm, opts));
        }
        return results;
      },
    },
    EnsembleSerial(),
  );
}

// Auto-register on module import
registerSimulateSolvers();

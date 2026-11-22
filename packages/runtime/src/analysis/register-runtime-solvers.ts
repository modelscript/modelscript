// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers canonical `@modelscript/runtime` formal verification & reachability engines
 * (`TMJets`, `ZonotopeReach`, `SosBarrier`) into the unified `@modelscript/solve` registry.
 *
 * All registered verification solvers return a strict `VerificationCertificate` constructed
 * via `createCertificate()`, guaranteeing that non-rigorous / heuristic runs can never
 * report `isCertifiedSafe: true`.
 */

import {
  createCertificate,
  registerSolver,
  TMJets,
  type BarrierAlgorithm,
  type CommonSolveOptions,
  type ReachabilityAlgorithm,
  type RigorLevel,
  type UnifiedBarrierProblem,
  type UnifiedReachabilityProblem,
  type Verdict,
  type VerificationCertificate,
} from "@modelscript/solve";
import { Interval } from "./wasm_interval.js";
import { SosBarrierSynthesizer, type BarrierCertificateResult } from "./wasm_sos_barrier.js";
import {
  TaylorModel,
  TaylorModelFlowpipeSolver,
  type FlowpipeReachabilityResult,
  type FlowpipeRequirement,
} from "./wasm_taylor_model.js";
import { Zonotope } from "./wasm_zonotope.js";
import { ZonotopeReachabilitySolver, type ZonotopeReachabilityResult } from "./wasm_zonotope_reach.js";

function mapRuntimeRigor(rigor?: string): RigorLevel {
  if (rigor === "exact-rational" || rigor === "rigorous") return "exact-rational";
  if (rigor === "outward-f64") return "outward-f64";
  if (rigor === "float-sound") return "floating-point";
  return "heuristic";
}

function toFlowpipeReqs(prob: UnifiedReachabilityProblem): FlowpipeRequirement[] {
  return (prob.properties ?? []).map((p) => ({
    stateIndex: p.stateIndex,
    stateName: p.stateName,
    operator: p.operator,
    limitValue: p.limit,
  }));
}

let _registered = false;

/**
 * Registers canonical `@modelscript/runtime` reachability and barrier engines with `@modelscript/solve`.
 * Idempotent; called automatically on module import.
 */
export function registerRuntimeSolvers(): void {
  if (_registered) return;
  _registered = true;

  // ── TMJets (Taylor Model Flowpipe Reachability — default for reachability problems) ──
  registerSolver<
    UnifiedReachabilityProblem,
    ReachabilityAlgorithm,
    VerificationCertificate<FlowpipeReachabilityResult>
  >(
    {
      problemKind: "reachability",
      algorithmName: "TMJets",
      isDefault: true,
      solve: (prob, alg, opts: CommonSolveOptions) => {
        const t0 = performance.now();
        const dt = opts.dt ?? Math.max(1e-3, (prob.tSpan[1] - prob.tSpan[0]) / 40);
        const initIntervals = prob.initialSet.map((iv) => new Interval(iv.lo, iv.hi));
        const nominal = prob.initialSet.map((iv) => iv.mid);
        const n = nominal.length;
        const reqs = toFlowpipeReqs(prob);

        // Compute nominal f0 and Jacobian A around nominal state to lift into TaylorModel dynamics
        const f0 = prob.fn.f(prob.tSpan[0], nominal, prob.p);
        let A: number[][];
        if (prob.fn.jac) {
          A = prob.fn.jac(prob.tSpan[0], nominal, prob.p);
        } else {
          const eps = 1e-6;
          A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
          for (let j = 0; j < n; j++) {
            const xPlus = [...nominal];
            const xMinus = [...nominal];
            xPlus[j] = nominal[j]! + eps;
            xMinus[j] = nominal[j]! - eps;
            const fPlus = prob.fn.f(prob.tSpan[0], xPlus, prob.p);
            const fMinus = prob.fn.f(prob.tSpan[0], xMinus, prob.p);
            for (let i = 0; i < n; i++) {
              A[i]![j] = ((fPlus[i] ?? 0) - (fMinus[i] ?? 0)) / (2 * eps);
            }
          }
        }

        const res = TaylorModelFlowpipeSolver.solve({
          dynamics: (_tTM: TaylorModel, yTMs: TaylorModel[]): TaylorModel[] => {
            const dom = yTMs[0]!.domain;
            const ord = yTMs[0]!.order;
            const out: TaylorModel[] = [];
            for (let i = 0; i < n; i++) {
              let acc = TaylorModel.constant(f0[i] ?? 0, dom.length, dom, ord);
              for (let j = 0; j < n; j++) {
                const aij = A[i]![j]!;
                if (aij !== 0) {
                  const dy = yTMs[j]!.sub(TaylorModel.constant(nominal[j]!, dom.length, dom, ord));
                  acc = acc.add(dy.scale(aij));
                }
              }
              out.push(acc);
            }
            return out;
          },
          initialEnclosure: initIntervals,
          nominalInitial: nominal,
          tSpan: [prob.tSpan[0], prob.tSpan[1]],
          dt,
          order: alg.order ?? 4,
          requirements: reqs,
        });

        let verdict: Verdict;
        if (res.verdict.kind === "violated") {
          const v = res.violations[0];
          verdict = {
            status: "violated",
            witness: {
              time: v?.time,
              state: v ? [v.worstCaseValue] : [],
              validated: false,
            },
            detail: res.summary,
          };
        } else if (res.verdict.kind === "proven") {
          // Enforce strict rigor contract: TaylorModelFlowpipeSolver currently uses
          // unrounded polynomial arithmetic, so map "float-sound" -> "floating-point"
          // (auto-downgraded by createCertificate unless outward-f64 is achieved).
          verdict = {
            status: "proven",
            rigor: mapRuntimeRigor(res.verdict.rigor),
            detail: res.summary,
          };
        } else {
          verdict = {
            status: "unknown",
            reason: res.verdict.reason === "budget" ? "budget" : "not-rigorous",
            rigor: mapRuntimeRigor(res.verdict.rigor),
            detail: res.summary,
          };
        }

        return createCertificate({
          verdict,
          algorithm: alg.name,
          durationMs: performance.now() - t0,
          summary: res.summary,
          data: res,
        });
      },
    },
    TMJets(),
  );

  // ── ZonotopeReach (Linearized / Matrix-Exponential Zonotope Reachability) ──
  registerSolver<
    UnifiedReachabilityProblem,
    ReachabilityAlgorithm,
    VerificationCertificate<ZonotopeReachabilityResult>
  >({
    problemKind: "reachability",
    algorithmName: "ZonotopeReach",
    solve: (prob, alg, opts: CommonSolveOptions) => {
      const t0 = performance.now();
      const dt = opts.dt ?? Math.max(1e-3, (prob.tSpan[1] - prob.tSpan[0]) / 40);
      const initIntervals = prob.initialSet.map((iv) => new Interval(iv.lo, iv.hi));
      const nominal = prob.initialSet.map((iv) => iv.mid);
      const n = nominal.length;

      // Obtain Jacobian A around nominal state (analytical/AD if provided, else central FD)
      let A: number[][];
      if (prob.fn.jac) {
        A = prob.fn.jac(prob.tSpan[0], nominal, prob.p);
      } else {
        const eps = 1e-6;
        A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        for (let j = 0; j < n; j++) {
          const xPlus = [...nominal];
          const xMinus = [...nominal];
          xPlus[j] = nominal[j]! + eps;
          xMinus[j] = nominal[j]! - eps;
          const fPlus = prob.fn.f(prob.tSpan[0], xPlus, prob.p);
          const fMinus = prob.fn.f(prob.tSpan[0], xMinus, prob.p);
          for (let i = 0; i < n; i++) {
            A[i]![j] = ((fPlus[i] ?? 0) - (fMinus[i] ?? 0)) / (2 * eps);
          }
        }
      }

      const initZono = Zonotope.fromIntervals(initIntervals);
      const res = ZonotopeReachabilitySolver.solve({
        A,
        initialSet: initZono,
        nominalInitial: nominal,
        tSpan: [prob.tSpan[0], prob.tSpan[1]],
        dt,
        requirements: toFlowpipeReqs(prob),
        maxOrder: Math.max(2, Math.ceil((alg.maxGenerators ?? 40) / Math.max(1, n))),
      });

      let verdict: Verdict;
      if (res.verdict.kind === "violated") {
        const v = res.violations[0];
        verdict = {
          status: "violated",
          witness: {
            time: v?.time,
            state: v ? [v.worstCaseValue] : [],
            validated: Boolean(v?.isConcreteWitness),
          },
          detail: res.summary,
        };
      } else {
        verdict = {
          status: "unknown",
          reason: "not-rigorous",
          rigor: "floating-point",
          detail: res.summary,
        };
      }

      return createCertificate({
        verdict,
        algorithm: alg.name,
        durationMs: performance.now() - t0,
        summary: res.summary,
        data: res,
      });
    },
  });

  // ── SosBarrier (Lyapunov / SOS Barrier Candidate Synthesizer) ──
  registerSolver<UnifiedBarrierProblem, BarrierAlgorithm, VerificationCertificate<BarrierCertificateResult>>({
    problemKind: "barrier",
    algorithmName: "SosBarrier",
    solve: (prob, alg) => {
      const t0 = performance.now();
      const n = prob.fn.stateNames?.length ?? 2;
      const sys = {
        numVars: n,
        varNames: prob.fn.stateNames ? [...prob.fn.stateNames] : undefined,
        f: (x: number[]) => prob.fn.f(0, x, prob.p),
      };
      const spec = {
        initialRadius: prob.initialRadius,
        unsafeRadius: prob.unsafeRadius,
      };
      const res =
        alg.degree >= 4
          ? SosBarrierSynthesizer.synthesizeHigherDegree(sys, spec, 4)
          : SosBarrierSynthesizer.synthesizeQuadratic(sys, spec);

      return createCertificate({
        verdict: {
          status: "unknown",
          reason: "not-rigorous",
          rigor: "heuristic",
          detail: res.summary,
        },
        algorithm: alg.name,
        durationMs: performance.now() - t0,
        summary: res.summary,
        data: res,
      });
    },
  });
}

// Auto-register on module import
registerRuntimeSolvers();

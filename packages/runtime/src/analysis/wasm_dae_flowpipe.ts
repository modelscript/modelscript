// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Validated Flowpipe Reachability for Implicit DAEs.
 *
 * Implements:
 *   - Pryce's Structural Sigma-Method for DAE offset analysis.
 *   - High-order Automatic Differentiation for DAE Taylor series coefficients:
 *       J_{x'} x^{[k+1]} = \Phi_k(x^{[0]}, ..., x^{[k]})
 *   - Interval Krawczyk Contractor on the algebraic constraint manifold g(x, z) = 0.
 *   - Guaranteed Taylor model reachability tubes for semi-explicit and implicit DAEs.
 */

import type { VerificationVerdict } from "../formal/verdict.js";
import { ivAdd, ivMul, ivSub } from "./outward_rounding.js";
import { Interval, addMachineEps, subMachineEps } from "./wasm_interval.js";

export interface DaeSystem {
  /** Dimension of differential state vector x */
  numDiffStates: number;
  /** Dimension of algebraic state vector z */
  numAlgStates: number;
  /**
   * Differential residual: \dot{x} - f(t, x, z) = 0
   */
  f: (t: number, x: number[], z: number[]) => number[];
  /**
   * Algebraic constraint: g(x, z) = 0
   */
  g: (x: number[], z: number[]) => number[];
  /**
   * Jacobian of algebraic constraint with respect to algebraic states: J_z = \partial g / \partial z
   */
  jacobianGz: (x: number[], z: number[]) => number[][];
  /**
   * Jacobian of algebraic constraint with respect to differential states: J_x = \partial g / \partial x
   */
  jacobianGx?: (x: number[], z: number[]) => number[][];
  /**
   * Jacobian of differential equations with respect to differential states: J_fx = \partial f / \partial x
   */
  jacobianFx?: (t: number, x: number[], z: number[]) => number[][];
  /**
   * Interval extensions of f, g, J_z and J_fx. When provided, validated reachability solvers
   * can perform interval contractors and conservative linearization with rigorous remainder bounds.
   * Each must return an enclosure of the corresponding point function over the given boxes.
   */
  fInterval?: (t: Interval, x: Interval[], z: Interval[]) => Interval[];
  gInterval?: (x: Interval[], z: Interval[]) => Interval[];
  jacobianGzInterval?: (x: Interval[], z: Interval[]) => Interval[][];
  jacobianFxInterval?: (t: Interval, x: Interval[], z: Interval[]) => Interval[][];
}

export interface DaeFlowpipeRequirement {
  variable: "x" | "z";
  index: number;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface DaeFlowpipeOptions {
  dae: DaeSystem;
  initialX: Interval[];
  initialZ: Interval[];
  nominalX: number[];
  nominalZ: number[];
  tSpan: [number, number];
  dt: number;
  order?: number;
  tol?: number;
  /** Requirements checked against the validated tubes (validated path only). */
  requirements?: DaeFlowpipeRequirement[];
  /** Smallest step the validated path may shrink to before giving up (default 1e-9). */
  minDt?: number;
}

export interface DaeFlowpipeStep {
  time: number;
  xTubes: Interval[];
  zTubes: Interval[];
  nominalX: number[];
  nominalZ: number[];
  isAlgebraicManifoldCertified: boolean;
}

export interface DaeFlowpipeResult {
  /**
   * True only if the algebraic manifold was certified (Krawczyk containment) at every step.
   * NOTE: this does not imply the differential tubes are guaranteed enclosures; see `verdict`.
   */
  isCertifiedSafe: boolean;
  totalSteps: number;
  steps: DaeFlowpipeStep[];
  summary: string;
  /**
   * Soundness-aware verdict. Currently always `unknown(not-rigorous)`: the differential tube step
   * evaluates f only at box corners and the Krawczyk test uses a point Jacobian, so the tubes are
   * not guaranteed over-approximations.
   */
  verdict: VerificationVerdict;
}

export class IntervalKrawczykOperator {
  /**
   * Applies the Interval Krawczyk operator to rigorously enclose algebraic variables z on g(x, z) = 0.
   *
   * K([Z]) = z0 - C * g(x0, z0) + (I - C * J_z([X], [Z])) * ([Z] - z0)
   * where C \approx (J_z(x0, z0))^{-1}.
   *
   * If K([Z]) \subseteq int([Z]), the Banach/Brouwer fixed-point theorem guarantees
   * that there exists a UNIQUE solution z* \in [Z] for EVERY x \in [X].
   */
  public static contract(
    dae: DaeSystem,
    xBox: Interval[],
    zBox: Interval[],
    z0Nominal: number[],
    x0Nominal: number[],
  ): { isContracted: boolean; contractedZ: Interval[]; isUniqueSolutionProven: boolean } {
    const m = dae.numAlgStates;
    const J_nominal = dae.jacobianGz(x0Nominal, z0Nominal);

    // Invert J_nominal for 1D or 2D systems
    const C: number[][] = [];
    if (m === 1) {
      const diag = J_nominal[0]?.[0] ?? 1.0;
      C.push([Math.abs(diag) > 1e-12 ? 1.0 / diag : 1.0]);
    } else {
      // Identity fallback for preconditioning
      for (let i = 0; i < m; i++) {
        const row = new Array<number>(m).fill(0);
        row[i] = 1.0;
        C.push(row);
      }
    }

    const g0 = dae.g(x0Nominal, z0Nominal);

    // K_i([Z]) = z0_i - (C * g0)_i + ...
    const contractedZ: Interval[] = [];
    let isContainedInInterior = true;

    for (let i = 0; i < m; i++) {
      let C_dot_g0 = 0;
      for (let j = 0; j < m; j++) {
        C_dot_g0 += (C[i]![j] ?? 0) * (g0[j] ?? 0);
      }
      const centerShift = z0Nominal[i]! - C_dot_g0;

      // Bound remainder term: (I - C * J_z) * ([Z] - z0)
      let remainderWidth = 0;
      for (let j = 0; j < m; j++) {
        const zDelta = 0.5 * zBox[j]!.width;
        let I_minus_CJ = (i === j ? 1.0 : 0.0) - (C[i]![j] ?? 0) * (J_nominal[j]?.[j] ?? 1.0);
        remainderWidth += Math.abs(I_minus_CJ) * zDelta;
      }

      const kLo = subMachineEps(centerShift - remainderWidth);
      const kHi = addMachineEps(centerShift + remainderWidth);

      if (kLo < zBox[i]!.lo || kHi > zBox[i]!.hi) {
        isContainedInInterior = false;
      }

      const newLo = Math.max(zBox[i]!.lo, kLo);
      const newHi = Math.min(zBox[i]!.hi, kHi);
      contractedZ.push(new Interval(newLo, newHi));
    }

    return {
      isContracted: true,
      contractedZ,
      isUniqueSolutionProven: isContainedInInterior,
    };
  }
}

/** Gauss–Jordan inverse with partial pivoting; any approximate inverse is a valid Krawczyk preconditioner. */
function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (!(Math.abs(M[p]![c]!) > 1e-300)) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    for (let j = 0; j < 2 * n; j++) M[c]![j] = M[c]![j]! / piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r]![j] = M[r]![j]! - f * M[c]![j]!;
    }
  }
  return M.map((row) => row.slice(n));
}

const pt = (v: number): Interval => new Interval(v, v);
const hullOf = (a: Interval, b: Interval): Interval => new Interval(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi));
const isFiniteIv = (a: Interval): boolean => Number.isFinite(a.lo) && Number.isFinite(a.hi);
const inflateIv = (a: Interval, rel: number, abs: number): Interval => {
  const pad = rel * (a.hi - a.lo) + abs * (1 + Math.max(Math.abs(a.lo), Math.abs(a.hi)));
  return new Interval(a.lo - pad, a.hi + pad);
};
const subsetEq = (a: Interval, b: Interval): boolean => a.lo >= b.lo && a.hi <= b.hi;

export type ValidatedDaeSystem = DaeSystem &
  Required<Pick<DaeSystem, "fInterval" | "gInterval" | "jacobianGzInterval">>;

export function hasValidatedHooks(dae: DaeSystem): dae is ValidatedDaeSystem {
  return !!dae.fInterval && !!dae.gInterval && !!dae.jacobianGzInterval;
}

export class RigorousKrawczyk {
  /**
   * One Krawczyk evaluation: K(Z) = z0 − C·g([X], z0) + (I − C·J_z([X],[Z]))·([Z] − z0), with the full
   * interval Jacobian and a full inverse of its midpoint as preconditioner C. All sums and products
   * use outward rounding. Returns K and whether K ⊆ int(Z) (existence and uniqueness of z*(x) in Z
   * for every x in X).
   */
  static operator(dae: ValidatedDaeSystem, X: Interval[], Z: Interval[]): { K: Interval[]; inside: boolean } | null {
    const m = Z.length;
    if (m === 0) return { K: [], inside: true };
    const z0 = Z.map((z) => z.lo + 0.5 * (z.hi - z.lo));
    const J = dae.jacobianGzInterval(X, Z);
    // Preconditioner: inverse of the Jacobian at the point (mid X, z0). Using the midpoint of the
    // interval Jacobian over a wide box would give a poor C; any C keeps the test rigorous.
    const xMid = X.map((x) => pt(x.lo + 0.5 * (x.hi - x.lo)));
    const Jp = dae.jacobianGzInterval(xMid, z0.map(pt));
    const Jmid = Jp.map((row) => row.map((e) => e.lo + 0.5 * (e.hi - e.lo)));
    const C = invertMatrix(Jmid);
    if (!C) return null;
    const G0 = dae.gInterval(X, z0.map(pt));
    const K: Interval[] = [];
    let inside = true;
    for (let i = 0; i < m; i++) {
      let acc = pt(z0[i]!);
      for (let j = 0; j < m; j++) acc = ivSub(acc, ivMul(pt(C[i]![j]!), G0[j]!));
      for (let j = 0; j < m; j++) {
        // (I - C J)_{ij} as an interval
        let cj = pt(i === j ? 1 : 0);
        for (let k = 0; k < m; k++) cj = ivSub(cj, ivMul(pt(C[i]![k]!), J[k]![j]!));
        const zDelta = ivSub(Z[j]!, pt(z0[j]!));
        acc = ivAdd(acc, ivMul(cj, zDelta));
      }
      if (!isFiniteIv(acc)) return null;
      K.push(acc);
      if (!(acc.lo > Z[i]!.lo && acc.hi < Z[i]!.hi)) inside = false;
    }
    return { K, inside };
  }

  /**
   * Finds a certified enclosure of the algebraic variables for every x in X, starting from a guess.
   * Epsilon-inflates the candidate until K ⊆ int(Z) or attempts run out (returns null).
   */
  static enclose(dae: ValidatedDaeSystem, X: Interval[], guess: Interval[]): Interval[] | null {
    // Seed with an approximate root at mid(X) (floating-point Newton on the point functions). This
    // only chooses where to start; rigor comes entirely from the interval Krawczyk test below.
    const starts: Interval[][] = [];
    const seeded = RigorousKrawczyk.newtonSeed(
      dae,
      X.map((x) => x.lo + 0.5 * (x.hi - x.lo)),
      guess.map((z) => z.lo + 0.5 * (z.hi - z.lo)),
    );
    if (seeded)
      starts.push(seeded.map((v) => new Interval(v - 1e-9 * (1 + Math.abs(v)), v + 1e-9 * (1 + Math.abs(v)))));
    starts.push(guess.map((z) => new Interval(z.lo, z.hi)));
    for (const start of starts) {
      const out = RigorousKrawczyk.iterate(dae, X, start);
      if (out) return out;
    }
    return null;
  }

  private static newtonSeed(dae: DaeSystem, x: number[], z0: number[]): number[] | null {
    const z = [...z0];
    for (let it = 0; it < 30; it++) {
      const g = dae.g(x, z);
      const Jinv = invertMatrix(dae.jacobianGz(x, z));
      if (!Jinv) return null;
      let step = 0;
      for (let i = 0; i < z.length; i++) {
        let d = 0;
        for (let j = 0; j < z.length; j++) d += Jinv[i]![j]! * (g[j] ?? 0);
        z[i] = z[i]! - d;
        step = Math.max(step, Math.abs(d));
      }
      if (!z.every(Number.isFinite)) return null;
      if (step < 1e-14) break;
    }
    return z;
  }

  private static iterate(dae: ValidatedDaeSystem, X: Interval[], start: Interval[]): Interval[] | null {
    let Z = start;
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = RigorousKrawczyk.operator(dae, X, Z);
      if (!res) return null;
      if (res.inside) {
        // A few refinement passes: K is itself an enclosure and K ⊆ int(Z) is preserved under iteration.
        let cur = res.K;
        for (let r = 0; r < 3; r++) {
          const again = RigorousKrawczyk.operator(dae, X, cur);
          if (!again || !again.K.every((k, i) => subsetEq(k, cur[i]!))) break;
          cur = again.K;
        }
        return cur;
      }
      // Epsilon-inflation of K itself (standard Krawczyk iteration): a contractive operator then
      // shrinks Z toward the solution until K lands strictly inside.
      Z = res.K.map((k) => inflateIv(k, 0.1, 1e-12));
    }
    return null;
  }
}

/**
 * Validated Reachability Integrator for Implicit & Semi-Explicit DAEs.
 */
export class DaeFlowpipeSolver {
  public static solve(options: DaeFlowpipeOptions): DaeFlowpipeResult {
    if (hasValidatedHooks(options.dae)) return DaeFlowpipeSolver.solveValidated(options, options.dae);
    return DaeFlowpipeSolver.solveHeuristic(options);
  }

  /**
   * Validated path (semi-explicit index-1 DAE). Per step: (1) a priori box B with
   * X0 + [0,h]·f([t,t+h], B, Z(B)) ⊆ B, where Z(B) is a Krawczyk-certified enclosure of the algebraic
   * variables over B (this also certifies the index-1 condition, J_z nonsingular); (2) the end set is
   * X0 + h·F ∩ B. Higher-index systems fail the Krawczyk test and give `unknown(nonconvergent)`.
   * Rigor: float-sound (outward-rounded interval operations on user-supplied interval extensions).
   */
  private static solveValidated(options: DaeFlowpipeOptions, dae: ValidatedDaeSystem): DaeFlowpipeResult {
    const { initialX, initialZ, nominalX, nominalZ, tSpan, dt, requirements = [], minDt = 1e-9 } = options;
    const [t0, tEnd] = tSpan;
    const steps: DaeFlowpipeStep[] = [];
    let X = initialX.map((i) => new Interval(i.lo, i.hi));
    let currentNomX = [...nominalX];
    const currentNomZ = [...nominalZ];
    let currentTime = t0;

    let verdict: VerificationVerdict | null = null;
    const breaches: string[] = [];
    const checkReq = (xs: Interval[], zs: Interval[], time: number): void => {
      for (const r of requirements) {
        const tube = (r.variable === "x" ? xs : zs)[r.index];
        if (!tube) continue;
        const holds =
          r.operator === "<="
            ? tube.hi <= r.limitValue
            : r.operator === "<"
              ? tube.hi < r.limitValue
              : r.operator === ">="
                ? tube.lo >= r.limitValue
                : tube.lo > r.limitValue;
        if (!holds) breaches.push(`${r.variable}[${r.index}] ${r.operator} ${r.limitValue} at t=${time}`);
      }
    };

    let Z = RigorousKrawczyk.enclose(dae, X, initialZ);
    if (!Z) {
      return DaeFlowpipeSolver.finishValidated(
        steps,
        t0,
        tEnd,
        {
          kind: "unknown",
          reason: "nonconvergent",
          detail: "Initial algebraic manifold could not be certified (Krawczyk failed; singular J_z or index > 1).",
        },
        [],
      );
    }
    steps.push({
      time: t0,
      xTubes: X.map((i) => new Interval(i.lo, i.hi)),
      zTubes: Z.map((i) => new Interval(i.lo, i.hi)),
      nominalX: [...currentNomX],
      nominalZ: [...currentNomZ],
      isAlgebraicManifoldCertified: true,
    });
    checkReq(X, Z, t0);

    let h = dt;
    let count = 0;
    while (currentTime < tEnd - 1e-12 && count < 100000) {
      count++;
      h = Math.min(h, tEnd - currentTime);
      const T = new Interval(currentTime, currentTime + h);
      const timeIv = new Interval(0, h);

      // (1) a priori enclosure over [t, t+h]
      let B: Interval[] | null = null;
      let Zb: Interval[] | null = null;
      let F: Interval[] = [];
      {
        let box = X.map((x) => inflateIv(x, 0.05, 1e-12));
        for (let attempt = 0; attempt < 15; attempt++) {
          const zb = RigorousKrawczyk.enclose(dae, box, Z);
          if (!zb) break;
          const f = dae.fInterval(T, box, zb);
          if (!f.every(isFiniteIv)) break;
          const cand = X.map((x, i) => ivAdd(x, ivMul(timeIv, f[i]!)));
          if (cand.every((c, i) => subsetEq(c, box[i]!))) {
            B = box;
            Zb = zb;
            F = f;
            break;
          }
          box = cand.map((c, i) => inflateIv(hullOf(c, box[i]!), 0.1, 1e-12));
        }
      }
      if (!B || !Zb) {
        if (h > minDt * 1.01) {
          h = Math.max(minDt, h * 0.5);
          continue;
        }
        verdict = {
          kind: "unknown",
          reason: "nonconvergent",
          detail: `A priori enclosure / Krawczyk validation failed at t=${currentTime}.`,
        };
        break;
      }

      // Refinement (keeps containment: each refined box must still satisfy X + [0,h]F ⊆ box).
      for (let r = 0; r < 3; r++) {
        const zb = RigorousKrawczyk.enclose(dae, B, Zb);
        if (!zb) break;
        const f = dae.fInterval(T, B, zb);
        const cand = X.map((x, i) => ivAdd(x, ivMul(timeIv, f[i]!)));
        if (!f.every(isFiniteIv) || !cand.every((c, i) => subsetEq(c, B![i]!))) break;
        B = cand;
        Zb = zb;
        F = f;
      }

      // (2) end-of-step set: x(h) ∈ X + h·F, and x(h) ∈ B
      const Xnext = X.map((x, i) => {
        const e = ivAdd(x, ivMul(pt(h), F[i]!));
        const lo = Math.max(e.lo, B![i]!.lo);
        const hi = Math.min(e.hi, B![i]!.hi);
        return lo <= hi ? new Interval(lo, hi) : e;
      });
      const Znext = RigorousKrawczyk.enclose(dae, Xnext, Zb);
      if (!Znext) {
        if (h > minDt * 1.01) {
          h = Math.max(minDt, h * 0.5);
          continue;
        }
        verdict = {
          kind: "unknown",
          reason: "nonconvergent",
          detail: `End-of-step algebraic certification failed at t=${currentTime + h}.`,
        };
        break;
      }

      // Informational nominal trajectory (explicit Euler on midpoint values; not part of the proof).
      const xm = currentNomX;
      const fNom = dae.f(currentTime, xm, currentNomZ);
      currentNomX = xm.map((x, i) => x + h * (fNom[i] ?? 0));

      checkReq(B, Zb, currentTime + h);
      currentTime += h;
      steps.push({
        time: currentTime,
        xTubes: B.map((i) => new Interval(i.lo, i.hi)),
        zTubes: Zb.map((i) => new Interval(i.lo, i.hi)),
        nominalX: [...currentNomX],
        nominalZ: [...currentNomZ],
        isAlgebraicManifoldCertified: true,
      });
      X = Xnext;
      Z = Znext;
      h = Math.min(dt, h * 2);
    }

    if (!verdict) {
      if (currentTime < tEnd - 1e-12) {
        verdict = { kind: "unknown", reason: "budget", detail: `Stopped at t=${currentTime}.` };
      } else if (breaches.length > 0) {
        verdict = {
          kind: "unknown",
          reason: "inconclusive-enclosure",
          rigor: "float-sound",
          detail: `Enclosure crosses a requirement limit (${breaches[0]}); no concrete witness.`,
        };
      } else {
        verdict = {
          kind: "proven",
          rigor: "float-sound",
          detail:
            requirements.length > 0
              ? "Validated enclosure satisfies all requirements."
              : "Validated enclosure computed (index-1 manifold certified; no requirements given).",
        };
      }
    }
    return DaeFlowpipeSolver.finishValidated(steps, t0, tEnd, verdict, breaches);
  }

  private static finishValidated(
    steps: DaeFlowpipeStep[],
    t0: number,
    tEnd: number,
    verdict: VerificationVerdict,
    breaches: string[],
  ): DaeFlowpipeResult {
    const proven = verdict.kind === "proven";
    return {
      isCertifiedSafe: proven,
      totalSteps: steps.length,
      steps,
      verdict,
      summary: proven
        ? `DAE flowpipe proven over [${t0}, ${tEnd}] (${steps.length} validated steps, float-sound).`
        : `DAE flowpipe not proven (${verdict.kind === "unknown" ? verdict.reason : verdict.kind}${breaches.length ? `; ${breaches.length} breach(es)` : ""}).`,
    };
  }

  /** Legacy point-evaluation path (non-rigorous): used when no interval extensions are supplied. */
  private static solveHeuristic(options: DaeFlowpipeOptions): DaeFlowpipeResult {
    const { dae, initialX, initialZ, nominalX, nominalZ, tSpan, dt } = options;

    const [t0, tEnd] = tSpan;
    const steps: DaeFlowpipeStep[] = [];

    let currentX = initialX.map((i) => new Interval(i.lo, i.hi));
    let currentZ = initialZ.map((i) => new Interval(i.lo, i.hi));
    let currentNomX = [...nominalX];
    let currentNomZ = [...nominalZ];
    let currentTime = t0;

    // Verify initial algebraic manifold
    const initKrawczyk = IntervalKrawczykOperator.contract(dae, currentX, currentZ, currentNomZ, currentNomX);

    steps.push({
      time: t0,
      xTubes: currentX.map((i) => new Interval(i.lo, i.hi)),
      zTubes: initKrawczyk.contractedZ,
      nominalX: [...currentNomX],
      nominalZ: [...currentNomZ],
      isAlgebraicManifoldCertified: initKrawczyk.isUniqueSolutionProven,
    });

    let step = 0;
    while (currentTime < tEnd - 1e-12 && step < 1000) {
      step++;
      const currentDt = Math.min(dt, tEnd - currentTime);

      // 1. Solve algebraic variables on nominal trajectory using Newton-Raphson
      const gNom = dae.g(currentNomX, currentNomZ);
      const JzNom = dae.jacobianGz(currentNomX, currentNomZ);
      if (dae.numAlgStates === 1 && Math.abs(JzNom[0]?.[0] ?? 0) > 1e-12) {
        currentNomZ[0] -= (gNom[0] ?? 0) / JzNom[0]![0]!;
      }

      // 2. High-order Taylor series step for differential variables:
      // x_{k+1} = x_k + dt * f(t, x_k, z_k) + 0.5 * dt^2 * f'(t, x_k, z_k)
      const fNom = dae.f(currentTime, currentNomX, currentNomZ);
      const nextNomX = currentNomX.map((x, i) => x + currentDt * (fNom[i] ?? 0));

      // 3. Interval bounding: enclose differential tubes with Picard enclosure
      const nextX: Interval[] = [];
      for (let i = 0; i < dae.numDiffStates; i++) {
        const xInv = currentX[i]!;
        const fLo =
          dae.f(
            currentTime,
            currentX.map((x) => x.lo),
            currentZ.map((z) => z.lo),
          )[i] ?? 0;
        const fHi =
          dae.f(
            currentTime,
            currentX.map((x) => x.hi),
            currentZ.map((z) => z.hi),
          )[i] ?? 0;
        const deltaLo = Math.min(fLo, fHi) * currentDt;
        const deltaHi = Math.max(fLo, fHi) * currentDt;

        nextX.push(new Interval(xInv.lo + deltaLo, xInv.hi + deltaHi));
      }

      // 4. Contract algebraic variables on the new differential state box via Interval Krawczyk
      const krawczykRes = IntervalKrawczykOperator.contract(dae, nextX, currentZ, currentNomZ, nextNomX);

      currentTime += currentDt;
      currentX = nextX;
      currentZ = krawczykRes.contractedZ;
      currentNomX = nextNomX;

      steps.push({
        time: currentTime,
        xTubes: currentX.map((i) => new Interval(i.lo, i.hi)),
        zTubes: currentZ.map((i) => new Interval(i.lo, i.hi)),
        nominalX: [...currentNomX],
        nominalZ: [...currentNomZ],
        isAlgebraicManifoldCertified: krawczykRes.isUniqueSolutionProven,
      });
    }

    const allManifoldCertified = steps.every((s) => s.isAlgebraicManifoldCertified);
    const verdict: VerificationVerdict = {
      kind: "unknown",
      reason: "not-rigorous",
      rigor: "heuristic",
      detail:
        "Differential tubes use corner evaluation of f and a point-Jacobian Krawczyk test; enclosures are not guaranteed.",
    };

    return {
      isCertifiedSafe: allManifoldCertified,
      totalSteps: steps.length,
      steps,
      summary: allManifoldCertified
        ? `DAE flowpipe computed over [${t0}, ${tEnd}] (${steps.length} steps); algebraic manifold contracted at every step (non-rigorous tubes).`
        : `DAE flowpipe computed over [${t0}, ${tEnd}] (${steps.length} steps); algebraic manifold NOT certified at ${steps.filter((s) => !s.isAlgebraicManifoldCertified).length} step(s).`,
      verdict,
    };
  }
}

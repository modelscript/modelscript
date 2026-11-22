// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Dutertre–de Moura SMT Simplex Solver for Linear Real Arithmetic (LRA).
 *
 * Implements the general Simplex algorithm for DPLL(T) / Nelson-Oppen (Dutertre & de Moura, CAV 2006):
 *   - Native handling of unbounded variables (no non-negativity splitting required).
 *   - Exact strict inequalities (`<`, `>`) via infinitesimal delta-rationals `(r, d)` representing `r + d*eps`.
 *   - Bland's rule pivot selection guaranteeing termination without cycling.
 *   - Minimal conflict-bound justification extraction for CDCL(T) lemma learning.
 *   - Model-guided implied equality deduction (`x <= y && y <= x ==> x == y`) for Nelson-Oppen sharing.
 */

import { UndoTrail } from "./oracles/undo_trail.js";
import { Rational } from "./rational.js";

export type LinearOp = "<=" | "<" | ">=" | ">" | "==";

/**
 * Infinitesimal-extended real number `r + d * eps` for exact strict inequality handling.
 */
interface DeltaVal {
  r: number;
  d: number;
}

const NEG_INF: DeltaVal = { r: -Infinity, d: 0 };
const POS_INF: DeltaVal = { r: Infinity, d: 0 };

const EPS_REL = 1e-11;

function relTol(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return EPS_REL * Math.max(1, Math.abs(a), Math.abs(b));
}

function deltaCmp(a: DeltaVal, b: DeltaVal): number {
  if (a.r === b.r) {
    if (Math.abs(a.d - b.d) <= 1e-12) return 0;
    return a.d < b.d ? -1 : 1;
  }
  if (!Number.isFinite(a.r) || !Number.isFinite(b.r)) {
    return a.r < b.r ? -1 : 1;
  }
  const tol = relTol(a.r, b.r);
  if (Math.abs(a.r - b.r) <= tol) {
    if (Math.abs(a.d - b.d) <= 1e-12) return 0;
    return a.d < b.d ? -1 : 1;
  }
  return a.r < b.r ? -1 : 1;
}

function deltaAdd(a: DeltaVal, b: DeltaVal): DeltaVal {
  return { r: a.r + b.r, d: a.d + b.d };
}

function deltaSub(a: DeltaVal, b: DeltaVal): DeltaVal {
  return { r: a.r - b.r, d: a.d - b.d };
}

function deltaScale(a: DeltaVal, k: number): DeltaVal {
  return { r: a.r * k, d: a.d * k };
}

export interface LraConstraint {
  coeffs: Record<string, number>;
  op: LinearOp;
  rhs: number;
  litId: number;
}

export interface LraCheckResult {
  isSat: boolean;
  /** True when the solver exhausted its pivot or branch-and-bound budget without proving SAT or UNSAT. */
  isUnknown?: boolean | undefined;
  conflictLitIds?: number[] | undefined;
  model?: Map<string, number> | undefined;
}

/**
 * Dutertre–de Moura Simplex tableau for linear real arithmetic feasibility and equality deduction.
 */
export class LraSimplexSolver {
  private varToIdx = new Map<string, number>();
  private idxToVar: string[] = [];
  private numOrigVars = 0;

  // Per-variable bounds & justifications
  private lower: DeltaVal[] = [];
  private upper: DeltaVal[] = [];
  private lowerJust: (number | undefined)[] = [];
  private upperJust: (number | undefined)[] = [];
  private values: DeltaVal[] = [];

  // Tableau: basicRow.get(basicIdx) = Map<nonBasicIdx, coeff> representing x_basic = sum(a_ij * x_nonBasic)
  private isBasic: boolean[] = [];
  private rows = new Map<number, Map<number, number>>();
  private slackCount = 0;
  private immediateConflictLits?: number[] | undefined;
  private trail = new UndoTrail();

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public reset(): void {
    this.varToIdx.clear();
    this.idxToVar = [];
    this.numOrigVars = 0;
    this.lower = [];
    this.upper = [];
    this.lowerJust = [];
    this.upperJust = [];
    this.values = [];
    this.isBasic = [];
    this.rows.clear();
    this.slackCount = 0;
    this.immediateConflictLits = undefined;
    this.integerVars.clear();
    this.trail.reset();
  }

  private setImmediateConflict(lits: number[]): void {
    const prev = this.immediateConflictLits;
    this.trail.record(() => {
      this.immediateConflictLits = prev;
    });
    this.immediateConflictLits = lits;
  }

  private ensureVar(name: string, isSlack = false): number {
    let idx = this.varToIdx.get(name);
    if (idx !== undefined) return idx;
    idx = this.idxToVar.length;
    this.varToIdx.set(name, idx);
    this.idxToVar.push(name);
    if (!isSlack) this.numOrigVars++;
    this.lower.push(NEG_INF);
    this.upper.push(POS_INF);
    this.lowerJust.push(undefined);
    this.upperJust.push(undefined);
    this.values.push({ r: 0, d: 0 });
    this.isBasic.push(isSlack);
    return idx;
  }

  /**
   * Asserts a bound on a single variable (`lo <= x <= hi`, with optional strict open flags).
   */
  public assertVarBound(name: string, lo: number, hi: number, loOpen = false, hiOpen = false, litId?: number): void {
    const idx = this.ensureVar(name, false);
    if (Number.isFinite(lo)) {
      this.tightenLower(idx, { r: lo, d: loOpen ? 1 : 0 }, litId);
    }
    if (Number.isFinite(hi)) {
      this.tightenUpper(idx, { r: hi, d: hiOpen ? -1 : 0 }, litId);
    }
  }

  /**
   * Asserts a linear constraint `sum(coeffs[v] * v) op rhs`.
   */
  public assertConstraint(c: LraConstraint): void {
    const entries = Object.entries(c.coeffs).filter(([, coeff]) => Math.abs(coeff) > 1e-12);
    if (entries.length === 0) {
      // Constant constraint: 0 op rhs
      const ok =
        (c.op === "<=" && 0 <= c.rhs + 1e-12) ||
        (c.op === "<" && 0 < c.rhs - 1e-12) ||
        (c.op === ">=" && 0 >= c.rhs - 1e-12) ||
        (c.op === ">" && 0 > c.rhs + 1e-12) ||
        (c.op === "==" && Math.abs(c.rhs) <= 1e-12);
      if (!ok && !this.immediateConflictLits) {
        this.setImmediateConflict([c.litId]);
      }
      return;
    }

    if (entries.length === 1) {
      const [vName, coeff] = entries[0]!;
      const boundVal = c.rhs / coeff;
      let op = c.op;
      if (coeff < 0) {
        op = op === "<=" ? ">=" : op === ">=" ? "<=" : op === "<" ? ">" : op === ">" ? "<" : "==";
      }
      const idx = this.ensureVar(vName, false);
      if (op === "<=") this.tightenUpper(idx, { r: boundVal, d: 0 }, c.litId);
      else if (op === "<") this.tightenUpper(idx, { r: boundVal, d: -1 }, c.litId);
      else if (op === ">=") this.tightenLower(idx, { r: boundVal, d: 0 }, c.litId);
      else if (op === ">") this.tightenLower(idx, { r: boundVal, d: 1 }, c.litId);
      else {
        this.tightenLower(idx, { r: boundVal, d: 0 }, c.litId);
        this.tightenUpper(idx, { r: boundVal, d: 0 }, c.litId);
      }
      return;
    }

    // Create slack variable s = sum(coeff * x_j)
    const slackName = `__slack_${this.slackCount++}`;
    const slackIdx = this.ensureVar(slackName, true);
    const row = new Map<number, number>();

    for (const [vName, coeff] of entries) {
      const vIdx = this.ensureVar(vName, false);
      if (this.isBasic[vIdx]) {
        // Substitute basic variable's row expression
        const bRow = this.rows.get(vIdx);
        if (bRow) {
          for (const [nbIdx, nbCoeff] of bRow.entries()) {
            const next = (row.get(nbIdx) ?? 0) + coeff * nbCoeff;
            if (Math.abs(next) <= 1e-12) row.delete(nbIdx);
            else row.set(nbIdx, next);
          }
        }
      } else {
        const next = (row.get(vIdx) ?? 0) + coeff;
        if (Math.abs(next) <= 1e-12) row.delete(vIdx);
        else row.set(vIdx, next);
      }
    }

    this.rows.set(slackIdx, row);

    // Initialize slack value from current non-basic values
    let val: DeltaVal = { r: 0, d: 0 };
    for (const [nbIdx, nbCoeff] of row.entries()) {
      val = deltaAdd(val, deltaScale(this.values[nbIdx]!, nbCoeff));
    }
    this.values[slackIdx] = val;

    if (c.op === "<=") this.tightenUpper(slackIdx, { r: c.rhs, d: 0 }, c.litId);
    else if (c.op === "<") this.tightenUpper(slackIdx, { r: c.rhs, d: -1 }, c.litId);
    else if (c.op === ">=") this.tightenLower(slackIdx, { r: c.rhs, d: 0 }, c.litId);
    else if (c.op === ">") this.tightenLower(slackIdx, { r: c.rhs, d: 1 }, c.litId);
    else {
      this.tightenLower(slackIdx, { r: c.rhs, d: 0 }, c.litId);
      this.tightenUpper(slackIdx, { r: c.rhs, d: 0 }, c.litId);
    }
  }

  private tightenLower(idx: number, bound: DeltaVal, litId?: number): void {
    if (deltaCmp(bound, this.lower[idx]!) > 0) {
      const prevBound = this.lower[idx]!;
      const prevJust = this.lowerJust[idx];
      this.trail.record(() => {
        this.lower[idx] = prevBound;
        this.lowerJust[idx] = prevJust;
      });
      this.lower[idx] = bound;
      this.lowerJust[idx] = litId;
      if (deltaCmp(this.lower[idx]!, this.upper[idx]!) > 0 && !this.immediateConflictLits) {
        const conflict: number[] = [];
        if (this.lowerJust[idx] !== undefined) conflict.push(this.lowerJust[idx]!);
        if (this.upperJust[idx] !== undefined) conflict.push(this.upperJust[idx]!);
        this.setImmediateConflict(conflict);
      }
      if (!this.isBasic[idx] && deltaCmp(this.values[idx]!, bound) < 0) {
        this.updateNonBasic(idx, bound);
      }
    }
  }

  private tightenUpper(idx: number, bound: DeltaVal, litId?: number): void {
    if (deltaCmp(bound, this.upper[idx]!) < 0) {
      const prevBound = this.upper[idx]!;
      const prevJust = this.upperJust[idx];
      this.trail.record(() => {
        this.upper[idx] = prevBound;
        this.upperJust[idx] = prevJust;
      });
      this.upper[idx] = bound;
      this.upperJust[idx] = litId;
      if (deltaCmp(this.lower[idx]!, this.upper[idx]!) > 0 && !this.immediateConflictLits) {
        const conflict: number[] = [];
        if (this.lowerJust[idx] !== undefined) conflict.push(this.lowerJust[idx]!);
        if (this.upperJust[idx] !== undefined) conflict.push(this.upperJust[idx]!);
        this.setImmediateConflict(conflict);
      }
      if (!this.isBasic[idx] && deltaCmp(this.values[idx]!, bound) > 0) {
        this.updateNonBasic(idx, bound);
      }
    }
  }

  private updateNonBasic(nbIdx: number, newVal: DeltaVal): void {
    const diff = deltaSub(newVal, this.values[nbIdx]!);
    this.values[nbIdx] = newVal;
    for (const [bIdx, row] of this.rows.entries()) {
      const coeff = row.get(nbIdx);
      if (coeff !== undefined) {
        this.values[bIdx] = deltaAdd(this.values[bIdx]!, deltaScale(diff, coeff));
      }
    }
  }

  private pivotAndUpdate(basicIdx: number, nonBasicIdx: number, newBasicVal: DeltaVal): void {
    const row = this.rows.get(basicIdx)!;
    const aij = row.get(nonBasicIdx)!;
    const theta = deltaScale(deltaSub(newBasicVal, this.values[basicIdx]!), 1 / aij);

    this.values[basicIdx] = newBasicVal;
    this.values[nonBasicIdx] = deltaAdd(this.values[nonBasicIdx]!, theta);

    // Update other basic variable values
    for (const [otherB, otherRow] of this.rows.entries()) {
      if (otherB === basicIdx) continue;
      const coeff = otherRow.get(nonBasicIdx);
      if (coeff !== undefined) {
        this.values[otherB] = deltaAdd(this.values[otherB]!, deltaScale(theta, coeff));
      }
    }

    // Pivot: solve basicIdx = aij * nonBasicIdx + sum(aik * xk) for nonBasicIdx
    const newRow = new Map<number, number>();
    newRow.set(basicIdx, 1 / aij);
    for (const [k, aik] of row.entries()) {
      if (k === nonBasicIdx) continue;
      newRow.set(k, -aik / aij);
    }

    this.rows.delete(basicIdx);
    this.isBasic[basicIdx] = false;
    this.isBasic[nonBasicIdx] = true;

    // Substitute nonBasicIdx in all other rows
    for (const [, otherRow] of this.rows.entries()) {
      const coeff = otherRow.get(nonBasicIdx);
      if (coeff === undefined) continue;
      otherRow.delete(nonBasicIdx);
      for (const [k, rk] of newRow.entries()) {
        const next = (otherRow.get(k) ?? 0) + coeff * rk;
        if (Math.abs(next) <= 1e-12) otherRow.delete(k);
        else otherRow.set(k, next);
      }
    }

    this.rows.set(nonBasicIdx, newRow);
  }

  /**
   * Runs the Dutertre–de Moura Simplex feasibility loop using Bland's rule.
   */
  public checkSat(maxPivots = 500): LraCheckResult {
    if (this.immediateConflictLits) {
      return { isSat: false, conflictLitIds: [...this.immediateConflictLits] };
    }

    // Ensure all non-basic variables satisfy their own bounds before pivoting
    for (let i = 0; i < this.idxToVar.length; i++) {
      if (!this.isBasic[i]) {
        if (deltaCmp(this.lower[i]!, this.upper[i]!) > 0) {
          const lits: number[] = [];
          if (this.lowerJust[i] !== undefined) lits.push(this.lowerJust[i]!);
          if (this.upperJust[i] !== undefined) lits.push(this.upperJust[i]!);
          return { isSat: false, conflictLitIds: lits };
        }
        if (deltaCmp(this.values[i]!, this.lower[i]!) < 0) {
          this.updateNonBasic(i, this.lower[i]!);
        } else if (deltaCmp(this.values[i]!, this.upper[i]!) > 0) {
          this.updateNonBasic(i, this.upper[i]!);
        }
      }
    }

    for (let pivot = 0; pivot < maxPivots; pivot++) {
      // Bland's rule: pick lowest-index basic variable violating its bounds
      let violatedBasic = -1;
      let isBelowLower = false;
      for (let i = 0; i < this.idxToVar.length; i++) {
        if (!this.isBasic[i]) continue;
        if (deltaCmp(this.values[i]!, this.lower[i]!) < 0) {
          violatedBasic = i;
          isBelowLower = true;
          break;
        }
        if (deltaCmp(this.values[i]!, this.upper[i]!) > 0) {
          violatedBasic = i;
          isBelowLower = false;
          break;
        }
      }

      if (violatedBasic === -1) {
        // Satisfiable! Compute real model (choosing small concrete eps if needed)
        let eps = 1e-6;
        for (let i = 0; i < this.idxToVar.length; i++) {
          const lo = this.lower[i]!;
          const hi = this.upper[i]!;
          if (Number.isFinite(lo.r) && Number.isFinite(hi.r) && hi.r > lo.r) {
            const denom = Math.abs(lo.d - hi.d);
            if (denom > 0) {
              eps = Math.min(eps, (hi.r - lo.r) / (2 * denom));
            }
          }
        }
        const model = new Map<string, number>();
        for (let i = 0; i < this.idxToVar.length; i++) {
          const name = this.idxToVar[i]!;
          if (!name.startsWith("__slack_")) {
            const v = this.values[i]!;
            model.set(name, v.r + v.d * eps);
          }
        }
        return { isSat: true, model };
      }

      const row = this.rows.get(violatedBasic);
      if (!row) return { isSat: false, conflictLitIds: [] };

      // Find lowest-index non-basic variable able to move violatedBasic toward its bound
      let chosenNonBasic = -1;
      const sortedNb = Array.from(row.keys()).sort((a, b) => a - b);
      for (const j of sortedNb) {
        const aij = row.get(j)!;
        if (isBelowLower) {
          if (
            (aij > 0 && deltaCmp(this.values[j]!, this.upper[j]!) < 0) ||
            (aij < 0 && deltaCmp(this.values[j]!, this.lower[j]!) > 0)
          ) {
            chosenNonBasic = j;
            break;
          }
        } else {
          if (
            (aij < 0 && deltaCmp(this.values[j]!, this.upper[j]!) < 0) ||
            (aij > 0 && deltaCmp(this.values[j]!, this.lower[j]!) > 0)
          ) {
            chosenNonBasic = j;
            break;
          }
        }
      }

      if (chosenNonBasic === -1) {
        // Unsatisfiable! Collect blocking bound justifications
        const conflictSet = new Set<number>();
        const violJust = isBelowLower ? this.lowerJust[violatedBasic] : this.upperJust[violatedBasic];
        if (violJust !== undefined) conflictSet.add(violJust);
        for (const [j, aij] of row.entries()) {
          const blockJust = isBelowLower
            ? aij > 0
              ? this.upperJust[j]
              : this.lowerJust[j]
            : aij < 0
              ? this.upperJust[j]
              : this.lowerJust[j];
          if (blockJust !== undefined) conflictSet.add(blockJust);
        }
        return { isSat: false, conflictLitIds: Array.from(conflictSet) };
      }

      const targetBound = isBelowLower ? this.lower[violatedBasic]! : this.upper[violatedBasic]!;
      this.pivotAndUpdate(violatedBasic, chosenNonBasic, targetBound);
    }

    // Pivot limit reached — report unknown rather than claiming SAT without a valid model
    return { isSat: false, isUnknown: true };
  }

  private integerVars = new Set<string>();

  /**
   * Marks a variable as integer-valued for Mixed Integer / Linear Integer Arithmetic (LIA) branch-and-bound.
   */
  public markIntegerVar(name: string): void {
    this.ensureVar(name, false);
    this.trail.setAdd(this.integerVars, name);
  }

  /**
   * Clones the solver state for speculative equality-entailment probes and LIA branch-and-bound.
   */
  private clone(): LraSimplexSolver {
    const copy = new LraSimplexSolver();
    copy.varToIdx = new Map(this.varToIdx);
    copy.idxToVar = [...this.idxToVar];
    copy.numOrigVars = this.numOrigVars;
    copy.lower = this.lower.map((v) => ({ r: v.r, d: v.d }));
    copy.upper = this.upper.map((v) => ({ r: v.r, d: v.d }));
    copy.lowerJust = [...this.lowerJust];
    copy.upperJust = [...this.upperJust];
    copy.values = this.values.map((v) => ({ r: v.r, d: v.d }));
    copy.isBasic = [...this.isBasic];
    for (const [b, row] of this.rows.entries()) {
      copy.rows.set(b, new Map(row));
    }
    copy.slackCount = this.slackCount;
    copy.immediateConflictLits = this.immediateConflictLits ? [...this.immediateConflictLits] : undefined;
    copy.integerVars = new Set(this.integerVars);
    return copy;
  }

  /**
   * Attempts to derive and assert a valid Gomory Mixed-Integer (GMI) cut from the tableau row
   * of a fractional basic integer variable `basicIdx`.
   * Returns true if a separating cut was added to the tableau, false if not applicable.
   */
  private tryApplyGomoryCut(basicIdx: number): boolean {
    if (!this.isBasic[basicIdx]) return false;
    const row = this.rows.get(basicIdx);
    if (!row || row.size === 0) return false;
    const vBasic = this.values[basicIdx]!;
    if (!Number.isFinite(vBasic.r) || Math.abs(vBasic.d) > 1e-12) return false;

    const f0 = vBasic.r - Math.floor(vBasic.r);
    if (f0 <= 1e-6 || f0 >= 1 - 1e-6) return false;

    const cutRow = new Map<number, number>();
    let rhs = 1;
    let firstJust: number | undefined;

    for (const [j, aij] of row.entries()) {
      const vj = this.values[j]!;
      const lj = this.lower[j]!;
      const uj = this.upper[j]!;
      if (Math.abs(vj.d) > 1e-12) return false;

      const atLower =
        Number.isFinite(lj.r) && Math.abs(lj.d) <= 1e-12 && Math.abs(vj.r - lj.r) <= relTol(vj.r, lj.r) * 10;
      const atUpper =
        Number.isFinite(uj.r) && Math.abs(uj.d) <= 1e-12 && Math.abs(vj.r - uj.r) <= relTol(vj.r, uj.r) * 10;
      if (!atLower && !atUpper) {
        // Non-basic variable is free (not at a finite bound) — GMI cut not applicable on this row
        return false;
      }

      const useLower = atLower;
      const boundVal = useLower ? lj.r : uj.r;
      const alpha = useLower ? -aij : aij;
      const jName = this.idxToVar[j]!;
      const isIntNonBasic = this.integerVars.has(jName) && Math.abs(boundVal - Math.round(boundVal)) <= 1e-9;

      let cj: number;
      if (isIntNonBasic) {
        const fj = alpha - Math.floor(alpha);
        if (fj <= 1e-9 || fj >= 1 - 1e-9) {
          cj = 0;
        } else if (fj <= f0) {
          cj = fj / f0;
        } else {
          cj = (1 - fj) / (1 - f0);
        }
      } else {
        cj = alpha >= 0 ? alpha / f0 : -alpha / (1 - f0);
      }

      if (Math.abs(cj) <= 1e-12) continue;

      if (useLower) {
        // c_j * (x_j - l_j)
        cutRow.set(j, (cutRow.get(j) ?? 0) + cj);
        rhs += cj * lj.r;
        if (firstJust === undefined && this.lowerJust[j] !== undefined) firstJust = this.lowerJust[j];
      } else {
        // c_j * (u_j - x_j)
        cutRow.set(j, (cutRow.get(j) ?? 0) - cj);
        rhs -= cj * uj.r;
        if (firstJust === undefined && this.upperJust[j] !== undefined) firstJust = this.upperJust[j];
      }
    }

    if (cutRow.size === 0) {
      // 0 >= 1: immediate integer infeasibility!
      const conflictSet = new Set<number>();
      for (const j of row.keys()) {
        if (this.lowerJust[j] !== undefined) conflictSet.add(this.lowerJust[j]!);
        if (this.upperJust[j] !== undefined) conflictSet.add(this.upperJust[j]!);
      }
      this.setImmediateConflict(Array.from(conflictSet));
      return true;
    }

    const slackName = `__slack_gmi_${this.slackCount++}`;
    const slackIdx = this.ensureVar(slackName, true);
    this.rows.set(slackIdx, cutRow);

    let val: DeltaVal = { r: 0, d: 0 };
    for (const [nbIdx, nbCoeff] of cutRow.entries()) {
      val = deltaAdd(val, deltaScale(this.values[nbIdx]!, nbCoeff));
    }
    this.values[slackIdx] = val;
    this.tightenLower(slackIdx, { r: rhs, d: 0 }, firstJust);
    return true;
  }

  /**
   * Checks Linear Integer Arithmetic (LIA / MILP) feasibility via Gomory Mixed-Integer (GMI)
   * cutting planes followed by branch-and-bound on top of the Dutertre–de Moura Simplex LRA relaxation.
   */
  public checkSatLia(maxNodes = 64, maxCuts = 8): LraCheckResult {
    if (this.integerVars.size === 0) {
      return this.checkSat();
    }

    let nodesExplored = 0;
    const solveNode = (solver: LraSimplexSolver, cutsRemaining: number): LraCheckResult => {
      nodesExplored++;
      let lraRes = solver.checkSat();
      if (!lraRes.isSat) return lraRes;
      if (!lraRes.model) return lraRes;

      // Apply Gomory Mixed-Integer cuts at the current node before branching
      let cutsLeft = cutsRemaining;
      while (cutsLeft > 0) {
        let cutApplied = false;
        for (const intVar of solver.integerVars) {
          const idx = solver.varToIdx.get(intVar);
          if (idx === undefined || !solver.isBasic[idx]) continue;
          const val = lraRes.model?.get(intVar);
          if (val === undefined || !Number.isFinite(val)) continue;
          const frac = Math.abs(val - Math.round(val));
          if (frac > 1e-6) {
            if (solver.tryApplyGomoryCut(idx)) {
              cutApplied = true;
              cutsLeft--;
              break;
            }
          }
        }
        if (!cutApplied) break;
        lraRes = solver.checkSat();
        if (!lraRes.isSat) return lraRes;
        if (!lraRes.model) return lraRes;
      }

      // Find the most-fractional integer variable (closest to 0.5)
      let branchVar: string | undefined;
      let branchVal = 0;
      let maxFracDist = 0;
      for (const intVar of solver.integerVars) {
        const val = lraRes.model.get(intVar);
        if (val === undefined || !Number.isFinite(val)) continue;
        const frac = Math.abs(val - Math.round(val));
        if (frac > 1e-7) {
          const distFromHalf = 0.5 - Math.abs(frac - 0.5);
          if (!branchVar || distFromHalf > maxFracDist) {
            branchVar = intVar;
            branchVal = val;
            maxFracDist = distFromHalf;
          }
        }
      }

      if (!branchVar) {
        return lraRes; // Integer-feasible model found!
      }

      if (nodesExplored >= maxNodes) {
        // Never return a fractional relaxation model as LIA-satisfiable; report unknown
        return { isSat: false, isUnknown: true };
      }

      const floorVal = Math.floor(branchVal);
      const ceilVal = Math.ceil(branchVal);

      // Left branch: x <= floor(v)
      const left = solver.clone();
      left.assertVarBound(branchVar, -Infinity, floorVal, false, false);
      const leftRes = solveNode(left, Math.min(cutsLeft, 4));
      if (leftRes.isSat) return leftRes;

      // Right branch: x >= ceil(v)
      const right = solver.clone();
      right.assertVarBound(branchVar, ceilVal, Infinity, false, false);
      const rightRes = solveNode(right, Math.min(cutsLeft, 4));
      if (rightRes.isSat) return rightRes;

      // Both branches infeasible => certified LIA UNSAT
      const combined = new Set<number>();
      for (const id of leftRes.conflictLitIds ?? []) combined.add(id);
      for (const id of rightRes.conflictLitIds ?? []) combined.add(id);
      return { isSat: false, conflictLitIds: Array.from(combined) };
    };

    // Run cutting-plane / B&B search on a clone so temporary cuts never pollute the caller's persistent tableau
    const rootSolver = this.clone();
    return solveNode(rootSolver, maxCuts);
  }

  /**
   * Deduces entailed variable equalities (`x == y`) from a satisfiable LRA system.
   * Uses the current model to filter candidate pairs in O(V log V), then proves entailment
   * by checking that both `x - y > 0` and `x - y < 0` are infeasible.
   */
  public deduceImpliedEqualities(model: Map<string, number>): { varA: string; varB: string; justs: number[] }[] {
    const vars = Array.from(model.keys());
    if (vars.length < 2) return [];

    // Group variables with equal values in the current model
    const sorted = vars.map((v) => ({ v, val: model.get(v)! })).sort((a, b) => a.val - b.val);
    const deduced: { varA: string; varB: string; justs: number[] }[] = [];

    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (
        j < sorted.length &&
        Math.abs(sorted[j]!.val - sorted[i]!.val) <= relTol(sorted[i]!.val, sorted[j]!.val) * 100
      ) {
        j++;
      }
      if (j - i > 1) {
        // Partition the equal-value bucket into entailed equivalence classes
        const bucketLen = j - i;
        const matched = new Uint8Array(bucketLen);
        for (let a = 0; a < bucketLen; a++) {
          if (matched[a]) continue;
          const rep = sorted[i + a]!.v;
          for (let b = a + 1; b < bucketLen; b++) {
            if (matched[b]) continue;
            const other = sorted[i + b]!.v;
            const probeGt = this.clone();
            probeGt.assertConstraint({ coeffs: { [rep]: 1, [other]: -1 }, op: ">", rhs: 0, litId: -1 });
            const resGt = probeGt.checkSat(100);
            if (resGt.isSat) continue;

            const probeLt = this.clone();
            probeLt.assertConstraint({ coeffs: { [rep]: 1, [other]: -1 }, op: "<", rhs: 0, litId: -2 });
            const resLt = probeLt.checkSat(100);
            if (!resLt.isSat) {
              matched[b] = 1;
              const justSet = new Set<number>();
              for (const id of resGt.conflictLitIds ?? []) if (id > 0) justSet.add(id);
              for (const id of resLt.conflictLitIds ?? []) if (id > 0) justSet.add(id);
              deduced.push({ varA: rep, varB: other, justs: Array.from(justSet) });
            }
          }
        }
      }
      i = j;
    }

    return deduced;
  }
}

export { Rational };

/**
 * Exact infinitesimal-extended rational `r + d * eps` (with `inf: -1 | 0 | 1` for `-inf` / finite / `+inf`).
 */
interface ExactDeltaVal {
  r: Rational;
  d: Rational;
  inf: -1 | 0 | 1;
}

const EXACT_NEG_INF: ExactDeltaVal = { r: Rational.ZERO, d: Rational.ZERO, inf: -1 };
const EXACT_POS_INF: ExactDeltaVal = { r: Rational.ZERO, d: Rational.ZERO, inf: 1 };
const EXACT_ZERO: ExactDeltaVal = { r: Rational.ZERO, d: Rational.ZERO, inf: 0 };

function exactDeltaCmp(a: ExactDeltaVal, b: ExactDeltaVal): number {
  if (a.inf !== b.inf) return a.inf < b.inf ? -1 : 1;
  if (a.inf !== 0) return 0;
  const rc = a.r.cmp(b.r);
  if (rc !== 0) return rc;
  return a.d.cmp(b.d);
}

function exactDeltaAdd(a: ExactDeltaVal, b: ExactDeltaVal): ExactDeltaVal {
  return { r: a.r.add(b.r), d: a.d.add(b.d), inf: 0 };
}

function exactDeltaSub(a: ExactDeltaVal, b: ExactDeltaVal): ExactDeltaVal {
  return { r: a.r.sub(b.r), d: a.d.sub(b.d), inf: 0 };
}

function exactDeltaScale(a: ExactDeltaVal, k: Rational): ExactDeltaVal {
  return { r: a.r.mul(k), d: a.d.mul(k), inf: 0 };
}

export interface ExactLraConstraint {
  coeffs: Record<string, number | Rational>;
  op: LinearOp;
  rhs: number | Rational;
  litId: number;
}

export interface ExactLraCheckResult {
  isSat: boolean;
  conflictLitIds?: number[] | undefined;
  model?: Map<string, Rational> | undefined;
}

/**
 * Exact Arbitrary-Precision (`BigInt` Rational) Dutertre–de Moura Simplex Solver
 * with exact Gomory Mixed-Integer (GMI) cuts and `UndoTrail` push/pop persistence.
 *
 * Zero floating-point drift — immune to ill-conditioned matrices and catastrophic cancellation.
 */
export class ExactLraSimplexSolver {
  private varToIdx = new Map<string, number>();
  private idxToVar: string[] = [];
  private lower: ExactDeltaVal[] = [];
  private upper: ExactDeltaVal[] = [];
  private lowerJust: (number | undefined)[] = [];
  private upperJust: (number | undefined)[] = [];
  private values: ExactDeltaVal[] = [];
  private isBasic: boolean[] = [];
  private rows = new Map<number, Map<number, Rational>>();
  private slackCount = 0;
  private immediateConflictLits?: number[] | undefined;
  private integerVars = new Set<string>();
  private trail = new UndoTrail();

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public reset(): void {
    this.varToIdx.clear();
    this.idxToVar = [];
    this.lower = [];
    this.upper = [];
    this.lowerJust = [];
    this.upperJust = [];
    this.values = [];
    this.isBasic = [];
    this.rows.clear();
    this.slackCount = 0;
    this.immediateConflictLits = undefined;
    this.integerVars.clear();
    this.trail.reset();
  }

  private toRat(v: number | Rational): Rational {
    return v instanceof Rational ? v : Rational.fromNumber(v);
  }

  private setImmediateConflict(lits: number[]): void {
    const prev = this.immediateConflictLits;
    this.trail.record(() => {
      this.immediateConflictLits = prev;
    });
    this.immediateConflictLits = lits;
  }

  private ensureVar(name: string, isSlack = false): number {
    let idx = this.varToIdx.get(name);
    if (idx !== undefined) return idx;
    idx = this.idxToVar.length;
    this.varToIdx.set(name, idx);
    this.idxToVar.push(name);
    this.lower.push(EXACT_NEG_INF);
    this.upper.push(EXACT_POS_INF);
    this.lowerJust.push(undefined);
    this.upperJust.push(undefined);
    this.values.push(EXACT_ZERO);
    this.isBasic.push(isSlack);
    return idx;
  }

  public markIntegerVar(name: string): void {
    this.ensureVar(name, false);
    this.trail.setAdd(this.integerVars, name);
  }

  public assertVarBound(
    name: string,
    lo: number | Rational | null,
    hi: number | Rational | null,
    loOpen = false,
    hiOpen = false,
    litId?: number,
  ): void {
    const idx = this.ensureVar(name, false);
    if (lo !== null && (lo instanceof Rational || Number.isFinite(lo))) {
      this.tightenLower(idx, { r: this.toRat(lo), d: loOpen ? Rational.ONE : Rational.ZERO, inf: 0 }, litId);
    }
    if (hi !== null && (hi instanceof Rational || Number.isFinite(hi))) {
      this.tightenUpper(idx, { r: this.toRat(hi), d: hiOpen ? Rational.NEG_ONE : Rational.ZERO, inf: 0 }, litId);
    }
  }

  public assertConstraint(c: ExactLraConstraint): void {
    const rhs = this.toRat(c.rhs);
    const entries: [string, Rational][] = [];
    for (const [k, raw] of Object.entries(c.coeffs)) {
      const r = this.toRat(raw);
      if (!r.isZero()) entries.push([k, r]);
    }

    if (entries.length === 0) {
      const cmp = Rational.ZERO.cmp(rhs);
      const ok =
        (c.op === "<=" && cmp <= 0) ||
        (c.op === "<" && cmp < 0) ||
        (c.op === ">=" && cmp >= 0) ||
        (c.op === ">" && cmp > 0) ||
        (c.op === "==" && cmp === 0);
      if (!ok && !this.immediateConflictLits) {
        this.setImmediateConflict([c.litId]);
      }
      return;
    }

    if (entries.length === 1) {
      const [vName, coeff] = entries[0]!;
      const boundVal = rhs.div(coeff);
      let op = c.op;
      if (coeff.isNegative()) {
        op = op === "<=" ? ">=" : op === ">=" ? "<=" : op === "<" ? ">" : op === ">" ? "<" : "==";
      }
      const idx = this.ensureVar(vName, false);
      if (op === "<=") this.tightenUpper(idx, { r: boundVal, d: Rational.ZERO, inf: 0 }, c.litId);
      else if (op === "<") this.tightenUpper(idx, { r: boundVal, d: Rational.NEG_ONE, inf: 0 }, c.litId);
      else if (op === ">=") this.tightenLower(idx, { r: boundVal, d: Rational.ZERO, inf: 0 }, c.litId);
      else if (op === ">") this.tightenLower(idx, { r: boundVal, d: Rational.ONE, inf: 0 }, c.litId);
      else {
        this.tightenLower(idx, { r: boundVal, d: Rational.ZERO, inf: 0 }, c.litId);
        this.tightenUpper(idx, { r: boundVal, d: Rational.ZERO, inf: 0 }, c.litId);
      }
      return;
    }

    const slackName = `__eslack_${this.slackCount++}`;
    const slackIdx = this.ensureVar(slackName, true);
    const row = new Map<number, Rational>();

    for (const [vName, coeff] of entries) {
      const vIdx = this.ensureVar(vName, false);
      if (this.isBasic[vIdx]) {
        const bRow = this.rows.get(vIdx);
        if (bRow) {
          for (const [nbIdx, nbCoeff] of bRow.entries()) {
            const next = (row.get(nbIdx) ?? Rational.ZERO).add(coeff.mul(nbCoeff));
            if (next.isZero()) row.delete(nbIdx);
            else row.set(nbIdx, next);
          }
        }
      } else {
        const next = (row.get(vIdx) ?? Rational.ZERO).add(coeff);
        if (next.isZero()) row.delete(vIdx);
        else row.set(vIdx, next);
      }
    }

    this.rows.set(slackIdx, row);
    let val = EXACT_ZERO;
    for (const [nbIdx, nbCoeff] of row.entries()) {
      val = exactDeltaAdd(val, exactDeltaScale(this.values[nbIdx]!, nbCoeff));
    }
    this.values[slackIdx] = val;

    if (c.op === "<=") this.tightenUpper(slackIdx, { r: rhs, d: Rational.ZERO, inf: 0 }, c.litId);
    else if (c.op === "<") this.tightenUpper(slackIdx, { r: rhs, d: Rational.NEG_ONE, inf: 0 }, c.litId);
    else if (c.op === ">=") this.tightenLower(slackIdx, { r: rhs, d: Rational.ZERO, inf: 0 }, c.litId);
    else if (c.op === ">") this.tightenLower(slackIdx, { r: rhs, d: Rational.ONE, inf: 0 }, c.litId);
    else {
      this.tightenLower(slackIdx, { r: rhs, d: Rational.ZERO, inf: 0 }, c.litId);
      this.tightenUpper(slackIdx, { r: rhs, d: Rational.ZERO, inf: 0 }, c.litId);
    }
  }

  private tightenLower(idx: number, bound: ExactDeltaVal, litId?: number): void {
    if (exactDeltaCmp(bound, this.lower[idx]!) > 0) {
      const prevBound = this.lower[idx]!;
      const prevJust = this.lowerJust[idx];
      this.trail.record(() => {
        this.lower[idx] = prevBound;
        this.lowerJust[idx] = prevJust;
      });
      this.lower[idx] = bound;
      this.lowerJust[idx] = litId;
      if (exactDeltaCmp(this.lower[idx]!, this.upper[idx]!) > 0 && !this.immediateConflictLits) {
        const conflict: number[] = [];
        if (this.lowerJust[idx] !== undefined) conflict.push(this.lowerJust[idx]!);
        if (this.upperJust[idx] !== undefined) conflict.push(this.upperJust[idx]!);
        this.setImmediateConflict(conflict);
      }
      if (!this.isBasic[idx] && exactDeltaCmp(this.values[idx]!, bound) < 0) {
        this.updateNonBasic(idx, bound);
      }
    }
  }

  private tightenUpper(idx: number, bound: ExactDeltaVal, litId?: number): void {
    if (exactDeltaCmp(bound, this.upper[idx]!) < 0) {
      const prevBound = this.upper[idx]!;
      const prevJust = this.upperJust[idx];
      this.trail.record(() => {
        this.upper[idx] = prevBound;
        this.upperJust[idx] = prevJust;
      });
      this.upper[idx] = bound;
      this.upperJust[idx] = litId;
      if (exactDeltaCmp(this.lower[idx]!, this.upper[idx]!) > 0 && !this.immediateConflictLits) {
        const conflict: number[] = [];
        if (this.lowerJust[idx] !== undefined) conflict.push(this.lowerJust[idx]!);
        if (this.upperJust[idx] !== undefined) conflict.push(this.upperJust[idx]!);
        this.setImmediateConflict(conflict);
      }
      if (!this.isBasic[idx] && exactDeltaCmp(this.values[idx]!, bound) > 0) {
        this.updateNonBasic(idx, bound);
      }
    }
  }

  private updateNonBasic(nbIdx: number, newVal: ExactDeltaVal): void {
    const diff = exactDeltaSub(newVal, this.values[nbIdx]!);
    this.values[nbIdx] = newVal;
    for (const [bIdx, row] of this.rows.entries()) {
      const coeff = row.get(nbIdx);
      if (coeff !== undefined) {
        this.values[bIdx] = exactDeltaAdd(this.values[bIdx]!, exactDeltaScale(diff, coeff));
      }
    }
  }

  private pivotAndUpdate(basicIdx: number, nonBasicIdx: number, newBasicVal: ExactDeltaVal): void {
    const row = this.rows.get(basicIdx)!;
    const aij = row.get(nonBasicIdx)!;
    const invAij = Rational.ONE.div(aij);
    const theta = exactDeltaScale(exactDeltaSub(newBasicVal, this.values[basicIdx]!), invAij);

    this.values[basicIdx] = newBasicVal;
    this.values[nonBasicIdx] = exactDeltaAdd(this.values[nonBasicIdx]!, theta);

    for (const [otherBasic, otherRow] of this.rows.entries()) {
      if (otherBasic === basicIdx) continue;
      const akj = otherRow.get(nonBasicIdx);
      if (akj !== undefined) {
        this.values[otherBasic] = exactDeltaAdd(this.values[otherBasic]!, exactDeltaScale(theta, akj));
      }
    }

    const newRow = new Map<number, Rational>();
    newRow.set(basicIdx, invAij);
    for (const [colIdx, coeff] of row.entries()) {
      if (colIdx === nonBasicIdx) continue;
      const nc = coeff.neg().div(aij);
      if (!nc.isZero()) newRow.set(colIdx, nc);
    }

    this.rows.delete(basicIdx);
    this.isBasic[basicIdx] = false;
    this.rows.set(nonBasicIdx, newRow);
    this.isBasic[nonBasicIdx] = true;

    for (const [otherBasic, otherRow] of this.rows.entries()) {
      if (otherBasic === nonBasicIdx) continue;
      const akj = otherRow.get(nonBasicIdx);
      if (akj === undefined) continue;
      otherRow.delete(nonBasicIdx);
      for (const [colIdx, coeff] of newRow.entries()) {
        const next = (otherRow.get(colIdx) ?? Rational.ZERO).add(akj.mul(coeff));
        if (next.isZero()) otherRow.delete(colIdx);
        else otherRow.set(colIdx, next);
      }
    }
  }

  public checkSat(maxPivots = 2000): ExactLraCheckResult {
    if (this.immediateConflictLits) {
      return { isSat: false, conflictLitIds: [...this.immediateConflictLits] };
    }

    for (let pivot = 0; pivot < maxPivots; pivot++) {
      let violatedBasic = -1;
      let isBelowLower = false;
      for (let i = 0; i < this.idxToVar.length; i++) {
        if (!this.isBasic[i]) continue;
        if (exactDeltaCmp(this.values[i]!, this.lower[i]!) < 0) {
          violatedBasic = i;
          isBelowLower = true;
          break;
        }
        if (exactDeltaCmp(this.values[i]!, this.upper[i]!) > 0) {
          violatedBasic = i;
          isBelowLower = false;
          break;
        }
      }

      if (violatedBasic === -1) {
        // Compute exact positive rational eps for any strict inequalities
        let eps = new Rational(1n, 1000n);
        for (let i = 0; i < this.idxToVar.length; i++) {
          const v = this.values[i]!;
          const lo = this.lower[i]!;
          const hi = this.upper[i]!;
          if (lo.inf === 0 && v.r.cmp(lo.r) > 0 && v.d.cmp(lo.d) < 0) {
            const boundEps = v.r.sub(lo.r).div(lo.d.sub(v.d).mul(new Rational(2n, 1n)));
            if (boundEps.cmp(eps) < 0) eps = boundEps;
          }
          if (hi.inf === 0 && v.r.cmp(hi.r) < 0 && v.d.cmp(hi.d) > 0) {
            const boundEps = hi.r.sub(v.r).div(v.d.sub(hi.d).mul(new Rational(2n, 1n)));
            if (boundEps.cmp(eps) < 0) eps = boundEps;
          }
        }
        const model = new Map<string, Rational>();
        for (let i = 0; i < this.idxToVar.length; i++) {
          const name = this.idxToVar[i]!;
          if (!name.startsWith("__eslack_")) {
            const v = this.values[i]!;
            model.set(name, v.r.add(v.d.mul(eps)));
          }
        }
        return { isSat: true, model };
      }

      const row = this.rows.get(violatedBasic);
      if (!row) return { isSat: false, conflictLitIds: [] };

      let chosenNonBasic = -1;
      const sortedNb = Array.from(row.keys()).sort((a, b) => a - b);
      for (const j of sortedNb) {
        const aij = row.get(j)!;
        if (isBelowLower) {
          if (
            (aij.isPositive() && exactDeltaCmp(this.values[j]!, this.upper[j]!) < 0) ||
            (aij.isNegative() && exactDeltaCmp(this.values[j]!, this.lower[j]!) > 0)
          ) {
            chosenNonBasic = j;
            break;
          }
        } else {
          if (
            (aij.isNegative() && exactDeltaCmp(this.values[j]!, this.upper[j]!) < 0) ||
            (aij.isPositive() && exactDeltaCmp(this.values[j]!, this.lower[j]!) > 0)
          ) {
            chosenNonBasic = j;
            break;
          }
        }
      }

      if (chosenNonBasic === -1) {
        const conflictSet = new Set<number>();
        const violJust = isBelowLower ? this.lowerJust[violatedBasic] : this.upperJust[violatedBasic];
        if (violJust !== undefined) conflictSet.add(violJust);
        for (const [j, aij] of row.entries()) {
          const blockJust = isBelowLower
            ? aij.isPositive()
              ? this.upperJust[j]
              : this.lowerJust[j]
            : aij.isNegative()
              ? this.upperJust[j]
              : this.lowerJust[j];
          if (blockJust !== undefined) conflictSet.add(blockJust);
        }
        return { isSat: false, conflictLitIds: Array.from(conflictSet) };
      }

      const targetBound = isBelowLower ? this.lower[violatedBasic]! : this.upper[violatedBasic]!;
      this.pivotAndUpdate(violatedBasic, chosenNonBasic, targetBound);
    }

    return { isSat: true };
  }

  private clone(): ExactLraSimplexSolver {
    const copy = new ExactLraSimplexSolver();
    copy.varToIdx = new Map(this.varToIdx);
    copy.idxToVar = [...this.idxToVar];
    copy.lower = [...this.lower];
    copy.upper = [...this.upper];
    copy.lowerJust = [...this.lowerJust];
    copy.upperJust = [...this.upperJust];
    copy.values = [...this.values];
    copy.isBasic = [...this.isBasic];
    for (const [b, row] of this.rows.entries()) {
      copy.rows.set(b, new Map(row));
    }
    copy.slackCount = this.slackCount;
    copy.immediateConflictLits = this.immediateConflictLits ? [...this.immediateConflictLits] : undefined;
    copy.integerVars = new Set(this.integerVars);
    return copy;
  }

  /**
   * Exact BigInt-Rational Gomory Mixed-Integer (GMI) cut generation.
   */
  private tryApplyExactGomoryCut(basicIdx: number): boolean {
    if (!this.isBasic[basicIdx]) return false;
    const row = this.rows.get(basicIdx);
    if (!row || row.size === 0) return false;
    const vBasic = this.values[basicIdx]!;
    if (vBasic.inf !== 0 || !vBasic.d.isZero()) return false;

    const f0 = vBasic.r.frac();
    if (f0.isZero()) return false;
    const oneMinusF0 = Rational.ONE.sub(f0);

    const cutRow = new Map<number, Rational>();
    let rhs = Rational.ONE;
    let firstJust: number | undefined;

    for (const [j, aij] of row.entries()) {
      const vj = this.values[j]!;
      const lj = this.lower[j]!;
      const uj = this.upper[j]!;
      if (vj.inf !== 0 || !vj.d.isZero()) return false;

      const atLower = lj.inf === 0 && lj.d.isZero() && vj.r.equals(lj.r);
      const atUpper = uj.inf === 0 && uj.d.isZero() && vj.r.equals(uj.r);
      if (!atLower && !atUpper) return false;

      const useLower = atLower;
      const boundVal = useLower ? lj.r : uj.r;
      const alpha = useLower ? aij.neg() : aij;
      const jName = this.idxToVar[j]!;
      const isIntNonBasic = this.integerVars.has(jName) && boundVal.isInteger();

      let cj: Rational;
      if (isIntNonBasic) {
        const fj = alpha.frac();
        if (fj.isZero()) {
          cj = Rational.ZERO;
        } else if (fj.cmp(f0) <= 0) {
          cj = fj.div(f0);
        } else {
          cj = Rational.ONE.sub(fj).div(oneMinusF0);
        }
      } else {
        cj = !alpha.isNegative() ? alpha.div(f0) : alpha.neg().div(oneMinusF0);
      }

      if (cj.isZero()) continue;

      if (useLower) {
        cutRow.set(j, (cutRow.get(j) ?? Rational.ZERO).add(cj));
        rhs = rhs.add(cj.mul(lj.r));
        if (firstJust === undefined && this.lowerJust[j] !== undefined) firstJust = this.lowerJust[j];
      } else {
        cutRow.set(j, (cutRow.get(j) ?? Rational.ZERO).sub(cj));
        rhs = rhs.sub(cj.mul(uj.r));
        if (firstJust === undefined && this.upperJust[j] !== undefined) firstJust = this.upperJust[j];
      }
    }

    if (cutRow.size === 0) {
      const conflictSet = new Set<number>();
      for (const j of row.keys()) {
        if (this.lowerJust[j] !== undefined) conflictSet.add(this.lowerJust[j]!);
        if (this.upperJust[j] !== undefined) conflictSet.add(this.upperJust[j]!);
      }
      this.setImmediateConflict(Array.from(conflictSet));
      return true;
    }

    const slackName = `__eslack_gmi_${this.slackCount++}`;
    const slackIdx = this.ensureVar(slackName, true);
    this.rows.set(slackIdx, cutRow);

    let val = EXACT_ZERO;
    for (const [nbIdx, nbCoeff] of cutRow.entries()) {
      val = exactDeltaAdd(val, exactDeltaScale(this.values[nbIdx]!, nbCoeff));
    }
    this.values[slackIdx] = val;
    this.tightenLower(slackIdx, { r: rhs, d: Rational.ZERO, inf: 0 }, firstJust);
    return true;
  }

  public checkSatLia(maxNodes = 64, maxCuts = 12): ExactLraCheckResult {
    if (this.integerVars.size === 0) {
      return this.checkSat();
    }

    let nodesExplored = 0;
    const solveNode = (solver: ExactLraSimplexSolver, cutsRemaining: number): ExactLraCheckResult => {
      nodesExplored++;
      let lraRes = solver.checkSat();
      if (!lraRes.isSat || !lraRes.model) return lraRes;

      let cutsLeft = cutsRemaining;
      while (cutsLeft > 0) {
        let cutApplied = false;
        for (const intVar of solver.integerVars) {
          const idx = solver.varToIdx.get(intVar);
          if (idx === undefined || !solver.isBasic[idx]) continue;
          const val = lraRes.model?.get(intVar);
          if (!val || val.isInteger()) continue;
          if (solver.tryApplyExactGomoryCut(idx)) {
            cutApplied = true;
            cutsLeft--;
            break;
          }
        }
        if (!cutApplied) break;
        lraRes = solver.checkSat();
        if (!lraRes.isSat || !lraRes.model) return lraRes;
      }

      let branchVar: string | undefined;
      let branchVal: Rational | undefined;
      for (const intVar of solver.integerVars) {
        const val = lraRes.model.get(intVar);
        if (val && !val.isInteger()) {
          branchVar = intVar;
          branchVal = val;
          break;
        }
      }
      if (!branchVar || !branchVal) return lraRes;
      if (nodesExplored >= maxNodes) return { isSat: true, model: lraRes.model };

      const left = solver.clone();
      left.assertVarBound(branchVar, null, new Rational(branchVal.floor(), 1n, true), false, false);
      const leftRes = solveNode(left, Math.min(cutsLeft, 4));
      if (leftRes.isSat) return leftRes;

      const right = solver.clone();
      right.assertVarBound(branchVar, new Rational(branchVal.ceil(), 1n, true), null, false, false);
      const rightRes = solveNode(right, Math.min(cutsLeft, 4));
      if (rightRes.isSat) return rightRes;

      const combined = new Set<number>();
      for (const id of leftRes.conflictLitIds ?? []) combined.add(id);
      for (const id of rightRes.conflictLitIds ?? []) combined.add(id);
      return { isSat: false, conflictLitIds: Array.from(combined) };
    };

    return solveNode(this.clone(), maxCuts);
  }
}

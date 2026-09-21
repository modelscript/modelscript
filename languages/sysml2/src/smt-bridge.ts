// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { type ExtractedConstraint, extractSysML2Constraints } from "./constraint-extractor.js";

export const OCTAGON_INF = 0x3fffffff;

/**
 * Difference Bound Matrix (DBM) engine for SMT numeric theory solving.
 */
export class SmtOctagonDBM {
  private dim: number;
  private matrix: Int32Array;

  constructor(public readonly numVars: number) {
    this.dim = numVars * 2;
    this.matrix = new Int32Array(this.dim * this.dim);
    this.reset();
  }

  reset(): void {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        this.matrix[i * dim + j] = i === j ? 0 : OCTAGON_INF;
      }
    }
  }

  setBound(i: number, j: number, bound: number): void {
    const dim = this.dim;
    if (i >= dim || j >= dim) return;
    const current = this.matrix[i * dim + j];
    if (bound < current) {
      this.matrix[i * dim + j] = bound;
    }
  }

  close(): void {
    const dim = this.dim;
    for (let k = 0; k < dim; k++) {
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          const ik = this.matrix[i * dim + k];
          const kj = this.matrix[k * dim + j];
          if (ik !== OCTAGON_INF && kj !== OCTAGON_INF) {
            const newBound = ik + kj;
            if (newBound < this.matrix[i * dim + j]) {
              this.matrix[i * dim + j] = newBound;
            }
          }
        }
      }
    }
  }

  assumeDiff(var1: number, var2: number, maxDiff: number): void {
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    this.setBound(p1, p2, maxDiff);
    this.setBound(p2 + 1, p1 + 1, maxDiff);
    this.close();
  }

  checkDiff(var1: number, var2: number, limit: number): boolean {
    const dim = this.dim;
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    if (p1 >= dim || p2 >= dim) return true;
    return this.matrix[p1 * dim + p2] <= limit;
  }

  assumeInterval(varIdx: number, lower: number, upper: number): void {
    const p = varIdx * 2;
    if (upper < OCTAGON_INF / 2) {
      this.setBound(p, p + 1, upper * 2);
    }
    if (lower > -OCTAGON_INF / 2) {
      this.setBound(p + 1, p, -lower * 2);
    }
    this.close();
  }

  getUpperBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return OCTAGON_INF;
    const raw = this.matrix[p * dim + (p + 1)];
    return raw >= OCTAGON_INF ? OCTAGON_INF : Math.floor(raw / 2);
  }

  getLowerBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return -OCTAGON_INF;
    const raw = this.matrix[(p + 1) * dim + p];
    return raw >= OCTAGON_INF ? -OCTAGON_INF : Math.ceil(-raw / 2);
  }

  hasNegativeCycle(): boolean {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      if (this.matrix[i * dim + i] < 0) return true;
    }
    return false;
  }
}

/**
 * Result of SMT requirement consistency verification.
 */
export interface SMTRequirementCheckResult {
  isConsistent: boolean;
  conflictingRequirements: string[];
  violatedConstraints: {
    expression: string;
    requirementName?: string;
    reason: string;
  }[];
}

/**
 * Verifies consistency of a set of SysML v2 extracted constraints.
 * Encodes numeric bounds and difference constraints into an Octagon DBM
 * to detect contradictory intervals, impossible budgets, or cycle violations.
 */
export function verifyConstraintSet(constraints: ExtractedConstraint[]): SMTRequirementCheckResult {
  const varMap = new Map<string, number>();
  let nextVarId = 0;
  const getVarId = (name: string): number => {
    let id = varMap.get(name);
    if (id === undefined) {
      id = nextVarId++;
      varMap.set(name, id);
    }
    return id;
  };

  // Collect all unique variable names
  for (const c of constraints) {
    getVarId(c.lhs);
    // If difference constraint: e.g. "x - y <= 5"
    const diffMatch = c.lhs.match(/^([a-zA-Z0-9_.]+)\s*-\s*([a-zA-Z0-9_.]+)$/);
    if (diffMatch) {
      getVarId(diffMatch[1]);
      getVarId(diffMatch[2]);
    }
  }

  const numVars = Math.max(nextVarId, 1);
  const dbm = new SmtOctagonDBM(numVars);

  const conflictingReqs = new Set<string>();
  const violatedConstraints: { expression: string; requirementName?: string; reason: string }[] = [];

  // Ingest each constraint incrementally to isolate conflict causes
  for (const c of constraints) {
    if (typeof c.rhs !== "number") continue;

    const rhs = c.rhs;
    const diffMatch = c.lhs.match(/^([a-zA-Z0-9_.]+)\s*-\s*([a-zA-Z0-9_.]+)$/);

    if (diffMatch) {
      const v1 = getVarId(diffMatch[1]);
      const v2 = getVarId(diffMatch[2]);
      if (c.operator === "<=" || c.operator === "<") {
        dbm.assumeDiff(v1, v2, Math.floor(rhs));
      } else if (c.operator === ">=" || c.operator === ">") {
        dbm.assumeDiff(v2, v1, Math.floor(-rhs));
      }
    } else {
      const v = getVarId(c.lhs);
      const currentLower = dbm.getLowerBound(v);
      const currentUpper = dbm.getUpperBound(v);

      if (c.operator === "<=" || c.operator === "<") {
        dbm.assumeInterval(v, currentLower, Math.floor(rhs));
      } else if (c.operator === ">=" || c.operator === ">") {
        dbm.assumeInterval(v, Math.ceil(rhs), currentUpper);
      } else if (c.operator === "==") {
        dbm.assumeInterval(v, Math.round(rhs), Math.round(rhs));
      }
    }

    if (dbm.hasNegativeCycle()) {
      if (c.requirementName) {
        conflictingReqs.add(c.requirementName);
      }
      violatedConstraints.push({
        expression: c.expression,
        requirementName: c.requirementName,
        reason: `Contradiction with prior bound for variable '${c.lhs}' (evaluated bound: ${rhs})`,
      });
      break;
    }
  }

  // If a contradiction was detected, find all participating requirements
  if (violatedConstraints.length > 0) {
    for (const c of constraints) {
      if (c.requirementName) conflictingReqs.add(c.requirementName);
    }
  }

  return {
    isConsistent: violatedConstraints.length === 0,
    conflictingRequirements: Array.from(conflictingReqs),
    violatedConstraints,
  };
}

/**
 * Validates the requirement consistency for a package or analysis scope via QueryDB.
 */
export function checkRequirementConsistency(db: QueryDB, scopeFilter?: string): SMTRequirementCheckResult {
  const constraints = extractSysML2Constraints(db, scopeFilter);
  if (!constraints || constraints.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }
  return verifyConstraintSet(constraints);
}

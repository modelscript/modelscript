// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed Optimization / Math Programming / OCP Facet backed directly by WASM `DaeBuilder`.
 */

import {
  type ConeConstraintSpec,
  ConstraintKind,
  type ConstraintSpec,
  DaeObjectiveSense,
  type FacetHost,
  FLAG_OBJ_LAGRANGE,
  FLAG_OBJ_MAYER,
  type ObjectiveSpec,
  WASM_NULL_ID,
} from "../problem_types.js";

export class OptimizationFacet {
  constructor(private readonly host: FacetHost) {}

  get objectiveCount(): number {
    return this.host.exports.dae_opt_getObjectiveCount(this.host.ptr) >>> 0;
  }

  get constraintCount(): number {
    return this.host.exports.dae_opt_getConstraintCount(this.host.ptr) >>> 0;
  }

  get coneCount(): number {
    return this.host.exports.dae_opt_getConeCount(this.host.ptr) >>> 0;
  }

  addObjective(
    mayerExprId: number,
    lagrangeExprId: number = -1,
    sense: DaeObjectiveSense = DaeObjectiveSense.Minimize,
    flags?: number,
  ): number {
    const mId = mayerExprId >= 0 ? mayerExprId >>> 0 : WASM_NULL_ID;
    const lId = lagrangeExprId >= 0 ? lagrangeExprId >>> 0 : WASM_NULL_ID;
    const autoFlags =
      flags ?? (mId !== WASM_NULL_ID ? FLAG_OBJ_MAYER : 0) | (lId !== WASM_NULL_ID ? FLAG_OBJ_LAGRANGE : 0);
    return this.host.exports.dae_opt_addObjective(this.host.ptr, mId, lId, sense, autoFlags) >>> 0;
  }

  addConstraint(exprId: number, lb: number, ub: number, kind: ConstraintKind = ConstraintKind.Algebraic): number {
    return this.host.exports.dae_opt_addConstraint(this.host.ptr, exprId >>> 0, lb, ub, kind) >>> 0;
  }

  addEqualityConstraint(
    exprId: number,
    rhsValue: number = 0.0,
    kind: ConstraintKind = ConstraintKind.Algebraic,
  ): number {
    return this.addConstraint(exprId, rhsValue, rhsValue, kind);
  }

  addInequalityConstraint(
    exprId: number,
    ub: number,
    lb: number = -Infinity,
    kind: ConstraintKind = ConstraintKind.Algebraic,
  ): number {
    return this.addConstraint(exprId, lb, ub, kind);
  }

  addConeConstraint(kind: ConstraintKind, memberExprIds: readonly number[], dim?: number): number {
    const cIdx = this.host.exports.dae_opt_addCone(this.host.ptr, kind, (dim ?? memberExprIds.length) >>> 0) >>> 0;
    for (let i = 0; i < memberExprIds.length; i++) {
      this.host.exports.dae_opt_addConeMember(this.host.ptr, cIdx, memberExprIds[i]! >>> 0);
    }
    return cIdx;
  }

  addComplementarity(exprA: number, exprB: number): number {
    return this.addConeConstraint(ConstraintKind.Complementarity, [exprA, exprB], 2);
  }

  getObjectives(): ObjectiveSpec[] {
    const n = this.objectiveCount;
    const out: ObjectiveSpec[] = [];
    for (let i = 0; i < n; i++) {
      const m = this.host.exports.dae_opt_getObjectiveMayer(this.host.ptr, i) >>> 0;
      const l = this.host.exports.dae_opt_getObjectiveLagrange(this.host.ptr, i) >>> 0;
      out.push({
        index: i,
        mayerExprId: m === WASM_NULL_ID ? -1 : m,
        lagrangeExprId: l === WASM_NULL_ID ? -1 : l,
        sense: this.host.exports.dae_opt_getObjectiveSense(this.host.ptr, i) as DaeObjectiveSense,
        flags: this.host.exports.dae_opt_getObjectiveFlags(this.host.ptr, i) as number,
      });
    }
    return out;
  }

  getConstraints(): ConstraintSpec[] {
    const n = this.constraintCount;
    const out: ConstraintSpec[] = [];
    for (let i = 0; i < n; i++) {
      const e = this.host.exports.dae_opt_getConstraintExpr(this.host.ptr, i) >>> 0;
      out.push({
        index: i,
        exprId: e === WASM_NULL_ID ? -1 : e,
        lb: this.host.exports.dae_opt_getConstraintLb(this.host.ptr, i) as number,
        ub: this.host.exports.dae_opt_getConstraintUb(this.host.ptr, i) as number,
        kind: this.host.exports.dae_opt_getConstraintKind(this.host.ptr, i) as ConstraintKind,
      });
    }
    return out;
  }

  getCones(): ConeConstraintSpec[] {
    const n = this.coneCount;
    const out: ConeConstraintSpec[] = [];
    for (let i = 0; i < n; i++) {
      const start = this.host.exports.dae_opt_getConeMemberStart(this.host.ptr, i) >>> 0;
      const count = this.host.exports.dae_opt_getConeMemberCount(this.host.ptr, i) >>> 0;
      const members: number[] = [];
      for (let m = 0; m < count; m++) {
        members.push(this.host.exports.dae_opt_getConeMember(this.host.ptr, start + m) >>> 0);
      }
      out.push({
        index: i,
        kind: this.host.exports.dae_opt_getConeKind(this.host.ptr, i) as ConstraintKind,
        dim: this.host.exports.dae_opt_getConeDim(this.host.ptr, i) >>> 0,
        memberExprIds: members,
      });
    }
    return out;
  }

  evalObjectives(values: ArrayLike<number>, normalizeMinimize: boolean = false): number[] {
    const n = this.objectiveCount;
    if (n === 0) return [];
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const outPtr = ex.atomicChunkAlloc(n * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      ex.dae_opt_evalObjectives(this.host.ptr, valsPtr, outPtr, normalizeMinimize ? 1 : 0);
      return Array.from(new Float64Array(ex.memory.buffer, outPtr, n));
    } finally {
      ex.atomicChunkFree(outPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalConstraints(values: ArrayLike<number>): number[] {
    const n = this.constraintCount;
    if (n === 0) return [];
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const outPtr = ex.atomicChunkAlloc(n * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      ex.dae_opt_evalConstraints(this.host.ptr, valsPtr, outPtr);
      return Array.from(new Float64Array(ex.memory.buffer, outPtr, n));
    } finally {
      ex.atomicChunkFree(outPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  maxConstraintViolation(values: ArrayLike<number>): number {
    if (this.constraintCount === 0) return 0;
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      return ex.dae_opt_maxConstraintViolation(this.host.ptr, valsPtr) as number;
    } finally {
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalObjectiveGradient(
    objIdx: number,
    values: ArrayLike<number>,
    varIds: readonly number[],
    normalizeMinimize: boolean = false,
  ): { value: number; gradient: number[] } {
    const nVars = varIds.length;
    if (nVars === 0) return { value: 0, gradient: [] };
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const idsPtr = ex.atomicChunkAlloc(nVars * 4);
    const gradPtr = ex.atomicChunkAlloc(nVars * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      const u32 = new Uint32Array(ex.memory.buffer, idsPtr, nVars);
      for (let i = 0; i < nVars; i++) u32[i] = varIds[i]! >>> 0;
      const value = ex.dae_opt_evalObjectiveGradient(
        this.host.ptr,
        objIdx >>> 0,
        valsPtr,
        idsPtr,
        nVars >>> 0,
        gradPtr,
        normalizeMinimize ? 1 : 0,
      ) as number;
      const gradient = Array.from(new Float64Array(ex.memory.buffer, gradPtr, nVars));
      return { value, gradient };
    } finally {
      ex.atomicChunkFree(gradPtr);
      ex.atomicChunkFree(idsPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalConstraintJacobian(values: ArrayLike<number>, varIds: readonly number[]): number[][] {
    const m = this.constraintCount;
    const nVars = varIds.length;
    if (m === 0 || nVars === 0) return [];
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const idsPtr = ex.atomicChunkAlloc(nVars * 4);
    const jacPtr = ex.atomicChunkAlloc(m * nVars * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      const u32 = new Uint32Array(ex.memory.buffer, idsPtr, nVars);
      for (let i = 0; i < nVars; i++) u32[i] = varIds[i]! >>> 0;
      ex.dae_opt_evalConstraintJacobianDense(this.host.ptr, valsPtr, idsPtr, nVars >>> 0, jacPtr);
      const flat = new Float64Array(ex.memory.buffer, jacPtr, m * nVars);
      const rows: number[][] = [];
      for (let i = 0; i < m; i++) {
        rows.push(Array.from(flat.subarray(i * nVars, (i + 1) * nVars)));
      }
      return rows;
    } finally {
      ex.atomicChunkFree(jacPtr);
      ex.atomicChunkFree(idsPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }

  evalConstraintJacobianSparse(
    values: ArrayLike<number>,
    varIds: readonly number[],
    tol: number = 0.0,
  ): { rows: number[]; cols: number[]; values: number[]; nnz: number } {
    const m = this.constraintCount;
    const nVars = varIds.length;
    if (m === 0 || nVars === 0) return { rows: [], cols: [], values: [], nnz: 0 };
    const maxNnz = m * nVars;
    const ex = this.host.exports;
    const vc = Math.max(this.host.varCount, values.length);
    const valsPtr = ex.atomicChunkAlloc(vc * 8);
    const idsPtr = ex.atomicChunkAlloc(nVars * 4);
    const rowsPtr = ex.atomicChunkAlloc(maxNnz * 4);
    const colsPtr = ex.atomicChunkAlloc(maxNnz * 4);
    const outValsPtr = ex.atomicChunkAlloc(maxNnz * 8);
    try {
      const f64 = new Float64Array(ex.memory.buffer, valsPtr, vc);
      for (let i = 0; i < values.length; i++) f64[i] = values[i]!;
      const u32 = new Uint32Array(ex.memory.buffer, idsPtr, nVars);
      for (let i = 0; i < nVars; i++) u32[i] = varIds[i]! >>> 0;
      const nnz =
        ex.dae_opt_evalConstraintJacobianSparse(
          this.host.ptr,
          valsPtr,
          idsPtr,
          nVars >>> 0,
          tol,
          rowsPtr,
          colsPtr,
          outValsPtr,
          maxNnz >>> 0,
        ) >>> 0;
      return {
        rows: Array.from(new Uint32Array(ex.memory.buffer, rowsPtr, nnz)),
        cols: Array.from(new Uint32Array(ex.memory.buffer, colsPtr, nnz)),
        values: Array.from(new Float64Array(ex.memory.buffer, outValsPtr, nnz)),
        nnz,
      };
    } finally {
      ex.atomicChunkFree(outValsPtr);
      ex.atomicChunkFree(colsPtr);
      ex.atomicChunkFree(rowsPtr);
      ex.atomicChunkFree(idsPtr);
      ex.atomicChunkFree(valsPtr);
    }
  }
}

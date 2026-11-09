// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Sparse & Dense Linear Algebra Solver Bridge.
 *
 * Implements Gilbert-Peierls left-looking Sparse LU factorization with partial pivoting
 * for Compressed Column Storage (CCS) matrices, with automatic fallback to SIMD dense LU.
 * Delegates to canonical @modelscript/runtime sparse linear algebra implementation.
 */

import {
  bicgstab,
  ccsMatVec,
  denseMatVec,
  gmres,
  ilu0Factor,
  ilu0Preconditioner,
  ilu0Solve,
  jacobiPreconditioner,
  jfnkSolve,
  denseToCCS as runtimeDenseToCCS,
  factorizeLinearMatrix as runtimeFactorizeLinearMatrix,
  flatToCCS as runtimeFlatToCCS,
  solveLinearSystemSparse as runtimeSolveLinearSystemSparse,
  sparseLuFactor as runtimeSparseLuFactor,
  sparseLuSolve as runtimeSparseLuSolve,
  type FactorizedLinearSolver,
  type ILU0Factorization,
  type JFNKOptions,
  type JFNKResult,
  type KrylovOptions,
  type KrylovResult,
  type MatVecOperator,
  type Preconditioner,
  type SparseCCSMatrix,
  type SparseLU,
} from "@modelscript/runtime";

export type CCSMatrix = SparseCCSMatrix;
export type {
  FactorizedLinearSolver,
  ILU0Factorization,
  JFNKOptions,
  JFNKResult,
  KrylovOptions,
  KrylovResult,
  MatVecOperator,
  Preconditioner,
  SparseCCSMatrix,
  SparseLU,
};

export const denseToCCS = runtimeDenseToCCS;
export const flatToCCS = runtimeFlatToCCS;
export const sparseLuFactor = (A: SparseCCSMatrix): SparseLU => {
  const lu = runtimeSparseLuFactor(A, true);
  if (!lu) throw new Error("Singular matrix encountered during sparse LU factorization");
  return lu;
};
export const sparseLuSolve = runtimeSparseLuSolve;
export const factorizeLinearMatrix = runtimeFactorizeLinearMatrix;
export const solveLinearSystemSparse = runtimeSolveLinearSystemSparse;
export {
  bicgstab,
  ccsMatVec,
  denseMatVec,
  gmres,
  ilu0Factor,
  ilu0Preconditioner,
  ilu0Solve,
  jacobiPreconditioner,
  jfnkSolve,
};

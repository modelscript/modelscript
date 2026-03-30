// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified CAS (Computer Algebra System) API.
 *
 * Re-exports all symbolic algebra modules for convenient access:
 *   - E-Graph equality saturation engine
 *   - Polynomial expansion and normalization
 *   - Polynomial factoring
 *   - Trigonometric simplification
 *   - Symbolic equation solving (degree 1–4)
 *   - Symbolic linear algebra
 *   - Symbolic integration and calculus
 *   - Gröbner basis algorithms
 */

// E-Graph engine
export {
  AstDepth,
  AstSize,
  BackoffScheduler,
  ConstantAnalysis,
  DEFAULT_RULES,
  EGraph,
  ProofLog,
  SignAnalysis,
  SimpleScheduler,
  conditionalRewrite,
  egraphSimplify,
  multiRewrite,
  rewrite,
  runEqualitySaturation,
  toDot,
} from "./egraph.js";
export type {
  AnalysisData,
  CostFunction,
  EClassId,
  EGraphAnalysis,
  ENode,
  ExplanationStep,
  RewriteRule,
  RunReport,
  RunnerConfig,
  Sign,
  StopReason,
} from "./egraph.js";

// Algebraic engine
export { collectTerms, expandExpr, getLiteralValue, isLiteral, normalizeExpr } from "./expand.js";
export { factorOutCommon, factorQuadratic, rationalRoots } from "./factor.js";
export { TRIG_EXPAND_RULES, TRIG_RULES, trigExpand, trigSimplify } from "./trigsimp.js";

// Equation solver
export { solveForVariable } from "./solve.js";

// Linear algebra
export { determinant, gaussianElimination, solveLinearSystem } from "./linalg.js";
export type { SymMatrix, SymVector } from "./linalg.js";

// Calculus
export { integrateExpr, limit, nthDerivative, taylorSeries } from "./integrate.js";

// Gröbner basis
export { Polynomial, Term, TermOrder, computeGroebnerBasis, sPolynomial } from "./groebner.js";

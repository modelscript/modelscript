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

// Modelica CAS bindings
export { CAS_FUNCTIONS, MODELSCRIPT_CAS_PACKAGE, evaluateCASFunction, isCASFunction } from "./cas-bindings.js";

// N-Dimensional Tensor AD
export {
  SparsityPattern,
  TensorNode,
  TensorTape,
  broadcastShape,
  matmulShape,
  shapeSize,
  shapesEqual,
} from "./tensor.js";
export type { TensorOpType, TensorShape } from "./tensor.js";

// Tensor E-Graph
export {
  TENSOR_RULES,
  emitFusedKernelC,
  identifyFusableChains,
  tensorEgraphSimplify,
  tensorNodeCost,
} from "./egraph-tensor.js";
export type { FusedKernel } from "./egraph-tensor.js";

// Gaussian Uncertainty Propagation
export {
  GaussianTuple,
  emitGaussianForwardC,
  evaluateTapeGaussian,
  gaAdd,
  gaCos,
  gaDiv,
  gaExp,
  gaLog,
  gaMul,
  gaNeg,
  gaSin,
  gaSqrt,
  gaSub,
  gaTan,
  unscentedTransform,
} from "../gaussian.js";

// Monte Carlo Engine
export {
  Xoshiro256pp,
  distributionMean,
  distributionVariance,
  isGaussian,
  latinHypercubeSample,
  normalQuantile,
  runMonteCarloSimulation,
  runMonteCarloTape,
  sampleDistribution,
} from "../monte-carlo.js";
export type {
  Distribution,
  MonteCarloOptions,
  MonteCarloResult,
  RandomVariable,
  ScalarMCResult,
  VariableStatistics,
} from "../monte-carlo.js";

// Stochastic Optimization
export {
  ProgressiveHedging,
  SampleAverageApproximation,
  computeVSSandEVPI,
  generateScenarios,
} from "../stochastic-optimizer.js";
export type {
  MultiStageStochasticProblem,
  Scenario,
  StageDefinition,
  StochasticProblem,
  StochasticResult,
} from "../stochastic-optimizer.js";

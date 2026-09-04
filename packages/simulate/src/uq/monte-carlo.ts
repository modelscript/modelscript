// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Monte Carlo / Uncertainty Quantification for the Arena Simulation Pipeline.
 * Backed by the high-performance WASM Monte Carlo runtime engine.
 */

export {
  SobolSequence,
  WasmMonteCarloEngine,
  Xoshiro256pp,
  aggregateResults,
  aggregateSimulationResults,
  betaQuantile,
  distributionMean,
  distributionVariance,
  isGaussian,
  latinHypercubeSample,
  lgamma,
  normalQuantile,
  registerArenaSimulator,
  regularizedBeta,
  runMonteCarloArena,
  runMonteCarloArenaAsync,
  runMonteCarloSimulation,
  runMonteCarloTape,
  runSensitivityAnalysisArena,
  sampleDistribution,
  sobolSample,
  type ArenaMonteCarloOptions,
  type ArenaSimulatorFn,
  type AsyncArenaSimulatorFn,
  type Distribution,
  type MonteCarloOptions,
  type MonteCarloResult,
  type RandomVariable,
  type ScalarMCResult,
  type SensitivityResult,
  type VariableStatistics,
} from "@modelscript/runtime/wasm_monte_carlo.js";

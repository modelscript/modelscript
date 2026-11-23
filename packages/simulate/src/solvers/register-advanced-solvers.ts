// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Unified `@modelscript/solve` Registration for Advanced Algorithm Domains.
 *
 * Registers Phases 1–8 algorithms into `@modelscript/solve` so any language frontend, CLI command,
 * or MCP tool can invoke them uniformly via `solve(problem, algorithm)`.
 */

import {
  analyzeIdentifiability,
  dinicMaxFlow,
  minCostMaxFlow,
  partitionGraphKWay,
  solveRcpsp,
} from "@modelscript/runtime";
import {
  registerSolver,
  type FbaAlgorithm,
  type GameEquilibriumAlgorithm,
  type GraphFlowAlgorithm,
  type GraphPartitionAlgorithm,
  type IdentifiabilityAlgorithm,
  type MorAlgorithm,
  type MotionPlanningAlgorithm,
  type ProbabilisticInferenceAlgorithm,
  type SchedulingAlgorithm,
  type SpectralAlgorithm,
  type StochasticKineticsAlgorithm,
  type SysIdAlgorithm,
  type TopologyOptAlgorithm,
  type UnifiedFbaProblem,
  type UnifiedGameEquilibriumProblem,
  type UnifiedGraphFlowProblem,
  type UnifiedGraphPartitionProblem,
  type UnifiedIdentifiabilityProblem,
  type UnifiedMorProblem,
  type UnifiedMotionPlanningProblem,
  type UnifiedProbabilisticInferenceProblem,
  type UnifiedSchedulingProblem,
  type UnifiedSpectralProblem,
  type UnifiedStochasticKineticsProblem,
  type UnifiedSysIdProblem,
  type UnifiedTopologyOptProblem,
} from "@modelscript/solve";
import { planRrtStar } from "../control/trajectory-opt.js";
import { welchPsd } from "../dsp/spectral.js";
import { runSimpTopologyOptimization } from "../fea/topology-opt.js";
import { solveBimatrixNash } from "../optimizer/solvers/game-equilibria.js";
import { balancedTruncation } from "../surrogates/system-mor.js";
import { computeDmd } from "../sysid/subspace-id.js";
import { vectorFit } from "../sysid/vector-fitting.js";
import { runHmcSampler } from "../uq/hmc-smc.js";
import { runGillespieSsa, solveFluxBalanceAnalysis } from "./bio/systems-biology.js";

let _registered = false;

export function registerAdvancedSolvers(): void {
  if (_registered) return;
  _registered = true;

  registerSolver<UnifiedSpectralProblem, SpectralAlgorithm>(
    {
      problemKind: "spectral",
      algorithmName: "WelchPSD",
      isDefault: true,
      solve: (prob) => welchPsd(prob.signal, prob.sampleRateHz),
    },
    { problemKind: "spectral", name: "WelchPSD" },
  );

  registerSolver<UnifiedSysIdProblem, SysIdAlgorithm>(
    {
      problemKind: "sysid",
      algorithmName: "VectorFitting",
      isDefault: true,
      solve: (prob, alg) => {
        if (prob.mode === "frequency" && prob.frequenciesHz && prob.responseReal && prob.responseImag) {
          return vectorFit(prob.frequenciesHz, prob.responseReal, prob.responseImag, {
            order: prob.order,
            enforcePassivity: alg?.enforcePassivity,
          });
        }
        return computeDmd(prob.outputs ?? [], prob.order);
      },
    },
    { problemKind: "sysid", name: "VectorFitting", enforcePassivity: true },
  );

  registerSolver<UnifiedMorProblem, MorAlgorithm>(
    {
      problemKind: "mor",
      algorithmName: "BalancedTruncation",
      isDefault: true,
      solve: (prob) => balancedTruncation(prob.A, prob.B, prob.C, prob.D, prob.targetOrder),
    },
    { problemKind: "mor", name: "BalancedTruncation" },
  );

  registerSolver<UnifiedIdentifiabilityProblem, IdentifiabilityAlgorithm>(
    {
      problemKind: "identifiability",
      algorithmName: "ObservabilityRank",
      isDefault: true,
      solve: (prob) =>
        analyzeIdentifiability({
          f: (t, x, p) => prob.fn.f(t, x, p as never),
          outputFn: prob.outputFn,
          x0: prob.u0,
          p0: prob.p0,
          paramNames: prob.paramNames,
        }),
    },
    { problemKind: "identifiability", name: "ObservabilityRank" },
  );

  registerSolver<UnifiedProbabilisticInferenceProblem, ProbabilisticInferenceAlgorithm>(
    {
      problemKind: "probabilistic-inference",
      algorithmName: "HMC",
      isDefault: true,
      solve: (prob) =>
        runHmcSampler(prob.logDensity, prob.initialTheta, prob.gradLogDensity, {
          numSamples: prob.numSamples,
          warmup: prob.warmup,
          seed: prob.seed,
        }),
    },
    { problemKind: "probabilistic-inference", name: "HMC" },
  );

  registerSolver<UnifiedMotionPlanningProblem, MotionPlanningAlgorithm>(
    {
      problemKind: "motion-planning",
      algorithmName: "RRTStar",
      isDefault: true,
      solve: (prob, alg) =>
        planRrtStar(prob.start, prob.goal, prob.boundsMin, prob.boundsMax, prob.isCollisionFree, {
          maxIterations: alg?.maxIterations,
        }),
    },
    { problemKind: "motion-planning", name: "RRTStar" },
  );

  registerSolver<UnifiedGameEquilibriumProblem, GameEquilibriumAlgorithm>(
    {
      problemKind: "game-equilibrium",
      algorithmName: "NashLemkeHowson",
      isDefault: true,
      solve: (prob) => solveBimatrixNash(prob.payoffA, prob.payoffB),
    },
    { problemKind: "game-equilibrium", name: "NashLemkeHowson" },
  );

  registerSolver<UnifiedSchedulingProblem, SchedulingAlgorithm>(
    {
      problemKind: "scheduling",
      algorithmName: "RCPSP",
      isDefault: true,
      solve: (prob) => solveRcpsp(prob.tasks, prob.resourceCapacities),
    },
    { problemKind: "scheduling", name: "RCPSP" },
  );

  registerSolver<UnifiedGraphFlowProblem, GraphFlowAlgorithm>(
    {
      problemKind: "graph-flow",
      algorithmName: "DinicMaxFlow",
      isDefault: true,
      solve: (prob) => dinicMaxFlow(prob.numNodes, prob.edges, prob.source, prob.sink),
    },
    { problemKind: "graph-flow", name: "DinicMaxFlow" },
  );

  registerSolver<UnifiedGraphFlowProblem, GraphFlowAlgorithm>({
    problemKind: "graph-flow",
    algorithmName: "MinCostFlow",
    solve: (prob) => minCostMaxFlow(prob.numNodes, prob.edges, prob.source, prob.sink),
  });

  registerSolver<UnifiedGraphPartitionProblem, GraphPartitionAlgorithm>(
    {
      problemKind: "graph-partition",
      algorithmName: "MultilevelKWay",
      isDefault: true,
      solve: (prob) => partitionGraphKWay(prob.numNodes, prob.edges, prob.numPartitions),
    },
    { problemKind: "graph-partition", name: "MultilevelKWay" },
  );

  registerSolver<UnifiedTopologyOptProblem, TopologyOptAlgorithm>(
    {
      problemKind: "topology-opt",
      algorithmName: "SIMP",
      isDefault: true,
      solve: (prob) =>
        runSimpTopologyOptimization({
          nelx: prob.nelx,
          nely: prob.nely,
          volumeFraction: prob.volumeFraction,
          penalization: prob.penalization,
          rmin: prob.rmin,
        }),
    },
    { problemKind: "topology-opt", name: "SIMP" },
  );

  registerSolver<UnifiedStochasticKineticsProblem, StochasticKineticsAlgorithm>(
    {
      problemKind: "stochastic-kinetics",
      algorithmName: "GillespieDirect",
      isDefault: true,
      solve: (prob) =>
        runGillespieSsa(prob.initialCounts, prob.stoichiometry, prob.propensities, prob.tEnd, {
          seed: prob.seed,
        }),
    },
    { problemKind: "stochastic-kinetics", name: "GillespieDirect" },
  );

  registerSolver<UnifiedFbaProblem, FbaAlgorithm>(
    {
      problemKind: "fba",
      algorithmName: "SimplexFBA",
      isDefault: true,
      solve: (prob) => solveFluxBalanceAnalysis(prob.stoichiometry, prob.lowerBounds, prob.upperBounds, prob.objective),
    },
    { problemKind: "fba", name: "SimplexFBA" },
  );
}

registerAdvancedSolvers();

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Simulation-Based Requirement Falsification Engine.
 *
 * Implements automated adversarial falsification for cyber-physical and continuous
 * SysML v2 models using metaheuristic global optimization (Particle Swarm & Differential Evolution).
 *
 * Minimizes the trajectory robustness margin \rho(p, \phi):
 *   min_{p \in P} \rho(Simulate(p), \phi)
 *
 * If min \rho < 0, a concrete falsifying counterexample parameter set is found.
 */

import { type CanonicalTraceRecord, STLEvaluator, type STLFormula, TraceRecordNormalizer } from "@modelscript/runtime";

export interface ParameterRange {
  name: string;
  min: number;
  max: number;
}

export interface SimulationTrajectory {
  times: number[];
  signals: Record<string, number[]>;
}

export interface FalsificationOptions {
  parameters: ParameterRange[];
  formula: STLFormula;
  simulate?: (params: Record<string, number>) => Promise<SimulationTrajectory>;
  /**
   * Optional batched simulation function. Evaluates multiple parameter sets in a single invocation
   * (e.g., GPU-accelerated ODE batch, SUNDIALS parallel execution, or external worker pool).
   */
  simulateBatch?: (paramsList: Record<string, number>[]) => Promise<SimulationTrajectory[]>;
  maxGenerations?: number;
  populationSize?: number;
  seed?: number;
  /** Algorithm: 'de' (Differential Evolution, default) or 'cem' (Cross-Entropy Method). */
  algorithm?: "de" | "cem";
  /** Elite fraction for CEM (default 0.1 = top 10%). */
  eliteFraction?: number;
  /** Maximum number of concurrent simulations when using individual `simulate` (default: 1 = sequential). */
  concurrency?: number;
}

export interface FalsificationResult {
  isFalsified: boolean;
  minRobustness: number;
  counterexampleParams?: Record<string, number>;
  falsificationTime?: number;
  evaluationsCount: number;
  summary: string;
  traceRecord?: CanonicalTraceRecord;
}

export class RequirementFalsifier {
  /**
   * Evaluates a batch of parameter sets either using `simulateBatch` if provided,
   * or concurrently chunked `simulate` calls.
   */
  public static async evaluateBatch(
    paramsList: Record<string, number>[],
    options: FalsificationOptions,
  ): Promise<SimulationTrajectory[]> {
    if (options.simulateBatch) {
      return options.simulateBatch(paramsList);
    }
    if (!options.simulate) {
      throw new Error("Either simulate or simulateBatch must be provided in FalsificationOptions.");
    }
    const simulate = options.simulate;
    const concurrency = Math.max(1, options.concurrency ?? 1);
    if (concurrency === 1) {
      const results: SimulationTrajectory[] = [];
      for (const p of paramsList) {
        results.push(await simulate(p));
      }
      return results;
    }
    const results: SimulationTrajectory[] = new Array(paramsList.length);
    for (let i = 0; i < paramsList.length; i += concurrency) {
      const chunk = paramsList.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map((p) => simulate(p)));
      for (let j = 0; j < chunkResults.length; j++) {
        results[i + j] = chunkResults[j]!;
      }
    }
    return results;
  }

  /**
   * Searches for a parameter vector that violates the given temporal requirement.
   * Dispatches to Differential Evolution (default) or Cross-Entropy Method.
   */
  public static async falsify(options: FalsificationOptions): Promise<FalsificationResult> {
    if (options.algorithm === "cem") {
      return RequirementFalsifier.falsifyCEM(options);
    }
    return RequirementFalsifier.falsifyDE(options);
  }

  /**
   * Cross-Entropy Method (CEM) falsification.
   * Samples from a multivariate Gaussian, selects elite fraction, refits distribution.
   * More sample-efficient than DE for smooth robustness landscapes.
   */
  public static async falsifyCEM(options: FalsificationOptions): Promise<FalsificationResult> {
    const { parameters, formula } = options;
    const popSize = options.populationSize ?? 32;
    const maxGen = options.maxGenerations ?? 20;
    const eliteFrac = options.eliteFraction ?? 0.1;
    const eliteCount = Math.max(2, Math.floor(popSize * eliteFrac));

    let evalCount = 0;
    let bestParams: Record<string, number> | null = null;
    let minRobustness = Infinity;
    let falsificationTime: number | undefined = undefined;

    // Initialize Gaussian: mean = center of bounds, stddev = (max - min) / 4
    const means = parameters.map((p) => (p.min + p.max) / 2);
    const stds = parameters.map((p) => (p.max - p.min) / 4);

    const clamp = (val: number, min: number, max: number): number => Math.max(min, Math.min(max, val));

    const sampleGaussian = (mean: number, std: number): number => {
      // Box-Muller transform
      const u1 = Math.random();
      const u2 = Math.random();
      return mean + std * Math.sqrt(-2 * Math.log(u1 || 1e-15)) * Math.cos(2 * Math.PI * u2);
    };

    for (let gen = 0; gen < maxGen; gen++) {
      // 1. Generate entire batch of candidate vectors
      const candidateVecs: number[][] = [];
      const candidateParams: Record<string, number>[] = [];

      for (let i = 0; i < popSize; i++) {
        const vec = parameters.map((p, j) => clamp(sampleGaussian(means[j]!, stds[j]!), p.min, p.max));
        const pRec: Record<string, number> = {};
        for (let j = 0; j < parameters.length; j++) {
          pRec[parameters[j]!.name] = vec[j]!;
        }
        candidateVecs.push(vec);
        candidateParams.push(pRec);
      }

      // 2. Evaluate batch in parallel / vector kernel
      const trajs = await RequirementFalsifier.evaluateBatch(candidateParams, options);
      evalCount += candidateParams.length;

      const samples: { vec: number[]; params: Record<string, number>; robustness: number }[] = [];

      for (let i = 0; i < popSize; i++) {
        const traj = trajs[i]!;
        const evalRes = STLEvaluator.evaluate(formula, traj.times, traj.signals);
        samples.push({ vec: candidateVecs[i]!, params: candidateParams[i]!, robustness: evalRes.robustness });

        if (evalRes.robustness < minRobustness) {
          minRobustness = evalRes.robustness;
          bestParams = candidateParams[i]!;
          falsificationTime = evalRes.violationTime;
        }

        if (evalRes.robustness < 0) {
          return {
            isFalsified: true,
            minRobustness,
            counterexampleParams: bestParams || candidateParams[i]!,
            falsificationTime,
            evaluationsCount: evalCount,
            summary: `Requirement falsified via CEM with margin ${minRobustness.toFixed(4)} at t=${(
              falsificationTime ?? 0
            ).toFixed(4)}s after ${evalCount} simulation runs.`,
          };
        }
      }

      // 3. Select elite samples (lowest robustness = closest to falsification)
      samples.sort((a, b) => a.robustness - b.robustness);
      const elites = samples.slice(0, eliteCount);

      // Refit Gaussian to elites
      for (let j = 0; j < parameters.length; j++) {
        let sum = 0;
        for (const e of elites) sum += e.vec[j]!;
        means[j] = sum / eliteCount;

        let varSum = 0;
        for (const e of elites) varSum += (e.vec[j]! - means[j]!) ** 2;
        stds[j] = Math.max(1e-8, Math.sqrt(varSum / eliteCount));
      }
    }

    return {
      isFalsified: false,
      minRobustness,
      counterexampleParams: bestParams || undefined,
      falsificationTime,
      evaluationsCount: evalCount,
      summary: `CEM: requirement held across ${evalCount} adversarial evaluations. Minimum observed robustness margin: +${minRobustness.toFixed(4)}.`,
    };
  }

  /**
   * Differential Evolution (rand/1/bin) falsification.
   */
  public static async falsifyDE(options: FalsificationOptions): Promise<FalsificationResult> {
    const { parameters, formula } = options;
    const popSize = options.populationSize ?? 16;
    const maxGen = options.maxGenerations ?? 15;

    let evalCount = 0;
    let bestParams: Record<string, number> | null = null;
    let minRobustness = Infinity;
    let falsificationTime: number | undefined = undefined;

    // Helper to generate a random parameter vector within bounds
    const randomVector = (): number[] => {
      return parameters.map((p) => p.min + Math.random() * (p.max - p.min));
    };

    const vectorToRecord = (vec: number[]): Record<string, number> => {
      const rec: Record<string, number> = {};
      for (let i = 0; i < parameters.length; i++) {
        rec[parameters[i]!.name] = vec[i]!;
      }
      return rec;
    };

    const clamp = (val: number, min: number, max: number): number => {
      return Math.max(min, Math.min(max, val));
    };

    // Initialize population
    let population: number[][] = Array.from({ length: popSize }, () => randomVector());
    let fitnesses: number[] = new Array<number>(popSize).fill(Infinity);

    // Initial batch evaluation
    const initParams = population.map(vectorToRecord);
    const initTrajs = await RequirementFalsifier.evaluateBatch(initParams, options);
    evalCount += popSize;

    for (let i = 0; i < popSize; i++) {
      const pRec = initParams[i]!;
      const traj = initTrajs[i]!;
      const evalRes = STLEvaluator.evaluate(formula, traj.times, traj.signals);
      fitnesses[i] = evalRes.robustness;

      if (evalRes.robustness < minRobustness) {
        minRobustness = evalRes.robustness;
        bestParams = pRec;
        falsificationTime = evalRes.violationTime;
      }

      // Early exit if counterexample found
      if (evalRes.robustness < 0) {
        return {
          isFalsified: true,
          minRobustness,
          counterexampleParams: bestParams || pRec,
          falsificationTime,
          evaluationsCount: evalCount,
          summary: `Requirement falsified with margin ${minRobustness.toFixed(4)} at t=${(
            falsificationTime ?? 0
          ).toFixed(4)}s after ${evalCount} simulation runs.`,
        };
      }
    }

    // Differential Evolution loop (rand/1/bin)
    const F = 0.7; // Mutation factor
    const CR = 0.8; // Crossover rate

    for (let gen = 0; gen < maxGen; gen++) {
      const trialVectors: number[][] = [];
      for (let i = 0; i < popSize; i++) {
        // Pick 3 distinct individuals distinct from i
        const idxs: number[] = [];
        while (idxs.length < 3) {
          const r = Math.floor(Math.random() * popSize);
          if (r !== i && !idxs.includes(r)) idxs.push(r);
        }

        const [r1, r2, r3] = idxs;
        const x1 = population[r1!]!;
        const x2 = population[r2!]!;
        const x3 = population[r3!]!;
        const target = population[i]!;

        // Mutant vector
        const mutant: number[] = [];
        const R = Math.floor(Math.random() * parameters.length);

        for (let j = 0; j < parameters.length; j++) {
          if (Math.random() < CR || j === R) {
            const v = x1[j]! + F * (x2[j]! - x3[j]!);
            mutant.push(clamp(v, parameters[j]!.min, parameters[j]!.max));
          } else {
            mutant.push(target[j]!);
          }
        }
        trialVectors.push(mutant);
      }

      // Batch evaluate mutants
      const trialParams = trialVectors.map(vectorToRecord);
      const trialTrajs = await RequirementFalsifier.evaluateBatch(trialParams, options);
      evalCount += popSize;

      for (let i = 0; i < popSize; i++) {
        const mutant = trialVectors[i]!;
        const mRec = trialParams[i]!;
        const traj = trialTrajs[i]!;
        const evalRes = STLEvaluator.evaluate(formula, traj.times, traj.signals);
        const mFit = evalRes.robustness;

        // Selection
        if (mFit < fitnesses[i]!) {
          population[i] = mutant;
          fitnesses[i] = mFit;
        }

        if (mFit < minRobustness) {
          minRobustness = mFit;
          bestParams = mRec;
          falsificationTime = evalRes.violationTime;
        }

        if (mFit < 0) {
          const traceRecord = TraceRecordNormalizer.fromFalsificationTrajectory({
            times: traj.times,
            signals: traj.signals,
            parameters: bestParams || mRec,
            minRobustness,
            violatingTimeIndex: (evalRes as any).violationIndex ?? (evalRes as any).violationTime,
          });

          return {
            isFalsified: true,
            minRobustness,
            counterexampleParams: bestParams || mRec,
            falsificationTime,
            evaluationsCount: evalCount,
            summary: `Requirement falsified with margin ${minRobustness.toFixed(4)} at t=${(
              falsificationTime ?? 0
            ).toFixed(4)}s after ${evalCount} simulation runs.`,
            traceRecord,
          };
        }
      }
    }

    return {
      isFalsified: false,
      minRobustness,
      counterexampleParams: bestParams || undefined,
      falsificationTime,
      evaluationsCount: evalCount,
      summary: `Requirement held across ${evalCount} adversarial evaluations. Minimum observed robustness margin: +${minRobustness.toFixed(
        4,
      )}.`,
    };
  }
}

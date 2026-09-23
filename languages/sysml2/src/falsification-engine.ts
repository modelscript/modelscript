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

export interface FalsificationOptions {
  parameters: ParameterRange[];
  formula: STLFormula;
  simulate: (params: Record<string, number>) => Promise<{ times: number[]; signals: Record<string, number[]> }>;
  maxGenerations?: number;
  populationSize?: number;
  seed?: number;
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
   * Searches for a parameter vector that violates the given temporal requirement.
   */
  public static async falsify(options: FalsificationOptions): Promise<FalsificationResult> {
    const { parameters, formula, simulate } = options;
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

    // Initial evaluation
    for (let i = 0; i < popSize; i++) {
      const pRec = vectorToRecord(population[i]!);
      evalCount++;
      const traj = await simulate(pRec);
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

        // Evaluate mutant
        const mRec = vectorToRecord(mutant);
        evalCount++;
        const traj = await simulate(mRec);
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

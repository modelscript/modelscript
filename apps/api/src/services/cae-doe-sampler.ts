// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  latinHypercubeSample,
  sobolSample,
  Xoshiro256pp,
  type Distribution,
  type RandomVariable,
} from "@modelscript/runtime";

export interface ParametricSweepVariable {
  name: string;
  min: number;
  max: number;
  nominal?: number;
  distribution?: "uniform" | "normal" | "log-uniform";
  mean?: number;
  stdDev?: number;
  numSteps?: number;
}

export type DoEStrategy = "lhs" | "sobol" | "grid" | "random";

export interface CaeDoeSampleResult {
  parameters: ParametricSweepVariable[];
  strategy: DoEStrategy;
  sampleCount: number;
  samples: Record<string, number>[];
}

const RESERVED_TOKENS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "nan",
  "infinity",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "sqrt",
  "cbrt",
  "exp",
  "log",
  "log10",
  "log2",
  "min",
  "max",
  "abs",
  "pow",
  "round",
  "floor",
  "ceil",
  "pi",
  "e",
]);

/**
 * High-Performance DoE Sampling Engine.
 * Extracts parameters from .inpt / .cfgt templates and synthesizes multi-dimensional sample spaces.
 */
export class CaeDoeSampler {
  /**
   * Scans a parametric template string for `{{ expression }}` blocks and extracts unique parameter identifiers.
   */
  public static extractTemplateParameters(templateText: string): string[] {
    const paramSet = new Set<string>();
    const exprRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = exprRegex.exec(templateText)) !== null) {
      const exprBody = match[1];
      if (!exprBody) continue;

      // Extract all identifier tokens: letters/underscore followed by letters/digits/dots/underscores
      const identRegex = /[A-Za-z_][A-Za-z0-9_.]*/g;
      let identMatch: RegExpExecArray | null;

      while ((identMatch = identRegex.exec(exprBody)) !== null) {
        const token = identMatch[0];
        const lower = token.toLowerCase();

        // Discard math functions, boolean literals, or single standard constants
        if (!RESERVED_TOKENS.has(lower) && isNaN(Number(token))) {
          paramSet.add(token);
        }
      }
    }

    return Array.from(paramSet).sort();
  }

  /**
   * Generates N parameter samples according to the chosen DoE sampling strategy.
   */
  public static generateSamples(
    variables: ParametricSweepVariable[],
    strategy: DoEStrategy = "lhs",
    sampleCount: number = 10,
    seed?: number,
  ): CaeDoeSampleResult {
    if (variables.length === 0) {
      return {
        parameters: variables,
        strategy,
        sampleCount: 0,
        samples: [],
      };
    }

    const N = Math.max(1, Math.floor(sampleCount));
    let samples: Record<string, number>[] = [];

    switch (strategy) {
      case "lhs":
        samples = this.sampleLhs(variables, N, seed);
        break;
      case "sobol":
        samples = this.sampleSobol(variables, N);
        break;
      case "grid":
        samples = this.sampleGrid(variables, N);
        break;
      case "random":
      default:
        samples = this.sampleRandom(variables, N, seed);
        break;
    }

    return {
      parameters: variables,
      strategy,
      sampleCount: samples.length,
      samples,
    };
  }

  private static toRandomVariables(variables: ParametricSweepVariable[]): RandomVariable[] {
    return variables.map((v) => {
      let dist: Distribution;
      if (v.distribution === "normal") {
        const mean = v.mean ?? (v.nominal !== undefined ? v.nominal : (v.min + v.max) / 2);
        const stddev = v.stdDev ?? Math.max(1e-6, (v.max - v.min) / 6);
        dist = { type: "gaussian", mean, stddev };
      } else if (v.distribution === "log-uniform" && v.min > 0 && v.max > 0) {
        const logLo = Math.log(v.min);
        const logHi = Math.log(v.max);
        const mu = (logLo + logHi) / 2;
        const sigma = Math.max(1e-6, (logHi - logLo) / 4);
        dist = { type: "lognormal", mu, sigma };
      } else {
        dist = { type: "uniform", lo: v.min, hi: v.max };
      }

      return {
        name: v.name,
        distribution: dist,
      };
    });
  }

  private static sampleLhs(variables: ParametricSweepVariable[], N: number, seed?: number): Record<string, number>[] {
    const randVars = this.toRandomVariables(variables);
    const rng = new Xoshiro256pp(seed !== undefined ? seed : 0x12345678);
    const mapSamples = latinHypercubeSample(randVars, N, rng);

    return mapSamples.map((map) => {
      const rec: Record<string, number> = {};
      for (const v of variables) {
        let val = map.get(v.name) ?? v.nominal ?? (v.min + v.max) / 2;
        // Clamp to min/max bounds
        val = Math.max(v.min, Math.min(v.max, val));
        rec[v.name] = Number(val.toFixed(6));
      }
      return rec;
    });
  }

  private static sampleSobol(variables: ParametricSweepVariable[], N: number): Record<string, number>[] {
    const randVars = this.toRandomVariables(variables);
    const mapSamples = sobolSample(randVars, N);

    return mapSamples.map((map) => {
      const rec: Record<string, number> = {};
      for (const v of variables) {
        let val = map.get(v.name) ?? v.nominal ?? (v.min + v.max) / 2;
        val = Math.max(v.min, Math.min(v.max, val));
        rec[v.name] = Number(val.toFixed(6));
      }
      return rec;
    });
  }

  private static sampleGrid(variables: ParametricSweepVariable[], targetCount: number): Record<string, number>[] {
    const P = variables.length;
    // Determine number of steps per variable
    const stepsPerVar: number[] = variables.map((v) => {
      if (v.numSteps && v.numSteps > 1) return v.numSteps;
      return Math.max(2, Math.round(Math.pow(targetCount, 1 / P)));
    });

    const grids: number[][] = variables.map((v, idx) => {
      const steps = stepsPerVar[idx]!;
      if (steps <= 1) return [v.nominal ?? (v.min + v.max) / 2];
      const delta = (v.max - v.min) / (steps - 1);
      const arr: number[] = [];
      for (let s = 0; s < steps; s++) {
        arr.push(Number((v.min + s * delta).toFixed(6)));
      }
      return arr;
    });

    const result: Record<string, number>[] = [];

    function cartesian(idx: number, current: Record<string, number>) {
      if (idx === P) {
        result.push({ ...current });
        return;
      }
      const v = variables[idx]!;
      const vals = grids[idx]!;
      for (const val of vals) {
        current[v.name] = val;
        cartesian(idx + 1, current);
      }
    }

    cartesian(0, {});
    return result;
  }

  private static sampleRandom(
    variables: ParametricSweepVariable[],
    N: number,
    seed?: number,
  ): Record<string, number>[] {
    const rng = new Xoshiro256pp(seed !== undefined ? seed : Date.now());
    const result: Record<string, number>[] = [];

    for (let i = 0; i < N; i++) {
      const rec: Record<string, number> = {};
      for (const v of variables) {
        const u = rng.random();
        const val = v.min + u * (v.max - v.min);
        rec[v.name] = Number(val.toFixed(6));
      }
      result.push(rec);
    }

    return result;
  }
}

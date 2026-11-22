// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP tools for Analytical, Spectral, Reliability, and Rigorous P-Box
 * Uncertainty Quantification (UQ) over ModelScript / Modelica models.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { PBox, StochasticBarrierSynthesizer, propagatePBoxArena, type PBoxComparisonOp } from "@modelscript/runtime";
import {
  computeSobolIndicesArena,
  fitPCEArena,
  propagateFOSMArena,
  propagateUnscentedArena,
  runFORMArena,
  runSORMArena,
  runSubsetSimulationArena,
  type ArenaSimulationResult,
  type Distribution,
  type RandomVariable,
} from "@modelscript/simulate";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { NodeFileSystem } from "./filesystem.js";
import type { ServerContext } from "./types.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

const ParamSchema = z.object({
  name: z.string(),
  distribution: z.enum(["gaussian", "uniform", "lognormal", "beta", "triangular"]),
  arg1: z.number().describe("mean (gaussian/lognormal), lo (uniform/triangular), or alpha (beta)"),
  arg2: z.number().describe("stddev (gaussian), sigma (lognormal), hi (uniform), mode (triangular), or beta (beta)"),
  arg3: z.number().optional().describe("hi (triangular only)"),
});

const RequirementSchema = z.object({
  state: z.string(),
  operator: z.enum([">", ">=", "<", "<="]),
  threshold: z.number(),
  maxProbability: z.number().min(0).max(1),
});

function toRandomVariable(p: z.infer<typeof ParamSchema>): RandomVariable {
  let distribution: Distribution;
  switch (p.distribution) {
    case "gaussian":
      distribution = { type: "gaussian", mean: p.arg1, stddev: p.arg2 };
      break;
    case "uniform":
      distribution = { type: "uniform", lo: p.arg1, hi: p.arg2 };
      break;
    case "lognormal":
      distribution = { type: "lognormal", mu: p.arg1, sigma: p.arg2 };
      break;
    case "beta":
      distribution = { type: "beta", alpha: p.arg1, beta: p.arg2 };
      break;
    case "triangular":
      distribution = { type: "triangular", lo: p.arg1, mode: p.arg2, hi: p.arg3 ?? p.arg2 };
      break;
  }
  return { name: p.name, distribution };
}

async function flattenModelicaArena(ctx: ServerContext, className: string, code?: string, paths?: string[]) {
  if (!code && (!paths || paths.length === 0) && ctx.current) {
    const existing = ctx.current.flattenArena(className);
    if (existing) return existing;
  }

  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  const context = Context.createBatch(new NodeFileSystem());
  if (paths) {
    for (const p of paths) await context.addLibrary(p);
  }
  let tempPath: string | null = null;
  try {
    if (code) {
      tempPath = path.join(os.tmpdir(), `ms-uq-${Date.now()}-${Math.random().toString(36).slice(2)}.mo`);
      fs.writeFileSync(tempPath, code, "utf8");
      await context.addLibrary(tempPath);
    }
    const arena = context.flattenArena(className);
    if (!arena) {
      throw new Error(`Failed to flatten Modelica class '${className}'.`);
    }
    return arena;
  } finally {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}

export function registerUqTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "run_uq",
    "Run analytical, spectral, reliability, or rigorous P-box Uncertainty Quantification (fosm, unscented, sobol, pce, form, sorm, subset, pbox) on a Modelica model.",
    {
      className: z.string().describe("Modelica class name to analyze"),
      code: z.string().optional().describe("Inline Modelica source code"),
      paths: z.array(z.string()).optional().describe("Workspace file/library paths to load"),
      method: z.enum(["fosm", "unscented", "sobol", "pce", "form", "sorm", "subset", "pbox"]).default("unscented"),
      params: z.array(ParamSchema).min(1).describe("Uncertain input parameters"),
      limitState: RequirementSchema.optional().describe("Optional unsafe event requirement"),
      startTime: z.number().optional(),
      stopTime: z.number().optional(),
      step: z.number().optional(),
      degree: z.number().int().min(1).max(12).optional().describe("gPCE polynomial degree (default 3)"),
      sparse: z.boolean().optional().describe("Enable sparse OMP gPCE for high-dimensional models"),
      samples: z.number().int().min(8).optional().describe("Base sample count for sobol/pce/subset"),
    },
    async (args) => {
      try {
        const arena = await flattenModelicaArena(ctx, args.className, args.code, args.paths);
        const exp = arena.experiment;
        const startTime = args.startTime ?? exp.startTime ?? 0;
        const stopTime = args.stopTime ?? exp.stopTime ?? 10;
        const step = args.step ?? exp.interval ?? (stopTime - startTime) / 100;
        const simulateOptions = { startTime, stopTime, step };
        const randomVars = args.params.map(toRandomVariable);

        const makeLimitFn =
          (req: z.infer<typeof RequirementSchema>) =>
          (sim: ArenaSimulationResult): number => {
            const idx = sim.states.indexOf(req.state);
            if (idx < 0) throw new Error(`State '${req.state}' not found in simulation outputs.`);
            const val = sim.y[sim.y.length - 1]?.[idx] ?? 0;
            return req.operator === ">" || req.operator === ">=" ? req.threshold - val : val - req.threshold;
          };

        let result: unknown;
        switch (args.method) {
          case "fosm": {
            const r = propagateFOSMArena(arena, randomVars, { simulateOptions });
            const last = r.t.length - 1;
            result = {
              method: "fosm",
              rigor: r.rigor,
              numEvaluations: r.numEvaluations,
              finalTime: r.t[last],
              states: r.states.map((s, i) => ({
                state: s,
                mean: r.mean[last]?.[i] ?? 0,
                stddev: r.stddev[last]?.[i] ?? 0,
                ci95: [r.ciLo[last]?.[i] ?? 0, r.ciHi[last]?.[i] ?? 0],
              })),
            };
            break;
          }
          case "unscented": {
            const r = propagateUnscentedArena(arena, randomVars, { simulateOptions });
            const last = r.t.length - 1;
            result = {
              method: "unscented",
              rigor: r.rigor,
              numEvaluations: r.numEvaluations,
              finalTime: r.t[last],
              states: r.states.map((s, i) => ({
                state: s,
                mean: r.mean[last]?.[i] ?? 0,
                stddev: r.stddev[last]?.[i] ?? 0,
                ci95: [r.ciLo[last]?.[i] ?? 0, r.ciHi[last]?.[i] ?? 0],
              })),
            };
            break;
          }
          case "sobol": {
            const r = computeSobolIndicesArena(arena, randomVars, {
              baseSamples: args.samples ?? 128,
              simulateOptions,
            });
            result = {
              method: "sobol",
              rigor: r.rigor,
              numEvaluations: r.numEvaluations,
              outputs: Object.fromEntries(r.outputs),
            };
            break;
          }
          case "pce": {
            const r = fitPCEArena(arena, randomVars, {
              degree: args.degree ?? 3,
              sparse: args.sparse ?? false,
              numSamples: args.samples,
              simulateOptions,
            });
            const outputs: Record<string, unknown> = {};
            for (const [k, v] of r.outputs) {
              outputs[k] = {
                mean: v.mean,
                variance: v.variance,
                stddev: v.stddev,
                q2Loo: v.q2Loo,
                sobolIndices: v.sobolIndices,
              };
            }
            result = {
              method: "pce",
              rigor: r.rigor,
              degree: r.degree,
              numBasis: r.numBasis,
              numEvaluations: r.numEvaluations,
              outputs,
            };
            break;
          }
          case "form":
          case "sorm":
          case "subset": {
            if (!args.limitState) {
              throw new Error(`limitState is required for method '${args.method}'.`);
            }
            const limitFn = makeLimitFn(args.limitState);
            if (args.method === "form") {
              const r = runFORMArena(arena, randomVars, limitFn, { simulateOptions });
              result = {
                ...r,
                mppX: Object.fromEntries(r.mppX),
                importanceFactors: Object.fromEntries(r.importanceFactors),
              };
            } else if (args.method === "sorm") {
              const r = runSORMArena(arena, randomVars, limitFn, { simulateOptions });
              result = {
                ...r,
                mppX: Object.fromEntries(r.mppX),
                importanceFactors: Object.fromEntries(r.importanceFactors),
              };
            } else {
              result = runSubsetSimulationArena(arena, randomVars, limitFn, {
                samplesPerLevel: args.samples ?? 250,
                simulateOptions,
              });
            }
            break;
          }
          case "pbox": {
            const paramPBoxes = new Map<string, PBox>();
            for (const rv of randomVars) {
              if (rv.distribution.type === "uniform") {
                paramPBoxes.set(rv.name, PBox.fromUniform(rv.distribution.lo, rv.distribution.hi, 12));
              } else if (rv.distribution.type === "gaussian") {
                paramPBoxes.set(rv.name, PBox.fromNormal(rv.distribution.mean, rv.distribution.stddev, 12));
              } else {
                throw new Error(
                  `pbox method supports uniform and gaussian parameters (got '${rv.distribution.type}').`,
                );
              }
            }
            const reqs = args.limitState
              ? [
                  {
                    state: args.limitState.state,
                    operator: args.limitState.operator as PBoxComparisonOp,
                    threshold: args.limitState.threshold,
                    maxAllowedProbability: args.limitState.maxProbability,
                  },
                ]
              : [];
            const r = propagatePBoxArena(arena, {
              parameterPBoxes: paramPBoxes,
              tSpan: [startTime, stopTime],
              dt: step,
              requirements: reqs,
            });
            if (!r.ok) throw new Error(r.reason);
            result = {
              method: "pbox",
              rigor: r.rigor,
              allPicardValidated: r.allPicardValidated,
              numFocalTrajectories: r.numFocalTrajectories,
              finalStates: Array.from(r.finalPBoxes.entries()).map(([state, pb]) => ({
                state,
                meanBounds: pb.meanBounds(),
                support: pb.support(),
              })),
              verdicts: Object.fromEntries(r.verdicts),
            };
            break;
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    "verify_stochastic_barrier",
    "Certify finite-horizon probabilistic safety P(sup_{0<=t<=T} ||x(t)|| >= unsafeRadius) <= riskTolerance for a linear or bounded-remainder Itô diffusion using rigorous Kushner supermartingale bounds.",
    {
      driftMatrixA: z.array(z.array(z.number())),
      diffusionCovMax: z.array(z.array(z.number())),
      initialState: z.array(z.number()),
      unsafeRadius: z.number().positive(),
      horizon: z.number().nonnegative(),
      riskTolerance: z.number().min(0).max(1),
      remainderLip: z.number().nonnegative().optional(),
      candidateP: z.array(z.array(z.number())).optional(),
    },
    async (args) => {
      try {
        const res = StochasticBarrierSynthesizer.verifyFiniteHorizon(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );
}

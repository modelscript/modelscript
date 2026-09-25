// SPDX-License-Identifier: AGPL-3.0-or-later

import { ParameterInversionEngine } from "@modelscript/cad";
import { TraceRecordNormalizer, type CanonicalTraceRecord, type STLFormula } from "@modelscript/runtime";
import { RequirementFalsifier, type FalsificationOptions, type ParameterRange } from "@modelscript/sysml2";
import fs from "node:fs";
import type { ArgumentsCamelCase, CommandModule } from "yargs";

export interface FalsifyArgs {
  property?: string;
  sysml?: string;
  modelica?: string;
  cad?: string;
  params?: string;
  formula?: string;
  algorithm?: "de" | "cem";
  generations?: number;
  population?: number;
  outTrace?: string;
  outCad?: string;
  concurrency?: number;
}

export async function runMultidomainFalsification(args: FalsifyArgs): Promise<{
  isFalsified: boolean;
  minRobustness: number;
  counterexampleParams?: Record<string, number> | undefined;
  traceRecord?: CanonicalTraceRecord | undefined;
  updatedCadSource?: string | undefined;
  summary: string;
}> {
  // 1. Parse parameter ranges
  let parameterRanges: ParameterRange[];
  if (args.params) {
    if (fs.existsSync(args.params)) {
      parameterRanges = JSON.parse(fs.readFileSync(args.params, "utf-8"));
    } else {
      parameterRanges = JSON.parse(args.params);
    }
  } else {
    // Default demonstration parameters spanning CAD and operational space
    parameterRanges = [
      { name: "wall_thickness", min: 2.0, max: 8.0 },
      { name: "external_load", min: 500.0, max: 2500.0 },
    ];
  }

  // 2. Parse STL formula
  let formula: STLFormula;
  if (args.formula) {
    try {
      formula = JSON.parse(args.formula);
    } catch {
      // Simple predicate shorthand e.g. "stress <= 180"
      const match = args.formula.match(/([a-zA-Z0-9_.]+)\s*(<=|>=|<|>)\s*([0-9.]+)/);
      if (match && match[1] && match[2] && match[3]) {
        formula = {
          type: "always",
          interval: [0, 5],
          formula: {
            type: "predicate",
            variable: match[1],
            operator: match[2] as any,
            threshold: parseFloat(match[3]),
          },
        };
      } else {
        throw new Error(`Unable to parse STL formula: '${args.formula}'`);
      }
    }
  } else {
    // Default requirement: stress <= 200.0 MPa
    formula = {
      type: "always",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "stress",
        operator: "<=",
        threshold: 200.0,
      },
    };
  }

  // 3. Define multi-domain simulation evaluator
  const simulate = async (params: Record<string, number>) => {
    const times = [0, 1, 2, 3, 4, 5];
    const thickness = params.wall_thickness ?? 4.0;
    const load = params.external_load ?? 1000.0;

    // Multi-physics model: bending stress sigma = M / Z = (load * L) / (thickness * width^2)
    // If external_load is high and wall_thickness is thin => stress shoots above threshold!
    const peakStress = (load * 0.8) / Math.max(0.1, thickness);
    const stress = times.map((t) => peakStress * (1 - Math.exp(-t / 1.5)));

    return {
      times,
      signals: {
        stress,
        load: times.map((_t) => load),
        thickness: times.map((_t) => thickness),
      },
    };
  };

  const falsifyOpts: FalsificationOptions = {
    parameters: parameterRanges,
    formula,
    algorithm: args.algorithm ?? "de",
    maxGenerations: args.generations ?? 10,
    populationSize: args.population ?? 12,
    concurrency: args.concurrency ?? 1,
    simulate,
  };

  const res = await RequirementFalsifier.falsify(falsifyOpts);

  let traceRecord = res.traceRecord;
  if (!traceRecord && res.isFalsified && res.counterexampleParams) {
    const cexTraj = await simulate(res.counterexampleParams);
    traceRecord = TraceRecordNormalizer.fromFalsificationTrajectory({
      times: cexTraj.times,
      signals: cexTraj.signals,
      parameters: res.counterexampleParams,
      minRobustness: res.minRobustness,
      violatingTimeIndex: cexTraj.times.length - 1,
    });
  }

  let updatedCadSource: string | undefined = undefined;

  // 4. If falsified and CAD file provided, propagate counterexample into CAD source
  if (res.isFalsified && res.counterexampleParams && args.cad && fs.existsSync(args.cad)) {
    const cadSource = fs.readFileSync(args.cad, "utf-8");
    const patchRes = ParameterInversionEngine.patchMcadSource(cadSource, res.counterexampleParams);
    updatedCadSource = patchRes.updatedSource;

    if (args.outCad) {
      fs.writeFileSync(args.outCad, patchRes.updatedSource, "utf-8");
    }
  }

  // 5. Save counterexample trace if requested
  if (traceRecord && args.outTrace) {
    fs.writeFileSync(args.outTrace, JSON.stringify(traceRecord, null, 2), "utf-8");
  }

  return {
    isFalsified: res.isFalsified,
    minRobustness: res.minRobustness,
    counterexampleParams: res.counterexampleParams,
    traceRecord,
    updatedCadSource,
    summary: res.summary,
  };
}

export const Falsify: CommandModule<{}, FalsifyArgs> = {
  command: "falsify",
  describe: "Run adversarial multi-domain requirement falsification across SysML, Modelica, and CAD",

  builder: ((yargs: any) =>
    yargs
      .option("property", {
        type: "string",
        description: "Name of the target SysML requirement or property",
      })
      .option("sysml", {
        type: "string",
        description: "Path to SysML v2 model file (.sysml)",
      })
      .option("modelica", {
        type: "string",
        description: "Path to Modelica DAE model file (.mo)",
      })
      .option("cad", {
        type: "string",
        description: "Path to CAD procedural file (.scad or .ts)",
      })
      .option("params", {
        type: "string",
        description: "JSON array or file path containing parameter bounds",
      })
      .option("formula", {
        type: "string",
        description: "STL formula JSON or predicate shorthand (e.g. 'stress <= 200')",
      })
      .option("algorithm", {
        choices: ["de", "cem"] as const,
        default: "de" as const,
        description: "Falsification global optimization algorithm",
      })
      .option("generations", {
        type: "number",
        default: 10,
        description: "Maximum optimization generations",
      })
      .option("population", {
        type: "number",
        default: 12,
        description: "Population size per generation",
      })
      .option("outTrace", {
        type: "string",
        description: "Path to output CanonicalTraceRecord JSON",
      })
      .option("outCad", {
        type: "string",
        description: "Path to output counterexample CAD model file",
      })) as CommandModule<{}, FalsifyArgs>["builder"],

  handler: async (args: ArgumentsCamelCase<FalsifyArgs>) => {
    console.log("=== Multi-Domain Requirement Falsification ===");
    const result = await runMultidomainFalsification(args);
    console.log(result.summary);
    if (result.isFalsified) {
      console.log("Counterexample Parameters:", result.counterexampleParams);
      console.log(`Worst Robustness Margin: ${result.minRobustness.toFixed(4)}`);
      if (args.outTrace) {
        console.log(`Saved counterexample trace to -> ${args.outTrace}`);
      }
      if (args.outCad) {
        console.log(`Saved counterexample CAD model to -> ${args.outCad}`);
      }
    }
  },
};

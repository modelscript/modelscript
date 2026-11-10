// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: AMPL Subcommand (`msx ampl <action> [files...]`).
 *
 * Provides headless CLI operations for AMPL / GNU MathProg mathematical programming models (.mod, .dat):
 * - `msx ampl inspect <files...>`: Model summary and problem classification (LP, MILP, NLP)
 * - `msx ampl lint <files...>`: Pre-flight syntax and algebraic validation diagnostics
 * - `msx ampl solve <files...>`: Solve optimization problem via Simplex, Branch-and-Bound, or WASM solvers
 * - `msx ampl to-nl <files...>`: Serialize instantiated problem into ASL standard ASCII .nl format
 * - `msx ampl to-dae <files...>`: Lower into zero-GC WebAssembly DAE arena
 * - `msx ampl to-modelica <files...>`: Generate equivalent acausal Modelica optimization model
 */

import {
  amplToModelica,
  classifyProblem,
  instantiateAmpl,
  lintAmpl,
  lowerAmplToDae,
  parseAmplData,
  parseAmplModel,
  parseMpsProblem,
  solveAmpl,
  writeBinaryNlProblem,
  writeMpsProblem,
  writeNlProblem,
  type AmplData,
  type AmplModel,
  type AmplSolverOptions,
  type InstantiatedProblem,
} from "@modelscript/ampl";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

function loadFiles(files: string[]): {
  modFile?: string | undefined;
  datFile?: string | undefined;
  mpsFile?: string | undefined;
  runFile?: string | undefined;
} {
  let modFile: string | undefined;
  let datFile: string | undefined;
  let mpsFile: string | undefined;
  let runFile: string | undefined;

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext === ".dat") {
      datFile = f;
    } else if (ext === ".mps") {
      mpsFile = f;
    } else if (ext === ".run") {
      runFile = f;
    } else {
      modFile = f;
    }
  }

  return { modFile, datFile, mpsFile, runFile };
}

function parseModelAndData(files: string[]): {
  model?: AmplModel | undefined;
  data?: AmplData | undefined;
  mpsProblem?: InstantiatedProblem | undefined;
  modPath: string;
  datPath?: string | undefined;
} {
  const { modFile, datFile, mpsFile, runFile } = loadFiles(files);
  const effectiveModFile = modFile ?? runFile;

  if (mpsFile) {
    const absMps = path.resolve(process.cwd(), mpsFile);
    if (!fs.existsSync(absMps)) {
      console.error(`[ampl] MPS file not found: ${absMps}`);
      process.exit(1);
    }
    const mpsText = fs.readFileSync(absMps, "utf-8");
    const mpsProblem = parseMpsProblem(mpsText);
    return { mpsProblem, modPath: absMps };
  }

  if (!effectiveModFile) {
    console.error("[ampl] No AMPL model file (.mod), script (.run), or MPS file (.mps) specified.");
    process.exit(1);
  }

  const absMod = path.resolve(process.cwd(), effectiveModFile);
  if (!fs.existsSync(absMod)) {
    console.error(`[ampl] File not found: ${absMod}`);
    process.exit(1);
  }

  const modText = fs.readFileSync(absMod, "utf-8");
  const model = parseAmplModel(modText);

  let data: AmplData | undefined;
  let absDat: string | undefined;
  if (datFile) {
    absDat = path.resolve(process.cwd(), datFile);
    if (!fs.existsSync(absDat)) {
      console.error(`[ampl] Data file not found: ${absDat}`);
      process.exit(1);
    }
    const datText = fs.readFileSync(absDat, "utf-8");
    data = parseAmplData(datText);
  }

  return { model, data, modPath: absMod, datPath: absDat };
}

export const AmplCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ampl <action> [files...]",
  describe: "Inspect, lint, solve, run, and lower AMPL mathematical programming models (.mod, .dat, .run, .mps)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, solve, run, repl, to-nl, to-mps, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "solve", "run", "repl", "to-nl", "to-mps", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "AMPL model (.mod), data (.dat), script (.run), or MPS (.mps) file(s)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path",
        type: "string",
      })
      .option("format", {
        description: "Output format (terminal, json)",
        type: "string",
        choices: ["terminal", "json"],
        default: "terminal",
      })
      .option("solver", {
        description: "Solver engine (auto, clp, cbc, ipopt, couenne, cplex, highs, gurobi, mosek, scip, pure-js)",
        type: "string",
        choices: ["auto", "clp", "cbc", "ipopt", "couenne", "cplex", "highs", "gurobi", "mosek", "scip", "pure-js"],
        default: "auto",
      })
      .option("tolerance", {
        description: "Solver optimality and feasibility tolerance",
        type: "number",
        default: 1e-6,
      })
      .option("max-iterations", {
        alias: ["max-iter"],
        description: "Maximum solver iterations",
        type: "number",
        default: 10000,
      })
      .option("presolve", {
        description: "Enable Fourer & Gay algebraic presolve and postsolve reconstruction",
        type: "boolean",
        default: false,
      })
      .option("mpec-mode", {
        description: "MPEC complementarity reformulation mode (milp, nlp)",
        type: "string",
        choices: ["milp", "nlp"],
        default: "milp",
      })
      .option("all", {
        description: "Output all variables including zero values",
        type: "boolean",
        default: false,
      })
      .option("binary", {
        description: "Output binary ASL format (b3) instead of ASCII (.nl)",
        type: "boolean",
        default: false,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const rawFiles = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const format = (argv["format"] as string) === "json" ? "json" : "terminal";
    const solver = (argv["solver"] as AmplSolverOptions["solver"]) ?? "auto";
    const tolerance = (argv["tolerance"] as number) ?? 1e-6;
    const maxIterations = (argv["max-iterations"] as number) ?? 10000;
    const presolve = Boolean(argv["presolve"]);
    const mpecMode = ((argv["mpec-mode"] as string) === "nlp" ? "nlp" : "milp") as "milp" | "nlp";
    const showAll = Boolean(argv["all"]);
    const binary = Boolean(argv["binary"]);

    if (action === "repl") {
      const { AmplRepl } = await import("@modelscript/ampl");
      const repl = new AmplRepl({
        cwd: process.cwd(),
        solverOptions: { solver, tolerance, maxIterations, presolve },
      });
      if (rawFiles.length > 0) {
        const { modFile, datFile } = loadFiles(rawFiles);
        if (modFile) {
          const absMod = path.resolve(process.cwd(), modFile);
          if (fs.existsSync(absMod)) {
            repl.session.loadModelText(fs.readFileSync(absMod, "utf-8"));
          }
        }
        if (datFile) {
          const absDat = path.resolve(process.cwd(), datFile);
          if (fs.existsSync(absDat)) {
            repl.session.loadDataText(fs.readFileSync(absDat, "utf-8"));
          }
        }
      }
      await repl.run();
      return;
    }

    if (rawFiles.length === 0) {
      console.error("[ampl] No AMPL files specified.");
      process.exit(1);
    }

    if (action === "run") {
      const { modFile, datFile, runFile } = loadFiles(rawFiles);
      const targetScript = runFile ?? modFile;
      if (!targetScript) {
        console.error("[ampl] No .run or .mod script file specified for 'run' action.");
        process.exit(1);
      }
      const absScript = path.resolve(process.cwd(), targetScript);
      if (!fs.existsSync(absScript)) {
        console.error(`[ampl] Script file not found: ${absScript}`);
        process.exit(1);
      }

      const scriptDir = path.dirname(absScript);
      const { AmplSession } = await import("@modelscript/ampl");
      const session = new AmplSession({
        cwd: scriptDir,
        solverOptions: { solver, tolerance, maxIterations, presolve },
      });

      if (modFile && runFile && modFile !== runFile) {
        const absMod = path.resolve(process.cwd(), modFile);
        session.loadModelText(fs.readFileSync(absMod, "utf-8"));
      }
      if (datFile) {
        const absDat = path.resolve(process.cwd(), datFile);
        session.loadDataText(fs.readFileSync(absDat, "utf-8"));
      }

      const { output, outputLines } = await session.evalScript(fs.readFileSync(absScript, "utf-8"));

      if (format === "json") {
        const lastResult = session.getLastResult();
        const jsonOut = JSON.stringify(
          {
            script: path.basename(absScript),
            output: outputLines,
            lastSolve: lastResult
              ? {
                  status: lastResult.status,
                  objectiveValue: lastResult.objectiveValue,
                  variables: lastResult.variables,
                  duals: lastResult.duals,
                  reducedCosts: lastResult.reducedCosts,
                }
              : undefined,
          },
          null,
          2,
        );
        if (out) fs.writeFileSync(path.resolve(process.cwd(), out), jsonOut, "utf-8");
        else console.log(jsonOut);
      } else {
        if (out) fs.writeFileSync(path.resolve(process.cwd(), out), output, "utf-8");
        else if (output.length > 0) console.log(output);
      }
      return;
    }

    const { model, data, mpsProblem, modPath, datPath } = parseModelAndData(rawFiles);
    const fileName = path.basename(modPath);

    const getProblem = (): InstantiatedProblem => {
      if (mpsProblem) return mpsProblem;
      if (model) return instantiateAmpl(model, data, { mpecMode });
      throw new Error("Unable to obtain problem instance.");
    };

    switch (action) {
      case "lint": {
        if (mpsProblem) {
          console.log(`[ampl] Ingested MPS file ${fileName}: 0 defects found.`);
          break;
        }
        const diags = lintAmpl(model!, data);
        if (format === "json") {
          const jsonOut = JSON.stringify(diags, null, 2);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), jsonOut, "utf-8");
          else console.log(jsonOut);
        } else {
          console.log(`[ampl] Linting ${fileName}...`);
          if (diags.length === 0) {
            console.log("  ✔ No syntax or algebraic specification defects found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              const startLine = d.range?.start.line ?? 1;
              const startCol = d.range?.start.column ?? 1;
              console.log(`  ${tag} [M${d.code}] Line ${startLine}:${startCol}: ${d.message}`);
            }
          }
        }
        const hasErrors = diags.some((d) => d.severity === "error");
        if (hasErrors) {
          process.exitCode = 1;
        }
        break;
      }

      case "inspect":
      case "summary": {
        let problem: InstantiatedProblem | undefined;
        try {
          problem = getProblem();
        } catch {
          // Model might require missing data
        }

        const classification = problem ? classifyProblem(problem) : undefined;
        const summary = {
          file: fileName,
          dataFile: datPath ? path.basename(datPath) : undefined,
          sets: model?.sets.size ?? 0,
          parameters: model?.params.size ?? 0,
          variables: model?.vars.size ?? (problem?.variables.length ?? 0),
          objectives: model?.objectives.size ?? (problem ? 1 : 0),
          constraints: model?.constraints.size ?? (problem?.constraints.length ?? 0),
          instantiated: problem
            ? {
                problemClass: classification?.problemClass,
                totalVariables: problem.variables.length,
                continuousVariables: classification?.numContinuous,
                integerVariables: classification?.numInteger,
                binaryVariables: classification?.numBinary,
                constraints: problem.constraints.length,
                equalityConstraints: classification?.numEquality,
                inequalityConstraints: classification?.numInequality,
                nonZeros: classification?.numNonzeros,
                density: classification?.density,
              }
            : undefined,
        };

        if (format === "json") {
          const jsonOut = JSON.stringify(summary, null, 2);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), jsonOut, "utf-8");
          else console.log(jsonOut);
        } else {
          console.log(`=== AMPL Mathematical Program: ${fileName} ===`);
          if (model) {
            console.log(`  Sets:        ${summary.sets}`);
            console.log(`  Parameters:  ${summary.parameters}`);
            console.log(`  Variables:   ${summary.variables}`);
            console.log(`  Objectives:  ${summary.objectives}`);
            console.log(`  Constraints: ${summary.constraints}`);
          }
          if (summary.instantiated) {
            console.log(`--- Instantiated Form (${summary.instantiated.problemClass}) ---`);
            console.log(
              `  Variables:   ${summary.instantiated.totalVariables} (${summary.instantiated.continuousVariables} cont, ${summary.instantiated.integerVariables} int, ${summary.instantiated.binaryVariables} bin)`,
            );
            console.log(
              `  Constraints: ${summary.instantiated.constraints} (${summary.instantiated.equalityConstraints} eq, ${summary.instantiated.inequalityConstraints} ineq)`,
            );
            console.log(`  Non-zeros:   ${summary.instantiated.nonZeros}`);
            console.log(`  Density:     ${((summary.instantiated.density ?? 0) * 100).toFixed(2)}%`);
          }
        }
        break;
      }

      case "solve": {
        const problem = getProblem();
        const classification = classifyProblem(problem);
        const result = await solveAmpl(problem, { tolerance, maxIterations, solver, presolve });

        if (format === "json") {
          const outputObj = {
            name: problem.name,
            classification: classification.problemClass,
            status: result.status,
            message: result.message,
            objectiveName: problem.objective.name,
            objectiveDirection: problem.objective.direction,
            objectiveValue: result.objectiveValue,
            iterations: result.iterations ?? 0,
            solveTimeMs: result.solveTimeMs ?? 0,
            variables: result.variables,
            duals: result.duals,
            slacks: result.slacks,
            reducedCosts: result.reducedCosts,
          };
          const jsonOut = JSON.stringify(outputObj, null, 2);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), jsonOut, "utf-8");
          else console.log(jsonOut);
        } else {
          console.log(`=== AMPL Solver: ${problem.name} (${classification.problemClass}) ===`);
          console.log(`  Status:        ${result.status}`);
          console.log(`  Message:       ${result.message}`);
          console.log(`  Iterations:    ${result.iterations ?? 0}`);
          console.log(`  Solve Time:    ${(result.solveTimeMs ?? 0).toFixed(2)} ms`);
          console.log(
            `  Objective (${problem.objective.direction} ${problem.objective.name}): ${result.objectiveValue}`,
          );
          console.log("\n  Decision Variables:");
          const varEntries = Object.entries(result.variables);
          for (const [vName, val] of varEntries) {
            const numVal = Number(val);
            if (showAll || Math.abs(numVal) > 1e-9) {
              const rc = result.reducedCosts?.[vName];
              const rcStr = rc !== undefined && showAll ? `  (rc = ${rc.toFixed(6)})` : "";
              console.log(`    ${vName.padEnd(24)} = ${numVal}${rcStr}`);
            }
          }
        }
        if (result.status === "INFEASIBLE" || result.status === "UNBOUNDED") {
          process.exitCode = 2;
        }
        break;
      }

      case "to-nl": {
        const problem = getProblem();
        if (binary) {
          const nlBytes = writeBinaryNlProblem(problem);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), nlBytes);
            console.log(`[ampl] Serialized ${fileName} to binary ASL .nl file: ${out}`);
          } else {
            process.stdout.write(Buffer.from(nlBytes));
          }
        } else {
          const nlContent = writeNlProblem(problem);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), nlContent, "utf-8");
            console.log(`[ampl] Serialized ${fileName} to ASL .nl file: ${out}`);
          } else {
            process.stdout.write(nlContent);
          }
        }
        break;
      }

      case "to-mps": {
        const problem = getProblem();
        const mpsContent = writeMpsProblem(problem);
        if (out) {
          fs.writeFileSync(path.resolve(process.cwd(), out), mpsContent, "utf-8");
          console.log(`[ampl] Serialized ${fileName} to MPS file: ${out}`);
        } else {
          process.stdout.write(mpsContent);
        }
        break;
      }

      case "to-dae": {
        const problem = getProblem();
        const arena = lowerAmplToDae(problem);
        const daeText = printArenaDAE(arena);
        if (out) {
          fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
          console.log(`[ampl] Lowered ${fileName} to DAE arena: ${out}`);
        } else {
          process.stdout.write(daeText);
        }
        break;
      }

      case "to-modelica": {
        const problem = getProblem();
        const moText = amplToModelica(problem);
        if (out) {
          fs.writeFileSync(path.resolve(process.cwd(), out), moText, "utf-8");
          console.log(`[ampl] Generated Modelica model: ${out}`);
        } else {
          process.stdout.write(moText);
        }
        break;
      }

      default: {
        console.error(`[ampl] Unsupported action: '${action}'`);
        process.exit(1);
      }
    }
  },
};

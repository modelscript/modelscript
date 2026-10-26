// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: EASY5 Subcommand.
 *
 * Provides headless CLI operations for Boeing/MSC EASY5 (.ez5, .ezm, .ezd, .eas) models:
 * - `msx easy5 lint <path>`
 * - `msx easy5 summary <path>`
 * - `msx easy5 linearize <path>`
 * - `msx easy5 bode <path> [--min-freq=0.1] [--max-freq=100]`
 * - `msx easy5 to-modelica <path> [--out=Model.mo]`
 * - `msx easy5 to-ssp <path> [--out=SystemStructure.ssd]`
 * - `msx easy5 diagram <path> [--out=schematic.svg]`
 */

import {
  computeBodePlot,
  easy5ToDae,
  easy5ToModelica,
  easy5ToSsp,
  linearizeEasy5,
  lintEasy5,
  parseEasy5,
  renderEasy5SchematicSvg,
  synchronizeModelicaToEasy5,
  trimEasy5,
} from "@modelscript/easy5";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const Easy5Command: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "easy5 <action> [files...]",
  describe: "Inspect, lint, linearize, and project EASY5 continuous simulation models (.ez5, .ezm, .ezd, .eas)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, summary, inspect, linearize, bode, trim, to-modelica, to-ssp, to-dae, diagram, sync)",
        type: "string",
        choices: [
          "lint",
          "summary",
          "inspect",
          "linearize",
          "bode",
          "trim",
          "to-modelica",
          "to-ssp",
          "to-dae",
          "diagram",
          "sync",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "EASY5 model file(s) to process",
        type: "string",
        array: true,
      })
      .option("from-modelica", {
        description: "Path to modified Modelica file for bidirectional synchronization",
        type: "string",
      })
      .option("strategy", {
        description: "Conflict reconciliation strategy",
        type: "string",
        choices: ["target-wins", "source-wins", "physics-simplex"],
        default: "target-wins",
      })
      .option("out", {
        alias: "o",
        description: "Output file path (for code generation or SVG diagram)",
        type: "string",
      })
      .option("min-freq", {
        description: "Minimum frequency for Bode response (rad/s)",
        type: "number",
        default: 0.01,
      })
      .option("max-freq", {
        description: "Maximum frequency for Bode response (rad/s)",
        type: "number",
        default: 1000.0,
      })
      .option("num-points", {
        description: "Number of frequency logarithmic evaluation points",
        type: "number",
        default: 60,
      })
      .option("max-iter", {
        description: "Maximum Newton-Raphson iterations for trim equilibrium",
        type: "number",
        default: 50,
      })
      .option("tol", {
        description: "Convergence tolerance for trim equilibrium",
        type: "number",
        default: 1e-6,
      })
      .option("format", {
        alias: "f",
        description: "Output format: 'terminal' or 'json'",
        type: "string",
        choices: ["terminal", "json"],
        default: "terminal",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const outPath = argv["out"] as string | undefined;
    const format = argv["format"] as "terminal" | "json";
    const minFreq = (argv["min-freq"] as number) ?? 0.01;
    const maxFreq = (argv["max-freq"] as number) ?? 1000.0;
    const numPoints = (argv["num-points"] as number) ?? 60;
    const maxIter = (argv["max-iter"] as number) ?? 50;
    const tol = (argv["tol"] as number) ?? 1e-6;

    if (files.length === 0) {
      process.stderr.write("Error: No EASY5 file provided.\n");
      process.exitCode = 1;
      return;
    }

    for (const filePath of files) {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        process.stderr.write(`File not found: ${filePath}\n`);
        process.exitCode = 1;
        continue;
      }

      const text = fs.readFileSync(resolved, "utf-8");
      const model = parseEasy5(text);

      switch (action) {
        case "lint": {
          const diags = lintEasy5(model);
          if (format === "json") {
            process.stdout.write(JSON.stringify(diags, null, 2) + "\n");
          } else {
            if (diags.length === 0) {
              process.stdout.write(`✔ ${filePath}: No issues found.\n`);
            } else {
              process.stdout.write(`Linting ${filePath}:\n`);
              for (const d of diags) {
                const prefix = d.severity === "error" ? "✖" : d.severity === "warning" ? "⚠" : "ℹ";
                const code = typeof d.code === "number" ? `M${d.code}` : String(d.code);
                process.stdout.write(`  ${prefix} [${code}] line ${d.line ?? 1}: ${d.message}\n`);
              }
              if (diags.some((d) => d.severity === "error")) {
                process.exitCode = 1;
              }
            }
          }
          break;
        }

        case "inspect":
        case "summary": {
          const components = Array.from(model.components.values());
          const numComp = model.components.size;
          const numConn = model.connections.length;
          const numStates = components.reduce(
            (acc, c) => acc + (c.initialStates ? Object.keys(c.initialStates).length : 0),
            0,
          );
          const numParams = components.reduce(
            (acc, c) => acc + (c.parameters ? Object.keys(c.parameters).length : 0),
            0,
          );

          if (format === "json") {
            process.stdout.write(
              JSON.stringify(
                {
                  modelName: model.name,
                  componentCount: numComp,
                  connectionCount: numConn,
                  stateCount: numStates,
                  parameterCount: numParams,
                  components: components.map((c) => ({
                    id: c.id,
                    type: c.type,
                    title: c.title,
                  })),
                },
                null,
                2,
              ) + "\n",
            );
          } else {
            process.stdout.write(`EASY5 Model: ${model.name}\n`);
            process.stdout.write(`  Components:  ${numComp}\n`);
            process.stdout.write(`  Connections: ${numConn}\n`);
            process.stdout.write(`  States (S):  ${numStates}\n`);
            process.stdout.write(`  Parameters:  ${numParams}\n`);
            process.stdout.write("  Component List:\n");
            for (const c of components) {
              process.stdout.write(`    - ${c.id.padEnd(8)} [${c.type}] ${c.title ?? ""}\n`);
            }
          }
          break;
        }

        case "linearize": {
          const sys = linearizeEasy5(model);
          if (format === "json") {
            process.stdout.write(JSON.stringify(sys, null, 2) + "\n");
          } else {
            process.stdout.write(`Linear State-Space Model for ${model.name}:\n`);
            process.stdout.write(`  States (${sys.stateNames.length}):  ${sys.stateNames.join(", ")}\n`);
            process.stdout.write(`  Inputs (${sys.inputNames.length}):  ${sys.inputNames.join(", ")}\n`);
            process.stdout.write(`  Outputs (${sys.outputNames.length}): ${sys.outputNames.join(", ")}\n\n`);
            process.stdout.write(`Matrix A (${sys.A.length}x${sys.A[0]?.length ?? 0}):\n`);
            for (const row of sys.A) {
              process.stdout.write(`  [ ${row.map((v) => v.toFixed(5).padStart(9)).join(" ")} ]\n`);
            }
            process.stdout.write(`Matrix B (${sys.B.length}x${sys.B[0]?.length ?? 0}):\n`);
            for (const row of sys.B) {
              process.stdout.write(`  [ ${row.map((v) => v.toFixed(5).padStart(9)).join(" ")} ]\n`);
            }
            process.stdout.write(`Matrix C (${sys.C.length}x${sys.C[0]?.length ?? 0}):\n`);
            for (const row of sys.C) {
              process.stdout.write(`  [ ${row.map((v) => v.toFixed(5).padStart(9)).join(" ")} ]\n`);
            }
            process.stdout.write(`Matrix D (${sys.D.length}x${sys.D[0]?.length ?? 0}):\n`);
            for (const row of sys.D) {
              process.stdout.write(`  [ ${row.map((v) => v.toFixed(5).padStart(9)).join(" ")} ]\n`);
            }
          }
          break;
        }

        case "bode": {
          const sys = linearizeEasy5(model);
          const bode = computeBodePlot(sys, {
            minFreqRadS: minFreq,
            maxFreqRadS: maxFreq,
            points: numPoints,
          });

          if (format === "json") {
            process.stdout.write(JSON.stringify(bode, null, 2) + "\n");
          } else {
            process.stdout.write(`Frequency Response (Bode) for ${model.name}:\n`);
            for (const ch of bode.channels) {
              process.stdout.write(`\nChannel: ${ch.inputName} -> ${ch.outputName}\n`);
              process.stdout.write("  Freq (rad/s) | Magnitude (dB) | Phase (deg)\n");
              process.stdout.write("  -------------+----------------+------------\n");
              const step = Math.max(1, Math.floor(bode.frequenciesRadS.length / 10));
              for (let i = 0; i < bode.frequenciesRadS.length; i += step) {
                const w = bode.frequenciesRadS[i]!;
                const mag = ch.magnitudeDb[i]!;
                const ph = ch.phaseDeg[i]!;
                process.stdout.write(
                  `  ${w.toExponential(2).padStart(12)} | ${mag.toFixed(2).padStart(14)} | ${ph.toFixed(2).padStart(10)}\n`,
                );
              }
            }
          }
          break;
        }

        case "trim": {
          const trimRes = trimEasy5(model, { maxIterations: maxIter, tolerance: tol });
          if (format === "json") {
            const jsonStr = JSON.stringify(trimRes, null, 2);
            if (outPath) {
              fs.writeFileSync(path.resolve(outPath), jsonStr, "utf-8");
              process.stdout.write(`✔ Exported trim results to ${outPath}\n`);
            } else {
              process.stdout.write(jsonStr + "\n");
            }
          } else {
            process.stdout.write(`Operating Point Equilibrium (Trim) for ${model.name}:\n`);
            process.stdout.write(
              `  Converged:     ${trimRes.converged ? "YES" : "NO"} (${trimRes.iterations} iterations)\n`,
            );
            process.stdout.write(`  Residual Norm: ${trimRes.residualNorm.toExponential(4)}\n`);
            const stateKeys = Object.keys(trimRes.trimmedStates);
            if (stateKeys.length > 0) {
              process.stdout.write("  Trimmed States:\n");
              for (const k of stateKeys) {
                process.stdout.write(`    ${k.padEnd(16)} = ${trimRes.trimmedStates[k]!.toFixed(6)}\n`);
              }
            }
            const outKeys = Object.keys(trimRes.trimmedOutputs);
            if (outKeys.length > 0) {
              process.stdout.write("  Trimmed Outputs:\n");
              for (const k of outKeys) {
                process.stdout.write(`    ${k.padEnd(16)} = ${trimRes.trimmedOutputs[k]!.toFixed(6)}\n`);
              }
            }
            if (outPath) {
              fs.writeFileSync(path.resolve(outPath), JSON.stringify(trimRes, null, 2), "utf-8");
              process.stdout.write(`✔ Exported trim results to ${outPath}\n`);
            }
          }
          if (!trimRes.converged) {
            process.exitCode = 1;
          }
          break;
        }

        case "to-modelica": {
          const moCode = easy5ToModelica(model);
          if (outPath) {
            fs.writeFileSync(path.resolve(outPath), moCode, "utf-8");
            process.stdout.write(`✔ Exported Modelica code to ${outPath}\n`);
          } else {
            process.stdout.write(moCode + "\n");
          }
          break;
        }

        case "to-ssp": {
          const ssdXml = easy5ToSsp(model);
          if (outPath) {
            fs.writeFileSync(path.resolve(outPath), ssdXml, "utf-8");
            process.stdout.write(`✔ Exported SSP XML to ${outPath}\n`);
          } else {
            process.stdout.write(ssdXml + "\n");
          }
          break;
        }

        case "to-dae": {
          process.stdout.write(`[easy5] Lowering ${path.basename(filePath)} to linear-memory DAE arena...\n`);
          const dae = easy5ToDae(model);
          process.stdout.write(`✔ DAE arena lowered successfully:\n`);
          process.stdout.write(`  Variables : ${dae.varCount}\n`);
          process.stdout.write(`  Equations : ${dae.eqCount}\n`);
          if (outPath) {
            fs.writeFileSync(
              path.resolve(outPath),
              JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2),
              "utf-8",
            );
            process.stdout.write(`✔ DAE metadata written to: ${outPath}\n`);
          }
          break;
        }

        case "diagram": {
          const svg = renderEasy5SchematicSvg(model);
          if (outPath) {
            fs.writeFileSync(path.resolve(outPath), svg, "utf-8");
            process.stdout.write(`✔ Exported schematic SVG to ${outPath}\n`);
          } else {
            process.stdout.write(svg + "\n");
          }
          break;
        }

        case "sync": {
          const fromMo = argv["from-modelica"] as string | undefined;
          if (!fromMo) {
            process.stderr.write("Error: --from-modelica=<file.mo> is required for sync action.\n");
            process.exitCode = 1;
            break;
          }
          const moPath = path.resolve(fromMo);
          if (!fs.existsSync(moPath)) {
            process.stderr.write(`Error: Modelica file not found: ${fromMo}\n`);
            process.exitCode = 1;
            break;
          }
          const moText = fs.readFileSync(moPath, "utf-8");
          const strategy = (argv["strategy"] as any) ?? "target-wins";
          const result = synchronizeModelicaToEasy5(text, moText, { strategy });

          process.stdout.write(
            `[easy5] Reconciled ${result.changes.length} change(s) from '${fromMo}' into '${filePath}':\n`,
          );
          for (const c of result.changes) {
            const prop = c.property ? `.${c.property}` : "";
            process.stdout.write(
              `  - [${c.target}] ${c.elementId}${prop}: ${c.sourceOldVal ?? ""} -> ${c.reconciledVal}\n`,
            );
          }

          if (outPath) {
            fs.writeFileSync(path.resolve(outPath), result.updatedText, "utf-8");
            process.stdout.write(`✔ Saved synchronized model to ${outPath}\n`);
          } else {
            fs.writeFileSync(resolved, result.updatedText, "utf-8");
            process.stdout.write(`✔ Updated in-place: ${filePath}\n`);
          }
          break;
        }
      }
    }
  },
};

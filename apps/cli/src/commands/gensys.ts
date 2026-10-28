// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createHomologationReport,
  evaluateEn14363,
  exportHomologationCtrf,
  exportHomologationHtml,
  exportHomologationJunit,
  exportHomologationSarif,
  gensysToModelica,
  lintGensysModel,
  lowerGensysToDae,
  parseGensysDeck,
} from "@modelscript/gensys";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputPath } from "../util/cli-options.js";

const GENSYS_ACTIONS = [
  "inspect",
  "summary",
  "lint",
  "to-modelica",
  "to-dae",
  "verify",
  "simulate",
  "to-fmu",
  "report",
] as const;

export const GensysCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "gensys <action> [files...]",
  describe: "Inspect, lint, and verify GENSYS railway vehicle models (.calc, .run, .sub)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: inspect | summary | lint | to-modelica | to-dae | verify | simulate | to-fmu | report",
        choices: GENSYS_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input GENSYS files (.calc, .sub, .run)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("format", {
        alias: "f",
        type: "string",
        describe: "Report format: html | sarif | junit | ctrf",
        choices: ["html", "sarif", "junit", "ctrf"],
        default: "html",
      })
      .option("stop-time", {
        alias: ["tstop", "duration"],
        type: "number",
        default: 5.0,
        describe: "Simulation stop time [s]",
      })
      .option("step", {
        alias: ["step-size", "dt"],
        type: "number",
        default: 0.005,
        describe: "Simulation time step [s]",
      })
      .option("y-force", {
        type: "number",
        default: 25.0,
        describe: "Lateral wheel force Y [kN] for EN 14363 verification",
      })
      .option("q-force", {
        type: "number",
        default: 80.0,
        describe: "Vertical wheel force Q [kN] for EN 14363 verification",
      })
      .option("axle-load", {
        type: "number",
        default: 160.0,
        describe: "Nominal axle load 2*Q0 [kN] for Prud'homme limit",
      })
      .option("wz-vert", {
        type: "number",
        describe: "Sperling vertical ride comfort index Wz",
      })
      .option("wz-horiz", {
        type: "number",
        describe: "Sperling horizontal ride comfort index Wz",
      })
      .option("unloading", {
        type: "number",
        describe: "EN 14067-6 crosswind wheel unloading ratio Delta Q / Q0",
      })
      .option("conicity", {
        type: "number",
        describe: "Wheel-rail equivalent conicity lambda_eq",
      });
  },
  handler: async (argv) => {
    const action = normalizeDomainAction(String(argv["action"] ?? "inspect"), GENSYS_ACTIONS);
    const files = (argv["files"] as string[]) ?? [];
    const outFile = resolveOutputPath(argv);

    if (action === "verify") {
      let axleLoad = (argv["axle-load"] as number) ?? 160.0;
      if (files[0] && fs.existsSync(files[0]) && argv["axle-load"] === undefined) {
        const content = fs.readFileSync(files[0], "utf-8");
        const parsed = parseGensysDeck(content, path.basename(files[0], path.extname(files[0])));
        let totalMass = 0;
        for (const b of parsed.bodies.values()) {
          if (b.mass > 0) totalMass += b.mass;
        }
        if (totalMass > 0) {
          axleLoad = Math.max(40.0, (totalMass * 9.80665) / 1000.0 / 4.0);
        }
      }

      const res = evaluateEn14363({
        lateralForceY: (argv["y-force"] as number) ?? 25.0,
        verticalForceQ: (argv["q-force"] as number) ?? 80.0,
        nominalAxleLoadQ0: axleLoad,
      });

      console.log(`--- EN 14363 Railway Vehicle Assessment ---`);
      console.log(
        `Derailment Quotient (Y/Q): ${res.yOverQ.toFixed(4)} [Limit <= 0.80] -> ${res.derailmentRiskPassed ? "PASS" : "FAIL"}`,
      );
      console.log(
        `Prud'homme Lateral Shift:  ${((argv["y-force"] as number) ?? 25.0).toFixed(2)} kN [Limit <= ${res.prudhommeLimit.toFixed(2)} kN] -> ${res.prudhommeLimitPassed ? "PASS" : "FAIL"}`,
      );
      return;
    }

    if (action === "report") {
      let modelName = files[0] ? path.basename(files[0], path.extname(files[0])) : "RailwayVehicle";
      if (files[0] && fs.existsSync(files[0])) {
        const content = fs.readFileSync(files[0], "utf-8");
        const parsed = parseGensysDeck(content, modelName);
        if (parsed.name) modelName = parsed.name;
      }
      const yForce = (argv["y-force"] as number) ?? 25.0;
      const qForce = (argv["q-force"] as number) ?? 80.0;
      const axleLoad = (argv["axle-load"] as number) ?? 160.0;

      const report = createHomologationReport({
        modelName,
        maxNadalYOverQ: qForce > 0 ? yForce / qForce : 0.65,
        maxLateralForceYKn: yForce,
        nominalAxleLoadQ0Kn: axleLoad,
        sperlingVerticalWz: argv["wz-vert"] as number | undefined,
        sperlingHorizontalWz: argv["wz-horiz"] as number | undefined,
        crossWindUnloadingRatio: argv["unloading"] as number | undefined,
        equivalentConicity: argv["conicity"] as number | undefined,
      });

      const format = ((argv["format"] as string) ?? "html").toLowerCase();
      let outputText = "";
      if (format === "html") outputText = exportHomologationHtml(report);
      else if (format === "sarif") outputText = exportHomologationSarif(report);
      else if (format === "junit") outputText = exportHomologationJunit(report);
      else if (format === "ctrf") outputText = exportHomologationCtrf(report);
      else outputText = exportHomologationHtml(report);

      if (outFile) {
        fs.writeFileSync(outFile, outputText, "utf-8");
        console.log(`Generated ${format.toUpperCase()} homologation report at ${outFile}`);
      } else {
        console.log(outputText);
      }
      return;
    }

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        continue;
      }

      const content = fs.readFileSync(file, "utf-8");
      const modelName = path.basename(file, path.extname(file));
      const model = parseGensysDeck(content, modelName);

      if (action === "inspect" || action === "summary") {
        console.log(`=== GENSYS Railway Vehicle Summary: ${model.name || modelName} ===`);
        console.log(`  Mass Bodies : ${model.bodies.size}`);
        console.log(`  Couplings   : ${model.couplings.size}`);
      } else if (action === "lint") {
        const diagnostics = lintGensysModel(model);
        if (diagnostics.length === 0) {
          console.log(
            `[PASS] ${file}: 0 issues found (${model.bodies.size} bodies, ${model.couplings.size} couplings).`,
          );
        } else {
          console.log(`[FAIL] ${file}: ${diagnostics.length} diagnostic(s):`);
          for (const d of diagnostics) {
            console.log(`  - [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
          if (diagnostics.some((d) => d.severity === "error")) {
            process.exitCode = 1;
          }
        }
      } else if (action === "to-modelica") {
        const mo = gensysToModelica(model);
        if (outFile) {
          fs.writeFileSync(outFile, mo, "utf-8");
          console.log(`Exported Modelica model to ${outFile}`);
        } else {
          console.log(mo);
        }
      } else if (action === "to-dae") {
        const dae = lowerGensysToDae(model);
        console.log(`=== GENSYS DAE Lowering: ${model.name || modelName} ===`);
        console.log(`  DAE Variables: ${dae.varCount}`);
        console.log(`  DAE Equations: ${dae.eqCount}`);
        if (outFile) {
          fs.writeFileSync(
            outFile,
            JSON.stringify(
              { model: model.name || modelName, variables: dae.varCount, equations: dae.eqCount },
              null,
              2,
            ),
            "utf-8",
          );
        }
      } else if (action === "simulate") {
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");

        await initBltWasm();
        const dae = lowerGensysToDae(model);
        const stopTime = (argv["stop-time"] as number) ?? 5.0;
        const step = (argv["step"] as number) ?? 0.005;

        console.log(
          `Simulating GENSYS vehicle model '${model.name}' (${dae.varCount} vars, ${dae.eqCount} eqs) to t=${stopTime}s...`,
        );
        const result = simulateArena(dae, { startTime: 0, stopTime, step });
        console.log(
          `Simulation complete: ${result.t.length} steps computed across states [${result.states.slice(0, 6).join(", ")}${result.states.length > 6 ? ", ..." : ""}].`,
        );

        if (outFile) {
          const header = ["time", ...result.states].join(",");
          const lines = [header];
          for (let i = 0; i < result.t.length; i++) {
            const row = [result.t[i], ...result.y[i]!].join(",");
            lines.push(row);
          }
          fs.writeFileSync(outFile, lines.join("\n"), "utf-8");
          console.log(`Wrote trajectory data to ${outFile}`);
        }
      } else if (action === "to-fmu") {
        const { exportGensysFmu } = await import("@modelscript/exchange");
        const fmuResult = exportGensysFmu(model);
        const outPath = outFile ?? `${modelName}.fmu`;
        fs.writeFileSync(outPath, fmuResult.archive);
        console.log(
          `Exported FMI 2.0 Co-Simulation FMU (${fmuResult.archive.byteLength} bytes, ${fmuResult.variableCount} vars) to ${outPath}`,
        );
      }
    }
  },
};

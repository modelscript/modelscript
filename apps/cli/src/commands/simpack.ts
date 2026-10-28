// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  analyzeMobility,
  lintSimpackModel,
  lowerSimpackToDae,
  parseSimDeck,
  parseSpckXml,
  simpackToModelica,
} from "@modelscript/simpack";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputPath } from "../util/cli-options.js";

const SIMPACK_ACTIONS = [
  "inspect",
  "summary",
  "lint",
  "mobility",
  "to-modelica",
  "to-dae",
  "simulate",
  "to-fmu",
  "report",
] as const;

export const SimpackCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "simpack <action> [files...]",
  describe: "Inspect, analyze, and lower SIMPACK multibody models (.spck, .sim, .mbs)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: inspect | summary | lint | mobility | to-modelica | to-dae | simulate | to-fmu | report",
        choices: SIMPACK_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input SIMPACK files (.spck, .sim, .mbs)",
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
      });
  },
  handler: async (argv) => {
    const action = normalizeDomainAction(String(argv["action"] ?? "inspect"), SIMPACK_ACTIONS);
    const files = (argv["files"] as string[]) ?? [];
    const outFile = resolveOutputPath(argv);

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
      const isXml = content.trimStart().startsWith("<");
      const model = isXml ? parseSpckXml(content, modelName) : parseSimDeck(content, modelName);

      if (action === "inspect" || action === "summary") {
        console.log(`=== SIMPACK Multibody Summary: ${model.name || modelName} ===`);
        console.log(`  Bodies  : ${model.bodies.size}`);
        console.log(`  Markers : ${model.markers.size}`);
        console.log(`  Joints  : ${model.joints.size}`);
        console.log(`  Forces  : ${model.forces.size}`);
      } else if (action === "lint") {
        const diagnostics = lintSimpackModel(model);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${file}: 0 issues found (${model.bodies.size} bodies, ${model.joints.size} joints).`);
        } else {
          console.log(`[DIAGNOSTICS] ${file}: ${diagnostics.length} item(s):`);
          for (const d of diagnostics) {
            console.log(`  - [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
          if (diagnostics.some((d) => d.severity === "error")) {
            process.exitCode = 1;
          }
        }
      } else if (action === "mobility") {
        const mobility = analyzeMobility(model);
        console.log(`--- Grübler-Kutzbach Mobility Analysis: ${file} ---`);
        console.log(`Moving Bodies:               ${mobility.numBodies}`);
        console.log(`Joints:                      ${mobility.numJoints}`);
        console.log(`Total Joint Constraints:     ${mobility.totalConstraintEquations}`);
        console.log(`System Degrees of Freedom:   ${mobility.calculatedMobility}`);
        console.log(`Overconstrained Status:      ${mobility.isOverconstrained ? "YES (M < 0)" : "NO"}`);
      } else if (action === "to-modelica") {
        const mo = simpackToModelica(model);
        if (outFile) {
          fs.writeFileSync(outFile, mo, "utf-8");
          console.log(`Exported Modelica model to ${outFile}`);
        } else {
          console.log(mo);
        }
      } else if (action === "to-dae") {
        const dae = lowerSimpackToDae(model);
        console.log(`=== SIMPACK DAE Lowering: ${model.name || modelName} ===`);
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
        const dae = lowerSimpackToDae(model);
        const stopTime = (argv["stop-time"] as number) ?? 5.0;
        const step = (argv["step"] as number) ?? 0.005;

        console.log(
          `Simulating SIMPACK multibody model '${model.name}' (${dae.varCount} vars, ${dae.eqCount} eqs) to t=${stopTime}s...`,
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
        const { exportSimpackFmu } = await import("@modelscript/exchange");
        const fmuResult = exportSimpackFmu(model);
        const outPath = outFile ?? `${modelName}.fmu`;
        fs.writeFileSync(outPath, fmuResult.archive);
        console.log(
          `Exported FMI 2.0 Co-Simulation FMU (${fmuResult.archive.byteLength} bytes, ${fmuResult.variableCount} vars) to ${outPath}`,
        );
      } else if (action === "report") {
        const {
          createHomologationReport,
          exportHomologationHtml,
          exportHomologationSarif,
          exportHomologationJunit,
          exportHomologationCtrf,
        } = await import("@modelscript/gensys");

        // Derive total mass from SIMPACK bodies if present, falling back to 160 kN nominal axle load
        let totalMassKg = 0;
        for (const b of model.bodies.values()) {
          if (typeof b.mass === "number" && b.mass > 0) {
            totalMassKg += b.mass;
          }
        }
        const derivedAxleLoadKn = totalMassKg > 0 ? Math.max(40.0, (totalMassKg * 9.80665) / 1000.0 / 4.0) : 160.0;

        const report = createHomologationReport({
          modelName,
          vehicleType: "SIMPACK Mechanism",
          maxNadalYOverQ: 0.65,
          maxLateralForceYKn: 35.0,
          nominalAxleLoadQ0Kn: derivedAxleLoadKn,
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
          console.log(`Generated ${format.toUpperCase()} report at ${outFile}`);
        } else {
          console.log(outputText);
        }
      }
    }
  },
};

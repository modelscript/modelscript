// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Gamma Technologies GT-SUITE / GT-POWER Subcommand.
 *
 * Provides headless CLI operations for GT-SUITE engine & powertrain models (.gtm, .gtd, .gtx):
 * - `msx gtsuite lint <path>`
 * - `msx gtsuite summary <path>`
 * - `msx gtsuite simulate <path> [--duration=0.5] [--speed=3000] [--out=traj.csv]`
 * - `msx gtsuite to-modelica <path> [--out=Engine.mo]`
 * - `msx gtsuite to-sysml2 <path> [--out=Engine.sysml]`
 * - `msx gtsuite to-ssp <path> [--out=SystemStructure.ssd]`
 * - `msx gtsuite diagram <path> [--view=schematic|pv] [--out=engine.svg]`
 * - `msx gtsuite verify <path> [--max-bsfc=240] [--max-boost=2.8] [--max-nox=60]`
 */

import {
  gtsuiteToDae,
  gtsuiteToModelica,
  gtsuiteToSsp,
  gtsuiteToSysml2,
  lintGtModel,
  parseGtmModel,
  renderGtSuiteSchematicSvg,
  runGtSuiteSimulation,
  verifyEngineGates,
  type GtCylinderComponent,
} from "@modelscript/gtsuite";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const GtSuiteCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "gtsuite <action> [files...]",
  describe: "Inspect, lint, simulate, diagram, and project GT-SUITE / GT-POWER engine models (.gtm, .gtd, .gtx)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, summary, inspect, simulate, to-modelica, to-sysml2, to-ssp, to-dae, diagram, verify)",
        type: "string",
        choices: [
          "lint",
          "summary",
          "inspect",
          "simulate",
          "to-modelica",
          "to-sysml2",
          "to-ssp",
          "to-dae",
          "diagram",
          "verify",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "GT-SUITE model file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (for code generation, trajectories, or SVG diagrams)",
        type: "string",
      })
      .option("speed", {
        description: "Engine speed override in RPM",
        type: "number",
      })
      .option("duration", {
        description: "Simulation duration in seconds",
        type: "number",
        default: 0.5,
      })
      .option("view", {
        description: "Diagram view: 'schematic' or 'pv'",
        type: "string",
        choices: ["schematic", "pv"],
        default: "schematic",
      })
      .option("max-bsfc", {
        description: "Verification ceiling for BSFC in g/kWh",
        type: "number",
        default: 240.0,
      })
      .option("max-boost", {
        description: "Verification ceiling for boost pressure in bar",
        type: "number",
        default: 2.8,
      })
      .option("max-nox", {
        description: "Verification ceiling for NOx concentration in ppm",
        type: "number",
        default: 60.0,
      })
      .option("min-knock", {
        description: "Verification floor for knock safety margin",
        type: "number",
        default: 0.05,
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
    const speed = argv["speed"] as number | undefined;
    const duration = (argv["duration"] as number) ?? 0.5;
    const view = (argv["view"] as "schematic" | "pv") ?? "schematic";

    if (files.length === 0) {
      process.stderr.write("Error: No GT-SUITE model file provided.\n");
      process.exitCode = 1;
      return;
    }

    const filePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`Error: File not found: ${filePath}\n`);
      process.exitCode = 1;
      return;
    }

    const sourceText = fs.readFileSync(filePath, "utf-8");
    const model = parseGtmModel(sourceText);
    if (speed !== undefined) {
      model.simulationSettings.engineSpeedRpm = speed;
    }

    switch (action) {
      case "lint": {
        const diags = lintGtModel(model);
        if (format === "json") {
          process.stdout.write(JSON.stringify(diags, null, 2) + "\n");
        } else {
          if (diags.length === 0) {
            process.stdout.write(`✓ No issues found in '${model.name}'.\n`);
          } else {
            process.stdout.write(`Found ${diags.length} diagnostic(s) in '${model.name}':\n`);
            for (const d of diags) {
              const compStr = d.componentId ? ` [${d.componentId}]` : "";
              process.stdout.write(`  [${d.severity.toUpperCase()}] [${d.code}]${compStr} - ${d.message}\n`);
            }
          }
        }
        if (diags.some((d) => d.severity === "error")) {
          process.exitCode = 1;
        }
        break;
      }

      case "inspect":
      case "summary": {
        const cylinders = model.components.filter((c) => c.kind === "cylinder") as GtCylinderComponent[];
        let totalDisp = 0;
        for (const c of cylinders) {
          totalDisp += c.displacementM3 ?? (Math.PI / 4) * c.boreM * c.boreM * c.strokeM;
        }
        const summaryObj = {
          name: model.name,
          ratedSpeedRpm: model.simulationSettings.engineSpeedRpm,
          lambda: model.simulationSettings.airFuelRatioLambda,
          cylinderCount: cylinders.length,
          displacementLiters: (totalDisp * 1000).toFixed(2),
          componentsCount: model.components.length,
          connectionsCount: model.connections.length,
        };

        if (format === "json") {
          process.stdout.write(JSON.stringify(summaryObj, null, 2) + "\n");
        } else {
          process.stdout.write(`GT-SUITE Model Summary: ${model.name}\n`);
          process.stdout.write(`  Cylinders:       ${summaryObj.cylinderCount}\n`);
          process.stdout.write(`  Displacement:    ${summaryObj.displacementLiters} L\n`);
          process.stdout.write(`  Rated Speed:     ${summaryObj.ratedSpeedRpm} RPM\n`);
          process.stdout.write(`  Lambda (AFR):    ${summaryObj.lambda}\n`);
          process.stdout.write(`  Total Parts:     ${summaryObj.componentsCount}\n`);
          process.stdout.write(`  Connections:     ${summaryObj.connectionsCount}\n`);
        }
        break;
      }

      case "simulate": {
        const result = await runGtSuiteSimulation(model, sourceText, {
          durationSeconds: duration,
        });

        if (outPath) {
          // Export CSV trajectory
          const rows: string[] = ["Time_s,CrankAngle_deg,P_cyl_bar,Torque_Nm,Power_kW,BSFC_g_kWh,NOx_ppm"];
          for (const p of result.trajectories) {
            rows.push(
              `${p.timeS.toFixed(4)},${p.crankAngleDeg.toFixed(1)},${(p.cylinderPressurePa[0]! / 1e5).toFixed(2)},${p.engineBrakeTorqueNm.toFixed(1)},${p.enginePowerKw.toFixed(1)},${p.bsfcGPerKwh.toFixed(1)},${p.noxPpm.toFixed(1)}`,
            );
          }
          fs.writeFileSync(outPath, rows.join("\n"), "utf-8");
          process.stdout.write(`✓ Saved simulation trajectory to ${outPath}\n`);
        }

        if (format === "json") {
          process.stdout.write(JSON.stringify(result.summary, null, 2) + "\n");
        } else {
          process.stdout.write(`Simulation Results: ${model.name}\n`);
          process.stdout.write(`  Mean Brake Torque:   ${result.summary.meanTorqueNm.toFixed(1)} Nm\n`);
          process.stdout.write(`  Mean Power:          ${result.summary.meanPowerKw.toFixed(1)} kW\n`);
          process.stdout.write(`  Mean BSFC:           ${result.summary.meanBsfcGPerKwh.toFixed(1)} g/kWh\n`);
          process.stdout.write(`  Peak P_cyl:          ${result.summary.maxCylinderPressureBar.toFixed(1)} bar\n`);
          process.stdout.write(`  Thermal Efficiency:  ${(result.summary.thermalEfficiency * 100).toFixed(1)}%\n`);
          process.stdout.write(`  Knock Margin:        ${(result.summary.knockMargin * 100).toFixed(1)}%\n`);
        }
        break;
      }

      case "to-modelica": {
        const code = gtsuiteToModelica(model);
        if (outPath) {
          fs.writeFileSync(outPath, code, "utf-8");
          process.stdout.write(`✓ Exported Modelica model to ${outPath}\n`);
        } else {
          process.stdout.write(code + "\n");
        }
        break;
      }

      case "to-sysml2": {
        const code = gtsuiteToSysml2(model);
        if (outPath) {
          fs.writeFileSync(outPath, code, "utf-8");
          process.stdout.write(`✓ Exported SysML v2 model to ${outPath}\n`);
        } else {
          process.stdout.write(code + "\n");
        }
        break;
      }

      case "to-ssp": {
        const code = gtsuiteToSsp(model);
        if (outPath) {
          fs.writeFileSync(outPath, code, "utf-8");
          process.stdout.write(`✓ Exported FMI SSP XML to ${outPath}\n`);
        } else {
          process.stdout.write(code + "\n");
        }
        break;
      }

      case "to-dae": {
        process.stdout.write(`[gtsuite] Lowering ${path.basename(filePath)} to linear-memory DAE arena...\n`);
        const dae = gtsuiteToDae(model);
        process.stdout.write(`✔ DAE arena lowered successfully:\n`);
        process.stdout.write(`  Variables : ${dae.varCount}\n`);
        process.stdout.write(`  Equations : ${dae.eqCount}\n`);
        if (outPath) {
          fs.writeFileSync(outPath, JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2), "utf-8");
          process.stdout.write(`✔ DAE metadata written to: ${outPath}\n`);
        }
        break;
      }

      case "diagram": {
        const svg = renderGtSuiteSchematicSvg(model, { view });
        if (outPath) {
          fs.writeFileSync(outPath, svg, "utf-8");
          process.stdout.write(`✓ Exported ${view} SVG diagram to ${outPath}\n`);
        } else {
          process.stdout.write(svg + "\n");
        }
        break;
      }

      case "verify": {
        const maxBsfc = ((argv["max-bsfc"] ?? argv["maxBsfc"]) as number | undefined) ?? 350.0;
        const maxBoost = ((argv["max-boost"] ?? argv["maxBoost"]) as number | undefined) ?? 3.0;
        const maxNox = ((argv["max-nox"] ?? argv["maxNox"]) as number | undefined) ?? 100.0;
        const minKnock = ((argv["min-knock"] ?? argv["minKnock"]) as number | undefined) ?? 0.05;

        const result = await runGtSuiteSimulation(model, sourceText, {
          durationSeconds: duration,
        });
        const report = verifyEngineGates(result, {
          maxBsfcGPerKwh: maxBsfc,
          maxBoostBar: maxBoost,
          maxNoxPpm: maxNox,
          minKnockMargin: minKnock,
        });

        if (format === "json") {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        } else {
          process.stdout.write(report.markdownSummary + "\n");
        }

        if (!report.passed) {
          process.exitCode = 1;
        }
        break;
      }
    }
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OLGA Flow Assurance Subcommand.
 *
 * Provides headless CLI operations for OLGA multiphase flow models (.opi, .key, .genkey):
 * - `msx olga simulate <file> [--duration=3600] [--out=traj.csv]`
 * - `msx olga lint <files...>`
 * - `msx olga verify <file> [--maop=250] [--capacity=150]`
 * - `msx olga diagram <file> [--view=profile|schematic] [--out=bathymetry.svg]`
 * - `msx olga convert <file> [--to=genkey|opi|sysml2] [--out=converted.ext]`
 */

import { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } from "@modelscript/diagram/olga-diagram-builder";
import {
  lintOlgaModel,
  parseOlga,
  projectOlgaToSysml2,
  serializeKeyDeck,
  serializeOpi,
  simulateDriftFlux,
  verifyFlowAssuranceLimits,
  type FlowAssuranceLimits,
} from "@modelscript/olga";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OlgaCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "olga <action> [files...]",
  describe: "Simulate, lint, verify, and visualize OLGA multiphase flowline models (.opi, .key, .genkey)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (simulate, lint, verify, diagram, convert)",
        type: "string",
        choices: ["simulate", "lint", "verify", "diagram", "convert"],
        demandOption: true,
      })
      .positional("files", {
        description: "OLGA model file(s) to process (.opi, .key, .genkey)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for trajectory CSV or SVG diagram)",
        type: "string",
      })
      .option("duration", {
        alias: "t",
        description: "Simulation duration in seconds [s]",
        type: "number",
      })
      .option("dt", {
        description: "Simulation time step in seconds [s]",
        type: "number",
      })
      .option("view", {
        description: "Diagram view type: 'profile' (bathymetry Z(X)) or 'schematic' (P&ID)",
        type: "string",
        choices: ["profile", "schematic"],
        default: "profile",
      })
      .option("to", {
        description: "Target format for conversion ('genkey', 'opi', 'sysml2')",
        type: "string",
        choices: ["genkey", "opi", "sysml2"],
        default: "genkey",
      })
      .option("maop", {
        description: "Maximum Allowable Operating Pressure limit in bar [bar]",
        type: "number",
        default: 250,
      })
      .option("margin", {
        description: "Required hydrate avoidance subcooling margin in Kelvin [K]",
        type: "number",
        default: 3.0,
      })
      .option("capacity", {
        description: "Topside slug catcher maximum liquid surge capacity in m³ [m³]",
        type: "number",
        default: 150.0,
      })
      .option("min-vel", {
        description: "Minimum gas turndown velocity in m/s [m/s]",
        type: "number",
        default: 0.5,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    if (files.length === 0) {
      console.error("Error: No OLGA input files specified.");
      process.exit(1);
    }

    const filePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const model = parseOlga(content);

    switch (action) {
      case "simulate": {
        const durationSeconds = (argv["duration"] as number | undefined) ?? model.endTime - model.startTime;
        const timeStepSeconds = (argv["dt"] as number | undefined) ?? model.maxDt;
        console.log(`Simulating OLGA model '${model.title}' (duration=${durationSeconds}s, dt=${timeStepSeconds}s)...`);

        const simResult = simulateDriftFlux(model, {
          durationSeconds,
          timeStepSeconds,
        });

        const lastProfile = simResult.profiles[simResult.profiles.length - 1];
        const peakSurge = simResult.trends.peakLiquidSurgeVolume;
        const meanSlugL = simResult.trends.meanSlugLength?.[simResult.trends.meanSlugLength.length - 1] ?? 0;
        const slugFreq = simResult.trends.slugFrequency?.[simResult.trends.slugFrequency.length - 1] ?? 0;

        console.log("\n=======================================================");
        console.log("            OLGA SIMULATION RESULTS SUMMARY            ");
        console.log("=======================================================");
        console.log(` Model Title               : ${model.title}`);
        console.log(` Simulated Steps           : ${simResult.times.length}`);
        console.log(` Peak Arrival Surge Volume : ${peakSurge.toFixed(2)} m³`);
        console.log(
          ` Topside Arrival Pressure  : ${((simResult.trends.arrivalPressure[simResult.trends.arrivalPressure.length - 1] ?? 0) / 1e5).toFixed(1)} bar`,
        );
        console.log(
          ` Topside Arrival Temp      : ${((simResult.trends.arrivalTemperature[simResult.trends.arrivalTemperature.length - 1] ?? 273.15) - 273.15).toFixed(1)} °C`,
        );
        console.log(` Mean Slug Body Length     : ${meanSlugL.toFixed(1)} m`);
        console.log(` Slug Arrival Frequency    : ${slugFreq.toFixed(3)} Hz`);
        if (lastProfile?.pigs && lastProfile.pigs.length > 0) {
          const pig = lastProfile.pigs[0]!;
          console.log(
            ` Scraper Pig (${pig.name})   : ${(pig.position / 1000).toFixed(2)} km (v=${pig.velocity.toFixed(2)} m/s, swept=${pig.sweptLiquidVolume.toFixed(1)} m³)`,
          );
        }
        console.log("=======================================================\n");

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          if (resolvedOut.endsWith(".json")) {
            fs.writeFileSync(resolvedOut, JSON.stringify(simResult, null, 2), "utf-8");
          } else {
            // CSV format
            const lines: string[] = [
              "time,inlet_pressure_bar,arrival_pressure_bar,arrival_temperature_c,arrival_holdup,peak_surge_m3,mean_slug_length_m",
            ];
            for (let i = 0; i < simResult.times.length; i++) {
              lines.push(
                [
                  simResult.times[i]!.toFixed(1),
                  ((simResult.trends.inletPressure[i] ?? 0) / 1e5).toFixed(2),
                  ((simResult.trends.arrivalPressure[i] ?? 0) / 1e5).toFixed(2),
                  ((simResult.trends.arrivalTemperature[i] ?? 273.15) - 273.15).toFixed(2),
                  (simResult.trends.arrivalLiquidHoldup[i] ?? 0).toFixed(4),
                  peakSurge.toFixed(2),
                  (simResult.trends.meanSlugLength?.[i] ?? 0).toFixed(2),
                ].join(","),
              );
            }
            fs.writeFileSync(resolvedOut, lines.join("\n"), "utf-8");
          }
          console.log(`✔ Trajectory exported to ${resolvedOut}`);
        }
        break;
      }

      case "lint": {
        console.log(`Linting OLGA model '${model.title}'...`);
        const diagnostics = lintOlgaModel(model);
        if (diagnostics.length === 0) {
          console.log("✔ Pre-flight flow assurance checks passed with 0 diagnostics.");
        } else {
          console.log(`Found ${diagnostics.length} diagnostic(s):`);
          for (const d of diagnostics) {
            const tag = `[${d.code}] ${d.severity.toUpperCase()}`;
            console.log(`  ${tag}: ${d.message} (target: '${d.target}')`);
          }
          const hasErrors = diagnostics.some((d) => d.severity === "error");
          if (hasErrors) {
            process.exit(1);
          }
        }
        break;
      }

      case "verify": {
        const maopBar = (argv["maop"] as number) ?? 250;
        const marginK = (argv["margin"] as number) ?? 3.0;
        const capacityM3 = (argv["capacity"] as number) ?? 150.0;
        const minVel = (argv["min-vel"] as number) ?? 0.5;

        const limits: FlowAssuranceLimits = {
          maop: maopBar * 1e5,
          hydrateMarginKelvin: marginK,
          slugCatcherLiquidCapacity: capacityM3,
          minGasVelocity: minVel,
        };

        console.log(`Verifying flow assurance limits for '${model.title}'...`);
        const result = verifyFlowAssuranceLimits(model, limits);

        console.log("\n=======================================================");
        console.log("            FLOW ASSURANCE VERIFICATION REPORT         ");
        console.log("=======================================================");
        console.log(` Overall Compliance        : ${result.passed ? "PASSED" : "FAILED"}`);
        console.log(
          ` Hydrate Avoidance Check   : ${result.checks.hydrateAvoidance.passed ? "PASS" : "FAIL"} (Min Margin: ${result.checks.hydrateAvoidance.minMarginObserved.toFixed(1)} K vs ${marginK.toFixed(1)} K required)`,
        );
        console.log(
          ` Slug Catcher Capacity     : ${result.checks.slugCatcherSurge.passed ? "PASS" : "FAIL"} (Peak Surge: ${result.checks.slugCatcherSurge.peakArrivalLiquidVolume.toFixed(1)} m³ vs ${capacityM3.toFixed(1)} m³ limit)`,
        );
        console.log(
          ` MAOP Overpressure Check   : ${result.checks.maopOverpressure.passed ? "PASS" : "FAIL"} (Peak Observed: ${(result.checks.maopOverpressure.peakPressureObserved / 1e5).toFixed(1)} bar vs ${maopBar.toFixed(1)} bar limit)`,
        );
        console.log(
          ` Turndown Velocity Check   : ${result.checks.turndownVelocity.passed ? "PASS" : "FAIL"} (Min Gas Vel: ${result.checks.turndownVelocity.minVelocityObserved.toFixed(2)} m/s vs ${minVel.toFixed(2)} m/s required)`,
        );
        console.log("=======================================================\n");

        if (!result.passed) {
          process.exit(1);
        }
        break;
      }

      case "diagram": {
        const view = (argv["view"] as string) ?? "profile";
        let svg: string;
        if (view === "schematic") {
          svg = renderOlgaSchematicSvg(model);
        } else {
          const simResult = simulateDriftFlux(model, {
            durationSeconds: Math.min(model.endTime - model.startTime, 60),
            timeStepSeconds: 1.0,
          });
          svg = renderOlgaElevationProfileSvg(model, simResult);
        }

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          fs.writeFileSync(resolvedOut, svg, "utf-8");
          console.log(`✔ SVG diagram rendered to ${resolvedOut}`);
        } else {
          process.stdout.write(svg);
        }
        break;
      }

      case "convert": {
        const targetFormat = (argv["to"] as string) ?? "genkey";
        let converted: string;
        if (targetFormat === "sysml2") {
          converted = projectOlgaToSysml2(model);
        } else if (targetFormat === "opi") {
          converted = serializeOpi(model);
        } else {
          converted = serializeKeyDeck(model);
        }

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          fs.writeFileSync(resolvedOut, converted, "utf-8");
          console.log(`✔ Converted model written to ${resolvedOut}`);
        } else {
          process.stdout.write(converted);
        }
        break;
      }
    }
  },
};

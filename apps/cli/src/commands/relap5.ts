// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: RELAP5 Subcommand.
 *
 * Provides headless CLI operations for US NRC RELAP5-3D nuclear safety decks (.i, .inp, .r5):
 * - `msx relap5 inspect <file>`
 * - `msx relap5 lint <file>`
 * - `msx relap5 kinetics <file>`
 * - `msx relap5 to-dae <file>`
 * - `msx relap5 to-modelica <file>`
 */

import { lintRelap5, lowerRelap5ToDae, parseRelap5, relap5ToModelica, solvePointKinetics } from "@modelscript/relap5";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const Relap5Command: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "relap5 <action> [files...]",
  describe: "Inspect, lint, solve kinetics, and lower US NRC RELAP5-3D decks (.i, .inp, .r5)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, kinetics, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "kinetics", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "RELAP5 input deck file(s) (.i, .inp, .r5) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("duration", {
        alias: "d",
        description: "Kinetics simulation duration in seconds (default: 10.0)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const duration = argv["duration"] as number | undefined;

    if (files.length === 0) {
      console.error("[relap5] No RELAP5 deck file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[relap5] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseRelap5(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== RELAP5 Deck Summary: ${path.basename(file)} ===`);
          console.log(`Title:          ${deck.title}`);
          console.log(`Execution:      ${deck.executionType} (${deck.problemType})`);
          console.log(`Time Steps:     ${deck.timeSteps.length}`);
          console.log(`Volumes:        ${deck.volumes.size}`);
          for (const vol of deck.volumes.values()) {
            console.log(
              `  - Volume ${vol.id}: ${vol.name} (${vol.type}) [P = ${(vol.initialPressure / 1e6).toFixed(2)} MPa, T = ${vol.initialTemperature.toFixed(1)} K]`,
            );
          }
          console.log(`Junctions:      ${deck.junctions.size}`);
          for (const junc of deck.junctions.values()) {
            console.log(
              `  - Junction ${junc.id}: ${junc.fromVolume} -> ${junc.toVolume} (Area = ${junc.area.toFixed(3)} m²)`,
            );
          }
          console.log(`Heat Structs:   ${deck.heatStructures.size}`);
          console.log(`Trips:          ${deck.trips.size}`);
          console.log(
            `Reactor Core:   ${deck.kinetics ? `${(deck.kinetics.initialPower / 1e6).toFixed(1)} MWth with 6 delayed precursor groups` : "Thermal-hydraulic loop only"}`,
          );
          break;
        }

        case "lint": {
          const diags = lintRelap5(deck);
          if (diags.length === 0) {
            console.log(`[relap5] Clean deck: 0 diagnostics in ${path.basename(file)}.`);
          } else {
            console.log(`[relap5] Found ${diags.length} diagnostic(s) in ${path.basename(file)}:`);
            for (const d of diags) {
              const loc = d.range ? `:${d.range.startLine}:${d.range.startColumn}` : "";
              console.log(`  [${file}${loc}] ${d.severity.toUpperCase()}: [M${d.code}] ${d.message}`);
            }
            if (diags.some((d) => d.severity === "error")) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "kinetics": {
          const res = solvePointKinetics(deck, { duration });
          console.log(`\n=== Reactor Point Kinetics Simulation: ${path.basename(file)} ===`);
          console.log(`Duration:       ${res.totalDuration.toFixed(1)} s (${res.stepsCount} samples)`);
          console.log(`Initial Power:  ${res.initialPowerMW.toFixed(1)} MWth`);
          console.log(`Peak Power:     ${res.peakPowerMW.toFixed(1)} MWth`);
          console.log(`Final Power:    ${res.finalPowerMW.toFixed(1)} MWth`);
          console.log(`Peak Fuel Temp: ${res.peakFuelTempK.toFixed(1)} K`);
          break;
        }

        case "to-dae": {
          const dae = lowerRelap5ToDae(deck);
          console.log(`\n=== RELAP5 DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Arena Variables:  ${dae.variables().length}`);
          console.log(`Arena Equations:  ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const modelName = path.basename(file, path.extname(file));
          const moCode = relap5ToModelica(deck, modelName);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[relap5] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }
      }
    }
  },
};

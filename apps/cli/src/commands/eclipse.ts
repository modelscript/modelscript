// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: ECLIPSE Subcommand.
 *
 * Provides headless CLI operations for Schlumberger ECLIPSE reservoir decks (.data, .dat, .inc):
 * - `msx eclipse inspect <file>`
 * - `msx eclipse lint <file>`
 * - `msx eclipse solve <file>`
 * - `msx eclipse to-dae <file>`
 * - `msx eclipse to-modelica <file>`
 */

import {
  eclipseToModelica,
  lintEclipse,
  lowerEclipseToDae,
  parseEclipse,
  solveReservoirDepletion,
} from "@modelscript/eclipse";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const EclipseCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "eclipse <action> [files...]",
  describe: "Inspect, lint, solve reservoir depletion, and lower Schlumberger ECLIPSE decks (.data, .dat, .inc)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, solve, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "solve", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "ECLIPSE deck file(s) (.data, .dat, .inc) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("days", {
        alias: "d",
        description: "Simulation duration in days (default: 365.0)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const days = argv["days"] as number | undefined;

    if (files.length === 0) {
      console.error("[eclipse] No ECLIPSE deck file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[eclipse] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseEclipse(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          const dims = deck.dimensions;
          const totalCells = dims.nx * dims.ny * dims.nz;
          console.log(`\n=== ECLIPSE Reservoir Deck Summary: ${path.basename(file)} ===`);
          console.log(`Title:          ${deck.title}`);
          console.log(`Unit System:    ${deck.units}`);
          console.log(`Dimensions:     ${dims.nx} x ${dims.ny} x ${dims.nz} (${totalCells} total cells)`);
          console.log(`Active Phases:  Oil=${deck.phases.oil}, Water=${deck.phases.water}, Gas=${deck.phases.gas}`);
          console.log(`Avg Porosity:   ${(deck.grid.poro * 100).toFixed(1)}%`);
          console.log(`Permeability:   kx=${deck.grid.permX}mD, ky=${deck.grid.permY}mD, kz=${deck.grid.permZ}mD`);
          console.log(`PVDO Entries:   ${deck.props.pvdo.length}`);
          console.log(`SWOF Entries:   ${deck.props.swof.length}`);
          console.log(`Wells:          ${deck.wells.size}`);
          for (const [name, w] of deck.wells) {
            const role = w.productionControl ? "Producer" : w.injectionControl ? "Injector" : "Well";
            console.log(`  - ${name} (${role}, ${w.completions.length} completions) @ (${w.i}, ${w.j})`);
          }
          break;
        }

        case "lint": {
          const diagnostics = lintEclipse(deck);
          if (diagnostics.length === 0) {
            console.log(`[eclipse] ✓ ${path.basename(file)} passed all pre-flight checks (0 diagnostics).`);
          } else {
            console.log(`[eclipse] Found ${diagnostics.length} diagnostic(s) in ${path.basename(file)}:`);
            for (const d of diagnostics) {
              const prefix = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
              console.log(`  [M${d.code}] ${prefix} (${d.rule}): ${d.message}`);
            }
          }
          break;
        }

        case "solve": {
          const res = solveReservoirDepletion(deck, { totalDays: days ?? 365.0 });
          const volUnit = deck.units === "FIELD" ? "STB" : "sm3";
          const pUnit = deck.units === "FIELD" ? "psi" : "bar";
          console.log(`\n=== ECLIPSE Reservoir Depletion Results: ${path.basename(file)} ===`);
          console.log(
            `Pore Volume:         ${res.poreVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} bbl/m3`,
          );
          console.log(
            `STOIIP:              ${res.stoiip.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${volUnit}`,
          );
          console.log(`Initial Pressure:    ${res.initialPressure.toFixed(1)} ${pUnit}`);
          console.log(`Final Pressure:      ${res.finalPressure.toFixed(1)} ${pUnit}`);
          console.log(
            `Cum Oil Produced:    ${res.cumulativeOilProduced.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${volUnit}`,
          );
          console.log(`Recovery Factor:     ${(res.recoveryFactor * 100).toFixed(2)}%`);
          console.log(`Time Steps Solved:   ${res.stepsCount}`);
          break;
        }

        case "to-dae": {
          const dae = lowerEclipseToDae(deck);
          console.log(`\n=== Lowered DAE Summary: ${path.basename(file)} ===`);
          console.log(`Variables:           ${dae.variables().length}`);
          console.log(`Equations:           ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const modelName = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_]/g, "_");
          const moCode = eclipseToModelica(deck, modelName);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[eclipse] Modelica model written to: ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        default:
          console.error(`[eclipse] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

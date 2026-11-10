// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: LBNL TOUGH Geothermal Subcommand.
 *
 * Provides headless CLI operations for LBNL TOUGH2/3 geothermal reservoir decks (.dat/.tgh/.tough):
 * - `msx tough inspect <file>`
 * - `msx tough lint <file>`
 * - `msx tough flash <file>`
 * - `msx tough to-dae <file>`
 */

import { printArenaDAE } from "@modelscript/runtime";
import {
  lintTough,
  lowerToughToDae,
  parseTough,
  solveGeothermalWells,
} from "@modelscript/tough";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const ToughCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "tough <action> [files...]",
  describe:
    "Inspect, lint, solve geothermal wellbore flashing thermodynamics, and lower LBNL TOUGH2/3 reservoir decks (.tgh, .dat, .tough)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, flash, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "flash", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "TOUGH input deck(s) (.tgh, .dat) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[tough] No TOUGH reservoir deck file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[tough] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseTough(text);

      switch (action) {
        case "lint": {
          console.log(`[tough] Linting ${path.basename(file)}...`);
          const diags = lintTough(deck);
          if (diags.length === 0) {
            console.log("  ✔ No reservoir or thermodynamics diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [M${d.code}] Line ${d.line ?? 1}: ${d.message}`);
            }
            const errors = diags.filter((d) => d.severity === "error");
            if (errors.length > 0) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "inspect":
        case "summary": {
          console.log(`=== LBNL TOUGH Geothermal Deck: ${deck.title || path.basename(file)} ===`);
          console.log(`  Rock Formations:    ${deck.rocks.length}`);
          for (const r of deck.rocks) {
            console.log(
              `    - Formation '${r.name}': kX=${r.permeabilityX.toExponential(2)} m², por=${r.porosity}, rho=${r.density} kg/m³`,
            );
          }
          console.log(`  Grid Elements:      ${deck.elements.length}`);
          console.log(`  Connections:        ${deck.connections.length}`);
          console.log(`  Generators / Wells: ${deck.generators.length}`);
          for (const g of deck.generators) {
            console.log(
              `    - Well '${g.name}' (Element: ${g.elem}, Type: ${g.type}): Q=${g.rate} kg/s, h=${g.enthalpy} J/kg`,
            );
          }
          break;
        }

        case "flash":
        case "solve": {
          const wellSolutions = solveGeothermalWells(deck);
          console.log(`=== LBNL TOUGH Geothermal Wellbore Flashing & Enthalpy ===`);
          console.log(`  Producible Wells: ${wellSolutions.length}`);
          for (const w of wellSolutions) {
            console.log(
              `    - Well '${w.wellName}' (Elem: ${w.element}): Steam Fraction=${(w.steamFraction * 100).toFixed(1)}%, Flow=${w.massRateKgS.toFixed(2)} kg/s, Enthalpy=${(w.enthalpyJPerKg / 1e3).toFixed(1)} kJ/kg, Thermal Power=${w.thermalPowerMW.toFixed(2)} MWth`,
            );
          }
          break;
        }

        case "to-dae": {
          const arena = lowerToughToDae(deck);
          console.log(`[tough] Lowered reservoir deck to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[tough] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[tough] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: IBIS Subcommand.
 *
 * Provides headless CLI operations for ANSI/EIA-656-B IBIS models (.ibs):
 * - `msx ibis inspect <file>`
 * - `msx ibis lint <file>`
 * - `msx ibis to-dae <file>`
 * - `msx ibis to-modelica <file>`
 * - `msx ibis eval <file>`
 */

import {
  calculateOutputResistance,
  evaluateBufferCurrent,
  ibisToModelica,
  lintIbis,
  lowerIbisToDae,
  parseIbis,
} from "@modelscript/ibis";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const IbisCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ibis <action> [files...]",
  describe: "Inspect, lint, evaluate, and lower ANSI/EIA-656-B IBIS buffer models (.ibs)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, to-dae, to-modelica, eval)",
        type: "string",
        choices: ["inspect", "summary", "lint", "to-dae", "to-modelica", "eval"],
        demandOption: true,
      })
      .positional("files", {
        description: "IBIS model file(s) (.ibs) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[ibis] No IBIS file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[ibis] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseIbis(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== IBIS Document Summary: ${path.basename(file)} ===`);
          console.log(`IBIS Version:  ${deck.ibisVer}`);
          console.log(`Components:    ${deck.components.size}`);
          for (const [compName, comp] of deck.components) {
            console.log(`  Component '${compName}': ${comp.pins.size} pins (Mfr: ${comp.manufacturer ?? "Unknown"})`);
          }
          console.log(`Buffer Models: ${deck.models.size}`);
          for (const [modName, mod] of deck.models) {
            console.log(
              `  Model '${modName}': [${mod.modelType}] Vcc=${mod.voltageRange.typ}V, Ccomp=${(mod.cComp.typ * 1e12).toFixed(2)}pF`,
            );
          }
          break;
        }

        case "lint": {
          const diags = lintIbis(deck);
          console.log(`\n=== IBIS Lint Results: ${path.basename(file)} ===`);
          if (diags.length === 0) {
            console.log("✓ No issues detected (0 diagnostics).");
          } else {
            for (const d of diags) {
              const prefix = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(`[${prefix}] [M${d.code}] Line ${d.range.startLine}: ${d.message}`);
            }
          }
          break;
        }

        case "to-dae": {
          const dae = lowerIbisToDae(deck);
          console.log(`\n=== IBIS DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Model Name:    IbisBufferModule`);
          console.log(`DAE Variables: ${dae.variables().length}`);
          console.log(`DAE Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = ibisToModelica(deck);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[ibis] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "eval": {
          console.log(`\n=== IBIS Buffer Evaluation: ${path.basename(file)} ===`);
          for (const [modName, mod] of deck.models) {
            const { rOnLow, rOnHigh } = calculateOutputResistance(mod);
            const curr = evaluateBufferCurrent(mod, mod.voltageRange.typ * 0.9, 1);
            console.log(`Model '${modName}':`);
            console.log(`  R_on (Low):  ${rOnLow.toFixed(1)} Ω`);
            console.log(`  R_on (High): ${rOnHigh.toFixed(1)} Ω`);
            console.log(`  I_out (High bias): ${(curr.iTotal * 1e3).toFixed(2)} mA`);
          }
          break;
        }

        default:
          console.error(`[ibis] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

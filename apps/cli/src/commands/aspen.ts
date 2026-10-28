// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Aspen Plus Subcommand.
 *
 * Provides headless CLI operations for Aspen Plus input decks (.in, .inp, .bkp):
 * - `msx aspen inspect <file>`
 * - `msx aspen lint <file>`
 * - `msx aspen to-dae <file>`
 * - `msx aspen to-modelica <file>`
 * - `msx aspen solve-flash <file>`
 */

import { aspenToModelica, lintAspen, lowerAspenToDae, parseAspen, solveFlashRachfordRice } from "@modelscript/aspen";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const AspenCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "aspen <action> [files...]",
  describe: "Inspect, lint, solve, and lower Aspen Plus chemical process flowsheets (.in, .inp, .bkp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, to-dae, to-modelica, solve-flash)",
        type: "string",
        choices: ["inspect", "summary", "lint", "to-dae", "to-modelica", "solve-flash"],
        demandOption: true,
      })
      .positional("files", {
        description: "Aspen Plus input deck file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("stream", {
        alias: "s",
        description: "Target feed stream ID for flash VLE calculation",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const targetStream = argv["stream"] as string | undefined;

    if (files.length === 0) {
      console.error("[aspen] No Aspen Plus input deck file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[aspen] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseAspen(text);

      switch (action) {
        case "lint": {
          console.log(`[aspen] Linting ${path.basename(file)}...`);
          const diags = lintAspen(deck);
          if (diags.length === 0) {
            console.log("  ✔ No chemical process or parameter diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [${d.code}] Line ${d.loc.startLine}: ${d.message}`);
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
          console.log(`=== Aspen Plus Flowsheet: ${deck.title || path.basename(file)} ===`);
          console.log(`  Units:            ${deck.units || "MET"}`);
          console.log(`  Property Method:  ${deck.propertyMethod || "NRTL"}`);
          console.log(`  Components:       ${deck.components.size} (${Array.from(deck.components.keys()).join(", ")})`);
          console.log(`  Flowsheet Blocks: ${deck.flowsheet.length}`);
          console.log(`  Streams Defined:  ${deck.streams.size}`);
          console.log("");
          console.log("  Unit Operations:");
          for (const entry of deck.flowsheet) {
            const blk = deck.blocks.get(entry.blockId);
            console.log(
              `    - ${entry.blockId.padEnd(10, " ")} [${(blk?.type ?? "CUSTOM").padEnd(8, " ")}] IN: [${entry.inlets.join(", ")}] OUT: [${entry.outlets.join(", ")}]`,
            );
          }
          break;
        }

        case "to-dae": {
          const dae = lowerAspenToDae(deck);
          console.log(`[aspen] Lowered flowsheet to DAE arena:`);
          console.log(`  Variables: ${dae.variables().length}`);
          console.log(`  Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = aspenToModelica(deck);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), moCode, "utf-8");
            console.log(`[aspen] Exported Modelica model to ${out}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "solve-flash": {
          const sId = targetStream ?? deck.streams.keys().next().value ?? "FEED";
          const s = deck.streams.get(sId);
          if (!s) {
            console.error(`[aspen] Stream '${sId}' not found in deck.`);
            process.exit(1);
          }
          const comps = Array.from(s.moleFractions.keys());
          const fracs = comps.map((c) => s.moleFractions.get(c)!);
          const flashRes = solveFlashRachfordRice({
            temperature: s.temperature ?? 75.0,
            pressure: s.pressure ?? 1.2,
            components: comps,
            moleFractions: fracs,
            totalFlow: s.moleFlow ?? 100.0,
          });
          console.log(`=== Flash VLE Solution for Stream '${sId}' ===`);
          console.log(`  State:            ${flashRes.state}`);
          console.log(`  Vapor Fraction:   ${(flashRes.vaporFraction * 100).toFixed(2)}%`);
          console.log(`  Vapor Flow Rate:  ${flashRes.vaporFlow.toFixed(2)} kmol/hr`);
          console.log(`  Liquid Flow Rate: ${flashRes.liquidFlow.toFixed(2)} kmol/hr`);
          console.log(`  Component Equilibrium:`);
          for (let i = 0; i < comps.length; i++) {
            console.log(
              `    - ${comps[i]!.padEnd(10, " ")} z=${fracs[i]!.toFixed(3)}  x=${flashRes.liquidFractions[i]!.toFixed(3)}  y=${flashRes.vaporFractions[i]!.toFixed(3)}  K=${flashRes.kValues[i]!.toFixed(3)}`,
            );
          }
          break;
        }
      }
    }
  },
};

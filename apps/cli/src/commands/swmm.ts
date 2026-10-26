// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: US EPA SWMM Subcommand.
 *
 * Provides headless CLI operations for SWMM stormwater and wastewater networks (.inp):
 * - `msx swmm inspect <file>`
 * - `msx swmm lint <file>`
 * - `msx swmm to-dae <file>`
 * - `msx swmm to-modelica <file>`
 * - `msx swmm route-flow <file>`
 */

import { lintSwmm, lowerSwmmToDae, parseSwmm, routeNetworkFlow, swmmToModelica } from "@modelscript/swmm";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SwmmCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "swmm <action> [files...]",
  describe: "Inspect, lint, route, and lower US EPA SWMM 5.x stormwater networks (.inp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, to-dae, to-modelica, route-flow)",
        type: "string",
        choices: ["inspect", "summary", "lint", "to-dae", "to-modelica", "route-flow"],
        demandOption: true,
      })
      .positional("files", {
        description: "SWMM input deck (.inp) file(s) to process",
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
      console.error("[swmm] No SWMM network file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[swmm] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseSwmm(text);

      switch (action) {
        case "lint": {
          console.log(`[swmm] Linting ${path.basename(file)}...`);
          const diags = lintSwmm(deck);
          if (diags.length === 0) {
            console.log("  ✔ No hydraulic network or slope diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [${d.code}] Line ${d.range.startLine}: ${d.message}`);
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
          console.log(`=== SWMM Network: ${deck.title || path.basename(file)} ===`);
          console.log(`  Flow Units:       ${deck.flowUnits}`);
          console.log(`  Routing Model:    ${deck.routingModel}`);
          console.log(`  Junctions:        ${deck.junctions.size}`);
          console.log(`  Outfalls:         ${deck.outfalls.size}`);
          console.log(`  Conduits:         ${deck.conduits.size}`);
          console.log(`  Pumps:            ${deck.pumps.size}`);
          console.log(`  Weirs:            ${deck.weirs.size}`);
          console.log(`  Cross-Sections:   ${deck.crossSections.size}`);
          console.log(`  Subcatchments:    ${deck.subcatchments.size}`);
          break;
        }

        case "to-dae": {
          const dae = lowerSwmmToDae(deck);
          console.log(`[swmm] Lowered network to DAE arena:`);
          console.log(`  Variables: ${dae.variables().length}`);
          console.log(`  Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = swmmToModelica(deck);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), moCode, "utf-8");
            console.log(`[swmm] Exported Modelica model to ${out}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "route-flow": {
          const result = routeNetworkFlow(deck);
          console.log(`=== SWMM Hydraulic Routing Summary ===`);
          console.log(`  Total Inflow:     ${result.totalInflow.toFixed(3)} ${deck.flowUnits}`);
          console.log(`  Total Outflow:    ${result.totalOutflow.toFixed(3)} ${deck.flowUnits}`);
          console.log(`  Flooding Active:  ${result.isFlooding ? "YES" : "NO"}`);
          console.log(`  Conduit Discharges:`);
          for (const [id, res] of result.conduits) {
            console.log(
              `    - ${id.padEnd(12, " ")} Q=${res.flowRate.toFixed(3).padEnd(8, " ")} V=${res.velocity.toFixed(2).padEnd(6, " ")} Depth=${res.depth.toFixed(2).padEnd(6, " ")} Status=${res.status}`,
            );
          }
          break;
        }
      }
    }
  },
};

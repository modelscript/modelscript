// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OpenDSS Subcommand.
 *
 * Provides headless CLI operations for EPRI OpenDSS distribution network circuits (.dss):
 * - `msx opendss inspect <file>`
 * - `msx opendss lint <file>`
 * - `msx opendss powerflow <file>`
 * - `msx opendss to-dae <file>`
 * - `msx opendss to-modelica <file>`
 */

import {
  lintOpenDss,
  lowerOpenDssToDae,
  openDssToModelica,
  parseOpenDss,
  solveDistributionPowerFlow,
} from "@modelscript/opendss";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenDssCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "opendss <action> [files...]",
  describe: "Inspect, lint, solve power flow, and lower EPRI OpenDSS distribution circuits (.dss)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, powerflow, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "powerflow", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "OpenDSS circuit script(s) (.dss) to process",
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
      console.error("[opendss] No OpenDSS circuit file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[opendss] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseOpenDss(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== OpenDSS Circuit Summary: ${path.basename(file)} ===`);
          if (deck.circuit) {
            console.log(
              `Substation Circuit: ${deck.circuit.name} (${deck.circuit.baseKv} kV, ${deck.circuit.pu} pu, Bus: ${deck.circuit.bus1})`,
            );
          } else {
            console.log(`Substation Circuit: [No Circuit source defined]`);
          }
          console.log(`Transformers: ${deck.transformers.size}`);
          console.log(`Lines:        ${deck.lines.size}`);
          console.log(`Loads:        ${deck.loads.size}`);
          console.log(`PV Systems:   ${deck.pvSystems.size}`);
          console.log(`Storage BESS: ${deck.storages.size}`);
          console.log(`Capacitors:   ${deck.capacitors.size}`);
          break;
        }

        case "lint": {
          const diags = lintOpenDss(deck);
          console.log(`\n=== OpenDSS Lint Results: ${path.basename(file)} ===`);
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

        case "powerflow": {
          const pf = solveDistributionPowerFlow(deck);
          console.log(`\n=== OpenDSS Power Flow Results: ${path.basename(file)} ===`);
          console.log(`Status:       ${pf.converged ? "✓ CONVERGED" : "⚠ DID NOT CONVERGE"}`);
          console.log(`Iterations:   ${pf.iterations}`);
          console.log(`Total Load:   ${pf.totalLoadKw.toFixed(1)} kW + j${pf.totalLoadKvar.toFixed(1)} kvar`);
          console.log(`Total Gen:    ${pf.totalGenKw.toFixed(1)} kW`);
          console.log(`Losses:       ${pf.lossesKw.toFixed(2)} kW`);
          console.log(`Bus Voltages:`);
          for (const [bName, bRes] of pf.buses) {
            console.log(`  Bus '${bName}': ${bRes.voltagePu.toFixed(4)} pu (${bRes.voltageKv.toFixed(2)} kV)`);
          }
          break;
        }

        case "to-dae": {
          const dae = lowerOpenDssToDae(deck);
          console.log(`\n=== OpenDSS DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Model Name:    ${deck.circuit?.name || "DistributionGrid"}`);
          console.log(`DAE Variables: ${dae.variables().length}`);
          console.log(`DAE Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = openDssToModelica(deck);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[opendss] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        default:
          console.error(`[opendss] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

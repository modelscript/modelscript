// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: ATP-EMTP Subcommand (`msx atp <action> [files...]`).
 *
 * Provides headless CLI operations for Alternative Transients Program (ATP-EMTP) card decks:
 * - `msx atp lint <files...>`: Pre-flight syntax, isolated bus, and parameter checks (ATP1001-ATP4001)
 * - `msx atp summary <files...>`: Circuit components, time step, branch cards, switches, and sources
 * - `msx atp simulate <files...>`: Dommel companion-matrix trapezoidal electromagnetic transient simulation
 * - `msx atp to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { lintAtpCase, lowerAtpToDae, parseAtp, simulateAtpCase } from "@modelscript/atp";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const AtpCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "atp <action> [files...]",
  describe: "Inspect, lint, simulate, and convert ATP-EMTP electromagnetic transient card decks (.atp, .dat)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, simulate, to-dae)",
        type: "string",
        choices: ["lint", "summary", "simulate", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "ATP-EMTP file(s) (.atp, .dat)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Output destination path",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"] ?? "summary");
    const rawFiles = (argv["files"] as string[]) ?? [];

    if (rawFiles.length === 0) {
      console.error("Error: At least one ATP-EMTP file (.atp, .dat) is required.");
      process.exit(1);
    }

    for (const rawFile of rawFiles) {
      const filePath = path.resolve(process.cwd(), rawFile);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const baseName = path.basename(filePath, path.extname(filePath));
      const atpCase = parseAtp(content);

      if (action === "lint") {
        const diagnostics = lintAtpCase(atpCase);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No ATP-EMTP lint violations found.`);
        } else {
          console.log(`\nDiagnostics for ${rawFile}:`);
          for (const d of diagnostics) {
            const sev = d.severity === "error" ? "ERROR" : "WARN";
            console.log(`  [${sev}] [${d.code}] ${d.message}`);
          }
        }
        continue;
      }

      if (action === "summary") {
        console.log(`\n================================================================================`);
        console.log(`                 ATP-EMTP TRANSIENT CASE SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Case Title:           ${atpCase.title}`);
        console.log(` Delta T (Time Step):  ${(atpCase.control.deltaTSec * 1e6).toFixed(2)} µs`);
        console.log(` Tmax (Duration):      ${(atpCase.control.tMaxSec * 1e3).toFixed(2)} ms`);
        console.log(` RLC Branches:         ${atpCase.branches.length}`);
        console.log(` Breaker Switches:     ${atpCase.switches.length}`);
        console.log(` Voltage/Current Sources:${atpCase.sources.length}`);
        console.log(` Monitored Outputs:    ${atpCase.outputNodes.length}`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "simulate") {
        const result = simulateAtpCase(atpCase);
        console.log(`\nSimulated ${result.stepCount} transient steps:`);
        console.log(`  Monitored Nodes:   ${result.nodeVoltages.size}`);
        console.log(`  Max Residual:      ${result.residualMax.toExponential(3)}`);
        console.log(`  RMSE:              ${result.rmse.toExponential(3)}`);
        console.log(`  Convergence:       ${result.converged ? "PASSED" : "FAILED"}\n`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerAtpToDae(atpCase);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered ATP-EMTP case to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

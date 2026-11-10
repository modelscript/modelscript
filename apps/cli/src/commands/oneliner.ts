// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: ASPEN OneLiner Subcommand (`msx oneliner <action> [files...]`).
 *
 * Provides headless CLI operations for ASPEN OneLiner / CAPE short-circuit cases:
 * - `msx oneliner lint <files...>`: Pre-flight bus, branch, and relay coordination checks (OLX1001-OLX4001)
 * - `msx oneliner summary <files...>`: Power grid summary (buses, lines, mutuals, generators, and relays)
 * - `msx oneliner solve-fault <files...>`: Symmetrical components 3-phase and SLG short-circuit calculation
 * - `msx oneliner to-dxt <files...>`: Export DXT text format
 * - `msx oneliner to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import {
  calculateBusFaultCurrents,
  lintOneLinerCase,
  lowerOneLinerToDae,
  parseOneLiner,
  writeOneLinerDxt,
} from "@modelscript/oneliner";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OnelinerCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "oneliner <action> [files...]",
  describe: "Inspect, lint, solve short-circuit faults, and convert ASPEN OneLiner / CAPE cases (.olx, .dxt)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, solve-fault, to-dxt, to-dae)",
        type: "string",
        choices: ["lint", "summary", "solve-fault", "to-dxt", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "OneLiner file(s) (.olx, .dxt, .json)",
        type: "string",
        array: true,
      })
      .option("bus", {
        alias: "b",
        type: "string",
        describe: "Bus ID or number to fault",
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
      console.error("Error: At least one OneLiner file (.olx, .dxt) is required.");
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
      const oneCase = parseOneLiner(content);

      if (action === "lint") {
        const diagnostics = lintOneLinerCase(oneCase);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No ASPEN OneLiner lint violations found.`);
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
        console.log(`                 ASPEN ONELINER CASE SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Case Title:           ${oneCase.title}`);
        console.log(` Base MVA:             ${oneCase.baseMva} MVA`);
        console.log(` Nominal Frequency:    ${oneCase.frequencyHz} Hz`);
        console.log(` Buses:                ${oneCase.busses.length}`);
        console.log(` Branches / Lines:     ${oneCase.branches.length}`);
        console.log(` Mutual Couplings:     ${oneCase.mutuals.length}`);
        console.log(` Generators:           ${oneCase.generators.length}`);
        console.log(` Protective Relays:    ${oneCase.overcurrentRelays.length + oneCase.distanceRelays.length}`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "solve-fault") {
        if (oneCase.busses.length === 0) {
          console.error("Error: No buses present in OneLiner case.");
          process.exit(1);
        }
        const busTarget = argv["bus"] ? String(argv["bus"]) : oneCase.busses[0]!.id;
        const faultRes = calculateBusFaultCurrents(oneCase, busTarget);

        console.log(`\nShort Circuit Calculation at Bus '${faultRes.busId}':`);
        console.log(`  Nominal Voltage:     ${faultRes.vNominalVolts.toFixed(1)} V`);
        console.log(`  3-Phase Fault:       ${faultRes.i3PhaseA.toFixed(2)} A`);
        console.log(`  SLG Fault Current:   ${faultRes.iSlgA.toFixed(2)} A`);
        console.log(`  Thevenin Z1 Mag:     ${faultRes.z1Thevenin.mag.toFixed(4)} Ω`);
        console.log(`  Thevenin Z0 Mag:     ${faultRes.z0Thevenin.mag.toFixed(4)} Ω`);
        console.log(`  Residual Error:      ${faultRes.residualMax.toExponential(3)}\n`);
        continue;
      }

      if (action === "to-dxt") {
        const dxtText = writeOneLinerDxt(oneCase);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.dxt`);
        fs.writeFileSync(outPath, dxtText, "utf-8");
        console.log(`Successfully exported OneLiner DXT text to:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerOneLinerToDae(oneCase);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered OneLiner case to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

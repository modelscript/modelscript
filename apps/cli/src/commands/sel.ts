// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: SEL Relay Settings Subcommand (`msx sel <action> [files...]`).
 *
 * Provides headless CLI operations for Schweitzer Engineering Laboratories relay settings:
 * - `msx sel lint <files...>`: Pre-flight relay ID, coordination, and circular SELogic checks (SEL1001-SEL4001)
 * - `msx sel summary <files...>`: Relay model, active group, CT/PT ratios, and protection pickups
 * - `msx sel evaluate-protection <files...>`: Simulate fault currents/impedances and evaluate SELogic trip gates
 * - `msx sel to-ascii <files...>`: Export clean SEL ASCII settings dump (.rcf, .sel)
 * - `msx sel to-json <files...>`: Export JSON settings database (.rdb)
 * - `msx sel to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { printArenaDAE } from "@modelscript/runtime";
import {
  evaluateRelayProtection,
  lintSELSettings,
  lowerSELToDae,
  parseSELSettings,
  writeSELAscii,
  writeSELJson,
} from "@modelscript/sel";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SelCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "sel <action> [files...]",
  describe: "Inspect, lint, evaluate protection, and convert SEL relay settings (.rcf, .rdb, .sel, .txt)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, evaluate-protection, to-ascii, to-json, to-dae)",
        type: "string",
        choices: ["lint", "summary", "evaluate-protection", "to-ascii", "to-json", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "SEL settings file(s) (.rcf, .rdb, .sel, .txt, .json)",
        type: "string",
        array: true,
      })
      .option("current", {
        alias: "i",
        type: "number",
        default: 20.0,
        describe: "Phase current in amperes to evaluate",
      })
      .option("impedance", {
        alias: "z",
        type: "number",
        describe: "Fault loop impedance in ohms to evaluate distance reach",
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
      console.error("Error: At least one SEL settings file is required.");
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
      const settings = parseSELSettings(content);

      if (action === "lint") {
        const diagnostics = lintSELSettings(settings);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No SEL relay settings violations found.`);
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
        const grp = settings.groups.get(settings.activeGroup);
        console.log(`\n================================================================================`);
        console.log(`                 SEL RELAY SETTINGS SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Relay Identifier:     ${settings.relayId}`);
        console.log(` Relay Model:          ${settings.relayType}`);
        console.log(` Terminal Identifier:  ${settings.terminalId}`);
        console.log(` Active Group:         ${settings.activeGroup} (Total Groups: ${settings.groups.size})`);
        console.log(` CT Ratio (Phase/Gnd): ${settings.ratios.ctRatioPhase} / ${settings.ratios.ctRatioGround}`);
        console.log(` PT Ratio:             ${settings.ratios.ptRatioPhase}`);
        if (grp?.phaseOvercurrent) {
          console.log(` 50P1P Instantaneous:  ${grp.phaseOvercurrent.inst50P1P ?? "OFF"} A`);
          console.log(
            ` 51P1P Time-Overcurrent:${grp.phaseOvercurrent.time51P1P ?? "OFF"} A (${grp.phaseOvercurrent.curve51P1C ?? "U3"}, TD=${grp.phaseOvercurrent.timeDial51P1TD ?? 1})`,
          );
        }
        if (grp?.distance) {
          console.log(` Z1P Zone 1 Reach:     ${grp.distance.zone1Reach ?? "OFF"} Ω`);
          console.log(` Z2P Zone 2 Reach:     ${grp.distance.zone2Reach ?? "OFF"} Ω`);
        }
        if (grp) {
          console.log(` SELogic Equations:    ${Object.keys(grp.equations).length}`);
        }
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "evaluate-protection") {
        const curA = Number(argv["current"] ?? 20.0);
        const zOhms = argv["impedance"] !== undefined ? Number(argv["impedance"]) : undefined;
        const result = evaluateRelayProtection(settings, {
          phaseCurrentA: curA,
          faultImpedanceOhms: zOhms,
        });

        console.log(`\nProtection Evaluation for I=${curA}A${zOhms !== undefined ? `, Z=${zOhms}Ω` : ""}:`);
        console.log(`  Trip Contact Status: ${result.tripped ? "TRIP (ASSERTED)" : "NORMAL (OPEN)"}`);
        console.log(`  Close Contact Status:${result.closed ? "CLOSE (ASSERTED)" : "OPEN"}`);
        if (result.overcurrentTripTimeSeconds < Infinity) {
          console.log(`  TOC Trip Time:       ${result.overcurrentTripTimeSeconds.toFixed(3)} s`);
        }
        if (zOhms !== undefined) {
          console.log(`  Distance Zone 1:     ${result.distanceZonePickups.zone1 ? "PICKUP" : "RESTRAIN"}`);
          console.log(`  Distance Zone 2:     ${result.distanceZonePickups.zone2 ? "PICKUP" : "RESTRAIN"}`);
        }
        console.log(
          `  SELogic Convergence: ${result.converged ? "CONVERGED" : "FAILED"} in ${result.iterations} iterations\n`,
        );
        continue;
      }

      if (action === "to-ascii") {
        const asciiText = writeSELAscii(settings);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.rcf`);
        fs.writeFileSync(outPath, asciiText, "utf-8");
        console.log(`Successfully exported SEL ASCII settings to:\n  ${outPath}`);
        continue;
      }

      if (action === "to-json") {
        const jsonText = writeSELJson(settings);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.rdb`);
        fs.writeFileSync(outPath, jsonText, "utf-8");
        console.log(`Successfully exported SEL JSON database to:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerSELToDae(settings);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered SEL relay settings to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

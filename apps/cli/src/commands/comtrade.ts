// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: COMTRADE Subcommand (`msx comtrade <action> [files...]`).
 *
 * Provides headless CLI operations for IEEE C37.111 / IEC 60255-24 COMTRADE recordings:
 * - `msx comtrade lint <files...>`: Pre-flight format, channel count, and sample rate validation
 * - `msx comtrade summary <files...>`: Station metadata, channel roster, duration, and sampling rates
 * - `msx comtrade extract-phasor <files...>`: 1-cycle sliding DFT dynamic phasor extraction
 * - `msx comtrade to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 * - `msx comtrade to-cff <files...>`: Package .cfg and .dat into single unified .cff container
 */

import {
  extractPhasorSeries,
  lintComtradeRecord,
  lowerComtradeToDae,
  parseComtradeCfg,
  parseComtradeDatAscii,
  writeComtradeCff,
  type ComtradeRecord,
} from "@modelscript/comtrade";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const ComtradeCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "comtrade <action> [files...]",
  describe: "Inspect, lint, analyze, and convert COMTRADE fault recordings (.cfg, .dat, .cff)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, extract-phasor, to-dae, to-cff)",
        type: "string",
        choices: ["lint", "summary", "extract-phasor", "to-dae", "to-cff"],
        demandOption: true,
      })
      .positional("files", {
        description: "COMTRADE file(s) (.cfg, .dat, .cff)",
        type: "string",
        array: true,
      })
      .option("channel", {
        alias: "c",
        type: "number",
        default: 0,
        describe: "Analog channel index for phasor extraction",
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
      console.error("Error: At least one COMTRADE file (.cfg or .cff) is required.");
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
      const datPath = filePath.replace(/\.cfg$/, ".dat");

      const cfg = parseComtradeCfg(content);
      const datContent = fs.existsSync(datPath) ? fs.readFileSync(datPath, "utf-8") : undefined;
      const record: ComtradeRecord = datContent
        ? parseComtradeDatAscii(datContent, cfg)
        : {
            config: cfg,
            cfg,
            analogData: [],
            digitalData: [],
            timestamps: [],
            timeSec: new Float64Array(0),
          };

      if (action === "lint") {
        const diagnostics = lintComtradeRecord(record);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No COMTRADE lint violations found.`);
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
        console.log(`                 COMTRADE RECORDING SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Station Name:         ${cfg.stationName}`);
        console.log(` Recording Device:     ${cfg.recDevId ?? cfg.recordingDeviceId}`);
        console.log(` Standard Revision:    ${cfg.revYear ?? cfg.standardVersionYear}`);
        console.log(` Total Channels:       ${cfg.analogChannels.length + cfg.digitalChannels.length}`);
        console.log(` Analog Channels:      ${cfg.analogChannels.length}`);
        console.log(` Digital Channels:     ${cfg.digitalChannels.length}`);
        console.log(` Line Frequency:       ${cfg.nominalFrequency ?? cfg.lineFrequencyHz} Hz`);
        console.log(
          ` Sampling Rates:       ${cfg.samplingRates
            .map((s) => `${s.rateHz ?? s.rate ?? 0} Hz (${s.lastSampleNumber ?? 0} pts)`)
            .join(", ")}`,
        );
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "extract-phasor") {
        if (!datContent) {
          console.error(`Error: Associated .dat file not found for phasor extraction: ${datPath}`);
          process.exit(1);
        }
        const chIdx = Number(argv["channel"] ?? 0);
        const phasors = extractPhasorSeries(record, chIdx);
        console.log(`Extracted ${phasors.length} dynamic DFT phasor windows for channel ${chIdx}:`);
        for (let i = 0; i < Math.min(phasors.length, 10); i++) {
          const p = phasors[i]!;
          console.log(
            `  t=${p.timeSec.toFixed(4)}s: RMS=${p.magnitudeRms.toFixed(2)}, Phase=${p.phaseDeg.toFixed(1)}°`,
          );
        }
        if (phasors.length > 10) console.log(`  ... and ${phasors.length - 10} more samples.`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerComtradeToDae(record);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered COMTRADE recording to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }

      if (action === "to-cff") {
        if (!datContent) {
          console.error(`Error: .dat file required for CFF bundling: ${datPath}`);
          process.exit(1);
        }
        const cffText = writeComtradeCff(record);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.cff`);
        fs.writeFileSync(outPath, cffText, "utf-8");
        console.log(`Successfully bundled COMTRADE to CFF container:\n  ${outPath}`);
        continue;
      }
    }
  },
};

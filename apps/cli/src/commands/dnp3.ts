// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: DNP3 Subcommand (`msx dnp3 <action> [files...]`).
 *
 * Provides headless CLI operations for IEEE 1815 / DNP3 SCADA device profiles:
 * - `msx dnp3 lint <files...>`: Pre-flight point indices, addressing, and limit validation (DNP1001-DNP4001)
 * - `msx dnp3 summary <files...>`: Outstation telemetry point roster (BI, BO, AI, AO, Counters)
 * - `msx dnp3 process-telemetry <files...>`: Deadband event filtering and engineering unit transformation
 * - `msx dnp3 to-xml <files...>`: Export standard IEEE 1815 XML device profile
 * - `msx dnp3 to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { lintDnp3Profile, lowerDnp3ToDae, parseDnp3, processTelemetryStream, writeDnp3Xml } from "@modelscript/dnp3";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const Dnp3Command: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "dnp3 <action> [files...]",
  describe: "Inspect, lint, process telemetry, and convert IEEE 1815 / DNP3 device profiles (.dnp3, .xml, .json)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, process-telemetry, to-xml, to-dae)",
        type: "string",
        choices: ["lint", "summary", "process-telemetry", "to-xml", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "DNP3 file(s) (.dnp3, .xml, .json)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Output destination path",
      })
      .option("deadband", {
        type: "number",
        describe: "Deadband threshold for telemetry filtering",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"] ?? "summary");
    const rawFiles = (argv["files"] as string[]) ?? [];

    if (rawFiles.length === 0) {
      console.error("Error: At least one DNP3 file (.dnp3, .xml, .json) is required.");
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
      const profile = parseDnp3(content);

      if (action === "lint") {
        const diagnostics = lintDnp3Profile(profile);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No DNP3 profile violations found.`);
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
        console.log(`                 IEEE 1815 / DNP3 DEVICE PROFILE: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Device Name:          ${profile.deviceName}`);
        console.log(` Vendor:               ${profile.vendor}`);
        console.log(` Outstation Address:   ${profile.outstationAddress}`);
        console.log(` Master Address:       ${profile.masterAddress}`);
        console.log(` Binary Inputs:        ${profile.binaryInputs.length}`);
        console.log(` Binary Outputs:       ${profile.binaryOutputs.length}`);
        console.log(` Analog Inputs:        ${profile.analogInputs.length}`);
        console.log(` Analog Outputs:       ${profile.analogOutputs.length}`);
        console.log(` Counters:             ${profile.counters.length}`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "process-telemetry") {
        if (profile.analogInputs.length === 0) {
          console.error("Error: No analog inputs configured in DNP3 profile.");
          process.exit(1);
        }
        const ai = { ...profile.analogInputs[0]! };
        if (typeof argv["deadband"] === "number") {
          ai.deadband = argv["deadband"];
        }
        const testSamples = [100, 102, 105, 110, 112, 125, 130];
        const res = processTelemetryStream(testSamples, ai);
        console.log(`\nProcessed telemetry for ${ai.name} (Deadband: ${ai.deadband}):`);
        console.log(`  Total Raw Samples:   ${res.rawSampleCount}`);
        console.log(`  Reported Events:     ${res.reportedEventCount}`);
        console.log(`  Filtering Residual:  ${res.residualMax.toFixed(4)}`);
        console.log(`  Reconstruction RMSE: ${res.rmse.toFixed(4)}\n`);
        continue;
      }

      if (action === "to-xml") {
        const xmlText = writeDnp3Xml(profile);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.xml`);
        fs.writeFileSync(outPath, xmlText, "utf-8");
        console.log(`Successfully exported IEEE 1815 XML profile to:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerDnp3ToDae(profile);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered DNP3 profile to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

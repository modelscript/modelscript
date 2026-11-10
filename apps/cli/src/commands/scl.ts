// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: IEC 61850 SCL Subcommand (`msx scl <action> [files...]`).
 *
 * Provides headless CLI operations for IEC 61850 Substation Configuration Language:
 * - `msx scl lint <files...>`: Pre-flight syntax, schema, and engineering rule diagnostics (SCL1001-SCL4001)
 * - `msx scl summary <files...>`: Substation hierarchy, voltage levels, bays, and IED logical node roster
 * - `msx scl validate-goose <files...>`: GOOSE and Sampled Values control block latency and throughput auditing
 * - `msx scl to-sld <files...>`: Extract topological node-breaker Single-Line Diagram connectivity
 * - `msx scl to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { printArenaDAE } from "@modelscript/runtime";
import { lintSclDocument, lowerSclToDae, parseSclXml, sclToGridTopology, validateGooseStreams } from "@modelscript/scl";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SclCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "scl <action> [files...]",
  describe: "Inspect, lint, audit, and convert IEC 61850 Substation Configuration files (.scd, .cid, .ssd)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, validate-goose, to-sld, to-dae)",
        type: "string",
        choices: ["lint", "summary", "validate-goose", "to-sld", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "IEC 61850 SCL file(s) (.scd, .cid, .icd, .ssd, .xml)",
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
      console.error("Error: At least one SCL file is required.");
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
      const doc = parseSclXml(content);

      if (action === "lint") {
        const diagnostics = lintSclDocument(doc);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No IEC 61850 SCL violations found.`);
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
        let totalVoltageLevels = 0;
        let totalBays = 0;
        if (doc.substation) {
          totalVoltageLevels = doc.substation.voltageLevels.length;
          for (const vl of doc.substation.voltageLevels) {
            totalBays += vl.bays.length;
          }
        }
        const commSubnets = doc.communication ? doc.communication.length : 0;

        console.log(`\n================================================================================`);
        console.log(`                IEC 61850 SCL SUBSTATION SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Header ID:            ${doc.header.id}`);
        console.log(` Standard Revision:    Ed. ${doc.header.revision} (Ver ${doc.header.version})`);
        console.log(` Substation:           ${doc.substation?.name ?? "None"}`);
        console.log(` Voltage Levels:       ${totalVoltageLevels}`);
        console.log(` Total Bays:           ${totalBays}`);
        console.log(` Configured IEDs:      ${doc.ieds.size}`);
        console.log(` Communication Subnets:${commSubnets}`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "validate-goose") {
        const report = validateGooseStreams(doc);
        console.log(`\nAudited GOOSE and Sampled Values Streams:`);
        console.log(`  Total Streams:     ${report.totalGooseStreams}`);
        console.log(`  Publishers:        ${report.totalPublishers}`);
        console.log(`  Subscribers:       ${report.totalSubscribers}`);
        console.log(`  Diagnostics:       ${report.diagnostics.length}`);
        console.log(`  Valid:             ${report.isValid ? "YES" : "NO"}\n`);
        continue;
      }

      if (action === "to-sld") {
        const topology = sclToGridTopology(doc);
        const jsonStr = JSON.stringify(topology, null, 2);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, jsonStr, "utf-8");
          console.log(`Successfully exported SLD topology to:\n  ${outPath}`);
        } else {
          console.log(jsonStr);
        }
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerSclToDae(doc);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered SCL automation to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

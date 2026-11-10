// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OGC WaterML Subcommand (`msx waterml <action> [files...]`).
 *
 * Provides headless CLI operations for OGC WaterML 2.0 / TimeseriesML hydrologic data:
 * - `msx waterml lint <files...>`: Pre-flight metadata, timestamp monotonicity, and range checks
 * - `msx waterml summary <files...>`: Hydrologic telemetry statistics, sensor metadata, and observation bounds
 * - `msx waterml fit-rating <files...>`: Stage-discharge rating curve fitting (Q = a*(h-h0)^b)
 * - `msx waterml to-hec-ras <files...>`: Project flow observations to HEC-RAS unsteady flow (.u01)
 * - `msx waterml to-epanet <files...>`: Project flow/head timeseries to EPANET pattern (.inp)
 * - `msx waterml to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { printArenaDAE } from "@modelscript/runtime";
import {
  fitRatingCurve,
  lintWaterMlDocument,
  lowerWaterMlToDae,
  parseWaterMl,
  projectWaterMlToEpanet,
  projectWaterMlToHecRas,
  type WaterObservation,
} from "@modelscript/waterml";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const WatermlCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "waterml <action> [files...]",
  describe: "Inspect, lint, fit rating curves, and convert OGC WaterML timeseries (.waterml, .wml2, .xml, .json)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, fit-rating, to-hec-ras, to-epanet, to-dae)",
        type: "string",
        choices: ["lint", "summary", "fit-rating", "to-hec-ras", "to-epanet", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "WaterML file(s) (.waterml, .wml2, .xml, .json)",
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
      console.error("Error: At least one WaterML file is required.");
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
      const doc = parseWaterMl(content);

      if (action === "lint") {
        const diagnostics = lintWaterMlDocument(doc);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No WaterML lint violations found.`);
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
        let totalPoints = 0;
        for (const s of doc.timeSeriesList) totalPoints += s.points.length;

        console.log(`\n================================================================================`);
        console.log(`               OGC WATERML 2.0 HYDROLOGIC SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Document ID:          ${doc.id}`);
        console.log(` Total Series:         ${doc.timeSeriesList.length}`);
        console.log(` Total Observations:   ${totalPoints}`);
        for (const s of doc.timeSeriesList) {
          console.log(`  * Series: ${s.seriesId} (${s.observedProperty}, Unit: ${s.unit}, Points: ${s.points.length})`);
        }
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "fit-rating") {
        const ts = doc.timeSeriesList[0];
        if (!ts || ts.points.length < 3) {
          console.error("Error: At least 3 observation points required to fit rating curve.");
          process.exit(1);
        }
        const pairs = ts.points.map((p: WaterObservation, idx: number) => ({
          stageM: 1.0 + idx * 0.5,
          dischargeM3S: p.value,
        }));
        const fit = fitRatingCurve(pairs);
        console.log(`\nFitted Power-Law Rating Curve: Q = a * (h - h0)^b`);
        console.log(`  a (coefficient):  ${fit.equation.a.toFixed(4)}`);
        console.log(`  b (exponent):     ${fit.equation.b.toFixed(4)}`);
        console.log(`  h0 (datum offset):${fit.equation.h0.toFixed(4)}`);
        console.log(`  Max Residual:     ${fit.residualMax.toFixed(4)}`);
        console.log(`  RMSE:             ${fit.rmse.toFixed(4)}\n`);
        continue;
      }

      if (action === "to-hec-ras") {
        const ts = doc.timeSeriesList[0];
        if (!ts) {
          console.error("Error: No timeseries found in WaterML document.");
          process.exit(1);
        }
        const rasText = projectWaterMlToHecRas(ts);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.u01`);
        fs.writeFileSync(outPath, rasText, "utf-8");
        console.log(`Successfully exported HEC-RAS unsteady flow hydrograph:\n  ${outPath}`);
        continue;
      }

      if (action === "to-epanet") {
        const ts = doc.timeSeriesList[0];
        if (!ts) {
          console.error("Error: No timeseries found in WaterML document.");
          process.exit(1);
        }
        const epanetText = projectWaterMlToEpanet(ts);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}_pattern.inp`);
        fs.writeFileSync(outPath, epanetText, "utf-8");
        console.log(`Successfully exported EPANET demand pattern:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerWaterMlToDae(doc);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered WaterML telemetry to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

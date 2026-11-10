// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: IWA Activated Sludge Models Subcommand (`msx asm <action> [files...]`).
 *
 * Provides headless CLI operations for wastewater treatment biokinetics:
 * - `msx asm lint <files...>`: Pre-flight stoichiometry, COD conservation, and kinetic parameter checks (ASM1001-ASM4001)
 * - `msx asm summary <files...>`: Biological model family (ASM1, ASM2d, ASM3, ADM1), components, and processes
 * - `msx asm simulate-biokinetics <files...>`: Solve Petersen matrix rate equations and Takács 10-layer clarifier
 * - `msx asm to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import {
  computeAsm1ConversionRates,
  evaluateAsm1ProcessRates,
  lintAsmPlant,
  lowerAsmToDae,
  parseAsmPlant,
} from "@modelscript/asm";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const AsmCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "asm <action> [files...]",
  describe: "Inspect, lint, simulate biokinetics, and convert IWA Activated Sludge Models (.asm, .bsm, .wrrf)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, simulate-biokinetics, to-dae)",
        type: "string",
        choices: ["lint", "summary", "simulate-biokinetics", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "ASM file(s) (.asm, .bsm, .wrrf, .json)",
        type: "string",
        array: true,
      })
      .option("days", {
        type: "number",
        default: 10.0,
        describe: "Simulation horizon in days",
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
      console.error("Error: At least one ASM file (.asm, .bsm, .json) is required.");
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
      const model = parseAsmPlant(content);

      if (action === "lint") {
        const diagnostics = lintAsmPlant(model);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No IWA ASM biokinetics violations found.`);
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
        let totalReactorVolume = 0;
        for (const r of model.reactors) totalReactorVolume += r.volumeM3;

        console.log(`\n================================================================================`);
        console.log(`                IWA ACTIVATED SLUDGE MODEL SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Plant Name:           ${model.name}`);
        console.log(` Model Family:         ${model.modelType}`);
        console.log(
          ` Bioreactors:          ${model.reactors.length} (Total volume: ${totalReactorVolume.toFixed(1)} m³)`,
        );
        console.log(` Secondary Clarifiers: ${model.clarifiers.length}`);
        console.log(` Influent Flow (Qin):  ${model.influentFlowM3Day.toFixed(1)} m³/day`);
        console.log(` Sludge Recycle (RAS): ${(model.sludgeRecycleRatio * 100).toFixed(0)}%`);
        console.log(` Internal Recycle:     ${(model.internalRecycleRatio * 100).toFixed(0)}%`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "simulate-biokinetics") {
        const processRates = evaluateAsm1ProcessRates(model.influentConcentrations);
        const conversionRates = computeAsm1ConversionRates(model.influentConcentrations);

        console.log(`\nEvaluated Biokinetic Reaction Rates:`);
        console.log(`  Aerobic Heterotrophic Growth (rho1): ${processRates[0]?.toFixed(4)} g COD/(m³·day)`);
        console.log(`  Anoxic Denitrification (rho2):       ${processRates[1]?.toFixed(4)} g COD/(m³·day)`);
        console.log(`  Aerobic Autotrophic Growth (rho3):   ${processRates[2]?.toFixed(4)} g N/(m³·day)`);
        console.log(`  Biomass Decay (rho4):                ${processRates[3]?.toFixed(4)} g COD/(m³·day)`);
        console.log(`\nNet Soluble/Particulate Conversion Rates (r_i):`);
        console.log(`  Substrate S_S Rate:   ${conversionRates["S_S"]?.toFixed(4)} g/(m³·day)`);
        console.log(`  Ammonium S_NH Rate:   ${conversionRates["S_NH"]?.toFixed(4)} g/(m³·day)`);
        console.log(`  Nitrate S_NO Rate:    ${conversionRates["S_NO"]?.toFixed(4)} g/(m³·day)`);
        console.log(`  Biomass X_BH Rate:    ${conversionRates["X_BH"]?.toFixed(4)} g/(m³·day)\n`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerAsmToDae(model);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered ASM model to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};

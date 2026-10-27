// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  energyPlusToModelica,
  lintEnergyPlus,
  lowerEnergyPlusToDae,
  parseEnergyPlus,
  synchronizeModelicaToEnergyPlus,
} from "@modelscript/energyplus";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const EnergyPlusCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "energyplus <action> [files...]",
  describe: "Inspect, validate, lower to DAE, and project US DOE EnergyPlus building models (.idf, .epJSON)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | summary | lint | to-modelica | to-dae | thermal-balance | sync",
        choices: ["inspect", "summary", "lint", "to-modelica", "to-dae", "thermal-balance", "sync"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input EnergyPlus building files (.idf, .epJSON)",
      })
      .option("out", {
        type: "string",
        alias: "o",
        describe: "Output file path (Modelica model, JSON metadata, or synchronized EnergyPlus file)",
      })
      .option("from-modelica", {
        type: "string",
        describe: "Path to modified Modelica file for bidirectional synchronization",
      })
      .option("strategy", {
        type: "string",
        choices: ["target-wins", "source-wins", "physics-simplex"],
        default: "target-wins",
        describe: "Conflict reconciliation strategy for sync",
      })
      .option("format", {
        type: "string",
        alias: "f",
        choices: ["terminal", "json"],
        default: "terminal",
        describe: "Output format: 'terminal' or 'json'",
      })
      .option("tamb", {
        type: "number",
        default: 10.0,
        describe: "Outdoor ambient temperature in deg C for thermal-balance",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const outFile = argv["out"] as string | undefined;
    const format = (argv["format"] as "terminal" | "json") ?? "terminal";

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const doc = parseEnergyPlus(content, file);

      switch (action) {
        case "inspect":
        case "summary": {
          if (format === "json") {
            const payload = {
              building: doc.building?.name ?? path.basename(file),
              zonesCount: doc.zones.length,
              zones: doc.zones.map((z) => ({
                name: z.name,
                multiplier: z.multiplier ?? 1,
                ceilingHeight: z.ceilingHeight ?? null,
                volume: z.volume ?? null,
              })),
              surfacesCount: doc.surfaces.length,
              materialsCount: {
                mass: doc.materials.length,
                noMass: doc.materialsNoMass.length,
              },
              constructionsCount: doc.constructions.length,
            };
            const jsonStr = JSON.stringify(payload, null, 2);
            if (outFile) {
              fs.writeFileSync(path.resolve(process.cwd(), outFile), jsonStr, "utf-8");
              console.log(`Saved EnergyPlus summary to ${outFile}`);
            } else {
              console.log(jsonStr);
            }
          } else {
            console.log(`\n=== US DOE EnergyPlus Building: ${doc.building?.name ?? path.basename(file)} ===`);
            console.log(`Thermal Zones: ${doc.zones.length}`);
            for (const z of doc.zones) {
              console.log(
                `  - Zone '${z.name}' (multiplier=${z.multiplier ?? 1}, ceilingHeight=${z.ceilingHeight ?? "auto"})`,
              );
            }
            console.log(`Surfaces: ${doc.surfaces.length}`);
            console.log(`Materials: ${doc.materials.length} mass, ${doc.materialsNoMass.length} no-mass`);
            console.log(`Constructions: ${doc.constructions.length}`);
            if (outFile) {
              const payload = {
                building: doc.building?.name ?? path.basename(file),
                zonesCount: doc.zones.length,
                surfacesCount: doc.surfaces.length,
              };
              fs.writeFileSync(path.resolve(process.cwd(), outFile), JSON.stringify(payload, null, 2), "utf-8");
              console.log(`Saved EnergyPlus summary to ${outFile}`);
            }
          }
          break;
        }

        case "lint": {
          const diags = lintEnergyPlus(doc);
          if (format === "json") {
            console.log(JSON.stringify(diags, null, 2));
          } else {
            if (diags.length === 0) {
              console.log(`[PASS] ${file}: 0 diagnostics reported.`);
            } else {
              console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
              for (const d of diags) {
                const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
                console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
              }
            }
          }
          break;
        }

        case "to-modelica": {
          const modelica = energyPlusToModelica(doc);
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), modelica, "utf-8");
            console.log(`Saved Modelica building thermal model to ${outFile}`);
          } else {
            console.log(modelica);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerEnergyPlusToDae(doc);
          const meta = {
            varCount: arena.getVarCount(),
            eqCount: arena.getEqCount(),
          };
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), JSON.stringify(meta, null, 2), "utf-8");
            console.log(`Saved DAE metadata to ${outFile}`);
          }
          if (format === "json") {
            if (!outFile) {
              console.log(JSON.stringify(meta, null, 2));
            }
          } else {
            console.log(`Lowered EnergyPlus building model into linear DAE arena:`);
            console.log(`  Variables: ${arena.getVarCount()}`);
            console.log(`  Equations: ${arena.getEqCount()}`);
          }
          break;
        }

        case "thermal-balance": {
          const tAmb = (argv["tamb"] as number) ?? 10.0;
          const zoneResults: {
            zone: string;
            totalUA: number;
            internalGains: number;
            freeFloatTemp: number;
          }[] = [];

          for (const zone of doc.zones) {
            let totalUA = 0.0;
            const zoneSurfs = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
            for (const surf of zoneSurfs) {
              const area = surf.grossArea && surf.grossArea > 0 ? surf.grossArea : 20.0;
              totalUA += area * 1.5;
            }
            let totalGains = 0.0;
            for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
              totalGains += p.numberOfPeople * 100.0;
            }
            for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
              totalGains += l.lightingLevel;
            }
            for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
              totalGains += e.designLevel;
            }
            const deltaTNeeded = totalUA > 0 ? totalGains / totalUA : 0.0;
            const freeFloatTemp = tAmb + deltaTNeeded;
            zoneResults.push({
              zone: zone.name,
              totalUA,
              internalGains: totalGains,
              freeFloatTemp,
            });
          }

          if (format === "json") {
            const payload = {
              building: doc.building?.name ?? path.basename(file),
              ambientTemp: tAmb,
              zones: zoneResults,
            };
            const jsonStr = JSON.stringify(payload, null, 2);
            if (outFile) {
              fs.writeFileSync(path.resolve(process.cwd(), outFile), jsonStr, "utf-8");
              console.log(`Saved thermal balance results to ${outFile}`);
            } else {
              console.log(jsonStr);
            }
          } else {
            console.log(
              `Steady-State Thermal Balance for ${doc.building?.name ?? path.basename(file)} (T_amb = ${tAmb}°C):`,
            );
            for (const z of zoneResults) {
              console.log(
                `  Zone ${z.zone}: totalUA=${z.totalUA.toFixed(1)} W/K, internalGains=${z.internalGains.toFixed(1)} W, freeFloatTemp=${z.freeFloatTemp.toFixed(1)}°C`,
              );
            }
          }
          break;
        }

        case "sync": {
          const fromModelica = argv["from-modelica"] as string | undefined;
          if (!fromModelica) {
            console.error("Error: --from-modelica=<file.mo> is required for sync action.");
            process.exit(1);
          }
          const moPath = path.resolve(process.cwd(), fromModelica);
          if (!fs.existsSync(moPath)) {
            console.error(`Error: Modelica file not found: ${fromModelica}`);
            process.exit(1);
          }
          const moContent = fs.readFileSync(moPath, "utf-8");
          const strategy =
            (argv["strategy"] as NonNullable<Parameters<typeof synchronizeModelicaToEnergyPlus>[2]>["strategy"]) ??
            "target-wins";
          const syncResult = synchronizeModelicaToEnergyPlus(content, moContent, { strategy });

          console.log(
            `[EnergyPlus Sync] Reconciled ${syncResult.changes.length} change(s) from '${fromModelica}' into '${file}':`,
          );
          for (const c of syncResult.changes) {
            const prop = c.property ? `.${c.property}` : "";
            console.log(`  - [${c.target}] ${c.elementId}${prop}: ${c.sourceOldVal ?? ""} -> ${c.reconciledVal}`);
          }

          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), syncResult.updatedText, "utf-8");
            console.log(`Saved synchronized EnergyPlus model to ${outFile}`);
          } else {
            fs.writeFileSync(fullPath, syncResult.updatedText, "utf-8");
            console.log(`Updated in-place: ${file}`);
          }
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { energyPlusToModelica, lintEnergyPlus, lowerEnergyPlusToDae, parseEnergyPlus } from "@modelscript/energyplus";
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
        describe: "Action to perform: inspect | lint | to-modelica | to-dae | thermal-balance",
        choices: ["inspect", "lint", "to-modelica", "to-dae", "thermal-balance"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input EnergyPlus building files (.idf, .epJSON)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path for generated Modelica code",
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
        case "inspect": {
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
          break;
        }

        case "lint": {
          const diags = lintEnergyPlus(doc);
          if (diags.length === 0) {
            console.log(`[PASS] ${file}: 0 diagnostics reported.`);
          } else {
            console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
            for (const d of diags) {
              const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
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
          console.log(`Lowered EnergyPlus building model into linear DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        case "thermal-balance": {
          const tAmb = (argv["tamb"] as number) ?? 10.0;
          console.log(
            `Steady-State Thermal Balance for ${doc.building?.name ?? path.basename(file)} (T_amb = ${tAmb}°C):`,
          );
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
            console.log(
              `  Zone ${zone.name}: totalUA=${totalUA.toFixed(1)} W/K, internalGains=${totalGains.toFixed(1)} W, freeFloatTemp=${freeFloatTemp.toFixed(1)}°C`,
            );
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

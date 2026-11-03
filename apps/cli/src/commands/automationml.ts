// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  amlToModelica,
  amlToSsp,
  amlToSysML2,
  lintAutomationML,
  lowerAutomationMLToDae,
  parseAutomationML,
  runAmlVirtualCommissioning,
} from "@modelscript/automationml";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const AutomationMLCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "aml <action> [files...]",
  aliases: ["automationml", "caex"],
  describe:
    "Inspect, validate, virtually commission, lower to DAE, and project IEC 62714 AutomationML / CAEX models (.aml, .caex, .amlx)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | commission | to-ssp | to-sysml | to-modelica | to-dae",
        choices: ["inspect", "lint", "commission", "to-ssp", "to-sysml", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input AutomationML / CAEX files (.aml, .caex, .amlx)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("cycles", {
        type: "number",
        default: 20,
        describe: "Number of scan cycles for virtual commissioning",
      })
      .option("dt", {
        type: "number",
        default: 10,
        describe: "Cycle time step in milliseconds for virtual commissioning",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

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
      const doc = parseAutomationML(content, file);

      switch (action) {
        case "inspect": {
          console.log(`AutomationML Document: ${doc.fileName || path.basename(file)} (CAEX ${doc.schemaVersion})`);
          console.log(`  Instance Hierarchies (${doc.instanceHierarchies.length}):`);
          for (const ih of doc.instanceHierarchies) {
            console.log(`    - ${ih.name}: ${ih.elements.length} root element(s)`);
          }
          console.log(`  SystemUnitClassLibs: ${doc.systemUnitClassLibs.length}`);
          console.log(`  RoleClassLibs: ${doc.roleClassLibs.length}`);
          console.log(`  InterfaceClassLibs: ${doc.interfaceClassLibs.length}`);
          break;
        }

        case "lint": {
          const diagnostics = lintAutomationML(doc);
          if (diagnostics.length === 0) {
            console.log(`[PASS] ${file}: 0 IEC 62714 diagnostics detected.`);
          } else {
            console.log(`Found ${diagnostics.length} diagnostic(s) in ${file}:`);
            for (const d of diagnostics) {
              const prefix = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(
                `  [${file}:${d.range.startLine}:${d.range.startColumn}] ${prefix} [${d.code}]: ${d.message}`,
              );
            }
          }
          break;
        }

        case "commission": {
          const cycles = (argv["cycles"] as number) ?? 20;
          const dtMs = (argv["dt"] as number) ?? 10;
          const result = runAmlVirtualCommissioning(doc, { cycles, dtMs });
          console.log(
            `Virtual Commissioning Complete (${result.cycles} cycles @ ${result.dtMs}ms = ${result.totalTimeMs}ms):`,
          );
          console.log(`  Interlock Status: ${result.interlockStatus}`);
          console.log(`  Final Signals:`, JSON.stringify(result.finalSignals, null, 2));
          break;
        }

        case "to-ssp": {
          const ssd = amlToSsp(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), ssd, "utf-8");
            console.log(`Saved SSP (.ssd) to: ${outPath}`);
          } else {
            console.log(ssd);
          }
          break;
        }

        case "to-sysml": {
          const sysml = amlToSysML2(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), sysml, "utf-8");
            console.log(`Saved SysML v2 to: ${outPath}`);
          } else {
            console.log(sysml);
          }
          break;
        }

        case "to-modelica": {
          const mo = amlToModelica(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), mo, "utf-8");
            console.log(`Saved Modelica 3.x to: ${outPath}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerAutomationMLToDae(doc);
          console.log(`Lowered AutomationML to DAE Arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintPlcProject,
  lowerPlcopenToDae,
  parsePlcopen,
  plcopenToModelica,
  plcopenToSysML,
  VirtualPlc,
} from "@modelscript/plcopen";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const PlcopenCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "plcopen <action> [files...]",
  describe:
    "Inspect, validate, simulate, and project IEC 61131-3 PLCopen XML & Structured Text models (.xml, .plcopen, .st)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | run-scan | to-modelica | to-sysml | to-dae",
        choices: ["inspect", "lint", "run-scan", "to-modelica", "to-sysml", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input PLCopen model files (.xml, .plcopen, .st)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("cycles", {
        type: "number",
        default: 10,
        describe: "Number of scan cycles for run-scan",
      })
      .option("dt", {
        type: "number",
        default: 10,
        describe: "Cycle time interval in milliseconds for run-scan",
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
      const project = parsePlcopen(content, file);

      if (project.pous.length === 0) {
        console.warn(`Warning: No POUs found in ${file}`);
      }

      switch (action) {
        case "inspect": {
          console.log(`PLC Project: ${project.contentHeader?.name ?? path.basename(file)}`);
          console.log(`  POUs (${project.pous.length}):`);
          for (const pou of project.pous) {
            console.log(`    - ${pou.name} (${pou.pouType}): ${pou.variables.length} vars, ${pou.body.kind} body`);
          }
          console.log(`  Configurations (${project.configurations.length}):`);
          for (const cfg of project.configurations) {
            for (const res of cfg.resources) {
              console.log(`    - Resource ${res.name}: ${res.tasks.length} tasks, ${res.instances.length} instances`);
            }
          }
          break;
        }

        case "lint": {
          const diagnostics = lintPlcProject(project);
          if (diagnostics.length === 0) {
            console.log(`[PASS] ${file}: 0 diagnostics detected.`);
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

        case "run-scan": {
          const cycles = (argv["cycles"] as number) ?? 10;
          const dtMs = (argv["dt"] as number) ?? 10;
          const plc = new VirtualPlc(project);
          const history = plc.runCycles(cycles, dtMs);
          console.log(`Executed ${cycles} scan cycles (interval: ${dtMs}ms):`);
          console.log(JSON.stringify(history[history.length - 1], null, 2));
          break;
        }

        case "to-modelica": {
          const moCode = plcopenToModelica(project);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), moCode, "utf-8");
            console.log(`Saved Modelica code to: ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "to-sysml": {
          const sysmlCode = plcopenToSysML(project);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), sysmlCode, "utf-8");
            console.log(`Saved SysML v2 code to: ${outPath}`);
          } else {
            console.log(sysmlCode);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerPlcopenToDae(project);
          console.log(`Lowered to DAE Arena:`);
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

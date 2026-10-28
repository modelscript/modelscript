// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autosarToModelica,
  autosarToSysml,
  lintAutosarModel,
  lowerAutosarToDae,
  parseArxml,
  VirtualRte,
  type AutosarModel,
} from "@modelscript/autosar";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

function loadAutosarModel(filePath: string): AutosarModel {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseArxml(content);
}

export const AutosarCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "autosar <action> [files...]",
  describe: "Inspect, lint, lower to DAE, project, and simulate AUTOSAR Classic & Adaptive ARXML models (.arxml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | to-modelica | to-sysml | to-dae | simulate-rte",
        choices: ["inspect", "lint", "to-modelica", "to-sysml", "to-dae", "simulate-rte"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input AUTOSAR ARXML files (.arxml)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path for generated code or export",
      })
      .option("duration", {
        type: "number",
        default: 0.1,
        describe: "Simulation duration for Virtual RTE [s]",
      })
      .option("step", {
        type: "number",
        default: 0.01,
        describe: "Simulation timestep for Virtual RTE [s]",
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

      const model = loadAutosarModel(fullPath);

      switch (action) {
        case "inspect": {
          console.log(`[AUTOSAR ARXML] File: ${path.basename(file)}`);
          console.log(`  Packages: ${model.packages.size}`);
          console.log(`  Components: ${model.components.size}`);
          console.log(`  Port Interfaces: ${model.interfaces.size}`);
          console.log(`  PDUs: ${model.pdus.size}`);
          console.log(`  Frames: ${model.frames.size}`);
          console.log(`  Compositions:`);
          for (const [cName, comp] of model.components) {
            if (comp.kind === "COMPOSITION-SW-COMPONENT-TYPE") {
              const protoCount = comp.subComponents?.size ?? 0;
              const connCount = comp.connectors?.length ?? 0;
              console.log(`    - Composition '${cName}': ${protoCount} prototypes, ${connCount} connectors`);
            }
          }
          console.log(`  Atomic SWCs:`);
          for (const [cName, comp] of model.components) {
            if (comp.kind !== "COMPOSITION-SW-COMPONENT-TYPE") {
              const runCount = comp.internalBehavior?.runnables.size ?? 0;
              const portCount = comp.ports?.size ?? 0;
              console.log(`    - [${comp.kind}] '${cName}': ${portCount} ports, ${runCount} runnables`);
            }
          }
          break;
        }

        case "lint": {
          const diagnostics = lintAutosarModel(model);
          if (diagnostics.length === 0) {
            console.log(`[AUTOSAR Linter] ${file}: Clean. 0 diagnostics.`);
          } else {
            console.log(`[AUTOSAR Linter] ${file}: ${diagnostics.length} diagnostic(s) found:`);
            for (const d of diagnostics) {
              const loc = `${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${loc}] [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
            }
          }
          break;
        }

        case "to-modelica": {
          const mo = autosarToModelica(model);
          const out = argv["out"] as string | undefined;
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, mo, "utf-8");
            console.log(`[AUTOSAR -> Modelica] Written to ${out}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "to-sysml": {
          const sysml = autosarToSysml(model);
          const out = argv["out"] as string | undefined;
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, sysml, "utf-8");
            console.log(`[AUTOSAR -> SysML v2] Written to ${out}`);
          } else {
            console.log(sysml);
          }
          break;
        }

        case "to-dae": {
          const dae = lowerAutosarToDae(model);
          console.log(`[AUTOSAR -> DAE] Model lowered to linear WebAssembly memory arena:`);
          console.log(`  Variables: ${dae.varCount}`);
          console.log(`  Equations: ${dae.eqCount}`);
          break;
        }

        case "simulate-rte": {
          const duration = (argv["duration"] as number) ?? 0.1;
          const step = (argv["step"] as number) ?? 0.01;
          const rte = new VirtualRte(model);
          const log = rte.runUntil(duration, step);
          console.log(`[AUTOSAR Virtual RTE] Simulation completed: ${duration}s (step ${step}s):`);
          console.log(`  Executed task triggers: ${log.length}`);
          for (const entry of log.slice(0, 10)) {
            const timeStr = entry.time.toFixed(3);
            console.log(`    [t=${timeStr}s] ${entry.swc}.${entry.runnable} (${entry.eventType})`);
          }
          if (log.length > 10) {
            console.log(`    ... and ${log.length - 10} more task execution events.`);
          }
          break;
        }
      }
    }
  },
};

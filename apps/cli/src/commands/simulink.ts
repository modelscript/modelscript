// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintSimulinkModel,
  lowerSimulinkToDae,
  parseMdl,
  parseSlx,
  simulinkToModelica,
  type SimulinkModel,
} from "@modelscript/simulink";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

function loadSimulinkModel(filePath: string): SimulinkModel {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".slx") {
    const buffer = fs.readFileSync(filePath);
    return parseSlx(buffer);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseMdl(content);
}

export const SimulinkCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "simulink <action> [files...]",
  describe: "Inspect, lint, lower to DAE, and project MATLAB Simulink control models (.slx, .mdl)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: lint | inspect | to-modelica | to-dae",
        choices: ["lint", "inspect", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input Simulink model files (.slx, .mdl)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path for generated code or export",
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

      const model = loadSimulinkModel(fullPath);

      switch (action) {
        case "lint": {
          const diagnostics = lintSimulinkModel(model);
          if (diagnostics.length === 0) {
            console.log(`[Simulink Linter] ${file}: Clean. 0 diagnostics.`);
          } else {
            console.log(`[Simulink Linter] ${file}: ${diagnostics.length} diagnostic(s) found:`);
            for (const d of diagnostics) {
              const loc = `${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${loc}] [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
            }
          }
          break;
        }

        case "inspect": {
          console.log(`[Simulink Model] '${model.name}' (${model.version ?? "R2024b"}):`);
          console.log(`  Solver: ${model.solver ?? "ode45"}`);
          console.log(`  Start Time: ${model.startTime ?? 0}s, Stop Time: ${model.stopTime ?? 10}s`);
          console.log(`  Blocks: ${model.rootSystem.blocks.size}`);
          console.log(`  Lines: ${model.rootSystem.lines.length}`);
          for (const block of model.rootSystem.blocks.values()) {
            console.log(`    - [${block.type}] '${block.name}'`);
          }
          break;
        }

        case "to-modelica": {
          const mo = simulinkToModelica(model);
          const out = argv["out"] as string | undefined;
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, mo, "utf-8");
            console.log(`[Simulink -> Modelica] Written to ${out}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "to-dae": {
          const dae = lowerSimulinkToDae(model);
          console.log(`[Simulink -> DAE] Model: '${model.name}' lowered to linear WebAssembly memory arena:`);
          console.log(`  Variables: ${dae.varCount}`);
          console.log(`  Equations: ${dae.eqCount}`);
          break;
        }
      }
    }
  },
};

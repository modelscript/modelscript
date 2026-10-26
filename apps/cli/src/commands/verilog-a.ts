// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintVerilogA,
  lowerVerilogAToDae,
  parseVerilogA,
  verilogAToModelica,
  verilogAToSpice,
} from "@modelscript/verilog-a";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const VerilogACommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "verilog-a <action> [files...]",
  describe: "Inspect, validate, and project Verilog-A / Verilog-AMS compact device models (.va, .vams)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | to-modelica | to-spice | to-dae",
        choices: ["inspect", "lint", "to-modelica", "to-spice", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input Verilog-A model files (.va, .vams)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path",
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
      const doc = parseVerilogA(content, file);

      if (doc.modules.length === 0) {
        console.warn(`Warning: No Verilog-A modules found in ${file}`);
        continue;
      }

      const mod = doc.modules[0]!;

      switch (action) {
        case "inspect": {
          console.log(`Verilog-A Module: ${mod.name}`);
          console.log(
            `  Ports (${mod.ports.length}): ${mod.ports.map((p) => `${p.name} (${p.direction})`).join(", ")}`,
          );
          console.log(
            `  Parameters (${mod.parameters.length}): ${mod.parameters.map((p) => `${p.name}=${p.defaultValue}`).join(", ")}`,
          );
          console.log(`  Variables (${mod.variables.length}): ${mod.variables.map((v) => v.name).join(", ")}`);
          console.log(`  Analog Block Statements: ${mod.analogBlock?.statements.length ?? 0}`);
          break;
        }

        case "lint": {
          const diagnostics = lintVerilogA(doc);
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

        case "to-modelica": {
          const moCode = verilogAToModelica(mod);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), moCode, "utf-8");
            console.log(`Saved Modelica code to: ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "to-spice": {
          const spiceCode = verilogAToSpice(mod);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), spiceCode, "utf-8");
            console.log(`Saved SPICE code to: ${outPath}`);
          } else {
            console.log(spiceCode);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerVerilogAToDae(mod);
          console.log(`Lowered '${mod.name}' to DAEBuilder:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }
      }
    }
  },
};

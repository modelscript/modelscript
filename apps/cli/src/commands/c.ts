// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: C Subcommand.
 *
 * Provides headless CLI operations for C source files and headers (.c, .h):
 * - `msx c inspect <file>`
 * - `msx c lint <file>`
 * - `msx c to-modelica <header.h> -o <out.mo>`
 * - `msx c to-dae <file.c>`
 */

import { bindCHeaderToModelica, compileCStep, lintC, lowerCToDae, scrapeCHeader } from "@modelscript/c";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const CCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "c <action> [files...]",
  describe: "Inspect, lint, and bridge C99/ANSI C files and headers (.c, .h)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, to-modelica, to-dae, step)",
        type: "string",
        choices: ["inspect", "summary", "lint", "to-modelica", "to-dae", "step"],
        demandOption: true,
      })
      .positional("files", {
        description: "C source or header file(s) (.c, .h) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("include", {
        description: "Header include directive name for Modelica external annotation",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const includeDirective = argv["include"] as string | undefined;

    if (files.length === 0) {
      console.error("[c] Error: No input C files (.c, .h) specified.");
      process.exitCode = 1;
      return;
    }

    for (const filePath of files) {
      const resolvedPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`[c] Error: File not found: ${resolvedPath}`);
        process.exitCode = 1;
        continue;
      }

      const content = fs.readFileSync(resolvedPath, "utf-8");
      const baseName = path.basename(resolvedPath);

      switch (action) {
        case "inspect":
        case "summary": {
          const scraped = scrapeCHeader(content);
          console.log(`=== C File Inspection: ${baseName} ===`);
          console.log(`Functions: ${scraped.functions.length}`);
          for (const fn of scraped.functions) {
            console.log(`  - ${fn.rawSignature}`);
          }
          console.log(`Structs: ${scraped.structs.length}`);
          for (const st of scraped.structs) {
            console.log(`  - struct ${st.name} (${st.fields.length} fields)`);
          }
          console.log(`Typedefs: ${scraped.typedefs.size}`);
          break;
        }

        case "lint": {
          const diags = lintC(content);
          console.log(`[c] Linting ${baseName}: ${diags.length} diagnostic(s) found.`);
          for (const d of diags) {
            const loc = d.line ? `:${d.line}` : "";
            console.log(`  [M${d.code}/${d.rule}] ${d.severity.toUpperCase()}${loc}: ${d.message}`);
          }
          if (diags.some((d) => d.severity === "error")) {
            process.exitCode = 1;
          }
          break;
        }

        case "to-modelica": {
          const inc = includeDirective ?? (baseName.endsWith(".h") ? baseName : `${path.basename(baseName, ".c")}.h`);
          const moCode = bindCHeaderToModelica(content, inc);
          if (out) {
            const resolvedOut = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
            fs.writeFileSync(resolvedOut, moCode, "utf-8");
            console.log(`[c] Exported Modelica external C bindings to ${resolvedOut}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "to-dae": {
          const { DAEBuilder } = await import("@modelscript/runtime");
          const dae = new DAEBuilder();
          const lines = content.split(/\r?\n/);
          const res = lowerCToDae(dae, lines, path.basename(baseName, path.extname(baseName)));
          console.log(
            `[c] Lowered to DAE Arena: ${res.equationCount} equations, ${res.stateVarIndices.length} state variables.`,
          );
          if (out) {
            const resolvedOut = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
            fs.writeFileSync(
              resolvedOut,
              JSON.stringify({ equations: res.equationCount, states: res.stateVarIndices }, null, 2),
              "utf-8",
            );
            console.log(`[c] Saved DAE metadata to ${resolvedOut}`);
          }
          break;
        }

        case "step": {
          const compiled = compileCStep(content);
          console.log(`[c] Compiled procedural step closure for ${baseName}`);
          console.log(`  Real states: ${compiled.numRealStates}, Int states: ${compiled.numIntStates}`);
          console.log(`  Referenced ports: ${compiled.referencedPorts.join(", ") || "none"}`);
          console.log(`  Assigned ports: ${compiled.assignedPorts.join(", ") || "none"}`);
          break;
        }
      }
    }
  },
};

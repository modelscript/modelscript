// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import {
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  exportToNuXmv,
  exportToOcra,
  exportToSmtLib,
} from "@modelscript/sysml2";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";

export interface ExportFormalArgs {
  paths: string[];
  format: "smt2" | "nuxmv" | "ocra";
  output?: string;
  logic?: "QF_LRA" | "QF_NRA" | "QF_IDL" | "ALL";
  module?: string;
  scope?: string;
  invariants?: string[];
  ltl?: string[];
  minimize?: string[];
  maximize?: string[];
}

export const ExportFormal: CommandModule<{}, ExportFormalArgs> = {
  command: "export-formal <paths..>",
  describe: "Export SysML v2 models to standard formal verification formats (SMT-LIB2, nuXmv, OCRA)",

  builder: (yargs) => {
    return yargs
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "Path(s) to .sysml files to export",
        type: "string",
      })
      .option("format", {
        alias: "f",
        choices: ["smt2", "nuxmv", "ocra"],
        default: "smt2",
        description: "Target formal representation: 'smt2' (SMT-LIB v2.6), 'nuxmv' (nuXmv .smv), or 'ocra' (OCRA .oss)",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Output file path (prints to stdout if omitted)",
        type: "string",
      })
      .option("logic", {
        choices: ["QF_LRA", "QF_NRA", "QF_IDL", "ALL"],
        description: "SMT-LIB logic directive (default: auto-detected QF_LRA or QF_NRA)",
        type: "string",
      })
      .option("module", {
        alias: "m",
        description: "Module name for nuXmv or top-level component name for OCRA",
        type: "string",
        default: "System",
      })
      .option("scope", {
        alias: "s",
        description: "Scope filter for extracted constraints or state machines",
        type: "string",
      })
      .option("invariants", {
        array: true,
        description: "Additional safety invariants (INVARSPEC) to emit for nuXmv",
        type: "string",
      })
      .option("ltl", {
        array: true,
        description: "Temporal logic specifications (LTLSPEC) to emit for nuXmv",
        type: "string",
      })
      .option("minimize", {
        array: true,
        description: "Parametric optimization objectives to minimize in SMT-LIB2",
        type: "string",
      })
      .option("maximize", {
        array: true,
        description: "Parametric optimization objectives to maximize in SMT-LIB2",
        type: "string",
      }) as any;
  },

  handler: async (args) => {
    const require = createRequire(import.meta.url);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    let wasmPath: string;
    try {
      wasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
    } catch {
      wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/dist/parser.wasm");
    }

    const { parser: sysmlParser } = await createWasmParser(wasmPath);
    const sysmlIndex = createSysML2WorkspaceIndex();

    for (const p of args.paths) {
      const resolvedPath = path.resolve(process.cwd(), p);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`Error: file not found: ${resolvedPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(resolvedPath, "utf-8");
      const tree = sysmlParser.parse(text);
      if (tree) {
        const fileUri = "file://" + resolvedPath;
        sysmlIndex.register(fileUri, () => tree.rootNode as any);
      }
    }

    const unifiedIndex = await sysmlIndex.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unifiedIndex);
    const db = qe.toQueryDB();
    let resultText = "";

    switch (args.format) {
      case "smt2":
        resultText = exportToSmtLib(db, {
          ...(args.logic !== undefined ? { logic: args.logic } : {}),
          ...(args.scope !== undefined ? { scopeFilter: args.scope } : {}),
          ...(args.minimize !== undefined ? { minimize: args.minimize } : {}),
          ...(args.maximize !== undefined ? { maximize: args.maximize } : {}),
        });
        break;

      case "nuxmv":
        resultText = exportToNuXmv(db, {
          moduleName: args.module || "System",
          ...(args.scope !== undefined ? { stateMachineName: args.scope } : {}),
          ...(args.invariants !== undefined ? { invariants: args.invariants } : {}),
          ...(args.ltl !== undefined ? { ltlSpecs: args.ltl } : {}),
        });
        break;

      case "ocra":
        resultText = exportToOcra(db, {
          systemName: args.module || "System",
        });
        break;
    }

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, resultText, "utf-8");
      console.log(`Exported ${args.format.toUpperCase()} formal model to ${args.output}`);
    } else {
      console.log(resultText);
    }
  },
};

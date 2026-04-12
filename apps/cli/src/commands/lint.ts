// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaLibrary, ModelicaLinter } from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import Parser, { type Range } from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface LintArgs {
  path: string;
  paths: string[] | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Lint: CommandModule<{}, LintArgs> = {
  command: "lint <path> [paths...]",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("path", {
        demandOption: true,
        description: "path of library or module to lint",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "additional paths of libraries and modules to load",
        type: "string",
      });
  },
  handler: (args) => {
    const diagnosticsMap = new Map<
      string | null,
      {
        type: string;
        code: number;
        message: string;
        resource: string | null | undefined;
        range: Range | null | undefined;
      }[]
    >();
    const linter = new ModelicaLinter(
      (
        type: string,
        code: number,
        message: string,
        resource: string | null | undefined,
        range: Range | null | undefined,
      ) => {
        if (!diagnosticsMap.has(resource ?? null)) {
          diagnosticsMap.set(resource ?? null, []);
        }
        diagnosticsMap.get(resource ?? null)?.push({ type, code, message, resource, range });
      },
    );

    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());
    for (const path of args.paths ?? []) context.addLibrary(path);
    const library = new ModelicaLibrary(context, args.path);
    linter.lint(library);

    for (const resource of diagnosticsMap.keys()) {
      const diagnostics = diagnosticsMap.get(resource);
      if (diagnostics == null) continue;
      diagnostics.sort((a, b) => {
        const rowSort = (a.range?.startPosition?.row ?? 0) - (b.range?.startPosition?.row ?? 0);
        if (rowSort != 0) return rowSort;
        const colSort = (a.range?.startPosition?.column ?? 0) - (b.range?.startPosition?.column ?? 0);
        return colSort;
      });
      console.log(resource ?? "unknown file");
      const maxLengthRow = Math.max(...diagnostics.map((r) => String((r.range?.startPosition?.row ?? 0) + 1).length));
      const maxLengthCol = Math.max(
        ...diagnostics.map((r) => String((r.range?.startPosition?.column ?? 0) + 1).length),
      );
      const maxLengthType = Math.max(...diagnostics.map((r) => r.type.length));
      for (const diagnostic of diagnostics) {
        const row = String((diagnostic.range?.startPosition?.row ?? 0) + 1).padStart(maxLengthRow);
        const col = String((diagnostic.range?.startPosition?.column ?? 0) + 1).padEnd(maxLengthCol);
        const codeStr = diagnostic.code > 0 ? `[M${diagnostic.code}] ` : "";
        console.log(
          "  " + row + ":" + col + "  " + diagnostic.type.padEnd(maxLengthType) + "  " + codeStr + diagnostic.message,
        );
      }
    }

    // Print summary of errors and warnings
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const diagnostics of diagnosticsMap.values()) {
      if (!diagnostics) continue;
      for (const d of diagnostics) {
        if (d.type === "error") totalErrors++;
        else totalWarnings++;
      }
    }
    if (totalErrors > 0 || totalWarnings > 0) {
      console.log(`\n${totalErrors} error(s), ${totalWarnings} warning(s) found.`);
    }
  },
};

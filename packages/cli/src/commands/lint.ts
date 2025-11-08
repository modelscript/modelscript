// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaLibrary, ModelicaLinter } from "modelscript";
import type { CommandModule } from "yargs";
import Parser, { type Range } from "tree-sitter";
import Modelica from "@modelscript/tree-sitter-modelica";
import { NodeFileSystem } from "../util/filesystem.js";

interface LintArgs {
  path: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Lint: CommandModule<{}, LintArgs> = {
  command: "lint <path>",
  describe: "",
  builder: (yargs) => {
    return yargs.positional("path", {
      demandOption: true,
      description: "path of library or module to lint",
      type: "string",
    });
  },
  handler: (args) => {
    const diagnosticsMap = new Map<
      string | null,
      { type: string; message: string; resource: string | null | undefined; range: Range | null | undefined }[]
    >();
    const linter = new ModelicaLinter(
      (type: string, message: string, resource: string | null | undefined, range: Range | null | undefined) => {
        if (!diagnosticsMap.has(resource ?? null)) {
          diagnosticsMap.set(resource ?? null, []);
        }
        diagnosticsMap.get(resource ?? null)?.push({ type, message, resource, range });
      },
    );

    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());
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
        console.log("  " + row + ":" + col + "  " + diagnostic.type.padEnd(maxLengthType) + "  " + diagnostic.message);
      }
    }
  },
};

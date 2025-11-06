// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaClassInstance,
  ModelicaLinter,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSyntaxNode,
} from "modelscript";
import type { CommandModule } from "yargs";
import Parser, { type Range } from "tree-sitter";
import Modelica from "@modelscript/tree-sitter-modelica";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface LintArgs {
  file: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Lint: CommandModule<{}, LintArgs> = {
  command: "lint <file>",
  describe: "",
  builder: (yargs) => {
    return yargs.positional("file", {
      demandOption: true,
      description: "path of file to lint",
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
    const resource = resolve(args.file);
    const parser = new Parser();
    parser.setLanguage(Modelica);
    const text = readFileSync(args.file, "utf8");
    const tree = parser.parse(text);
    linter.lint(tree, resource);
    const node = ModelicaSyntaxNode.new(null, tree.rootNode) as ModelicaStoredDefinitionSyntaxNode;
    linter.lint(node, resource);
    const instance = new ModelicaClassInstance(null, node.classDefinitions[0]);
    instance.instantiate();
    linter.lint(instance, resource);
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

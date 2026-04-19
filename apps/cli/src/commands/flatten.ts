// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaDAEPrinter, ModelicaFlattener, ModelicaLinter } from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import path from "node:path";
import Parser, { type Range } from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface FlattenArgs {
  name: string;
  paths: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Flatten: CommandModule<{}, FlattenArgs> = {
  command: "flatten <name> <paths...>",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to flatten",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      });
  },
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
    const context = new Context(new NodeFileSystem());

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    for (const p of args.paths) await context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    // Flatten the model
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).accept(new ModelicaFlattener(), ["", dae]);

    // Run the linter to collect diagnostics
    const diagnostics: { type: string; code: number; message: string; resource: string | null; range: Range | null }[] =
      [];
    const linter = new ModelicaLinter(
      (
        type: string,
        code: number,
        message: string,
        resource: string | null | undefined,
        range: Range | null | undefined,
      ) => {
        diagnostics.push({ type, code, message, resource: resource ?? null, range: range ?? null });
      },
    );
    for (const cls of context.classes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linter.lint(cls as any);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    linter.lint(instance as any);

    // Convert absolute resource path to user-provided relative path
    const toUserPath = (absPath: string | null) => {
      if (!absPath) return "";
      for (const [resolved, userProvided] of pathMap) {
        if (absPath === resolved) return userProvided;
        if (absPath.startsWith(resolved + path.sep)) {
          return userProvided + absPath.slice(resolved.length);
        }
      }
      return absPath;
    };

    const formatDiag = (d: (typeof diagnostics)[number]) => {
      const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
      const codeStr = d.code > 0 ? `[M${d.code}] ` : "";
      if (d.range) {
        const startPos = `${d.range.startPosition.row + 1}:${d.range.startPosition.column + 1}`;
        const endPos = `${d.range.endPosition.row + 1}:${d.range.endPosition.column + 1}`;
        const filePath = toUserPath(d.resource);
        return `[${filePath}:${startPos}-${endPos}] ${severity}: ${codeStr}${d.message}`;
      }
      return `${severity}: ${codeStr}${d.message}`;
    };

    const errors = diagnostics.filter((d) => d.type === "error");
    const warnings = diagnostics.filter((d) => d.type !== "error");

    // If errors exist, print only diagnostics (no flattened output)
    if (errors.length > 0) {
      for (const d of diagnostics) console.error(formatDiag(d));
      console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) found.`);
      return;
    }

    // No errors: print flattened output
    dae.accept(new ModelicaDAEPrinter(process.stdout));

    // Print warnings after flattened output
    for (const d of warnings) console.error(formatDiag(d));
    if (errors.length > 0 || warnings.length > 0) {
      console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) found.`);
    }
  },
};

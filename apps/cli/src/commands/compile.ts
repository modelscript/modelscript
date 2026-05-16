// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaDAEPrinter, ModelicaFlattener, ModelicaLinter } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import { snapshotMemory } from "@modelscript/simulator";
import path from "node:path";
import Parser, { type Range } from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";

interface CompileArgs {
  name: string;
  paths: string[];
  timing?: boolean;
  "memory-profile"?: boolean;
  memoryProfile?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Compile: CommandModule<{}, CompileArgs> = {
  command: ["compile <name> <paths...>", "flatten <name> <paths...>"],
  describe: "Flatten a Modelica model to a flat DAE representation",
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
      })
      .option("timing", {
        description: "report timing information for each stage as JSON to stderr",
        type: "boolean",
        default: false,
      })
      .option("memory-profile", {
        description: "profile memory usage across phases and report as JSON to stderr",
        type: "boolean",
        default: false,
      });
  },
  handler: async (args) => {
    const profiler = new Profiler();

    const parser = new Parser();
    parser.setLanguage(Modelica);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    const memProfiles: Record<string, unknown> = {};
    let lastSnap = args.memoryProfile ? snapshotMemory(true) : null;

    profiler.start("parsing");
    for (const p of args.paths) await context.addLibrary(p);
    profiler.end("parsing");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["parsing"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    // Flatten the model
    profiler.start("flattening");
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).accept(new ModelicaFlattener(), ["", dae]);
    profiler.end("flattening");

    Context.gcBetweenPhases();

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["flattening"] = { before: lastSnap, after: snap };
    }

    // Run the linter to collect diagnostics
    profiler.start("linting");
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
    profiler.end("linting");

    Context.gcBetweenPhases();

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
      if (args.timing) profiler.report();
      return;
    }

    // No errors: print flattened output
    dae.accept(new ModelicaDAEPrinter(process.stdout));

    // Print warnings after flattened output
    for (const d of warnings) console.error(formatDiag(d));
    if (errors.length > 0 || warnings.length > 0) {
      console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) found.`);
    }

    if (args.memoryProfile) {
      console.error(JSON.stringify({ memory: memProfiles }, null, 2));
    }

    if (args.timing) profiler.report();
  },
};

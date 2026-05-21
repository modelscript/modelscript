// SPDX-License-Identifier: AGPL-3.0-or-later

import { printArenaDAE } from "@modelscript/compiler";
import { Context } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import { snapshotMemory } from "@modelscript/simulator";
import path from "node:path";
import Parser from "tree-sitter";
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

    // Flatten the model using Arena
    profiler.start("flattening");
    const arena = context.flattenArena(args.name);
    profiler.end("flattening");

    Context.gcBetweenPhases();

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["flattening"] = { before: lastSnap, after: snap };
    }

    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      return;
    }

    // Print flattened output
    const text = printArenaDAE(arena);
    process.stdout.write(text);

    if (args.memoryProfile) {
      console.error(JSON.stringify({ memory: memProfiles }, null, 2));
    }

    if (args.timing) profiler.report();
  },
};

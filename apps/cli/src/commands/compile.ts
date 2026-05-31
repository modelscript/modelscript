// SPDX-License-Identifier: AGPL-3.0-or-later

import { printArenaDAE } from "@modelscript/compiler";
import { snapshotMemory } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    const { UnifiedWorkspace } = await import("@modelscript/compiler");
    const { createModelicaQueryEngine, createSysML2WorkspaceIndex, createModelicaWorkspaceIndex } =
      await import("@modelscript/core");
    const sysml2LangFallback = (await import("@modelscript/sysml2/language")).default;
    const modelicaLangFallback = (await import("@modelscript/modelica/language")).default;

    const parser = new Parser();
    parser.setLanguage(Modelica);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    const mIdx = createModelicaWorkspaceIndex();
    const sysmlIndex = createSysML2WorkspaceIndex();

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    const memProfiles: Record<string, unknown> = {};
    let lastSnap = args.memoryProfile ? snapshotMemory(true) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sysmlParser: any = null;
    let hasSysML = false;
    profiler.start("parsing");
    for (const p of args.paths) {
      if (p.endsWith(".sysml")) {
        hasSysML = true;
        const WebParserModule = await import("web-tree-sitter");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const WebParser: any = WebParserModule.default || WebParserModule;
        await WebParser.Parser.init();
        const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/tree-sitter-sysml2.wasm");
        const fs = await import("fs");
        const SysML2 = await WebParser.Language.load(fs.readFileSync(wasmPath));
        if (!sysmlParser) {
          sysmlParser = new WebParser.Parser();
          sysmlParser.setLanguage(SysML2);
        }
        const text = await import("fs/promises").then((m) => m.readFile(p, "utf-8"));
        const tree = sysmlParser.parse(text);
        const fileUri = "file://" + path.resolve(p);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sysmlIndex.register(fileUri, () => tree.rootNode as any);
      } else if (p.endsWith(".mo")) {
        await context.addLibrary(p);
        const text = await import("fs/promises").then((m) => m.readFile(p, "utf-8"));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mIdx.register(`file://${path.resolve(p)}`, () => parser.parse(text).rootNode as any);
      } else {
        await context.addLibrary(p);
      }
    }
    profiler.end("parsing");

    if (hasSysML) {
      const u = new UnifiedWorkspace();
      u.registerWorkspace("modelica", mIdx, modelicaLangFallback);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      u.registerWorkspace("sysml2", sysmlIndex, sysml2LangFallback as any);
      if (sysmlIndex) await sysmlIndex.toUnifiedAsync();
      const unifiedDb = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();
      const sysmlFactory = await import("@modelscript/sysml2/factory");
      const fileCache = new Map<string, string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const treeCache = new Map<string, any>();
      const engine = createModelicaQueryEngine(
        unifiedDb,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getText: (startByte: number, endByte: number, entry?: any) => {
            if (!entry || !entry.resourceId) return null;
            const p = pathMap.get(entry.resourceId.replace("file://", ""));
            if (!p) return null;
            let text = fileCache.get(p);
            if (text === undefined) {
              text = require("fs").readFileSync(p, "utf-8");
              fileCache.set(p, text as string);
            }
            return (text as string).substring(startByte, endByte);
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getNode: (startByte: number, endByte: number, entry?: any) => {
            if (!entry || !entry.resourceId) return null;
            const p = pathMap.get(entry.resourceId.replace("file://", ""));
            if (!p) return null;
            let text = fileCache.get(p);
            if (text === undefined) {
              text = require("fs").readFileSync(p, "utf-8");
              fileCache.set(p, text as string);
            }
            let tree = treeCache.get(p);
            if (!tree) {
              if (entry.resourceId.endsWith(".sysml")) {
                tree = sysmlParser.parse(text as string);
              } else {
                tree = parser.parse(text as string);
              }
              treeCache.set(p, tree);
            }
            return tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
          },
        },
        undefined,
        undefined,
        sysmlFactory.queryHooks,
      );
      context.setQueryEngine(engine);
    }

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

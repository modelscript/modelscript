// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { printArenaDAE } from "@modelscript/runtime";
import { snapshotMemory } from "@modelscript/simulate";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface CompileArgs {
  name: string;
  paths: string[];
  timing?: boolean;
  "memory-profile"?: boolean;
  memoryProfile?: boolean;
}

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
      .option("modelica-path", {
        alias: "L",
        description: "directories to search for Modelica libraries (colon-separated)",
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

    const { UnifiedWorkspace } = await import("@modelscript/runtime");
    const { createModelicaQueryEngine, createModelicaWorkspaceIndex } = await import("@modelscript/modelica/factory");
    const { createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } = await import("@modelscript/sysml2/factory");
    const sysml2LangFallback = (await import("@modelscript/sysml2/language")).default;
    const modelicaLangFallback = (await import("@modelscript/modelica/language")).default;

    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    if (args["modelica-path"]) {
      context.modelicaPath = args["modelica-path"] as string;
    }

    const mIdx = createModelicaWorkspaceIndex();
    const sysmlIndex = createSysML2WorkspaceIndex();

    // Auto-load root package from MODELICAPATH if specified in class name
    const rootName = args.name.split(".")[0];
    if (rootName) {
      await context.loadFromModelicaPath(rootName);
    }

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    const memProfiles: Record<string, unknown> = {};
    let lastSnap = args.memoryProfile ? snapshotMemory(true) : null;

    let sysmlParser: any = null;
    let hasSysML = false;
    profiler.start("parsing");
    for (const p of args.paths) {
      if (p.endsWith(".sysml")) {
        hasSysML = true;
        const { createWasmParser } = await import("@modelscript/dsl");
        const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/dist/parser.wasm");
        if (!sysmlParser) {
          const sysmlResult = await createWasmParser(wasmPath);
          sysmlParser = sysmlResult.parser;
        }
        const text = await import("fs/promises").then((m) => m.readFile(p, "utf-8"));
        const tree = sysmlParser.parse(text);
        const fileUri = "file://" + path.resolve(p);

        sysmlIndex.register(fileUri, () => tree.rootNode as any);
      } else if (p.endsWith(".mo")) {
        await context.addLibrary(p);
        const text = await import("fs/promises").then((m) => m.readFile(p, "utf-8"));

        mIdx.register(`file://${path.resolve(p)}`, () => parser.parse(text)?.rootNode as any);
      } else {
        await context.addLibrary(p);
      }
    }
    profiler.end("parsing");

    if (hasSysML) {
      if (sysmlParser) {
        loadEmbeddedKerMLStdlib(sysmlIndex, sysmlParser);
      }
      const u = new UnifiedWorkspace();
      u.registerWorkspace("modelica", mIdx, modelicaLangFallback);

      u.registerWorkspace("sysml2", sysmlIndex, sysml2LangFallback as any);
      if (sysmlIndex) await sysmlIndex.toUnifiedAsync();
      const unifiedDb = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();
      const sysmlFactory = await import("@modelscript/sysml2/factory");
      u.registerParser(".mo", parser as any);
      u.registerParser(".sysml", sysmlParser as any);

      const ensureDocument = (resId: string) => {
        const p = pathMap.get(resId.replace("file://", "")) || resId.replace("file://", "");
        if (!u.getDocumentText(resId) && !u.getDocumentText(p)) {
          try {
            const text = require("fs").readFileSync(p, "utf-8");
            u.setDocument(resId, text);
            u.setDocument(p, text);
          } catch {
            // ignore
          }
        }
      };

      const engine = createModelicaQueryEngine(
        unifiedDb,
        {
          getText: (startByte: number, endByte: number, entry?: any) => {
            if (!entry?.resourceId) return null;
            ensureDocument(entry.resourceId);
            return u.cstTextProvider ? u.cstTextProvider(startByte, endByte, entry) : null;
          },
          getNode: (startByte: number, endByte: number, entry?: any) => {
            if (!entry?.resourceId) return null;
            ensureDocument(entry.resourceId);
            return u.cstNodeProvider ? u.cstNodeProvider(entry.id) : null;
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

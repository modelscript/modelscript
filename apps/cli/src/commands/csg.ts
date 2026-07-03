// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/core";
import { CSGWorker, extractCSGTopology } from "@modelscript/csg";
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface CSGArgs {
  name: string;
  paths: string[];
}

export const BuildCSG: CommandModule<{}, CSGArgs> = {
  command: "csg <name> <paths...>",
  describe: "Compile and extract CSG topologies to 3D meshes",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to evaluate",
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
    Context.registerParser(".mo", parser as any);
    const context = new Context(new NodeFileSystem());

    for (const p of args.paths) await context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    console.log(`[CLI] Flattening ${args.name}...`);
    const arena = context.flattenArena(args.name);
    if (!arena) {
      console.error(`[CLI] Failed to flatten ${args.name}.`);
      return;
    }

    const csgGraph = extractCSGTopology(context, args.name);

    if (!csgGraph || csgGraph.nodes.length === 0) {
      console.log(`[CLI] No CSG operations found in ${args.name}.`);
      return;
    }

    const outputDir = path.join(process.cwd(), "build", "csg");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "execution_graph.json"), JSON.stringify(csgGraph, null, 2));

    console.log(`[CLI] Discovered ${csgGraph.nodes.length} CSG topologically ordered nodes.`);
    console.log(`[CLI] Spawning OpenCASCADE Worker...`);

    const worker = new CSGWorker();
    await worker.processGraph(csgGraph, outputDir);
  },
};

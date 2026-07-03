// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener } from "@modelscript/core";
import { CSGWorker } from "@modelscript/csg";
import Modelica from "@modelscript/tree-sitter-modelica";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface CSGArgs {
  name: string;
  paths: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());

    for (const p of args.paths) context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    console.log(`[CLI] Flattening ${args.name}...`);
    // Flatten the model
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    instance.accept(new ModelicaFlattener(), ["", dae]);

    // Check if the flattener found any CSG nodes
    if (!dae.csgGraph || dae.csgGraph.nodes.length === 0) {
      console.log(`[CLI] No CSG operations found in ${args.name}.`);
      return;
    }

    const outputDir = path.join(process.cwd(), "build", "csg");

    // Write out the graph JSON for diagnostics
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "execution_graph.json"), JSON.stringify(dae.csgGraph, null, 2));

    console.log(`[CLI] Discovered ${dae.csgGraph.nodes.length} CSG topologically ordered nodes.`);
    console.log(`[CLI] Spawning OpenCASCADE Worker...`);

    const worker = new CSGWorker();
    await worker.processGraph(dae.csgGraph, outputDir);
  },
};

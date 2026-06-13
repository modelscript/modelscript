// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface InstantiateArgs {
  name: string;
  paths: string[];
}

export const Instantiate: CommandModule<{}, InstantiateArgs> = {
  command: "instantiate <name> <paths...>",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to instantiate",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "path of library and module to load",
        type: "string",
      });
  },
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

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

    // Output
    const json = JSON.stringify(instance, null, 2);
    console.log(json);
  },
};

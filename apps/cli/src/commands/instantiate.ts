// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { createRequire } from "node:module";
import path from "node:path";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface InstantiateArgs {
  name: string;
  paths: string[];
}

export const Instantiate: CommandModule<{}, InstantiateArgs> = {
  command: "instantiate <name> <paths...>",
  describe: "Instantiate and query AST structure of a Modelica model",
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
    const { parser } = await createWasmParser(modelicaWasmPath);
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

// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelscript";
import Modelica from "@modelscript/tree-sitter-modelica";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface InstantiateArgs {
  name: string;
  paths: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());
    for (const path of args.paths) context.addLibrary(path);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
    } else {
      const json = JSON.stringify(instance, null, 2);
      console.log(json);
    }
  },
};

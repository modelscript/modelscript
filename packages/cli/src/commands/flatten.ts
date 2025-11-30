// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaFlattener, Context, ModelicaLibrary, ModelicaDAE, ModelicaDAEPrinter } from "@modelscript/modelscript";
import type { CommandModule } from "yargs";
import Parser from "tree-sitter";
import Modelica from "@modelscript/tree-sitter-modelica";
import { NodeFileSystem } from "../util/filesystem.js";

interface FlattenArgs {
  name: string;
  path: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Flatten: CommandModule<{}, FlattenArgs> = {
  command: "flatten <name> <path>",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to flatten",
        type: "string",
      })
      .positional("path", {
        demandOption: true,
        description: "path of library or module to load",
        type: "string",
      });
  },
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());
    const library = new ModelicaLibrary(context, args.path);
    const instance = library.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
    } else {
      const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
      instance.accept(new ModelicaFlattener(), ["", dae]);
      dae.accept(new ModelicaDAEPrinter(process.stdout));
    }
  },
};

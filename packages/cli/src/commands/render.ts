// SPDX-License-Identifier: AGPL-3.0-or-later

import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { Context, ModelicaClassInstance, ModelicaLibrary, renderIcon } from "modelscript";
import Modelica from "@modelscript/tree-sitter-modelica";
import { NodeFileSystem } from "../util/filesystem.js";
import { registerWindow } from "@svgdotjs/svg.js";
import { createSVGWindow } from "svgdom";
import xmlFormat from "xml-formatter";

interface RenderArgs {
  name: string;
  path: string;
  icon: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Render: CommandModule<{}, RenderArgs> = {
  command: "render <name> <path>",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to render",
        type: "string",
      })
      .positional("path", {
        demandOption: true,
        description: "path of library or module to load",
        type: "string",
      })
      .option("icon", {
        alias: "i",
        description: "render icon",
        type: "boolean",
        default: false,
      });
  },
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());
    const library = new ModelicaLibrary(context, args.path);
    const instance = library.query(args.name);
    const window = createSVGWindow();
    registerWindow(window, window.document);
    if (!instance) {
      console.error(`'${args.name}' not found`);
    } else if (!(instance instanceof ModelicaClassInstance)) {
      console.error(`'${args.name}' is not a class`);
    } else {
      if (args.icon) {
        const svg = renderIcon(instance);
        if (svg) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          console.log((xmlFormat as any)(svg?.svg()));
        }
      }
    }
  },
};

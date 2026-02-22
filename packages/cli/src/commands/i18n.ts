// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, I18nVisitor } from "@modelscript/modelscript";
import Modelica from "@modelscript/tree-sitter-modelica";
import { writeFileSync } from "node:fs";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface I18nArgs {
  paths: string[];
  output: string | undefined;
}

export const I18n: CommandModule<Record<string, unknown>, I18nArgs> = {
  command: "i18n <paths...>",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to scan",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "path to the output .pot file",
        type: "string",
      }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());

    const visitor = new I18nVisitor();

    for (const path of args.paths) {
      const library = context.addLibrary(path);
      if (library) {
        library.accept(visitor);
      }
    }

    const pot = visitor.generatePot();
    if (args.output) {
      writeFileSync(args.output, pot);
    } else {
      process.stdout.write(pot);
    }
  },
};

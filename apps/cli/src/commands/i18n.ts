// SPDX-License-Identifier: AGPL-3.0-or-later

import { I18nExtractor } from "@modelscript/compiler";
import { Context } from "@modelscript/core";
import { i18nConfig } from "@modelscript/modelica/indexer_config";
import Modelica from "@modelscript/modelica/parser";
import { writeFileSync } from "node:fs";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface I18nArgs {
  paths: string[];
  output: string | undefined;
}

export const I18n: CommandModule<Record<string, unknown>, I18nArgs> = {
  command: "i18n <paths..>",
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
  },
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    const extractor = new I18nExtractor(i18nConfig);

    for (const path of args.paths) {
      const library = await context.addLibrary(path);
      if (library) {
        for (const uri of context.workspaceIndex.uris) {
          if (uri.startsWith(library.path)) {
            const tree = context.getTree(uri);
            if (tree?.rootNode) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              extractor.extract(tree.rootNode as any, uri);
            }
          }
        }
      }
    }

    const pot = extractor.generatePot();
    if (args.output) {
      writeFileSync(args.output, pot);
    } else {
      process.stdout.write(pot);
    }
  },
};

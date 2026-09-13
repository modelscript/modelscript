// SPDX-License-Identifier: AGPL-3.0-or-later
import { I18nExtractor } from "@modelscript/dsl";
import { extractI18nConfig } from "@modelscript/lsp";
import { Context } from "@modelscript/modelica/context";
import modelicaLang from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface I18nArgs {
  paths: string[];
  output: string | undefined;
}

export const I18n: CommandModule<Record<string, unknown>, I18nArgs> = {
  command: "i18n <paths..>",
  describe: "Extract internationalization (.pot) translation templates from Modelica models",
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
      }) as any;
  },
  handler: async (args) => {
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    const i18nConfig = extractI18nConfig(modelicaLang);
    const extractor = new I18nExtractor(i18nConfig);

    for (const path of args.paths) {
      const library = await context.addLibrary(path);
      if (library) {
        for (const uri of context.workspaceIndex.uris) {
          if (uri.startsWith(library.path)) {
            const tree = context.getTree(uri);
            if (tree?.rootNode) {
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

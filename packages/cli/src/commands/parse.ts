// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaSyntaxNode } from "@modelscript/modelscript";
import Modelica from "@modelscript/tree-sitter-modelica";
import { readFileSync } from "node:fs";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";

interface ParseArgs {
  file: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Parse: CommandModule<{}, ParseArgs> = {
  command: "parse <file>",
  describe: "",
  builder: (yargs) => {
    return yargs.positional("file", {
      demandOption: true,
      description: "path of file to parse",
      type: "string",
    });
  },
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    const text = readFileSync(args.file, "utf8");
    const tree = parser.parse(text);
    const node = ModelicaSyntaxNode.new(null, tree.rootNode);
    const json = JSON.stringify(node, null, 2);
    console.log(json);
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaClassInstance, ModelicaStoredDefinitionSyntaxNode, ModelicaSyntaxNode } from "modelscript";
import type { CommandModule } from "yargs";
import Parser from "tree-sitter";
import Modelica from "@modelscript/tree-sitter-modelica";
import { readFileSync } from "node:fs";

interface InstantiateArgs {
  file: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Instantiate: CommandModule<{}, InstantiateArgs> = {
  command: "instantiate <file>",
  describe: "",
  builder: (yargs) => {
    return yargs.positional("file", {
      demandOption: true,
      description: "path of file to instantiate",
      type: "string",
    });
  },
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    const text = readFileSync(args.file, "utf8");
    const tree = parser.parse(text);
    const node = ModelicaSyntaxNode.new(null, tree.rootNode) as ModelicaStoredDefinitionSyntaxNode;
    const instance = new ModelicaClassInstance(null, node.classDefinitions[0]);
    instance.instantiate();
    const json = JSON.stringify(instance, null, 2);
    console.log(json);
  },
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { LanguageResolver } from "../util/language-registry.js";

interface UnparseArgs {
  file: string;
  output?: string;
  language?: string;
  indentSize?: number;
}

export const Unparse: CommandModule<any, any> = {
  command: "unparse <file>",
  describe: "Unparse and re-synthesize clean source code from the language AST",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        description: "Path of source file to parse and unparse",
        type: "string",
        demandOption: true,
      })
      .option("output", {
        alias: "o",
        description: "Output file path (default prints to stdout)",
        type: "string",
      })
      .option("language", {
        alias: "l",
        description: "Explicit language override",
        type: "string",
      })
      .option("indent-size", {
        description: "Number of spaces per indentation level",
        type: "number",
        default: 2,
      });
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found at ${filePath}`);
      process.exit(1);
    }

    try {
      const lang = await LanguageResolver.resolve(filePath, args.language);
      const original = fs.readFileSync(filePath, "utf-8");
      const unparsed = await lang.unparse(original, {
        indentSize: args.indentSize,
      });

      if (args.output) {
        const outPath = path.resolve(process.cwd(), args.output);
        fs.writeFileSync(outPath, unparsed, "utf-8");
        console.log(`Unparsed output written to: ${outPath}`);
      } else {
        process.stdout.write(unparsed);
      }
    } catch (err: any) {
      console.error(`Unparse failed: ${err.message}`);
      process.exit(1);
    }
  },
};

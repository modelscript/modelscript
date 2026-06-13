// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/language";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface GenerateArgs {
  entry: string;
  outdir: string;
}

export const Generate: CommandModule<{}, GenerateArgs> = {
  command: "generate [entry] [outdir]",
  describe: "Generate parser tables from a ModelScript DSL language spec",
  builder: (yargs) => {
    return yargs
      .positional("entry", {
        demandOption: false,
        description: "path to the language spec file (e.g. src/language.ts)",
        type: "string",
        default: "src/language.ts",
      })
      .positional("outdir", {
        description: "output directory",
        type: "string",
        default: "build/src-gen",
      });
  },
  handler: async (args) => {
    try {
      const entryPath = args.entry;
      const outDir = args.outdir;

      const absoluteEntry = path.resolve(process.cwd(), entryPath);
      if (!fs.existsSync(absoluteEntry)) {
        console.error(`Error: Entry file not found at ${absoluteEntry}`);
        process.exit(1);
      }

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);
      const module = (await jiti.import(absoluteEntry)) as Record<string, unknown>;

      const languageDef = Object.values(module).find((val: unknown) => {
        const v = val as Record<string, unknown>;
        return v && v.name && v.rules;
      }) as any;

      if (!languageDef) {
        console.error("Error: Could not find a valid language export in the entry file.");
        process.exit(1);
      }

      const { parserInfo, assemblyScriptFiles, javascriptWrapper } = buildParser(languageDef);

      const absoluteOutDir = path.resolve(process.cwd(), outDir);
      if (!fs.existsSync(absoluteOutDir)) {
        fs.mkdirSync(absoluteOutDir, { recursive: true });
      }

      const outputPath = path.join(absoluteOutDir, "parser.json");
      fs.writeFileSync(outputPath, JSON.stringify(parserInfo, null, 2));

      for (const file of assemblyScriptFiles) {
        fs.writeFileSync(path.join(absoluteOutDir, file.filename), file.content);
      }

      const { js: wrapperJs, dts: wrapperDts } = javascriptWrapper;
      const jsOutputPath = path.join(absoluteOutDir, "wrapper.js");
      const dtsOutputPath = path.join(absoluteOutDir, "wrapper.d.ts");
      fs.writeFileSync(jsOutputPath, wrapperJs);
      fs.writeFileSync(dtsOutputPath, wrapperDts);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(err.stack || err.message);
      } else {
        console.error(err);
      }
      process.exit(1);
    }
  },
};

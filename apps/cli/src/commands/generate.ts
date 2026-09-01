// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, bundleExtension, type ExtensionGeneratedFile } from "@modelscript/language";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface GenerateArgs {
  target?: string;
  entries?: string[];
  entry?: string;
  outdir: string;
  vsix?: boolean;
}

export const Generate: CommandModule<any, any> = {
  command: "generate [target] [entries..]",
  describe: "Generate parser tables or a full VS Code extension from DSL language specs",
  builder: (yargs) => {
    return yargs
      .positional("target", {
        description: "Generation target: 'parser' (default) or 'extension'",
        type: "string",
        default: "parser",
      })
      .positional("entries", {
        description: "Path(s) to the language spec file(s) (e.g. src/language.ts)",
        type: "string",
        array: true,
      })
      .option("entry", {
        description: "Path to primary language spec file",
        type: "string",
        default: "src/language.ts",
      })
      .option("outdir", {
        alias: "o",
        description: "Output directory",
        type: "string",
        default: "build/src-gen",
      })
      .option("vsix", {
        description: "Package into a .vsix extension bundle",
        type: "boolean",
        default: false,
      });
  },
  handler: async (args) => {
    try {
      const isExtension = args.target === "extension";
      const outDir = args.outdir;
      const absoluteOutDir = path.resolve(process.cwd(), outDir);

      const rawEntries = args.entries && args.entries.length > 0 ? args.entries : [args.entry || "src/language.ts"];
      // If target was not 'extension' or 'parser', it might be the entry file path
      const entryList =
        args.target && args.target !== "extension" && args.target !== "parser"
          ? [args.target, ...rawEntries.filter((e: string) => e !== args.target)]
          : rawEntries;

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);

      const languageDefs: any[] = [];
      for (const entryPath of entryList) {
        const absoluteEntry = path.resolve(process.cwd(), entryPath);
        if (!fs.existsSync(absoluteEntry)) {
          console.warn(`Warning: Entry file not found at ${absoluteEntry}`);
          continue;
        }

        const module = (await jiti.import(absoluteEntry)) as Record<string, unknown>;
        const lang = Object.values(module).find((val: unknown) => {
          const v = val as Record<string, unknown>;
          return v && v.name && v.rules;
        }) as any;

        if (lang) languageDefs.push(lang);
      }

      if (languageDefs.length === 0) {
        console.error("Error: Could not find any valid language export in the specified entry files.");
        process.exit(1);
      }

      if (isExtension) {
        // Generate complete VS Code extension
        console.log(`Generating VS Code extension for ${languageDefs.length} language(s)...`);
        const files: ExtensionGeneratedFile[] = bundleExtension(languageDefs, {
          features: {
            diagramEditor: true,
            cad3dViewer: true,
            notebooks: true,
          },
        });

        if (!fs.existsSync(absoluteOutDir)) {
          fs.mkdirSync(absoluteOutDir, { recursive: true });
        }

        for (const file of files) {
          const fullPath = path.join(absoluteOutDir, file.path);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          if (typeof file.content === "string") {
            fs.writeFileSync(fullPath, file.content, "utf-8");
          } else {
            fs.writeFileSync(fullPath, file.content);
          }
        }

        // Build with esbuild programmatic API
        try {
          const esbuild = await import("esbuild");
          await esbuild.build({
            entryPoints: [path.join(absoluteOutDir, "src/extension.ts")],
            outfile: path.join(absoluteOutDir, "dist/extension.js"),
            bundle: true,
            external: ["vscode"],
            format: "cjs",
            platform: "browser",
          });
        } catch {
          console.log("Note: Run 'npx esbuild src/extension.ts' inside the output directory to compile the bundle.");
        }

        if (args.vsix) {
          console.log("Packaging into .vsix...");
          try {
            execSync(`npx @vscode/vsce package --no-dependencies`, { cwd: absoluteOutDir, stdio: "inherit" });
          } catch (e) {
            console.error("VSIX packaging failed:", e);
          }
        }

        console.log(`VS Code extension generated successfully at: ${absoluteOutDir}`);
      } else {
        // Default: Generate parser tables for primary language
        const primaryLang = languageDefs[0];
        const { parserInfo, assemblyScriptFiles, javascriptWrapper } = buildParser(primaryLang);

        if (!fs.existsSync(absoluteOutDir)) {
          fs.mkdirSync(absoluteOutDir, { recursive: true });
        }

        const outputPath = path.join(absoluteOutDir, "parser.json");
        fs.writeFileSync(outputPath, JSON.stringify(parserInfo, null, 2));

        for (const file of assemblyScriptFiles) {
          fs.writeFileSync(path.join(absoluteOutDir, file.filename), file.content);
        }

        const { js: wrapperJs, dts: wrapperDts } = javascriptWrapper;
        const jsOutputPath = path.join(absoluteOutDir, "index.js");
        const dtsOutputPath = path.join(absoluteOutDir, "index.d.ts");
        fs.writeFileSync(jsOutputPath, wrapperJs);
        fs.writeFileSync(dtsOutputPath, wrapperDts);

        console.log(`Parser tables generated at: ${absoluteOutDir}`);
      }
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

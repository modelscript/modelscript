// SPDX-License-Identifier: AGPL-3.0-or-later

import { bundleExtension, type ExtensionGeneratedFile } from "@modelscript/language";
import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";

interface SandboxArgs {
  entries: string[];
  outdir: string;
  open: boolean;
}

export const Sandbox: CommandModule<{}, SandboxArgs> = {
  command: "sandbox [entries..]",
  describe: "Start a VS Code Web sandbox with on-the-fly compiled multi-language extension",
  builder: (yargs) => {
    return yargs
      .positional("entries", {
        demandOption: false,
        description: "path(s) to the language spec file(s) (e.g. src/language.ts)",
        type: "string",
        array: true,
        default: ["src/language.ts"],
      })
      .option("outdir", {
        alias: "o",
        description: "output directory for extension build artifacts",
        type: "string",
        default: "build/src-gen",
      })
      .option("open", {
        description: "Open the browser automatically",
        type: "boolean",
        default: true,
      });
  },
  handler: async (args) => {
    try {
      const entryList = Array.isArray(args.entries) && args.entries.length > 0 ? args.entries : ["src/language.ts"];
      const outDir = args.outdir;
      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);

      const languageDefs: any[] = [];

      for (const entryPath of entryList) {
        const absoluteEntry = path.resolve(process.cwd(), entryPath);
        if (!fs.existsSync(absoluteEntry)) {
          console.warn(`Warning: Entry file not found at ${absoluteEntry}, skipping.`);
          continue;
        }

        const module = (await jiti.import(absoluteEntry)) as Record<string, unknown>;
        const lang = Object.values(module).find((val: unknown) => {
          const v = val as Record<string, unknown>;
          return v && v.name && v.rules;
        }) as any;

        if (lang) {
          languageDefs.push(lang);
        } else {
          console.warn(`Warning: No valid language definition found in ${entryPath}`);
        }
      }

      if (languageDefs.length === 0) {
        console.error("Error: Could not find any valid language export in the provided entry files.");
        process.exit(1);
      }

      console.log(
        `Generating VS Code extension for ${languageDefs.length} language(s): ${languageDefs.map((l) => l.name).join(", ")}...`,
      );

      const absoluteOutDir = path.resolve(process.cwd(), outDir);
      await startVscodeExtension(absoluteOutDir, languageDefs, args.open);
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

export async function startVscodeExtension(outDir: string, grammarDefs: any | any[], openBrowser = false) {
  const defs = Array.isArray(grammarDefs) ? grammarDefs : [grammarDefs];
  const primaryName = defs[0]?.name || "modelscript";
  const extDir = path.join(outDir, "..", ".vscode-extension");

  // 1. Generate Extension Files using Unified ExtensionGenerator
  const generatedFiles: ExtensionGeneratedFile[] = bundleExtension(defs, {
    name: defs.length > 1 ? "modelscript-sandbox" : `${primaryName.toLowerCase()}-lang`,
    displayName: defs.length > 1 ? "ModelScript Sandbox IDE" : `${primaryName} Sandbox`,
    features: {
      diagramEditor: true,
      cad3dViewer: true,
      notebooks: true,
    },
  });

  // 2. Write all generated files to extDir
  for (const file of generatedFiles) {
    const fullPath = path.join(extDir, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (typeof file.content === "string") {
      fs.writeFileSync(fullPath, file.content, "utf-8");
    } else {
      fs.writeFileSync(fullPath, file.content);
    }
  }

  // 3. Handle language icons if present
  for (const def of defs) {
    if (def.lsp?.icons) {
      const extIconsDir = path.join(extDir, "icons");
      fs.mkdirSync(extIconsDir, { recursive: true });

      const lightPath = path.resolve(process.cwd(), def.lsp.icons.light);
      const darkPath = path.resolve(process.cwd(), def.lsp.icons.dark);

      if (fs.existsSync(lightPath) && fs.existsSync(darkPath)) {
        const lightExt = path.extname(lightPath);
        const darkExt = path.extname(darkPath);
        fs.copyFileSync(lightPath, path.join(extIconsDir, `light${lightExt}`));
        fs.copyFileSync(darkPath, path.join(extIconsDir, `dark${darkExt}`));
      }
    }
  }

  // 4. Try copying compiled WASM binary if available
  const langName = primaryName.split("/").pop() || "parser";
  const candidateWasms = [
    path.join(process.cwd(), "dist", `${langName}.wasm`),
    path.join(process.cwd(), "build", "release.wasm"),
    path.join(process.cwd(), "dist", "release.wasm"),
    path.join(process.cwd(), "parser.wasm"),
  ];
  for (const candidate of candidateWasms) {
    if (fs.existsSync(candidate)) {
      fs.copyFileSync(candidate, path.join(extDir, "parser.wasm"));
      break;
    }
  }

  // 5. Build Extension bundle via esbuild programmatic API
  console.log(`Building VS Code extension bundle with esbuild...`);
  try {
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [path.join(extDir, "src/extension.ts")],
      outfile: path.join(extDir, "dist/extension.js"),
      bundle: true,
      external: ["vscode"],
      format: "cjs",
      platform: "browser",
    });
  } catch (e) {
    console.error("Failed to build extension with esbuild:", e);
    process.exit(1);
  }

  // 6. Boot @vscode/test-web
  console.log(`Booting up @vscode/test-web...`);
  try {
    let commitArg = "";
    const sharedTestWebDir = path.join(os.homedir(), ".vscode-test-web");

    if (fs.existsSync(sharedTestWebDir)) {
      const dirs = fs.readdirSync(sharedTestWebDir);
      for (const d of dirs) {
        if (d.startsWith("vscode-web-insider-") || d.startsWith("vscode-web-stable-")) {
          const commit = d.replace(/^vscode-web-(insider|stable)-/, "");
          commitArg = `--commit ${commit}`;
          console.log(`Using cached VS Code Web commit: ${commit}`);
          break;
        }
      }
    }

    // Set up workspace folder with sample files
    let workspaceFolder = path.resolve(outDir, "..", "..", "workspace");
    const examplesDir = path.resolve(outDir, "..", "..", "examples");

    if (fs.existsSync(examplesDir) && fs.statSync(examplesDir).isDirectory()) {
      workspaceFolder = examplesDir;
    } else if (!fs.existsSync(workspaceFolder)) {
      fs.mkdirSync(workspaceFolder, { recursive: true });

      for (const def of defs) {
        const langId = (def.name || "dsl").toLowerCase();
        const ext = def.lsp?.fileExtension || `.${langId}`;
        const sampleContent =
          langId === "calc"
            ? "/* Welcome to Calc! */\n\na = 10;\nb = 20;\nsum = a + b;\n"
            : langId === "json"
              ? '{\n  "hello": "world",\n  "status": true,\n  "count": 42\n}\n'
              : langId === "csv"
                ? "time,voltage,current\n0.0,12.0,0.0\n1.0,11.8,0.5\n2.0,11.5,1.0\n"
                : `// Sample ${def.name || langId} file\n`;
        fs.writeFileSync(path.join(workspaceFolder, `example${ext}`), sampleContent, "utf-8");
      }
    }

    const args = [
      "--yes",
      "@vscode/test-web",
      "--browserType=none",
      "--coi",
      `--extensionDevelopmentPath=${extDir}`,
      `--testRunnerDataDir=${sharedTestWebDir}`,
    ];
    if (commitArg) {
      args.push("--commit");
      args.push(commitArg.replace("--commit ", ""));
    }
    args.push(workspaceFolder);

    const serverProcess = spawn("npx", args, {
      cwd: extDir,
      stdio: "inherit",
      shell: true,
    });

    if (openBrowser) {
      setTimeout(() => {
        const startCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${startCmd} http://localhost:3000`).on("error", () => {
          console.log("Could not open browser automatically. Please navigate to http://localhost:3000");
        });
      }, 2500);
    }

    serverProcess.on("close", (code) => {
      process.exit(code || 0);
    });
  } catch (e) {
    console.error("VS Code Web environment closed with error:", e);
  }
}

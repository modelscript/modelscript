// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} LanguageParserBuildOptions
 * @property {string} langName - Name of the language (e.g. "modelica", "step")
 * @property {string} dir - Directory of the language package
 * @property {string} languageModule - Path to language definition module (e.g. "./src/language.js")
 * @property {string} languageExportName - Exported identifier (e.g. "stepLanguage")
 * @property {string[]} [extraWatchFiles] - Additional files to watch for cache invalidation
 * @property {string[]} [extraAscFlags] - Additional asc compiler flags
 */

/**
 * Executes unified language parser and WebAssembly generation.
 * @param {LanguageParserBuildOptions} options
 */
export function runLanguageParserBuild(options) {
  const { langName, dir, languageModule, languageExportName, extraWatchFiles = [], extraAscFlags = [] } = options;

  const forceRebuild = process.argv.includes("--force");
  const outWasm = path.join(dir, "dist", "parser.wasm");
  const bindingsJs = path.join(dir, "src-gen", "bindings.js");
  const distBindingsJs = path.join(dir, "dist", "src-gen", "bindings.js");
  const languagePath = path.join(dir, "src", "language.ts");
  const dslDistPath = path.resolve(dir, "../../packages/dsl/dist/index.js");

  const cacheDir = path.join(dir, ".cache");
  const cacheWasm = path.join(cacheDir, "parser.wasm");

  function isParserUpToDate() {
    if (forceRebuild) return false;

    // If outWasm is missing (e.g. wiped by Nx task runner), restore from .cache if valid
    if (!fs.existsSync(outWasm) && fs.existsSync(cacheWasm) && fs.existsSync(bindingsJs)) {
      const cacheStat = fs.statSync(cacheWasm);
      if (cacheStat.size > 0) {
        const cacheTime = cacheStat.mtimeMs;
        const langTime = fs.existsSync(languagePath) ? fs.statSync(languagePath).mtimeMs : 0;
        const dslTime = fs.existsSync(dslDistPath) ? fs.statSync(dslDistPath).mtimeMs : 0;
        if (cacheTime > langTime && cacheTime > dslTime) {
          fs.mkdirSync(path.dirname(outWasm), { recursive: true });
          fs.copyFileSync(cacheWasm, outWasm);
          return true;
        }
      }
    }

    if (!fs.existsSync(outWasm) || !fs.existsSync(bindingsJs)) return false;
    const wasmStat = fs.statSync(outWasm);
    if (wasmStat.size === 0) return false;
    const wasmTime = wasmStat.mtimeMs;

    if (fs.existsSync(languagePath) && fs.statSync(languagePath).mtimeMs > wasmTime) return false;
    if (fs.existsSync(dslDistPath) && fs.statSync(dslDistPath).mtimeMs > wasmTime) return false;

    for (const extra of extraWatchFiles) {
      const extraPath = path.join(dir, extra);
      if (fs.existsSync(extraPath)) {
        const stat = fs.statSync(extraPath);
        if (stat.isDirectory()) {
          for (const f of fs.readdirSync(extraPath)) {
            if (fs.statSync(path.join(extraPath, f)).mtimeMs > wasmTime) return false;
          }
        } else if (stat.mtimeMs > wasmTime) {
          return false;
        }
      }
    }

    // Keep .cache in sync with valid outWasm
    if (!fs.existsSync(cacheWasm) || fs.statSync(cacheWasm).mtimeMs < wasmTime) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.copyFileSync(outWasm, cacheWasm);
    }
    return true;
  }

  if (isParserUpToDate()) {
    console.log(`[${langName}] WebAssembly parser is up to date, skipping GLR & asc build. (use --force to rebuild)`);
    if (!fs.existsSync(distBindingsJs) && fs.existsSync(bindingsJs)) {
      fs.mkdirSync(path.dirname(distBindingsJs), { recursive: true });
      fs.copyFileSync(bindingsJs, distBindingsJs);
      const bindingsDts = path.join(dir, "src-gen", "bindings.d.ts");
      const distBindingsDts = path.join(dir, "dist", "src-gen", "bindings.d.ts");
      if (fs.existsSync(bindingsDts)) fs.copyFileSync(bindingsDts, distBindingsDts);
    }
    return;
  }

  // Compile parser and WASM via tsx runner script
  const buildScriptPath = path.join(dir, "build-parser.ts");
  const buildScriptContent = `// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildParser } from "@modelscript/dsl";
import { ${languageExportName} } from "${languageModule}";

const __dirname = path.resolve("${dir.replace(/\\/g, "/")}");
const languagePath = path.join(__dirname, "src", "language.ts");
const result = buildParser(${languageExportName}, { sourcePath: languagePath });

// 1. Write AssemblyScript files to as-gen/ for asc
const asGenDir = path.join(__dirname, "as-gen");
fs.mkdirSync(asGenDir, { recursive: true });
for (const file of result.assemblyScriptFiles) {
  const filePath = path.join(asGenDir, file.filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, file.content);
}

// 2. Write TypeScript/JavaScript bindings to src-gen/ and dist/src-gen/
const srcGenDir = path.join(__dirname, "src-gen");
fs.mkdirSync(srcGenDir, { recursive: true });
fs.writeFileSync(path.join(srcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(srcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

const distSrcGenDir = path.join(__dirname, "dist", "src-gen");
fs.mkdirSync(distSrcGenDir, { recursive: true });
fs.writeFileSync(path.join(distSrcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(distSrcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

// 3. Compile parser.ts to WebAssembly with asc
const ascPath = path.resolve(__dirname, "../../node_modules/.bin/asc");
const parserTs = path.join(asGenDir, "parser.ts");
const outWasm = path.join(__dirname, "dist", "parser.wasm");

const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
execFileSync(
  ascBin,
  [
    ...ascPrefixArgs,
    parserTs,
    "-o",
    outWasm,
    "--exportRuntime",
    "--enable",
    "threads",
    "--enable",
    "simd",
    "--optimize",
    "--runtime",
    "stub",
    ${extraAscFlags.map((f) => JSON.stringify(f)).join(", ")}
  ],
  { stdio: "inherit" }
);
`;

  fs.writeFileSync(buildScriptPath, buildScriptContent);
  try {
    execFileSync("npx", ["tsx", buildScriptPath], { stdio: "inherit", cwd: dir });
    if (fs.existsSync(outWasm)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.copyFileSync(outWasm, cacheWasm);
    }
  } finally {
    if (fs.existsSync(buildScriptPath)) {
      fs.unlinkSync(buildScriptPath);
    }
  }
}

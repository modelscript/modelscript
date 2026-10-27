// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
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
  const bindingsDts = path.join(dir, "src-gen", "bindings.d.ts");
  const distBindingsJs = path.join(dir, "dist", "src-gen", "bindings.js");
  const distBindingsDts = path.join(dir, "dist", "src-gen", "bindings.d.ts");
  const languagePath = fs.existsSync(path.join(dir, "src", "language.ts"))
    ? path.join(dir, "src", "language.ts")
    : path.join(dir, "language.ts");
  const dslDistPath = path.resolve(dir, "../../packages/dsl/dist/index.js");
  const dslSrcTemplatesPath = path.resolve(dir, "../../packages/dsl/src/src-gen/runtime-templates.ts");
  const dslTemplatesPath = fs.existsSync(dslSrcTemplatesPath)
    ? dslSrcTemplatesPath
    : path.resolve(dir, "../../packages/dsl/dist/src-gen/runtime-templates.js");

  const cacheDir = path.join(dir, ".cache");
  const cacheWasm = path.join(cacheDir, "parser.wasm");
  const cacheHashFile = path.join(cacheDir, "parser.hash");
  const cacheBindingsJs = path.join(cacheDir, "bindings.js");
  const cacheBindingsDts = path.join(cacheDir, "bindings.d.ts");

  function getMaxMtime(targetPath) {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) return stat.mtimeMs;
    let maxMtime = stat.mtimeMs;
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      const childMtime = getMaxMtime(path.join(targetPath, entry.name));
      if (childMtime > maxMtime) maxMtime = childMtime;
    }
    return maxMtime;
  }

  function hashPathInto(hash, targetPath) {
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      hash.update(path.relative(dir, targetPath).replace(/\\/g, "/"));
      hash.update(fs.readFileSync(targetPath));
      return;
    }
    const entries = fs.readdirSync(targetPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      hashPathInto(hash, path.join(targetPath, entry.name));
    }
  }

  function computeInputHash() {
    const hash = crypto.createHash("sha256");
    hash.update(langName);
    hash.update(JSON.stringify(extraAscFlags));
    hashPathInto(hash, languagePath);
    hashPathInto(hash, dslDistPath);
    hashPathInto(hash, dslTemplatesPath);
    for (const extra of extraWatchFiles) {
      hashPathInto(hash, path.join(dir, extra));
    }
    return hash.digest("hex");
  }

  function syncBindingsToDist() {
    if (fs.existsSync(bindingsJs)) {
      fs.mkdirSync(path.dirname(distBindingsJs), { recursive: true });
      if (!fs.existsSync(distBindingsJs)) {
        fs.copyFileSync(bindingsJs, distBindingsJs);
      }
      if (fs.existsSync(bindingsDts) && !fs.existsSync(distBindingsDts)) {
        fs.copyFileSync(bindingsDts, distBindingsDts);
      }
    }
  }

  function persistCache(currentHash) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      if (fs.existsSync(outWasm)) {
        fs.copyFileSync(outWasm, cacheWasm);
      }
      if (fs.existsSync(bindingsJs)) {
        fs.copyFileSync(bindingsJs, cacheBindingsJs);
      }
      if (fs.existsSync(bindingsDts)) {
        fs.copyFileSync(bindingsDts, cacheBindingsDts);
      }
      fs.writeFileSync(cacheHashFile, currentHash, "utf-8");
    } catch {}
  }

  const currentHash = computeInputHash();

  function isParserUpToDate() {
    if (forceRebuild) return false;

    // 1. Content-hash check (survives mtime updates when @modelscript/dsl rebuilds or CI cache restores)
    if (fs.existsSync(cacheHashFile) && fs.existsSync(cacheWasm)) {
      const savedHash = fs.readFileSync(cacheHashFile, "utf-8").trim();
      const cacheStat = fs.statSync(cacheWasm);
      if (savedHash === currentHash && cacheStat.size > 0) {
        if (!fs.existsSync(outWasm) || fs.statSync(outWasm).size === 0) {
          fs.mkdirSync(path.dirname(outWasm), { recursive: true });
          fs.copyFileSync(cacheWasm, outWasm);
        }
        if (!fs.existsSync(bindingsJs) && fs.existsSync(cacheBindingsJs)) {
          fs.mkdirSync(path.dirname(bindingsJs), { recursive: true });
          fs.copyFileSync(cacheBindingsJs, bindingsJs);
        }
        if (!fs.existsSync(bindingsDts) && fs.existsSync(cacheBindingsDts)) {
          fs.mkdirSync(path.dirname(bindingsDts), { recursive: true });
          fs.copyFileSync(cacheBindingsDts, bindingsDts);
        }
        if (fs.existsSync(bindingsJs)) {
          syncBindingsToDist();
          return true;
        }
      }
    }

    const latestInputTime = Math.max(
      getMaxMtime(languagePath),
      getMaxMtime(dslDistPath),
      getMaxMtime(dslTemplatesPath),
      ...extraWatchFiles.map((extra) => getMaxMtime(path.join(dir, extra))),
    );

    // If outWasm is missing (e.g. wiped by Nx task runner), restore from .cache if valid
    if (!fs.existsSync(outWasm) && fs.existsSync(cacheWasm) && fs.existsSync(bindingsJs)) {
      const cacheStat = fs.statSync(cacheWasm);
      if (cacheStat.size > 0 && cacheStat.mtimeMs > latestInputTime) {
        fs.mkdirSync(path.dirname(outWasm), { recursive: true });
        fs.copyFileSync(cacheWasm, outWasm);
        persistCache(currentHash);
        return true;
      }
    }

    if (!fs.existsSync(outWasm) || !fs.existsSync(bindingsJs)) return false;
    const wasmStat = fs.statSync(outWasm);
    if (wasmStat.size === 0) return false;
    const wasmTime = wasmStat.mtimeMs;

    if (latestInputTime > wasmTime) return false;

    // Keep .cache and hash in sync with valid outWasm
    persistCache(currentHash);
    return true;
  }

  if (isParserUpToDate()) {
    console.log(`[${langName}] WebAssembly parser is up to date, skipping GLR & asc build. (use --force to rebuild)`);
    syncBindingsToDist();
    return;
  }

  // Compile parser and WASM via tsx runner script inside .cache/ so project root is not mutated
  fs.mkdirSync(cacheDir, { recursive: true });
  const langModule =
    languageModule ?? (fs.existsSync(path.join(dir, "src", "language.ts")) ? "./src/language.js" : "./language.js");
  let relLanguageModule = path.relative(cacheDir, path.resolve(dir, langModule)).replace(/\\/g, "/");
  if (!relLanguageModule.startsWith(".")) {
    relLanguageModule = "./" + relLanguageModule;
  }
  const buildScriptPath = path.join(cacheDir, "build-parser.ts");
  const buildScriptContent = `// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildParser } from "@modelscript/dsl";
import { ${languageExportName} } from "${relLanguageModule}";

const __dirname = ${JSON.stringify(path.resolve(dir))};
const languagePath = fs.existsSync(path.join(__dirname, "src", "language.ts"))
  ? path.join(__dirname, "src", "language.ts")
  : path.join(__dirname, "language.ts");
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
const parserTs = path.join(asGenDir, "parser.ts");
const outWasm = path.join(__dirname, "dist", "parser.wasm");
const isWin = process.platform === "win32";
const ascPath = path.resolve(__dirname, "../../node_modules/.bin", isWin ? "asc.cmd" : "asc");
const ascExec = fs.existsSync(ascPath) ? ascPath : (isWin ? "npx.cmd" : "npx");
const ascArgs = fs.existsSync(ascPath)
  ? [
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
    ]
  : [
      "asc",
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
    ];

execFileSync(ascExec, ascArgs, { stdio: "inherit", shell: isWin, cwd: __dirname });
`;

  fs.writeFileSync(buildScriptPath, buildScriptContent);
  const isWin = process.platform === "win32";
  const npxBin = isWin ? "npx.cmd" : "npx";
  try {
    execFileSync(npxBin, ["tsx", buildScriptPath], { stdio: "inherit", cwd: dir, shell: isWin });
    persistCache(currentHash);
  } finally {
    if (fs.existsSync(buildScriptPath)) {
      fs.unlinkSync(buildScriptPath);
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const isCI = process.env.CI === "true" || process.env.CI === "1" || process.env.GITHUB_ACTIONS === "true";
  const envOpt = (process.env.MS_WASM_OPT || "").trim().toLowerCase();

  /**
   * Resolve WebAssembly optimization profile:
   * - CI builds ALWAYS perform full optimization ("full": -O3s / wasm-opt -Os).
   * - Local builds default to "fast" (-O1, shrinkLevel 0) to avoid Binaryen's
   *   quadratic O3/shrink passes in single-threaded JS/WASM binaryen.js.
   * - Override locally via MS_WASM_OPT=0|none|1|fast|2|3|full or --dev / --release.
   * @returns {"none" | "fast" | "o2" | "full"}
   */
  function resolveOptProfile() {
    if (isCI) return "full";
    if (
      process.argv.includes("--release") ||
      envOpt === "full" ||
      envOpt === "3" ||
      envOpt === "s" ||
      process.env.NODE_ENV === "production"
    ) {
      return "full";
    }
    if (process.argv.includes("--dev") || envOpt === "0" || envOpt === "none") {
      return "none";
    }
    if (envOpt === "2" || envOpt === "o2") {
      return "o2";
    }
    return "fast";
  }

  const optProfile = resolveOptProfile();
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
    hash.update(`opt:${optProfile}`);
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
import { execFileSync, spawnSync } from "node:child_process";
import { buildParser } from "@modelscript/dsl";
import * as langModuleNamespace from "${relLanguageModule}";

const __dirname = ${JSON.stringify(path.resolve(dir))};
const languagePath = fs.existsSync(path.join(__dirname, "src", "language.ts"))
  ? path.join(__dirname, "src", "language.ts")
  : path.join(__dirname, "language.ts");
const langDef =
  (langModuleNamespace as Record<string, any>)[${JSON.stringify(languageExportName)}] ??
  (langModuleNamespace as Record<string, any>).default ??
  Object.values(langModuleNamespace).find((v: any) => v && typeof v === "object" && "rules" in v && "name" in v);
if (!langDef) {
  throw new Error("Could not find Language export '" + ${JSON.stringify(languageExportName)} + "' in " + languagePath);
}
const result = buildParser(langDef, { sourcePath: languagePath });

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

// 3. Compile parser.ts to WebAssembly with asc (+ native wasm-opt when available)
const parserTs = path.join(asGenDir, "parser.ts");
const outWasm = path.join(__dirname, "dist", "parser.wasm");
const isWin = process.platform === "win32";
const optProfile = ${JSON.stringify(optProfile)};
const ascPath = path.resolve(__dirname, "../../node_modules/.bin", isWin ? "asc.cmd" : "asc");
const ascExec = fs.existsSync(ascPath) ? ascPath : (isWin ? "npx.cmd" : "npx");
const baseAscArgs = fs.existsSync(ascPath)
  ? [
      parserTs,
      "-o",
      outWasm,
      "--exportRuntime",
      "--enable",
      "threads",
      "--enable",
      "simd",
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
      "--runtime",
      "stub",
      ${extraAscFlags.map((f) => JSON.stringify(f)).join(", ")}
    ];

function getAscOptFlags(profile: string): string[] {
  if (profile === "full") return ["--optimize"];
  if (profile === "o2") return ["--optimizeLevel", "2", "--shrinkLevel", "0"];
  if (profile === "fast") return ["--optimizeLevel", "1", "--shrinkLevel", "0"];
  return [];
}

function getWasmOptFlag(profile: string): string | null {
  if (profile === "full") return "-Os";
  if (profile === "o2") return "-O2";
  if (profile === "fast") return "-O1";
  return null;
}

function findNativeWasmOpt(): string | null {
  if (process.env.MS_WASM_OPT_DISABLE_NATIVE === "1") return null;
  if (process.env.MS_WASM_OPT_BIN) {
    const probe = spawnSync(process.env.MS_WASM_OPT_BIN, ["--version"], { stdio: "ignore", shell: isWin });
    return probe.status === 0 ? process.env.MS_WASM_OPT_BIN : null;
  }
  const pathEnv = process.env.PATH || "";
  const candidates = isWin ? ["wasm-opt.exe"] : ["wasm-opt"];
  for (const dirEntry of pathEnv.split(path.delimiter)) {
    if (!dirEntry || dirEntry.includes("node_modules")) continue;
    for (const name of candidates) {
      const fullPath = path.join(dirEntry, name);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const real = fs.realpathSync(fullPath);
        if (real.includes("node_modules")) continue;
        // Skip JS/shell wrapper scripts (shebang '#!'); only accept native binaries
        const fd = fs.openSync(real, "r");
        const header = Buffer.alloc(2);
        fs.readSync(fd, header, 0, 2, 0);
        fs.closeSync(fd);
        if (header[0] === 0x23 && header[1] === 0x21) continue;
        const probe = spawnSync(real, ["--version"], { stdio: "ignore" });
        if (probe.status === 0) return real;
      } catch {
        continue;
      }
    }
  }
  return null;
}

const nativeWasmOpt = optProfile !== "none" ? findNativeWasmOpt() : null;
const wasmOptFlag = getWasmOptFlag(optProfile);

if (nativeWasmOpt && wasmOptFlag) {
  console.log("[${langName}] Compiling Wasm with asc (unoptimized) + native wasm-opt " + wasmOptFlag + " (profile: " + optProfile + ")...");
  execFileSync(ascExec, baseAscArgs, { stdio: "inherit", shell: isWin, cwd: __dirname });
  const tmpOptWasm = outWasm + ".opt.tmp";
  try {
    execFileSync(nativeWasmOpt, ["--all-features", wasmOptFlag, "-o", tmpOptWasm, outWasm], {
      stdio: "inherit",
      shell: isWin,
      cwd: __dirname,
    });
    fs.renameSync(tmpOptWasm, outWasm);
  } catch (err) {
    if (fs.existsSync(tmpOptWasm)) fs.unlinkSync(tmpOptWasm);
    console.warn("[${langName}] Native wasm-opt failed; falling back to asc optimization:", err instanceof Error ? err.message : String(err));
    execFileSync(ascExec, [...baseAscArgs, ...getAscOptFlags(optProfile)], { stdio: "inherit", shell: isWin, cwd: __dirname });
  }
} else {
  const ascOptFlags = getAscOptFlags(optProfile);
  execFileSync(ascExec, [...baseAscArgs, ...ascOptFlags], { stdio: "inherit", shell: isWin, cwd: __dirname });
}
`;

  fs.writeFileSync(buildScriptPath, buildScriptContent);
  const isWin = process.platform === "win32";
  const npxBin = isWin ? "npx.cmd" : "npx";
  const nodeOpts = process.env.NODE_OPTIONS || "";
  const buildEnv = nodeOpts.includes("max-old-space-size")
    ? process.env
    : { ...process.env, NODE_OPTIONS: `${nodeOpts} --max-old-space-size=8192`.trim() };
  try {
    execFileSync(npxBin, ["tsx", buildScriptPath], { stdio: "inherit", cwd: dir, shell: isWin, env: buildEnv });
    persistCache(currentHash);
  } finally {
    if (fs.existsSync(buildScriptPath)) {
      fs.unlinkSync(buildScriptPath);
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const cwd = process.cwd();
  const langName = path.basename(cwd);
  const camelName = langName.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  runLanguageParserBuild({
    langName,
    dir: cwd,
    languageModule: "./src/language.js",
    languageExportName: `${camelName}Language`,
  });
}

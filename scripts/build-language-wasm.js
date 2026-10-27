// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} LanguageWasmBuildOptions
 * @property {string} langName - Language identifier (e.g. "gensys", "simpack")
 * @property {string} dir - Root directory of the language package
 * @property {string} entryFile - Relative path to AssemblyScript entry file (e.g. "assembly/contact.ts")
 * @property {string} outWasmFile - Relative path to output WASM file (e.g. "dist/contact.wasm")
 * @property {string} [binaryTsFile] - Optional relative path to embedded base64 TS file
 * @property {string} [base64ConstName] - Exported constant name for base64 payload
 * @property {string} [binaryGetterName] - Exported function name for Uint8Array binary getter
 * @property {string} [description] - Docstring description for the generated TS file
 */

/**
 * Executes content-hashed AssemblyScript kernel compilation with `.cache/` persistence
 * and idempotent TypeScript base64 wrapper generation.
 * @param {LanguageWasmBuildOptions} options
 */
export function runLanguageWasmBuild(options) {
  const {
    langName,
    dir,
    entryFile,
    outWasmFile,
    binaryTsFile,
    base64ConstName,
    binaryGetterName,
    description = `Pre-compiled WebAssembly binary payload for ${langName.toUpperCase()} Kernel.`,
  } = options;

  const forceRebuild = process.argv.includes("--force");
  const outWasmPath = path.join(dir, outWasmFile);
  const wasmBaseName = path.basename(outWasmFile, ".wasm");
  const cacheDir = path.join(dir, ".cache");
  const cacheWasmPath = path.join(cacheDir, `${wasmBaseName}.wasm`);
  const cacheHashPath = path.join(cacheDir, `${wasmBaseName}.hash`);
  const asconfigPath = path.join(dir, "asconfig.json");
  const assemblyDir = path.join(dir, "assembly");

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
    hash.update(entryFile);
    hash.update(outWasmFile);
    hashPathInto(hash, asconfigPath);
    hashPathInto(hash, assemblyDir);
    return hash.digest("hex");
  }

  function syncBinaryTs(wasmBuffer) {
    if (!binaryTsFile || !base64ConstName || !binaryGetterName) return;
    const binaryTsPath = path.join(dir, binaryTsFile);
    const base64 = wasmBuffer.toString("base64");
    const tsContent = `// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ${description}
 * Embedded as base64 for zero-I/O execution in browsers, Web Workers, and Node.js.
 */
export const ${base64ConstName} =
  "${base64}";

let cachedBytes: Uint8Array | null = null;

export function ${binaryGetterName}(): Uint8Array {
  if (!cachedBytes) {
    if (typeof Buffer !== "undefined") {
      cachedBytes = new Uint8Array(Buffer.from(${base64ConstName}, "base64"));
    } else {
      const binaryStr = atob(${base64ConstName});
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      cachedBytes = bytes;
    }
  }
  return cachedBytes;
}
`;
    fs.mkdirSync(path.dirname(binaryTsPath), { recursive: true });
    if (!fs.existsSync(binaryTsPath) || fs.readFileSync(binaryTsPath, "utf-8") !== tsContent) {
      fs.writeFileSync(binaryTsPath, tsContent, "utf-8");
    }
  }

  const currentHash = computeInputHash();

  if (!forceRebuild && fs.existsSync(cacheHashPath) && fs.existsSync(cacheWasmPath)) {
    const savedHash = fs.readFileSync(cacheHashPath, "utf-8").trim();
    const cacheStat = fs.statSync(cacheWasmPath);
    if (savedHash === currentHash && cacheStat.size > 0) {
      if (!fs.existsSync(outWasmPath) || fs.statSync(outWasmPath).size === 0) {
        fs.mkdirSync(path.dirname(outWasmPath), { recursive: true });
        fs.copyFileSync(cacheWasmPath, outWasmPath);
      }
      syncBinaryTs(fs.readFileSync(outWasmPath));
      console.log(`[${langName}] WebAssembly kernel (${outWasmFile}) is up to date, skipping asc build.`);
      return;
    }
  }

  console.log(`[${langName}] Compiling WebAssembly kernel (${entryFile}) with asc...`);
  fs.mkdirSync(path.dirname(outWasmPath), { recursive: true });
  const isWin = process.platform === "win32";
  const ascBin = path.resolve(dir, "../../node_modules/.bin", isWin ? "asc.cmd" : "asc");
  const cmd = fs.existsSync(ascBin) ? ascBin : isWin ? "npx.cmd" : "npx";
  const args = fs.existsSync(ascBin)
    ? [entryFile, "--config", "asconfig.json"]
    : ["asc", entryFile, "--config", "asconfig.json"];

  execFileSync(cmd, args, {
    cwd: dir,
    stdio: "inherit",
    shell: isWin,
  });

  if (!fs.existsSync(outWasmPath)) {
    throw new Error(`Expected WASM output file at ${outWasmPath}`);
  }

  const wasmBuffer = fs.readFileSync(outWasmPath);
  syncBinaryTs(wasmBuffer);

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(outWasmPath, cacheWasmPath);
    fs.writeFileSync(cacheHashPath, currentHash, "utf-8");
  } catch {}

  console.log(`[${langName}] Built ${outWasmFile} (${wasmBuffer.length} bytes WASM).`);
}

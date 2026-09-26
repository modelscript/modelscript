// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const forceRebuild = process.argv.includes("--force");
const releaseWasm = path.join(packageRoot, "build", "release.wasm");
const debugWasm = path.join(packageRoot, "build", "debug.wasm");
const asConfigPath = path.join(packageRoot, "asconfig.json");

function getLatestMtime(dirPath) {
  let latest = 0;
  if (!fs.existsSync(dirPath)) return latest;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const subLatest = getLatestMtime(fullPath);
      if (subLatest > latest) latest = subLatest;
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))) {
      const mtime = fs.statSync(fullPath).mtimeMs;
      if (mtime > latest) latest = mtime;
    }
  }
  return latest;
}

function isWasmUpToDate() {
  if (forceRebuild) return false;
  if (!fs.existsSync(releaseWasm) || !fs.existsSync(debugWasm)) return false;

  const releaseStat = fs.statSync(releaseWasm);
  const debugStat = fs.statSync(debugWasm);
  if (releaseStat.size === 0 || debugStat.size === 0) return false;

  const minWasmTime = Math.min(releaseStat.mtimeMs, debugStat.mtimeMs);

  if (fs.existsSync(asConfigPath) && fs.statSync(asConfigPath).mtimeMs > minWasmTime) {
    return false;
  }

  const assemblyTime = getLatestMtime(path.join(packageRoot, "assembly"));
  if (assemblyTime > minWasmTime) return false;

  const wasmSrcTime = getLatestMtime(path.join(packageRoot, "src", "wasm"));
  if (wasmSrcTime > minWasmTime) return false;

  return true;
}

async function runAscTarget(target) {
  const ascBin = path.resolve(packageRoot, "../../node_modules/.bin/asc");
  const bin = fs.existsSync(ascBin) ? ascBin : "npx";
  const args = fs.existsSync(ascBin)
    ? ["assembly/index.ts", "--target", target]
    : ["asc", "assembly/index.ts", "--target", target];

  return execFileAsync(bin, args, { cwd: packageRoot });
}

async function main() {
  if (isWasmUpToDate()) {
    console.log("[runtime] AssemblyScript WASM is up to date, skipping asc build. (use --force to rebuild)");
    return;
  }

  console.log("[runtime] Compiling AssemblyScript WASM targets (debug + release) in parallel...");
  const startTime = Date.now();
  fs.mkdirSync(path.join(packageRoot, "build"), { recursive: true });

  try {
    await Promise.all([runAscTarget("debug"), runAscTarget("release")]);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[runtime] AssemblyScript WASM build complete in ${duration}s`);
  } catch (err) {
    console.error("[runtime] AssemblyScript build failed:", err.stdout || err.message);
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}

main();

// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");
const BUILD_DIR = path.join(PKG_ROOT, "build");
const PREBUILD_DIR = path.join(PKG_ROOT, "prebuilds", `${process.platform}-${process.arch}`);

const args = process.argv.slice(2);
const skipCodegen = args.includes("--skip-codegen");
const enableDawn = args.includes("--dawn") || process.env["MS_ENABLE_DAWN"] === "1";
const enableCuda = args.includes("--cuda") || process.env["MS_ENABLE_CUDA"] === "1";
const enableHip = args.includes("--hip") || process.env["MS_ENABLE_HIP"] === "1";
const hpcNativeArch = args.includes("--hpc-native-arch") || process.env["MS_HPC_NATIVE_ARCH"] === "1";

function run(cmd, cmdArgs, cwd = PKG_ROOT) {
  console.log(`[native] $ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && cmd === "npx",
  });
}

if (!skipCodegen) {
  run("npx", ["tsx", path.join(REPO_ROOT, "scripts", "build", "wasm2c-codegen.ts")], REPO_ROOT);
}

const cmakeArgs = [
  "-S",
  PKG_ROOT,
  "-B",
  BUILD_DIR,
  "-DCMAKE_BUILD_TYPE=Release",
  `-DMS_ENABLE_DAWN=${enableDawn ? "ON" : "OFF"}`,
  `-DMS_ENABLE_CUDA=${enableCuda ? "ON" : "OFF"}`,
  `-DMS_ENABLE_HIP=${enableHip ? "ON" : "OFF"}`,
  `-DMS_HPC_NATIVE_ARCH=${hpcNativeArch ? "ON" : "OFF"}`,
];

if (process.env["DAWN_INCLUDE_DIR"]) {
  cmakeArgs.push(`-DDAWN_INCLUDE_DIR=${process.env["DAWN_INCLUDE_DIR"]}`);
}
if (process.env["DAWN_LIBRARY"]) {
  cmakeArgs.push(`-DDAWN_LIBRARY=${process.env["DAWN_LIBRARY"]}`);
}
if (process.env["NODE_INCLUDE_DIR"]) {
  cmakeArgs.push(`-DNODE_INCLUDE_DIR=${process.env["NODE_INCLUDE_DIR"]}`);
}
if (process.env["NODE_LIB_FILE"]) {
  cmakeArgs.push(`-DNODE_LIB_FILE=${process.env["NODE_LIB_FILE"]}`);
}

// Prefer Ninja if available on Unix
if (process.platform !== "win32") {
  try {
    execFileSync("which", ["ninja"], { stdio: "ignore" });
    cmakeArgs.push("-G", "Ninja");
  } catch {
    // Default generator (Unix Makefiles)
  }
}

run("cmake", cmakeArgs);
const jobs = Math.max(1, Math.min(os.cpus().length, 8));
run("cmake", ["--build", BUILD_DIR, "--config", "Release", "--parallel", String(jobs)]);

// Stage compiled .node addon into prebuilds/<platform>-<arch>/
fs.mkdirSync(PREBUILD_DIR, { recursive: true });
const nodeCandidates = [
  path.join(BUILD_DIR, "modelscript_native.node"),
  path.join(BUILD_DIR, "Release", "modelscript_native.node"),
];
for (const cand of nodeCandidates) {
  if (fs.existsSync(cand)) {
    const dest = path.join(PREBUILD_DIR, "modelscript_native.node");
    fs.copyFileSync(cand, dest);
    console.log(`[native] Staged N-API addon → ${path.relative(REPO_ROOT, dest)}`);
    break;
  }
}

const workerExe = process.platform === "win32" ? "msx-hpc-worker.exe" : "msx-hpc-worker";
const workerCandidates = [path.join(BUILD_DIR, workerExe), path.join(BUILD_DIR, "Release", workerExe)];
for (const cand of workerCandidates) {
  if (fs.existsSync(cand)) {
    const dest = path.join(PREBUILD_DIR, workerExe);
    fs.copyFileSync(cand, dest);
    console.log(`[native] Staged HPC worker → ${path.relative(REPO_ROOT, dest)}`);
    break;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Developer Preflight Doctor (`npm run doctor:dev`).
 *
 * Inspects local machine environment, required toolchains, memory headroom,
 * and data directories for all three development tracks:
 *   - Track A: Compiler, WASM GLR parsers, and Modelica solvers
 *   - Track B: Ansatz Web Platform, API server, and ActivityPub federation
 *   - Track C: Documentation portal & reference manual
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

function checkCommand(cmd: string, args = "--version"): { available: boolean; version?: string } {
  try {
    const out = execSync(`${cmd} ${args}`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    const firstLine = out.split("\n")[0] || out;
    return { available: true, version: firstLine };
  } catch {
    return { available: false };
  }
}

export function runDevDoctor(): boolean {
  console.log("\n========================================================");
  console.log("   ModelScript & Ansatz Developer Preflight Doctor");
  console.log("========================================================\n");

  let allRequiredPassed = true;

  // 1. Node.js runtime
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split(".")[0] || "0", 10);
  let expectedMajor = 24;
  try {
    const nvmrc = fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf-8").trim();
    const parsed = parseInt(nvmrc.replace(/^v/, ""), 10);
    if (!isNaN(parsed)) expectedMajor = parsed;
  } catch {}

  if (major >= expectedMajor) {
    console.log(`✓ Node.js: ${nodeVer} (meets required >= ${expectedMajor})`);
  } else {
    console.error(`✗ Node.js: ${nodeVer} (REQUIRED: Node.js >= ${expectedMajor}, check .nvmrc)`);
    allRequiredPassed = false;
  }

  // 2. Hardware / Resource allocation
  const cpus = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const freeMemGB = (os.freemem() / 1e9).toFixed(1);
  const totalMemGB = (os.totalmem() / 1e9).toFixed(1);
  console.log(`✓ Hardware: ${cpus} CPU cores, ${freeMemGB} GB free / ${totalMemGB} GB total RAM`);

  // 3. Track A: Compiler & WASM Toolchain
  console.log("\n--- Track A: Compiler & Formal Solvers ---");
  const asc = checkCommand("npx asc");
  if (asc.available) {
    console.log(`✓ AssemblyScript Compiler (asc): ready`);
  } else {
    console.warn(`! AssemblyScript Compiler: not found in path (run 'npm install')`);
  }

  const omc = checkCommand("omc");
  if (omc.available) {
    console.log(`✓ OpenModelica (omc): ${omc.version} (available for --update baselines)`);
  } else {
    console.log(`- OpenModelica (omc): not installed (optional: only required for --update --omc baselines)`);
  }

  const mslExtracted = path.join(REPO_ROOT, "data/libraries/Modelica/4.1.0/extracted/Modelica");
  if (fs.existsSync(mslExtracted)) {
    console.log(`✓ MSL 4.1.0 snapshot: extracted in data/libraries/Modelica/`);
  } else {
    console.log(
      `- MSL 4.1.0 snapshot: not extracted yet (run 'node scripts/download-msl.cjs --version=4.1.0 --extract')`,
    );
  }

  // 4. Track B: Ansatz Platform & Cloud
  console.log("\n--- Track B: Ansatz Platform (Web, API & Federation) ---");
  const dataDir = path.join(REPO_ROOT, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`✓ Created data/ directory for SQLite database`);
  } else {
    console.log(`✓ Local database directory data/ exists`);
  }

  const docker = checkCommand("docker");
  if (docker.available) {
    console.log(`✓ Docker: ${docker.version}`);
  } else {
    console.log(`- Docker: not installed (optional: only needed for container builds)`);
  }

  // 5. Track C: Documentation & Reference Manual
  console.log("\n--- Track C: Documentation & VitePress ---");
  const docsDir = path.join(REPO_ROOT, "apps/docs/docs");
  if (fs.existsSync(docsDir)) {
    console.log(`✓ VitePress documentation directory ready (apps/docs/docs)`);
  }

  console.log("\n--------------------------------------------------------");
  if (allRequiredPassed) {
    console.log("✓ Environment is healthy and ready for development!\n");
    console.log("Suggested quick starts:");
    console.log("  • Ansatz Web Platform:  npm run dev:ansatz");
    console.log("  • Compiler & WASM:      npm run dev:compiler");
    console.log("  • Documentation site:   npm run dev:docs");
    console.log("  • CLI interactive:      npm run dev:cli");
    console.log("  • Fast unit tests:      npm run test:fast\n");
    return true;
  } else {
    console.error("✗ Some required dependencies are missing or out of date.\n");
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const ok = runDevDoctor();
  process.exit(ok ? 0 : 1);
}

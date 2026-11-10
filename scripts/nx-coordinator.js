#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic Task Resource Coordinator for ModelScript Monorepo.
 *
 * Dynamically computes optimal Nx parallelism based on:
 *   - Available CPU cores (os.availableParallelism)
 *   - Live Available RAM (/proc/meminfo MemAvailable on Linux, os.freemem elsewhere)
 *   - Target-specific memory footprint (build, typecheck, lint)
 *   - Safety reserve for OS and running applications
 *
 * Prevents Linux Out-Of-Memory (OOM) crashes on constrained systems
 * while maximizing CPU throughput on multi-core workstations and CI runners.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const nxBin = fs.existsSync(path.resolve(repoRoot, "node_modules", "nx", "bin", "nx.js"))
  ? path.resolve(repoRoot, "node_modules", "nx", "bin", "nx.js")
  : path.resolve(repoRoot, "node_modules", "nx", "dist", "bin", "nx.js");

export function getAvailableMemory() {
  if (process.platform === "linux") {
    try {
      const data = fs.readFileSync("/proc/meminfo", "utf8");
      const match = data.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (match) {
        return parseInt(match[1], 10) * 1024;
      }
    } catch {}
  }
  return typeof os.freemem === "function" ? os.freemem() : 4e9;
}

export function computeOptimalParallelism(args = []) {
  // If user explicitly passed --parallel, respect it
  for (const arg of args) {
    if (arg.startsWith("--parallel=")) {
      const val = parseInt(arg.split("=")[1], 10);
      if (!isNaN(val) && val > 0) return { optimal: val, explicit: true };
    }
  }
  if (process.env.NX_PARALLEL) {
    const val = parseInt(process.env.NX_PARALLEL, 10);
    if (!isNaN(val) && val > 0) return { optimal: val, explicit: true };
  }

  const cpus = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus()?.length || 2;
  const availMem = getAvailableMemory();

  // Detect targets from args
  const argStr = args.join(" ");
  const hasLint = argStr.includes("lint");
  const hasBuild = argStr.includes("build");
  const hasTypecheck = argStr.includes("typecheck");

  // Typical memory footprint per worker:
  // - lint: ~400 MB (ESLint with TypeScript AST)
  // - build: ~300 MB (tsc)
  // - typecheck: ~250 MB (tsc --noEmit)
  let perWorkerBytes = 300 * 1024 * 1024;
  if (hasLint) {
    perWorkerBytes = Math.max(perWorkerBytes, 400 * 1024 * 1024);
  }
  if (hasTypecheck && !hasLint && !hasBuild) {
    perWorkerBytes = 250 * 1024 * 1024;
  }

  // Safety buffer: keep at least 20% of available memory (clamped between 1.5 GB and 3.0 GB)
  // free for the OS, desktop applications, and kernel buffers.
  const safetyReserve = Math.min(3e9, Math.max(1.5e9, availMem * 0.2));
  const effectiveMem = Math.max(0, availMem - safetyReserve);

  const memWorkers = Math.max(1, Math.floor(effectiveMem / perWorkerBytes));
  const optimal = Math.max(1, Math.min(cpus, memWorkers));

  return {
    cpus,
    availMemMB: Math.round(availMem / (1024 * 1024)),
    effectiveMemMB: Math.round(effectiveMem / (1024 * 1024)),
    perWorkerMB: Math.round(perWorkerBytes / (1024 * 1024)),
    optimal,
    explicit: false,
  };
}

export function runCoordinator() {
  const rawArgs = process.argv.slice(2);
  const alloc = computeOptimalParallelism(rawArgs);

  if (!alloc.explicit) {
    console.log(
      `[nx-coordinator] 🚀 Dynamic resource allocation: ${alloc.cpus} CPUs, ` +
        `${(alloc.availMemMB / 1024).toFixed(1)} GB available RAM -> ` +
        `running with --parallel=${alloc.optimal} (RAM budget: ~${alloc.optimal * alloc.perWorkerMB} MB)`,
    );
  }

  const filteredArgs = rawArgs.filter((a) => !a.startsWith("--parallel="));
  filteredArgs.push(`--parallel=${alloc.optimal}`);

  const isCI =
    Boolean(process.env.CI && process.env.CI !== "false") ||
    Boolean(process.env.CONTINUOUS_INTEGRATION) ||
    Boolean(process.env.GITHUB_ACTIONS) ||
    process.env.NX_TUI === "false" ||
    !process.stdout.isTTY;

  const env = { ...process.env };
  if (isCI) {
    env.NX_TUI = "false";
    if (!filteredArgs.some((a) => a.startsWith("--output-style") || a.startsWith("--outputStyle"))) {
      filteredArgs.push("--output-style=stream");
    }
  }

  const child = spawn(process.execPath, [nxBin, ...filteredArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  const onSignal = (sig) => {
    try {
      child.kill(sig);
    } catch {}
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCoordinator();
}

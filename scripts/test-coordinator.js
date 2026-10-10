#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic Test Resource Coordinator for ModelScript Monorepo.
 *
 * Dynamically computes the optimal two-tier parallelism:
 *   1. Task parallelism (P): How many package test targets Nx executes concurrently.
 *   2. Worker concurrency (W): How many test files each package executes concurrently via node:test.
 *
 * Constraints:
 *   - Total instantaneous workers (P * W) <= available CPU cores.
 *   - Total worker memory footprint <= (free memory - OS/system reserve).
 *   - Prevents memory thrashing / OOM on constrained machines and eliminates core underutilization on large machines.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const nxBin = path.resolve(repoRoot, "node_modules", "nx", "dist", "bin", "nx.js");

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

export function computeOptimalAllocation(options = {}) {
  const cpus =
    options.cpus ??
    (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus()?.length || 2);
  const freeMem = options.freeMem ?? getAvailableMemory();
  const totalMem = options.totalMem ?? (typeof os.totalmem === "function" ? os.totalmem() : 8e9);
  const targetCount = options.targetCount ?? null;

  // Typical memory footprint of a tsx + V8 + WASM test worker: ~750 MB working set.
  const workerMemBytes = options.workerMemBytes ?? 750 * 1024 * 1024;

  // Reserve RAM for OS, disk buffers, and the Nx coordinator (15% of free RAM, clamped [500MB, 2GB]).
  const reserveMem = Math.min(2e9, Math.max(500e6, freeMem * 0.15));
  const effectiveAvailMem = Math.max(0, freeMem - reserveMem);
  const memWorkers = Math.max(1, Math.floor(effectiveAvailMem / workerMemBytes));

  // Global worker ceiling that will not overcommit CPU or exhaust RAM
  const totalBudget = Math.max(1, Math.min(cpus, memWorkers));

  let tasks;
  let workers;

  if (options.userTasks && options.userWorkers) {
    tasks = options.userTasks;
    workers = options.userWorkers;
  } else if (options.userTasks) {
    tasks = options.userTasks;
    workers = Math.max(1, Math.floor(totalBudget / tasks));
  } else if (options.userWorkers) {
    workers = options.userWorkers;
    tasks = Math.max(1, Math.floor(totalBudget / workers));
  } else if (targetCount === 1) {
    // Single package targeted: give all concurrency to intra-task workers (capped at 12 to avoid fs contention)
    tasks = 1;
    workers = Math.min(totalBudget, 12);
  } else {
    // Multi-package run: balanced factorization
    // P = clamp(floor(sqrt(totalBudget)), 2, totalBudget)
    const idealTasks = Math.floor(Math.sqrt(totalBudget));
    const taskCeiling = targetCount ? Math.min(targetCount, totalBudget) : totalBudget;
    tasks = Math.max(1, Math.min(taskCeiling, Math.max(totalBudget >= 4 ? 2 : 1, idealTasks)));
    workers = Math.max(1, Math.floor(totalBudget / tasks));
  }

  return {
    cpus,
    freeMemMB: Math.round(freeMem / 1024 / 1024),
    totalMemMB: Math.round(totalMem / 1024 / 1024),
    totalBudget,
    tasks,
    workers,
    totalConcurrency: tasks * workers,
  };
}

export function runCoordinator(argv = process.argv.slice(2)) {
  let mode = "affected"; // "affected" or "run-many"
  let dryRun = false;
  let userTasks = null;
  let userWorkers = null;
  const passThroughArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "affected" || arg === "run-many") {
      mode = arg;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--parallel=")) {
      userTasks = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--parallel") {
      userTasks = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--test-concurrency=") || arg.startsWith("--concurrency=")) {
      userWorkers = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--concurrency" || arg === "--test-concurrency") {
      userWorkers = parseInt(argv[++i], 10);
    } else {
      passThroughArgs.push(arg);
    }
  }

  if (process.env.TEST_PARALLEL_TASKS) {
    userTasks = userTasks ?? parseInt(process.env.TEST_PARALLEL_TASKS, 10);
  }
  if (process.env.TEST_CONCURRENCY) {
    userWorkers = userWorkers ?? parseInt(process.env.TEST_CONCURRENCY, 10);
  }

  // Quick detection of target count if not explicitly provided
  let targetCount = null;
  try {
    const targetProjectsArg = passThroughArgs.find((a) => a.startsWith("--projects="));
    if (targetProjectsArg) {
      targetCount = targetProjectsArg.split("=")[1].split(",").filter(Boolean).length;
    } else {
      const showCmd = spawnSync(process.execPath, [nxBin, "show", "projects", `--${mode}`, "--with-target=test"], {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 4000,
      });
      if (showCmd.status === 0 && showCmd.stdout) {
        const count = showCmd.stdout.trim().split("\n").filter(Boolean).length;
        if (count > 0) targetCount = count;
      }
    }
  } catch {
    // If detection times out or errors, proceed with standard factorization
  }

  const alloc = computeOptimalAllocation({
    userTasks,
    userWorkers,
    targetCount,
  });

  const banner =
    `[test-coordinator] 🚀 Dynamic resource allocation: ` +
    `${alloc.cpus} CPUs, ${(alloc.freeMemMB / 1024).toFixed(1)} GB free RAM -> ` +
    `Budget: ${alloc.totalBudget} workers -> ` +
    `${alloc.tasks} parallel tasks × ${alloc.workers} workers/task ` +
    `(${alloc.totalConcurrency} total concurrent workers${targetCount ? `, ${targetCount} projects targeted` : ""})`;

  console.log(banner);

  if (dryRun) {
    console.log(JSON.stringify(alloc, null, 2));
    return;
  }

  // Set environment for child test-runner processes
  const env = {
    ...process.env,
    TEST_CONCURRENCY: String(alloc.workers),
    NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=2048",
  };

  const nxArgs = [mode, "--target=test", `--parallel=${alloc.tasks}`, ...passThroughArgs];

  const child = spawn(process.execPath, [nxBin, ...nxArgs], {
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

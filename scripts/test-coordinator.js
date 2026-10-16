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

function buildWorkspaceTestProjectMap() {
  const map = new Map();
  for (const group of ["packages", "languages", "apps"]) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgDir = path.join(groupDir, entry.name);
      const pkgJsonPath = path.join(pkgDir, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        if (pkg.name && pkg.scripts && pkg.scripts.test) {
          map.set(pkg.name, pkgDir);
        }
      } catch {}
    }
  }
  return map;
}

function countTestFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === ".cache") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countTestFiles(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.startsWith("test-"))) {
        count++;
      }
    }
  } catch {}
  return count;
}

export function partitionProjectsIntoShards(projects, totalShards, projectDirMap = buildWorkspaceTestProjectMap()) {
  const weighted = projects.map((name) => {
    const pkgDir = projectDirMap.get(name);
    let weight = 1;
    if (pkgDir) {
      const testsCount = countTestFiles(path.join(pkgDir, "tests")) + countTestFiles(path.join(pkgDir, "validation"));
      weight = Math.max(1, testsCount);
    }
    return { name, weight };
  });

  // Sort deterministically: largest test suites first, tie-break alphabetically
  weighted.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

  const shards = Array.from({ length: totalShards }, () => ({ weight: 0, projects: [] }));
  for (const item of weighted) {
    let bestIdx = 0;
    for (let i = 1; i < totalShards; i++) {
      if (
        shards[i].weight < shards[bestIdx].weight ||
        (shards[i].weight === shards[bestIdx].weight && shards[i].projects.length < shards[bestIdx].projects.length)
      ) {
        bestIdx = i;
      }
    }
    shards[bestIdx].projects.push(item.name);
    shards[bestIdx].weight += item.weight;
  }

  return shards;
}

export function runCoordinator(argv = process.argv.slice(2)) {
  let mode = "affected"; // "affected" or "run-many"
  let dryRun = false;
  let userTasks = null;
  let userWorkers = null;
  let shardSpec = null;
  const passThroughArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "affected" || arg === "run-many") {
      mode = arg;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--shard=")) {
      shardSpec = arg.split("=")[1];
    } else if (arg === "--shard" && argv[i + 1]) {
      shardSpec = argv[++i];
    } else if (arg.startsWith("--parallel=")) {
      const parsed = parseInt(arg.split("=")[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) userTasks = parsed;
    } else if (arg === "--parallel" && argv[i + 1]) {
      const parsed = parseInt(argv[++i], 10);
      if (Number.isFinite(parsed) && parsed > 0) userTasks = parsed;
    } else if (arg.startsWith("--test-concurrency=") || arg.startsWith("--concurrency=")) {
      const parsed = parseInt(arg.split("=")[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) userWorkers = parsed;
    } else if ((arg === "--concurrency" || arg === "--test-concurrency") && argv[i + 1]) {
      const parsed = parseInt(argv[++i], 10);
      if (Number.isFinite(parsed) && parsed > 0) userWorkers = parsed;
    } else {
      passThroughArgs.push(arg);
    }
  }

  if (process.env.TEST_PARALLEL_TASKS) {
    const parsed = parseInt(process.env.TEST_PARALLEL_TASKS, 10);
    if (Number.isFinite(parsed) && parsed > 0) userTasks = userTasks ?? parsed;
  }
  if (process.env.TEST_CONCURRENCY) {
    const parsed = parseInt(process.env.TEST_CONCURRENCY, 10);
    if (Number.isFinite(parsed) && parsed > 0) userWorkers = userWorkers ?? parsed;
  }

  // Parse --shard=K/N if provided
  let shardIndex = null;
  let totalShards = null;
  if (shardSpec) {
    const parts = shardSpec.split("/");
    const k = parseInt(parts[0], 10);
    const n = parseInt(parts[1], 10);
    if (Number.isFinite(k) && Number.isFinite(n) && k >= 1 && n >= 1 && k <= n) {
      shardIndex = k;
      totalShards = n;
    } else {
      console.error(`[test-coordinator] Invalid --shard specification: ${shardSpec} (expected K/N with 1 <= K <= N)`);
      process.exit(1);
    }
  }

  // Discover target projects
  const projectDirMap = buildWorkspaceTestProjectMap();
  let discoveredProjects = null;
  try {
    const targetProjectsArg = passThroughArgs.find((a) => a.startsWith("--projects=") || a.startsWith("-p="));
    if (targetProjectsArg) {
      discoveredProjects = targetProjectsArg.split("=")[1].split(",").filter(Boolean);
    } else {
      const showFilterArgs = passThroughArgs.filter(
        (a) => a.startsWith("--base=") || a.startsWith("--head=") || a.startsWith("--exclude="),
      );
      const showArgs = [
        nxBin,
        "show",
        "projects",
        ...(mode === "affected" ? ["--affected"] : []),
        "--with-target=test",
        ...showFilterArgs,
      ];
      const showCmd = spawnSync(process.execPath, showArgs, {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 30000,
      });
      if (showCmd.status === 0 && showCmd.stdout !== null) {
        discoveredProjects = showCmd.stdout
          .trim()
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (mode === "run-many") {
        discoveredProjects = Array.from(projectDirMap.keys());
      }
    }
  } catch {
    if (mode === "run-many") {
      discoveredProjects = Array.from(projectDirMap.keys());
    }
  }

  let effectivePassThroughArgs = [...passThroughArgs];
  let effectiveMode = mode;

  if (shardIndex !== null && totalShards !== null) {
    const candidateProjects = discoveredProjects ?? Array.from(projectDirMap.keys());
    const shards = partitionProjectsIntoShards(candidateProjects, totalShards, projectDirMap);
    const chosenShard = shards[shardIndex - 1] || { weight: 0, projects: [] };
    console.log(
      `[test-coordinator] 🧩 Shard ${shardIndex}/${totalShards}: assigned ${chosenShard.projects.length}/${candidateProjects.length} projects ` +
        `(~${chosenShard.weight} test files): ${chosenShard.projects.join(", ") || "(none)"}`,
    );
    if (chosenShard.projects.length === 0) {
      if (dryRun) {
        console.log(JSON.stringify({ shardIndex, totalShards, projects: [], weight: 0 }, null, 2));
      }
      return;
    }
    discoveredProjects = chosenShard.projects;
    effectiveMode = "run-many";
    effectivePassThroughArgs = passThroughArgs.filter(
      (a) =>
        !a.startsWith("--base=") && !a.startsWith("--head=") && !a.startsWith("--projects=") && !a.startsWith("-p="),
    );
    effectivePassThroughArgs.push(`--projects=${chosenShard.projects.join(",")}`);
  }

  const targetCount = discoveredProjects ? discoveredProjects.length : null;
  if (discoveredProjects && discoveredProjects.length === 0) {
    console.log("[test-coordinator] No target projects with 'test' found. Exiting cleanly.");
    return;
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
    console.log(JSON.stringify({ ...alloc, projects: discoveredProjects }, null, 2));
    return;
  }

  // Set environment for child test-runner processes
  const env = {
    ...process.env,
    NX_TUI: "false",
    TEST_CONCURRENCY: String(alloc.workers),
    SHARD_HANDLED_BY_COORDINATOR: "1",
    NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=2048",
  };

  if (!effectivePassThroughArgs.some((a) => a.startsWith("--output-style"))) {
    effectivePassThroughArgs.push("--output-style=stream");
  }

  const nxArgs = [effectiveMode, "--target=test", `--parallel=${alloc.tasks}`, ...effectivePassThroughArgs];

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

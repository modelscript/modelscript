// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { computeOptimalAllocation, partitionProjectsIntoShards } from "../scripts/test-coordinator.js";

// Test 1: Current machine (16 CPUs, 32GB RAM, 21GB free, 22 projects)
{
  const res = computeOptimalAllocation({
    cpus: 16,
    freeMem: 21 * 1024 * 1024 * 1024,
    totalMem: 32 * 1024 * 1024 * 1024,
    targetCount: 22,
  });
  assert.strictEqual(res.totalBudget, 16);
  assert.strictEqual(res.tasks, 4);
  assert.strictEqual(res.workers, 4);
  assert.strictEqual(res.totalConcurrency, 16);
}

// Test 2: Low memory machine (16 CPUs, but only 2GB free out of 8GB total)
{
  const res = computeOptimalAllocation({
    cpus: 16,
    freeMem: 2 * 1024 * 1024 * 1024,
    totalMem: 8 * 1024 * 1024 * 1024,
    targetCount: 10,
  });
  // Reserve: 2GB * 0.15 = 300MB -> clamped to 500MB
  // Avail: 2GB - 0.5GB = 1.5GB -> floor(1.5GB / 750MB) = 2 workers
  assert.strictEqual(res.totalBudget, 2);
  assert.strictEqual(res.tasks, 1);
  assert.strictEqual(res.workers, 2);
}

// Test 3: Moderate machine (8 CPUs, 16GB RAM, 10GB free, 15 projects)
{
  const res = computeOptimalAllocation({
    cpus: 8,
    freeMem: 10 * 1024 * 1024 * 1024,
    totalMem: 16 * 1024 * 1024 * 1024,
    targetCount: 15,
  });
  assert.strictEqual(res.totalBudget, 8);
  assert.strictEqual(res.tasks, 2);
  assert.strictEqual(res.workers, 4);
  assert.strictEqual(res.totalConcurrency, 8);
}

// Test 4: Laptop (4 CPUs, 8GB RAM, 4GB free, 8 projects)
{
  const res = computeOptimalAllocation({
    cpus: 4,
    freeMem: 4 * 1024 * 1024 * 1024,
    totalMem: 8 * 1024 * 1024 * 1024,
    targetCount: 8,
  });
  // Reserve: 4GB * 0.15 = 600MB
  // Avail: 4GB - 0.6GB = 3.4GB -> floor(3.4GB / 750MB) = 4 workers (capped at 4 CPUs)
  assert.strictEqual(res.totalBudget, 4);
  assert.strictEqual(res.tasks, 2);
  assert.strictEqual(res.workers, 2);
}

// Test 5: Single target on large machine (16 CPUs, 32GB RAM, targetCount: 1)
{
  const res = computeOptimalAllocation({
    cpus: 16,
    freeMem: 20 * 1024 * 1024 * 1024,
    totalMem: 32 * 1024 * 1024 * 1024,
    targetCount: 1,
  });
  assert.strictEqual(res.tasks, 1);
  assert.strictEqual(res.workers, 12);
}

// Test 6: Explicit user overrides
{
  const res = computeOptimalAllocation({
    cpus: 16,
    freeMem: 20 * 1024 * 1024 * 1024,
    totalMem: 32 * 1024 * 1024 * 1024,
    userTasks: 8,
    userWorkers: 2,
  });
  assert.strictEqual(res.tasks, 8);
  assert.strictEqual(res.workers, 2);
  assert.strictEqual(res.totalConcurrency, 16);
}

// Test 7: Time-balanced sharding
{
  const testDurations = {
    "@modelscript/runtime": 600,
    "@modelscript/api": 500,
    "@modelscript/dsl": 400,
    "@modelscript/simulate": 200,
    "@modelscript/lsp": 150,
    "@modelscript/cli": 150,
    "@modelscript/small1": 50,
    "@modelscript/small2": 50,
  };
  const projects = Object.keys(testDurations);
  const shards = partitionProjectsIntoShards(projects, 4, new Map(), testDurations);
  assert.strictEqual(shards.length, 4);

  // Shard weights should be reasonably balanced across the 4 shards
  const weights = shards.map((s) => s.weight);
  const maxWeight = Math.max(...weights);
  const minWeight = Math.min(...weights);
  assert.ok(maxWeight <= 600, `Max weight should be capped by runtime (600), got ${maxWeight}`);
  assert.ok(minWeight >= 400, `Min weight should be at least 400, got ${minWeight}`);

  // All projects must be assigned exactly once
  const assigned = shards.flatMap((s) => s.projects);
  assert.strictEqual(assigned.length, projects.length);
  assert.deepStrictEqual(new Set(assigned), new Set(projects));
}

console.log("All computeOptimalAllocation and partitionProjectsIntoShards unit tests passed!");

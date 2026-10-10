import assert from "node:assert";
import { computeOptimalAllocation } from "../scripts/test-coordinator.js";

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

console.log("All computeOptimalAllocation unit tests passed!");

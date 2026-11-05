// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JobQueue } from "../src/jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.resolve(__dirname, "fixtures/resilience-workers.cjs");

test("JobQueue Resilience & Fault-Tolerance", async (t) => {
  await t.test("terminates hung child process after hard timeout and drains remaining jobs", async () => {
    const queue = new JobQueue({ concurrency: 1, defaultTimeoutMs: 1200 });

    t.after(() => queue.clear());

    queue.enqueueProcess("hang-job-1", workerScript, { mode: "hang" }, { timeoutMs: 800 });
    queue.enqueueProcess("next-job-1", workerScript, { mode: "success" });

    // Wait until both jobs complete/fail
    let attempts = 0;
    while (attempts < 50) {
      const s1 = queue.getStatus("hang-job-1");
      const s2 = queue.getStatus("next-job-1");
      if ((s1?.status === "failed" || s1?.status === "completed") && s2?.status === "completed") {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s1 = queue.getStatus("hang-job-1");
    const s2 = queue.getStatus("next-job-1");

    assert.strictEqual(s1?.status, "failed", "Hung job must transition to failed");
    assert.ok(s1?.error?.includes("timed out"), `Error should indicate timeout: ${s1?.error}`);
    assert.strictEqual(s2?.status, "completed", "Subsequent queued job must complete successfully");
    assert.strictEqual(queue.activeCount, 0, "Active count must be safely reclaimed to 0");
    assert.strictEqual(queue.pendingCount, 0, "No jobs should remain pending");
  });

  await t.test("aborts stalled child process when inactivity watchdog fires", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    queue.enqueueProcess(
      "inactivity-job-1",
      workerScript,
      { mode: "stalled-inactivity" },
      { inactivityTimeoutMs: 800, timeoutMs: 5000 },
    );

    let attempts = 0;
    while (attempts < 40) {
      const s = queue.getStatus("inactivity-job-1");
      if (s?.status === "failed" || s?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s = queue.getStatus("inactivity-job-1");
    assert.strictEqual(s?.status, "failed", "Inactivity job must fail");
    assert.ok(s?.error?.includes("inactivity"), `Error should mention inactivity: ${s?.error}`);
    assert.strictEqual(queue.activeCount, 0, "Active count must be reclaimed to 0");
  });

  await t.test("recovers cleanly from worker crash (code 1) without stalling queue", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    queue.enqueueProcess("crash-job-1", workerScript, { mode: "crash" });
    queue.enqueueProcess("after-crash-job", workerScript, { mode: "success" });

    let attempts = 0;
    while (attempts < 40) {
      const s1 = queue.getStatus("crash-job-1");
      const s2 = queue.getStatus("after-crash-job");
      if (s1?.status === "failed" && s2?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s1 = queue.getStatus("crash-job-1");
    const s2 = queue.getStatus("after-crash-job");

    assert.strictEqual(s1?.status, "failed");
    assert.ok(s1?.error?.includes("Simulated worker crash"));
    assert.strictEqual(s2?.status, "completed");
    assert.strictEqual(queue.activeCount, 0);
  });

  await t.test("automatically retries in degraded mode upon OOM exit and succeeds", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    queue.enqueueProcess("oom-job-1", workerScript, { mode: "oom" }, { retryOnOom: true });

    let attempts = 0;
    while (attempts < 40) {
      const s = queue.getStatus("oom-job-1");
      if (s?.status === "completed" || s?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s = queue.getStatus("oom-job-1");
    assert.strictEqual(s?.status, "completed", `Job should complete after retry: ${s?.error}`);
    assert.strictEqual(s?.degraded, true, "Job info should reflect degraded mode");
    assert.strictEqual(s?.retried, true, "Job info should reflect retry");
    assert.strictEqual(queue.activeCount, 0);
  });

  await t.test("executes high-priority jobs ahead of low-priority queued jobs", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    const executionOrder: string[] = [];
    let resolveBlocker: () => void = () => {};
    const blockerPromise = new Promise<void>((r) => {
      resolveBlocker = r;
    });

    // Enqueue blocker to hold the 1 available slot
    queue.enqueue("blocker", async () => {
      await blockerPromise;
      executionOrder.push("blocker");
    });

    // Enqueue low priority job
    queue.enqueue(
      "low-priority-job",
      async () => {
        executionOrder.push("low");
      },
      { priority: "low" },
    );

    // Enqueue high priority job second
    queue.enqueue(
      "high-priority-job",
      async () => {
        executionOrder.push("high");
      },
      { priority: "high" },
    );

    // Release blocker
    resolveBlocker();

    let attempts = 0;
    while (attempts < 40) {
      if (executionOrder.length === 3) break;
      await new Promise((r) => setTimeout(r, 50));
      attempts++;
    }

    assert.deepStrictEqual(
      executionOrder,
      ["blocker", "high", "low"],
      "High priority job must run before low priority",
    );
    assert.strictEqual(queue.activeCount, 0);
  });

  await t.test("times out hung in-process job and drains queue", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    queue.enqueue(
      "inprocess-hang",
      () => new Promise<void>(() => {}), // Never resolves
      { timeoutMs: 400 },
    );
    queue.enqueue("inprocess-next", async () => {});

    let attempts = 0;
    while (attempts < 40) {
      const s1 = queue.getStatus("inprocess-hang");
      const s2 = queue.getStatus("inprocess-next");
      if (s1?.status === "failed" && s2?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s1 = queue.getStatus("inprocess-hang");
    const s2 = queue.getStatus("inprocess-next");

    assert.strictEqual(s1?.status, "failed");
    assert.ok(s1?.error?.includes("timed out"));
    assert.strictEqual(s2?.status, "completed");
    assert.strictEqual(queue.activeCount, 0);
  });

  await t.test("dynamically extends deadline when worker actively reports progress", async () => {
    const queue = new JobQueue({ concurrency: 1 });
    t.after(() => queue.clear());

    // Initial timeout is tight (800ms), but total duration is ~1000ms.
    // Without progress extension it would fail at 800ms.
    // With progress extension on each classesProcessed event, it should complete cleanly!
    queue.enqueueProcess(
      "progress-ext-job",
      workerScript,
      { mode: "slow-progress" },
      { timeoutMs: 800, maxTimeoutMs: 5000 },
    );

    let attempts = 0;
    while (attempts < 40) {
      const s = queue.getStatus("progress-ext-job");
      if (s?.status === "completed" || s?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    const s = queue.getStatus("progress-ext-job");
    assert.strictEqual(s?.status, "completed", `Job should complete with progress extension: ${s?.error}`);
    assert.strictEqual(s?.classesProcessed, 40);
    assert.strictEqual(queue.activeCount, 0);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SandboxedRolloutExecutor, SandboxTrapError } from "../src/ml/sandbox-rollout-guard.js";

describe("SandboxedRolloutExecutor — Fuel/Memory-Capped RLVR Rollout Guard", () => {
  it("executes well-behaved rollouts and reports exact fuel, peak memory, and audit telemetry", async () => {
    let now = 1_000;
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 500,
      defaultMemoryLimitBytes: 16 * 1024,
      defaultTimeoutMs: 1_000,
      clock: () => now,
    });

    const report = await executor.execute(
      {
        tenantId: "tenant-alpha",
        rolloutId: "rlvr-001",
        inputPayload: "model ThermalRC Real T; equation der(T) = -T; end ThermalRC;",
      },
      (ctx) => {
        ctx.allocateBytes(2048, "dae-arena");
        let sum = 0;
        ctx.runBoundedLoop(
          10,
          5,
          (i) => {
            sum += i;
          },
          "blt-pass",
        );
        ctx.releaseBytes(1024, "scratch-buffer");
        now += 12;
        return { reward: 1.0, sum, snapshot: ctx.getSnapshot() };
      },
    );

    assert.equal(report.ok, true);
    assert.equal(report.status, "ok");
    assert.equal(report.tenantId, "tenant-alpha");
    assert.equal(report.rolloutId, "rlvr-001");
    assert.equal(report.fuelUsed, 50);
    assert.equal(report.fuelBudget, 500);
    assert.equal(report.fuelExhausted, false);
    assert.equal(report.memoryExceeded, false);
    assert.equal(report.timedOut, false);
    assert.equal(report.circuitOpen, false);
    assert.equal(report.circuitState, "closed");
    assert.equal(report.elapsedMs, 12);
    assert.ok(report.peakMemoryBytes > 2048);
    assert.equal(report.value?.sum, 45);
    assert.ok(report.auditLog.length >= 3);
  });

  it("deterministically traps when instruction fuel budget is exhausted", async () => {
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 100,
      defaultMemoryLimitBytes: 1024 * 1024,
      defaultTimeoutMs: 2_000,
    });

    const report = await executor.execute({ tenantId: "tenant-fuel", rolloutId: "rlvr-infinite-loop" }, (ctx) => {
      ctx.runBoundedLoop(1000, 10, () => {
        // Pathological symbolic expansion loop
      });
      return "unreachable";
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "fuel-exhausted");
    assert.equal(report.fuelExhausted, true);
    assert.equal(report.memoryExceeded, false);
    assert.equal(report.timedOut, false);
    assert.equal(report.fuelUsed, 110);
    assert.equal(report.fuelBudget, 100);
    assert.match(report.error ?? "", /fuel budget/i);
  });

  it("deterministically traps when runtime allocations or input payloads exceed memory ceiling", async () => {
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 10_000,
      defaultMemoryLimitBytes: 4096,
      maxInputBytes: 2048,
      defaultTimeoutMs: 2_000,
    });

    // 1. Runtime allocation bomb
    const allocReport = await executor.execute({ tenantId: "tenant-mem", rolloutId: "mem-bomb-1" }, (ctx) => {
      ctx.allocateBytes(2048, "tensor-a");
      ctx.allocateBytes(3072, "tensor-b");
      return "unreachable";
    });

    assert.equal(allocReport.ok, false);
    assert.equal(allocReport.status, "memory-exceeded");
    assert.equal(allocReport.memoryExceeded, true);
    assert.equal(allocReport.fuelExhausted, false);
    assert.equal(allocReport.peakMemoryBytes, 5120);
    assert.equal(allocReport.memoryLimitBytes, 4096);

    // 2. Oversized pre-flight input payload rejection (task never even runs)
    let taskInvoked = false;
    const payloadReport = await executor.execute(
      {
        tenantId: "tenant-mem",
        rolloutId: "mem-bomb-2",
        inputPayload: "x".repeat(3000),
      },
      () => {
        taskInvoked = true;
        return "unreachable";
      },
    );

    assert.equal(taskInvoked, false);
    assert.equal(payloadReport.ok, false);
    assert.equal(payloadReport.status, "memory-exceeded");
    assert.equal(payloadReport.memoryExceeded, true);
    assert.equal(payloadReport.peakMemoryBytes, 3000);
  });

  it("enforces async wall-clock timeout and triggers AbortSignal", async () => {
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 10_000,
      defaultMemoryLimitBytes: 1024 * 1024,
      defaultTimeoutMs: 40,
    });

    let signalAborted = false;
    const report = await executor.execute({ tenantId: "tenant-slow", rolloutId: "slow-sim" }, async (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        signalAborted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return "too-late";
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "timed-out");
    assert.equal(report.timedOut, true);
    assert.equal(report.fuelExhausted, false);
    assert.equal(report.memoryExceeded, false);
    assert.equal(signalAborted, true);
  });

  it("enforces cooperative deadline check via injectable clock", async () => {
    let now = 5_000;
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 10_000,
      defaultTimeoutMs: 100,
      clock: () => now,
    });

    const report = await executor.execute({ tenantId: "tenant-clock" }, (ctx) => {
      ctx.consumeFuel(10);
      now += 150;
      ctx.checkDeadline("solver-step");
      return "unreachable";
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "timed-out");
    assert.equal(report.timedOut, true);
    assert.equal(report.elapsedMs, 150);
  });

  it("trips per-tenant anti-DoS circuit breaker without affecting healthy tenants and recovers via half-open probe", async () => {
    let now = 10_000;
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 50,
      defaultMemoryLimitBytes: 1024 * 1024,
      defaultTimeoutMs: 1_000,
      circuitBreaker: {
        failureThreshold: 2,
        cooldownMs: 5_000,
        slidingWindowMs: 20_000,
        halfOpenSuccessThreshold: 1,
      },
      clock: () => now,
    });

    // Trigger 2 fuel-exhaustion failures on abusive tenant -> circuit opens
    const f1 = await executor.execute({ tenantId: "abusive-tenant" }, (ctx) => {
      ctx.consumeFuel(100);
    });
    assert.equal(f1.status, "fuel-exhausted");
    assert.equal(f1.circuitOpen, false);
    assert.equal(f1.circuitState, "closed");

    now += 100;
    const f2 = await executor.execute({ tenantId: "abusive-tenant" }, (ctx) => {
      ctx.consumeFuel(100);
    });
    assert.equal(f2.status, "fuel-exhausted");
    assert.equal(f2.circuitOpen, true);
    assert.equal(f2.circuitState, "open");

    // Subsequent call during cooldown is immediately rejected without executing task
    now += 1_000;
    let abusiveRan = false;
    const rejected = await executor.execute({ tenantId: "abusive-tenant" }, () => {
      abusiveRan = true;
      return "should-not-run";
    });
    assert.equal(abusiveRan, false);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, "circuit-open");
    assert.equal(rejected.circuitOpen, true);
    assert.equal(rejected.circuitState, "open");
    assert.equal(rejected.retryAfterMs, 4_000);

    // Healthy tenant remains completely unaffected
    const healthy = await executor.execute({ tenantId: "healthy-tenant" }, (ctx) => {
      ctx.consumeFuel(10);
      return 42;
    });
    assert.equal(healthy.ok, true);
    assert.equal(healthy.value, 42);
    assert.equal(healthy.circuitOpen, false);

    // Advance past cooldown -> half-open probe fails -> re-opens circuit
    now += 4_500;
    assert.equal(executor.getTenantCircuitState("abusive-tenant").state, "half-open");
    const failedProbe = await executor.execute({ tenantId: "abusive-tenant" }, (ctx) => {
      ctx.consumeFuel(999);
    });
    assert.equal(failedProbe.circuitOpen, true);
    assert.equal(failedProbe.circuitState, "open");

    // Advance past second cooldown -> half-open probe succeeds -> circuit closes!
    now += 5_100;
    const goodProbe = await executor.execute({ tenantId: "abusive-tenant" }, (ctx) => {
      ctx.consumeFuel(10);
      return "recovered";
    });
    assert.equal(goodProbe.ok, true);
    assert.equal(goodProbe.value, "recovered");
    assert.equal(goodProbe.circuitOpen, false);
    assert.equal(goodProbe.circuitState, "closed");

    const metrics = executor.getMetrics();
    assert.equal(metrics.totalCircuitRejected, 1);
    assert.equal(metrics.totalFuelExhausted, 3);
    assert.equal(metrics.totalSucceeded, 2);
    assert.equal(metrics.activeTenants, 2);
    assert.equal(metrics.openCircuits, 0);
  });

  it("clamps untrusted per-request resource overrides to executor ceilings and isolates batch rollouts", async () => {
    const executor = new SandboxedRolloutExecutor({
      defaultFuelBudget: 100,
      defaultMemoryLimitBytes: 2048,
      defaultTimeoutMs: 500,
    });

    const reports = await executor.executeBatch([
      {
        request: {
          tenantId: "t-clamp",
          fuelBudget: 999_999,
          memoryLimitBytes: 999_999_999,
          timeoutMs: 999_999,
        },
        task: (ctx) => {
          assert.equal(ctx.fuelBudget, 100);
          assert.equal(ctx.memoryLimitBytes, 2048);
          assert.equal(ctx.timeoutMs, 500);
          ctx.consumeFuel(120);
        },
      },
      {
        request: { tenantId: "t-ok" },
        task: (ctx) => {
          ctx.consumeFuel(20);
          return "ok";
        },
      },
    ]);

    assert.equal(reports.length, 2);
    assert.equal(reports[0]!.status, "fuel-exhausted");
    assert.equal(reports[1]!.ok, true);
    assert.equal(reports[1]!.value, "ok");

    // Verify SandboxTrapError instance shape
    const trap = new SandboxTrapError("fuel-exhausted", "out of fuel", { fuelUsed: 101 });
    assert.equal(trap.kind, "fuel-exhausted");
    assert.equal(trap.name, "SandboxTrapError");
  });
});

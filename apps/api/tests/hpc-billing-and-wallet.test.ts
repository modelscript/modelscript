// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { checkComputeQuota } from "../src/services/hpc/quota-guard.js";

test("User Credit Wallet, Quotas & Billing Ledger", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpc-billing-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  // Cleanup tmpDir on exit
  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  let testUserId = 0;
  let testJobId = 0;

  await t.test("createUser provisions wallet with 100.0 free credits and logs ledger transaction", () => {
    const user = db.createUser("engineer_hpc", "engineer@hpc.test", "hashed_pwd", "HPC Engineer");
    assert.ok(user.id > 0);
    testUserId = user.id;

    // Check balance
    const balance = db.getUserBalance(user.id);
    assert.strictEqual(balance, 100.0, "New user must start with 100.0 credit balance");

    // Check transaction history
    const txs = db.getUserTransactions(user.id);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0]!.type, "initial_grant");
    assert.strictEqual(txs[0]!.amount, 100.0);
    assert.strictEqual(txs[0]!.balance_after, 100.0);
    assert.ok(txs[0]!.description.includes("Welcome bonus"));
  });

  await t.test("deductUserCredits atomically reduces balance and writes immutable ledger entry", () => {
    testJobId = db.createJob("CAE Su2 Airfoil Simulation", "RUNNING", "ADHOC", "ide", null, {}, testUserId);

    const result = db.deductUserCredits(testUserId, 15.5, testJobId, "CAE SU2 Airfoil Execution", {
      profile: "high-memory",
      cpuSeconds: 120,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.newBalance, 84.5);

    const currentBalance = db.getUserBalance(testUserId);
    assert.strictEqual(currentBalance, 84.5);

    const history = db.getUserTransactions(testUserId);
    assert.strictEqual(history.length, 2);
    const latestTx = history[0]!;
    assert.strictEqual(latestTx.user_id, testUserId);
    assert.strictEqual(latestTx.job_id, testJobId);
    assert.strictEqual(latestTx.amount, -15.5);
    assert.strictEqual(latestTx.balance_after, 84.5);
    assert.strictEqual(latestTx.type, "job_charge");
  });

  await t.test("grantUserCredits adds funds and logs topup transaction", () => {
    const newBalance = db.grantUserCredits(testUserId, 50.0, "top_up", "Manual Credit Top-Up via Sandbox Card", {
      paymentId: "pi_test_123",
    });

    assert.strictEqual(newBalance, 134.5);

    const currentBalance = db.getUserBalance(testUserId);
    assert.strictEqual(currentBalance, 134.5);

    const history = db.getUserTransactions(testUserId);
    assert.strictEqual(history.length, 3);
    const latestTx = history[0]!;
    assert.strictEqual(latestTx.amount, 50.0);
    assert.strictEqual(latestTx.balance_after, 134.5);
    assert.strictEqual(latestTx.type, "top_up");
  });

  await t.test("getUserBillingSummary calculates aggregate usage and profiles accurately", () => {
    // Update accounting details on the job
    db.updateJobAccounting(testJobId, {
      computeProfile: "high-memory",
      cpuSeconds: 3600,
      peakMemoryMb: 32768,
      gpuSeconds: 0,
      costCredits: 15.5,
    });
    db.updateJobStatus(testJobId, "SUCCESS");

    const summary = db.getUserBillingSummary(testUserId);
    assert.strictEqual(summary.userId, testUserId);
    assert.strictEqual(summary.creditBalance, 134.5);
    assert.strictEqual(summary.totalSpent, 15.5);
    assert.strictEqual(summary.totalJobs, 1);
    assert.strictEqual(summary.totalCpuSeconds, 3600);
    assert.strictEqual(summary.totalGpuSeconds, 0);
    assert.strictEqual(summary.recentTransactions.length, 3);
    assert.ok(summary.profileUsage["high-memory"]);
    assert.strictEqual(summary.profileUsage["high-memory"]!.jobsCount, 1);
    assert.strictEqual(summary.profileUsage["high-memory"]!.costCredits, 15.5);
  });

  await t.test("checkComputeQuota validates balance against profile pre-flight threshold", () => {
    // User with 134.5 credits passes for all profiles
    const quotaStd = checkComputeQuota(testUserId, "standard", db);
    assert.strictEqual(quotaStd.allowed, true);

    const quotaGpu = checkComputeQuota(testUserId, "gpu-a100", db);
    assert.strictEqual(quotaGpu.allowed, true);

    // Create an uncredited user with 0.01 credits
    const poorUser = db.createUser("broke_dev", "broke@test.com", "hashed", "Broke Dev");
    db.deductUserCredits(poorUser.id, 99.98, null, "Depletion");
    const poorBalance = db.getUserBalance(poorUser.id);
    assert.ok(poorBalance < 0.05);

    // Standard profile requires 0.05 credits (3 minutes)
    const rejectStd = checkComputeQuota(poorUser.id, "standard", db);
    assert.strictEqual(rejectStd.allowed, false);
    assert.ok(rejectStd.reason?.includes("Insufficient compute credits"));
    assert.strictEqual(rejectStd.profileId, "standard");
  });

  // REST API Route Verification
  await t.test("GET /api/v1/billing/wallet returns current user wallet statistics", async () => {
    const res = await request(app).get("/api/v1/billing/wallet").expect(200);

    assert.ok(typeof res.body.creditBalance === "number");
    assert.ok(typeof res.body.totalSpent === "number");
    assert.ok(typeof res.body.totalJobs === "number");
    assert.ok(typeof res.body.totalCpuSeconds === "number");
    assert.ok(typeof res.body.totalGpuSeconds === "number");
  });

  await t.test("GET /api/v1/billing/transactions returns paginated ledger entries", async () => {
    const res = await request(app).get("/api/v1/billing/transactions?limit=10").expect(200);

    assert.ok(Array.isArray(res.body.transactions));
    assert.ok(res.body.transactions.length >= 1);
    assert.ok(typeof res.body.count === "number");
    assert.strictEqual(res.body.limit, 10);
    assert.strictEqual(res.body.offset, 0);
  });

  await t.test("GET /api/v1/billing/usage returns comprehensive billing summary", async () => {
    const res = await request(app).get("/api/v1/billing/usage").expect(200);

    assert.strictEqual(res.body.userId, testUserId);
    assert.ok(typeof res.body.creditBalance === "number");
    assert.ok(Array.isArray(res.body.recentTransactions));
    assert.ok(res.body.profileUsage);
  });

  await t.test("POST /api/v1/billing/topup validates and reloads credits", async () => {
    // Rejects invalid amounts
    await request(app).post("/api/v1/billing/topup").send({ amount: 0 }).expect(400);

    await request(app).post("/api/v1/billing/topup").send({ amount: -50 }).expect(400);

    // Accepts valid topup
    const res = await request(app).post("/api/v1/billing/topup").send({ amount: 200 }).expect(200);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.amountAdded, 200);
    assert.ok(res.body.newBalance >= 200);
  });
});

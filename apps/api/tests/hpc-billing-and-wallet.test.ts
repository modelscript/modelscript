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
import { defaultPaymentGuard } from "../src/services/billing/payment-guard.js";
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

  await t.test("POST /api/v1/billing/topup enforces anti-carding minimum threshold and lockout", async () => {
    // Rejects micro-charges below 10 credits (carding test attack)
    const cardingRes = await request(app).post("/api/v1/billing/topup").send({ amount: 5 }).expect(400);
    assert.ok(cardingRes.body.error.includes("Minimum top-up threshold"));

    // Rejects excessive single charges (> 10,000 credits)
    const whaleRes = await request(app).post("/api/v1/billing/topup").send({ amount: 25000 }).expect(400);
    assert.ok(whaleRes.body.error.includes("Maximum single top-up"));

    // Simulate 3 payment failures
    for (let i = 0; i < 3; i++) {
      const failRes = await request(app)
        .post("/api/v1/billing/topup")
        .set("x-forwarded-for", "198.51.100.99")
        .send({ amount: 50, simulatePaymentFailure: true })
        .expect(402);
      assert.strictEqual(failRes.body.failedAttempts, i + 1);
    }

    // 4th attempt from the same locked identity should be rejected with 429
    const lockedRes = await request(app)
      .post("/api/v1/billing/topup")
      .set("x-forwarded-for", "198.51.100.99")
      .send({ amount: 50 })
      .expect(429);
    assert.ok(lockedRes.body.error.includes("temporarily locked"));

    // Reset lockouts for subsequent tests
    defaultPaymentGuard.clear(`user:${testUserId}`);
    defaultPaymentGuard.clear("ip:198.51.100.99");
  });

  await t.test("POST /api/v1/billing/payment-intent enforces 3D Secure 2 and Radar risk score ceilings", async () => {
    // Rejects amounts below anti-carding threshold
    await request(app).post("/api/v1/billing/payment-intent").send({ amount: 5 }).expect(400);

    // Standard valid intent with mandatory 3DS
    const intentRes = await request(app)
      .post("/api/v1/billing/payment-intent")
      .set("x-forwarded-for", "203.0.113.1")
      .send({
        amount: 50,
        customerCountry: "US",
        cardCountry: "US",
      })
      .expect(201);

    assert.strictEqual(intentRes.body.success, true);
    assert.strictEqual(intentRes.body.requires3DS, true);
    assert.strictEqual(intentRes.body.amountCents, 5000); // 50 credits = 5000 cents
    assert.ok(intentRes.body.clientSecret.startsWith("pi_"));

    // Geo-mismatch triggers heightened 3DS challenge and risk scoring
    const geoMismatchRes = await request(app)
      .post("/api/v1/billing/payment-intent")
      .set("x-forwarded-for", "203.0.113.2")
      .send({
        amount: 100,
        customerCountry: "US",
        cardCountry: "FR",
      })
      .expect(201);
    assert.strictEqual(geoMismatchRes.body.requires3DS, true);
    assert.ok(geoMismatchRes.body.riskScore >= 40);

    // High Radar fraud score (> 75) is blocked with 403
    const fraudRes = await request(app)
      .post("/api/v1/billing/payment-intent")
      .set("x-forwarded-for", "203.0.113.3")
      .send({
        amount: 100,
        simulateRadarScore: 88,
      })
      .expect(403);
    assert.ok(fraudRes.body.error.includes("Payment blocked by Stripe Radar: High fraud risk detected"));
  });

  await t.test("POST /api/v1/billing/webhook handles dispute chargeback and settlement events", async () => {
    // 1. Chargeback event: quarantine account and zero-out balance
    const disputeRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_dispute_123",
        type: "charge.dispute.created",
        data: {
          object: {
            id: "dp_test_456",
            metadata: { userId: String(testUserId) },
            reason: "fraudulent",
          },
        },
      })
      .expect(200);

    assert.strictEqual(disputeRes.body.received, true);
    assert.strictEqual(disputeRes.body.action, "account_frozen_dispute");
    assert.strictEqual(disputeRes.body.userId, testUserId);

    // Verify DB state for the frozen user
    const frozenBalance = db.getUserBalance(testUserId);
    assert.strictEqual(frozenBalance, 0.0);

    const userRecord = db.getUserById(testUserId);
    assert.strictEqual(userRecord.status, "suspended_dispute");

    const historyAfterDispute = db.getUserTransactions(testUserId);
    const disputeTx = historyAfterDispute[0]!;
    assert.strictEqual(disputeTx.type, "dispute_freeze");
    assert.strictEqual(disputeTx.balance_after, 0.0);

    // 2. Successful Payment Intent event: grant credits
    const paymentSucceededRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_pi_succeeded_789",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_stripe_succeeded_999",
            amount: 5000, // 50.0 credits
            metadata: { userId: String(testUserId) },
          },
        },
      })
      .expect(200);

    assert.strictEqual(paymentSucceededRes.body.received, true);
    assert.strictEqual(paymentSucceededRes.body.action, "credits_granted");

    const restoredBalance = db.getUserBalance(testUserId);
    assert.strictEqual(restoredBalance, 50.0);

    const latestTx = db.getUserTransactions(testUserId)[0]!;
    assert.strictEqual(latestTx.type, "top_up");
    assert.strictEqual(latestTx.amount, 50.0);
    assert.strictEqual(latestTx.balance_after, 50.0);
  });

  await t.test("Credit Escrow System: hold, settlement with refund, overage, and cancellation release", () => {
    const escrowUser = db.createUser("escrow_engineer", "escrow@test.com", "pwd", "Escrow Engineer");
    assert.strictEqual(db.getUserBalance(escrowUser.id), 100.0);

    // 1. Place a hold of 20 credits for Job A
    const jobA = db.createJob("Escrow Test Job A", "RUNNING", "ADHOC", "ide", null, {}, escrowUser.id);
    const holdA = db.holdUserCredits(escrowUser.id, 20.0, jobA, "Escrow Hold Job A", { test: true });
    assert.strictEqual(holdA.success, true);
    assert.strictEqual(holdA.heldAmount, 20.0);
    assert.strictEqual(holdA.newBalance, 80.0);
    assert.strictEqual(db.getUserBalance(escrowUser.id), 80.0);

    const txHoldA = db.getUserTransactions(escrowUser.id)[0]!;
    assert.strictEqual(txHoldA.type, "escrow_hold");
    assert.strictEqual(txHoldA.amount, -20.0);
    assert.strictEqual(txHoldA.balance_after, 80.0);

    // 2. Reject hold if user does not have sufficient balance
    const rejectHold = db.holdUserCredits(escrowUser.id, 999.0, jobA, "Greedy Hold");
    assert.strictEqual(rejectHold.success, false);
    assert.ok(rejectHold.reason?.includes("Insufficient balance"));
    assert.strictEqual(db.getUserBalance(escrowUser.id), 80.0);

    // 3. Settle Job A with actual cost = 12.5 (refund 7.5 back to wallet)
    const settleA = db.settleUserEscrow(escrowUser.id, jobA, 12.5, "Job A Final Settlement");
    assert.strictEqual(settleA.success, true);
    assert.strictEqual(settleA.settledAmount, 12.5);
    assert.strictEqual(settleA.refundedAmount, 7.5);
    assert.strictEqual(settleA.newBalance, 87.5);
    assert.strictEqual(db.getUserBalance(escrowUser.id), 87.5);

    const txSettleA = db.getUserTransactions(escrowUser.id)[0]!;
    assert.strictEqual(txSettleA.type, "escrow_refund");
    assert.strictEqual(txSettleA.amount, 7.5);
    assert.strictEqual(txSettleA.balance_after, 87.5);

    // 4. Place a hold of 10 credits for Job B, then settle with OVERAGE (actual = 14.0 -> extra charge 4.0)
    const jobB = db.createJob("Escrow Test Job B", "RUNNING", "ADHOC", "ide", null, {}, escrowUser.id);
    db.holdUserCredits(escrowUser.id, 10.0, jobB, "Escrow Hold Job B");
    assert.strictEqual(db.getUserBalance(escrowUser.id), 77.5);

    const settleB = db.settleUserEscrow(escrowUser.id, jobB, 14.0, "Job B Overage Settlement");
    assert.strictEqual(settleB.success, true);
    assert.strictEqual(settleB.settledAmount, 14.0);
    assert.strictEqual(settleB.refundedAmount, 0);
    assert.strictEqual(settleB.newBalance, 73.5);
    assert.strictEqual(db.getUserBalance(escrowUser.id), 73.5);

    const txSettleB = db.getUserTransactions(escrowUser.id)[0]!;
    assert.strictEqual(txSettleB.type, "escrow_overage");
    assert.strictEqual(txSettleB.amount, -4.0);
    assert.strictEqual(txSettleB.balance_after, 73.5);

    // 5. Place a hold of 30 credits for Job C, then CANCEL/RELEASE (100% refund of 30.0)
    const jobC = db.createJob("Escrow Test Job C", "RUNNING", "ADHOC", "ide", null, {}, escrowUser.id);
    db.holdUserCredits(escrowUser.id, 30.0, jobC, "Escrow Hold Job C");
    assert.strictEqual(db.getUserBalance(escrowUser.id), 43.5);

    const releaseC = db.releaseUserEscrow(escrowUser.id, jobC, "User cancelled execution");
    assert.strictEqual(releaseC.success, true);
    assert.strictEqual(releaseC.refundedAmount, 30.0);
    assert.strictEqual(releaseC.newBalance, 73.5);
    assert.strictEqual(db.getUserBalance(escrowUser.id), 73.5);

    const txReleaseC = db.getUserTransactions(escrowUser.id)[0]!;
    assert.strictEqual(txReleaseC.type, "escrow_release");
    assert.strictEqual(txReleaseC.amount, 30.0);
    assert.strictEqual(txReleaseC.balance_after, 73.5);
  });
});

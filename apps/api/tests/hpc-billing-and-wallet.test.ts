// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
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

  await t.test("Organization Credit Escrow System: hold, settlement with refund, overage, and release", () => {
    const org = db.createOrganization({ name: "Escrow Org", slug: "escrow-org", createdBy: testUserId });
    db.grantOrgCredits(org.id, 200.0, testUserId, "Seed Org Balance");
    assert.strictEqual(db.getOrgBalance(org.id), 200.0);

    // 1. Hold 50 credits for Org Job 1
    const job1 = db.createJob("Org Escrow Job 1", "RUNNING", "ADHOC", "ide", null, {}, testUserId);
    const hold1 = db.holdOrgCredits(org.id, 50.0, testUserId, job1, "Org Escrow Hold Job 1");
    assert.strictEqual(hold1.success, true);
    assert.strictEqual(hold1.heldAmount, 50.0);
    assert.strictEqual(hold1.newBalance, 150.0);
    assert.strictEqual(db.getOrgBalance(org.id), 150.0);

    // 2. Settle Job 1 with partial usage (actual 20.0 -> refund 30.0)
    const settle1 = db.settleOrgEscrow(org.id, job1, 20.0, testUserId, "Org Job 1 Settlement");
    assert.strictEqual(settle1.success, true);
    assert.strictEqual(settle1.settledAmount, 20.0);
    assert.strictEqual(settle1.refundedAmount, 30.0);
    assert.strictEqual(settle1.newBalance, 180.0);
    assert.strictEqual(db.getOrgBalance(org.id), 180.0);

    // 3. Hold 30 credits for Org Job 2, settle with overage (actual 45.0 -> extra charge 15.0)
    const job2 = db.createJob("Org Escrow Job 2", "RUNNING", "ADHOC", "ide", null, {}, testUserId);
    db.holdOrgCredits(org.id, 30.0, testUserId, job2, "Org Escrow Hold Job 2");
    assert.strictEqual(db.getOrgBalance(org.id), 150.0);

    const settle2 = db.settleOrgEscrow(org.id, job2, 45.0, testUserId, "Org Job 2 Overage");
    assert.strictEqual(settle2.success, true);
    assert.strictEqual(settle2.settledAmount, 45.0);
    assert.strictEqual(settle2.refundedAmount, 0);
    assert.strictEqual(settle2.newBalance, 135.0);
    assert.strictEqual(db.getOrgBalance(org.id), 135.0);

    // 4. Hold 25 credits for Org Job 3, cancel and release (refund 25.0)
    const job3 = db.createJob("Org Escrow Job 3", "RUNNING", "ADHOC", "ide", null, {}, testUserId);
    db.holdOrgCredits(org.id, 25.0, testUserId, job3, "Org Escrow Hold Job 3");
    assert.strictEqual(db.getOrgBalance(org.id), 110.0);

    const release3 = db.releaseOrgEscrow(org.id, job3, "Simulation aborted");
    assert.strictEqual(release3.success, true);
    assert.strictEqual(release3.refundedAmount, 25.0);
    assert.strictEqual(release3.newBalance, 135.0);
    assert.strictEqual(db.getOrgBalance(org.id), 135.0);
  });

  await t.test("Account freeze on dispute cancels active user jobs", () => {
    const disputeUser = db.createUser("dispute_target", "dispute@example.com", "Password123!");
    const pendingJob = db.createJob("Active Job 1", "PENDING", "ADHOC", "ide", null, {}, disputeUser.id);
    const runningJob = db.createJob("Active Job 2", "RUNNING", "ADHOC", "ide", null, {}, disputeUser.id);

    db.freezeUserForDispute(disputeUser.id, "Stripe Chargeback Dispute");

    const job1 = db.getJob(pendingJob);
    const job2 = db.getJob(runningJob);
    assert.strictEqual(job1?.status, "CANCELLED", "Pending job should be cancelled on account freeze");
    assert.strictEqual(job2?.status, "CANCELLED", "Running job should be cancelled on account freeze");
  });

  await t.test("Atomic settleStripeCreditGrant deduplicates duplicate eventId and duplicate paymentIntentId", () => {
    const stripeUser = db.createUser("stripe_dedup_user", "stripe_dedup@test.com", "pwd", "Stripe Dedup User");
    assert.strictEqual(db.getUserBalance(stripeUser.id), 100.0);

    // 1. Initial grant settles cleanly
    const first = db.billing.settleStripeCreditGrant({
      eventId: "evt_atomic_001",
      paymentIntentId: "pi_atomic_001",
      userId: stripeUser.id,
      amount: 45.25,
      description: "Stripe Credit Purchase",
      metadata: { source: "webhook" },
    });
    assert.strictEqual(first.settled, true);
    assert.strictEqual(first.duplicate, false);
    assert.strictEqual(first.newBalance, 145.25);
    assert.strictEqual(db.getUserBalance(stripeUser.id), 145.25);

    const txCountAfterFirst = db.getUserTransactionCount(stripeUser.id);

    // 2. Duplicate eventId (even with a different paymentIntentId) must NOT double-grant
    const dupEvent = db.billing.settleStripeCreditGrant({
      eventId: "evt_atomic_001",
      paymentIntentId: "pi_atomic_different",
      userId: stripeUser.id,
      amount: 45.25,
      description: "Duplicate eventId replay",
    });
    assert.strictEqual(dupEvent.settled, false);
    assert.strictEqual(dupEvent.duplicate, true);
    assert.strictEqual(db.getUserBalance(stripeUser.id), 145.25);
    assert.strictEqual(db.getUserTransactionCount(stripeUser.id), txCountAfterFirst);

    // 3. Duplicate paymentIntentId (even with a new eventId) must NOT double-grant
    const dupPi = db.billing.settleStripeCreditGrant({
      eventId: "evt_atomic_002",
      paymentIntentId: "pi_atomic_001",
      userId: stripeUser.id,
      amount: 45.25,
      description: "Duplicate paymentIntentId replay",
    });
    assert.strictEqual(dupPi.settled, false);
    assert.strictEqual(dupPi.duplicate, true);
    assert.strictEqual(db.getUserBalance(stripeUser.id), 145.25);
    assert.strictEqual(db.getUserTransactionCount(stripeUser.id), txCountAfterFirst);
  });

  await t.test("Org escrow isolation and shutdown recovery refunds org holds to org wallet only", () => {
    const isoUser = db.createUser("iso_user", "iso@test.com", "pwd", "Isolation User");
    const orgA = db.createOrganization({ name: "Isolation Org A", slug: "iso-org-a", createdBy: isoUser.id });
    const orgB = db.createOrganization({ name: "Isolation Org B", slug: "iso-org-b", createdBy: isoUser.id });
    db.grantOrgCredits(orgA.id, 200.0, isoUser.id, "Seed Org A");
    db.grantOrgCredits(orgB.id, 200.0, isoUser.id, "Seed Org B");

    // 1. User personal hold on jobPersonal must NOT be hijacked by orgA's releaseOrgEscrow or settleOrgEscrow
    const jobPersonal = db.createJob("Personal Held Job", "RUNNING", "ADHOC", "ide", null, {}, isoUser.id);
    const personalHold = db.holdUserCredits(isoUser.id, 25.0, jobPersonal, "Personal Hold");
    assert.strictEqual(personalHold.success, true);
    assert.strictEqual(db.getUserBalance(isoUser.id), 75.0);

    const orgReleaseAttempt = db.releaseOrgEscrow(orgA.id, jobPersonal, "Attempt cross-scope release");
    assert.strictEqual(orgReleaseAttempt.refundedAmount, 0);
    assert.strictEqual(db.getOrgBalance(orgA.id), 200.0);

    const personalHoldRowAfterRelease = db.db
      .prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`)
      .get(personalHold.holdId) as { status: string };
    assert.strictEqual(personalHoldRowAfterRelease.status, "held", "Personal hold must remain held after org release");

    const orgSettleAttempt = db.settleOrgEscrow(orgA.id, jobPersonal, 10.0, isoUser.id, "Attempt cross-scope settle");
    assert.strictEqual(orgSettleAttempt.refundedAmount, 0);
    // Org A has no hold on jobPersonal so settleOrgEscrow charges Org A directly without touching personal hold
    assert.strictEqual(db.getOrgBalance(orgA.id), 190.0);
    const personalHoldRowAfterSettle = db.db
      .prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`)
      .get(personalHold.holdId) as { status: string };
    assert.strictEqual(personalHoldRowAfterSettle.status, "held", "Personal hold must remain held after org settle");

    // 2. Org A hold on jobOrgA must NOT be hijacked by Org B's releaseOrgEscrow or settleOrgEscrow
    const jobOrgA = db.createJob("Org A Held Job", "RUNNING", "ADHOC", "ide", null, {}, isoUser.id);
    const orgAHold = db.holdOrgCredits(orgA.id, 40.0, isoUser.id, jobOrgA, "Org A Hold");
    assert.strictEqual(orgAHold.success, true);
    assert.strictEqual(db.getOrgBalance(orgA.id), 150.0);

    const orgBRelease = db.releaseOrgEscrow(orgB.id, jobOrgA, "Org B cross-org release attempt");
    assert.strictEqual(orgBRelease.refundedAmount, 0);
    assert.strictEqual(db.getOrgBalance(orgB.id), 200.0);

    const orgBSettle = db.settleOrgEscrow(orgB.id, jobOrgA, 5.0, isoUser.id, "Org B cross-org settle attempt");
    assert.strictEqual(orgBSettle.refundedAmount, 0);
    assert.strictEqual(db.getOrgBalance(orgB.id), 195.0);

    const orgAHoldRow = db.db.prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`).get(orgAHold.holdId) as {
      status: string;
    };
    assert.strictEqual(
      orgAHoldRow.status,
      "held",
      "Org A hold must remain held when Org B settles/releases same jobId",
    );

    // 3. releaseAllHeldEscrowsOnShutdown refunds orgA's 40.0 to orgA (NOT isoUser) and personal 25.0 to isoUser
    const releasedCount = db.releaseAllHeldEscrowsOnShutdown();
    assert.ok(releasedCount >= 2, "Expected both personal and org holds to be released on shutdown");
    assert.strictEqual(
      db.getOrgBalance(orgA.id),
      190.0,
      "Org A hold (40.0) must be refunded to organizations.credit_balance",
    );
    assert.strictEqual(
      db.getUserBalance(isoUser.id),
      100.0,
      "Personal user wallet must only receive its own 25.0 hold refund, NOT org hold",
    );

    const orgAHoldAfterShutdown = db.db
      .prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`)
      .get(orgAHold.holdId) as { status: string };
    const personalHoldAfterShutdown = db.db
      .prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`)
      .get(personalHold.holdId) as { status: string };
    assert.strictEqual(orgAHoldAfterShutdown.status, "released");
    assert.strictEqual(personalHoldAfterShutdown.status, "released");
  });

  await t.test(
    "Precision & reconciliation: sub-cent deduction rejected and clamped overage logs write-off matching ledger sum",
    () => {
      const reconUser = db.createUser("recon_user", "recon@test.com", "pwd", "Reconciliation User");
      assert.strictEqual(db.getUserBalance(reconUser.id), 100.0);
      const txCountBefore = db.getUserTransactionCount(reconUser.id);

      // 1. Sub-cent deduction (0.004 rounds to 0 cents) must be rejected instead of silently succeeding with 0
      const subCentRes = db.deductUserCredits(reconUser.id, 0.004, null, "Sub-cent charge");
      assert.strictEqual(subCentRes.success, false, "deductUserCredits(userId, 0.004) must be rejected");
      assert.strictEqual(db.getUserBalance(reconUser.id), 100.0);
      assert.strictEqual(db.getUserTransactionCount(reconUser.id), txCountBefore);

      // 2. Escrow overage that would push balance below 0 clamps to 0.0 and records a bad_debt_writeoff
      const overageJob = db.createJob("Overage Clamp Job", "RUNNING", "ADHOC", "ide", null, {}, reconUser.id);
      const hold = db.holdUserCredits(reconUser.id, 95.0, overageJob, "Large Escrow Hold");
      assert.strictEqual(hold.success, true);
      assert.strictEqual(db.getUserBalance(reconUser.id), 5.0);

      // Actual cost = 120.0 -> overage = 25.0 -> 5.0 - 25.0 = -20.0 -> clamped to 0.0 with +20.0 bad_debt_writeoff
      const settle = db.settleUserEscrow(reconUser.id, overageJob, 120.0, "Overage Clamp Settlement");
      assert.strictEqual(settle.success, true);
      assert.strictEqual(settle.newBalance, 0.0);
      assert.strictEqual(db.getUserBalance(reconUser.id), 0.0);

      const ledger = db.getUserTransactions(reconUser.id, 100, 0);
      const writeoffTx = ledger.find((tx) => tx.type === "bad_debt_writeoff");
      assert.ok(writeoffTx, "Expected explicit bad_debt_writeoff ledger entry on balance clamp");
      assert.strictEqual(writeoffTx.amount, 20.0);
      assert.strictEqual(writeoffTx.balance_after, 0.0);

      const ledgerSumCents = ledger.reduce((acc, tx) => acc + Math.round(tx.amount * 100), 0);
      assert.strictEqual(
        ledgerSumCents / 100,
        db.getUserBalance(reconUser.id),
        "Sum of all user ledger entries must reconcile exactly with credit_balance",
      );
    },
  );

  await t.test(
    "Transactional freezeUserForDispute zeros balance, cancels active escrows & jobs, and logs dispute transaction",
    () => {
      const targetUser = db.createUser("freeze_atomic_user", "freeze_atomic@test.com", "pwd", "Freeze Atomic");
      const activeJob = db.createJob("Disputed Running Job", "RUNNING", "ADHOC", "ide", null, {}, targetUser.id);
      const hold = db.holdUserCredits(targetUser.id, 30.0, activeJob, "Active Escrow Before Dispute");
      assert.strictEqual(hold.success, true);
      assert.strictEqual(db.getUserBalance(targetUser.id), 70.0);

      const freezeResult = db.freezeUserForDispute(targetUser.id, "Fraudulent chargeback");
      assert.strictEqual(freezeResult.success, true);
      assert.strictEqual(freezeResult.previousBalance, 70.0);

      // Balance zeroed & account status quarantined
      assert.strictEqual(db.getUserBalance(targetUser.id), 0.0);
      const userRow = db.getUserById(targetUser.id);
      assert.strictEqual(userRow.status, "suspended_dispute");

      // Active personal escrow hold frozen/cancelled
      const holdRow = db.db.prepare(`SELECT status FROM credit_escrow_holds WHERE id = ?`).get(hold.holdId) as {
        status: string;
      };
      assert.strictEqual(holdRow.status, "frozen_dispute");

      // Active job cancelled
      assert.strictEqual(db.getJob(activeJob)?.status, "CANCELLED");

      // Dispute transaction logged
      const latestTx = db.getUserTransactions(targetUser.id)[0]!;
      assert.strictEqual(latestTx.type, "dispute_freeze");
      assert.strictEqual(latestTx.amount, -70.0);
      assert.strictEqual(latestTx.balance_after, 0.0);
    },
  );

  await t.test(
    "Webhook security: enforces HMAC signature, handles multi-byte UTF-8 safely, rejects expired timestamps, and credits amount_subtotal",
    async () => {
      const webhookUser = db.createUser("webhook_sec_user", "webhook_sec@test.com", "pwd", "Webhook Sec");
      assert.strictEqual(db.getUserBalance(webhookUser.id), 100.0);

      const webhookSecret = "whsec_test_wave2a_secret_key";
      const prevSecret = process.env["STRIPE_WEBHOOK_SECRET"];
      process.env["STRIPE_WEBHOOK_SECRET"] = webhookSecret;

      const signPayload = (ts: number, rawBody: string) => {
        const mac = crypto.createHmac("sha256", webhookSecret).update(`${ts}.${rawBody}`).digest("hex");
        return `t=${ts},v1=${mac}`;
      };

      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const checkoutEvent = {
          id: "evt_checkout_sec_001",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_sec_001",
              payment_intent: "pi_checkout_sec_001",
              payment_status: "paid",
              currency: "usd",
              amount_subtotal: 4000, // 40.00 credits (pre-tax)
              amount_total: 4800, // includes $8.00 tax — must NOT be credited
              metadata: { userId: String(webhookUser.id) },
            },
          },
        };
        const rawPayload = JSON.stringify(checkoutEvent);

        // 1. Invalid HMAC signature -> 400
        const invalidSigRes = await request(app)
          .post("/api/v1/billing/webhook")
          .set("Content-Type", "application/json")
          .set("stripe-signature", `t=${nowSec},v1=${"a".repeat(64)}`)
          .send(rawPayload)
          .expect(400);
        assert.ok(invalidSigRes.body.error.includes("Invalid Stripe webhook signature"));

        // 2. Multi-byte UTF-8 signature (64 characters, 128 bytes) -> 400 (NOT 500 RangeError)
        const multiByteSig = "é".repeat(64);
        assert.strictEqual(multiByteSig.length, 64);
        assert.ok(Buffer.byteLength(multiByteSig, "utf8") > 64);
        const utf8Res = await request(app)
          .post("/api/v1/billing/webhook")
          .set("Content-Type", "application/json")
          .set("stripe-signature", `t=${nowSec},v1=${multiByteSig}`)
          .send(rawPayload)
          .expect(400);
        assert.ok(utf8Res.body.error.includes("Invalid Stripe webhook signature"));

        // 3. Expired timestamp (> 300s old) with valid HMAC -> 400
        const expiredTs = nowSec - 600;
        const expiredRes = await request(app)
          .post("/api/v1/billing/webhook")
          .set("Content-Type", "application/json")
          .set("stripe-signature", signPayload(expiredTs, rawPayload))
          .send(rawPayload)
          .expect(400);
        assert.ok(expiredRes.body.error.includes("5-minute replay window"));

        // 4. Valid HMAC signature -> 200 and credits exactly amount_subtotal (40.0, not 48.0)
        const validSig = signPayload(nowSec, rawPayload);
        const okRes = await request(app)
          .post("/api/v1/billing/webhook")
          .set("Content-Type", "application/json")
          .set("stripe-signature", validSig)
          .send(rawPayload)
          .expect(200);
        assert.strictEqual(okRes.body.received, true);
        assert.strictEqual(okRes.body.action, "credits_granted");
        assert.strictEqual(db.getUserBalance(webhookUser.id), 140.0);

        // 5. Replay of the exact same signed webhook -> deduplicated, no double-grant
        const replayRes = await request(app)
          .post("/api/v1/billing/webhook")
          .set("Content-Type", "application/json")
          .set("stripe-signature", validSig)
          .send(rawPayload)
          .expect(200);
        assert.strictEqual(replayRes.body.received, true);
        assert.strictEqual(replayRes.body.action, "duplicate_event_ignored");
        assert.strictEqual(db.getUserBalance(webhookUser.id), 140.0);
      } finally {
        if (prevSecret === undefined) {
          delete process.env["STRIPE_WEBHOOK_SECRET"];
        } else {
          process.env["STRIPE_WEBHOOK_SECRET"] = prevSecret;
        }
      }
    },
  );

  await t.test(
    "Production sandbox top-up block: POST /api/v1/billing/topup without paymentIntentId returns 403",
    async () => {
      const prodUser = db.createUser("prod_topup_user", "prod_topup@test.com", "pwd", "Prod Topup User");
      const token = jwt.sign(
        { id: prodUser.id, username: prodUser.username, email: prodUser.email, tokenVersion: 1 },
        JWT_SECRET,
        { algorithm: "HS256" },
      );

      // Provision an ephemeral signed enterprise license so NODE_ENV=production passes the EE slurm_hpc gate
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
      const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      const nowSec = Math.floor(Date.now() / 1000);
      const licClaims = {
        v: 1,
        jti: `lic_test_${crypto.randomBytes(6).toString("hex")}`,
        sub: "prod-test-org",
        org: "Prod Test Org",
        tier: "cloud-enterprise",
        seats: 10,
        features: ["slurm_hpc"],
        iat: nowSec,
        exp: nowSec + 3600,
      };
      const payloadB64 = Buffer.from(JSON.stringify(licClaims), "utf-8").toString("base64url");
      const sigB64 = crypto.sign(null, Buffer.from(payloadB64, "utf-8"), privPem).toString("base64url");
      const licenseToken = `msx_lic_${payloadB64}.${sigB64}`;

      const prevNodeEnv = process.env["NODE_ENV"];
      const prevAllowSandbox = process.env["ALLOW_SANDBOX_TOPUP"];
      const prevLicKey = process.env["MSX_LICENSE_KEY"];
      const prevLicPubKey = process.env["MSX_LICENSE_PUBLIC_KEY"];
      const prevBillingFlag = process.env["FEATURE_FLAG_BILLING_STRIPE_LIVE"];
      process.env["NODE_ENV"] = "production";
      process.env["MSX_LICENSE_KEY"] = licenseToken;
      process.env["MSX_LICENSE_PUBLIC_KEY"] = pubPem;
      process.env["FEATURE_FLAG_BILLING_STRIPE_LIVE"] = "true";
      delete process.env["ALLOW_SANDBOX_TOPUP"];

      try {
        const res = await request(app)
          .post("/api/v1/billing/topup")
          .set("Authorization", `Bearer ${token}`)
          .send({ amount: 50 })
          .expect(403);
        assert.ok(res.body.error.includes("Direct sandbox top-up is disabled"));
        assert.strictEqual(db.getUserBalance(prodUser.id), 100.0);
      } finally {
        if (prevNodeEnv === undefined) {
          delete process.env["NODE_ENV"];
        } else {
          process.env["NODE_ENV"] = prevNodeEnv;
        }
        if (prevAllowSandbox === undefined) {
          delete process.env["ALLOW_SANDBOX_TOPUP"];
        } else {
          process.env["ALLOW_SANDBOX_TOPUP"] = prevAllowSandbox;
        }
        if (prevLicKey === undefined) {
          delete process.env["MSX_LICENSE_KEY"];
        } else {
          process.env["MSX_LICENSE_KEY"] = prevLicKey;
        }
        if (prevLicPubKey === undefined) {
          delete process.env["MSX_LICENSE_PUBLIC_KEY"];
        } else {
          process.env["MSX_LICENSE_PUBLIC_KEY"] = prevLicPubKey;
        }
        if (prevBillingFlag === undefined) {
          delete process.env["FEATURE_FLAG_BILLING_STRIPE_LIVE"];
        } else {
          process.env["FEATURE_FLAG_BILLING_STRIPE_LIVE"] = prevBillingFlag;
        }
      }
    },
  );

  await t.test(
    "Org invoice access: allows org owner/maintainer for member org tx and rejects unrelated user with 403",
    async () => {
      const owner = db.createUser("inv_org_owner", "inv_owner@test.com", "pwd", "Org Owner");
      const maintainer = db.createUser("inv_org_maint", "inv_maint@test.com", "pwd", "Org Maintainer");
      const member = db.createUser("inv_org_member", "inv_member@test.com", "pwd", "Org Member");
      const outsider = db.createUser("inv_outsider", "inv_outsider@test.com", "pwd", "Unrelated User");

      const org = db.createOrganization({ name: "Invoice Org", slug: "invoice-org", createdBy: owner.id });
      db.addOrganizationMember(org.id, maintainer.id, "maintainer");
      db.addOrganizationMember(org.id, member.id, "contributor");

      // Org transaction created with member as actorUserId
      db.grantOrgCredits(org.id, 75.0, member.id, "Org Top-Up Recorded Under Member");
      const orgWallet = db.getOrgWalletSummary(org.id);
      assert.ok(orgWallet && orgWallet.transactions.length > 0);
      const orgTxId = orgWallet.transactions[0]!.id;

      const signUser = (u: { id: number; username: string; email: string }) =>
        jwt.sign({ id: u.id, username: u.username, email: u.email, tokenVersion: 1 }, JWT_SECRET, {
          algorithm: "HS256",
        });

      // Org owner can view org transaction created by another member
      const ownerRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTxId}?format=json`)
        .set("Authorization", `Bearer ${signUser(owner)}`)
        .expect(200);
      assert.strictEqual(ownerRes.body.invoice.transactionId, orgTxId);

      // Org maintainer can view org transaction created by another member
      const maintRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTxId}?format=json`)
        .set("Authorization", `Bearer ${signUser(maintainer)}`)
        .expect(200);
      assert.strictEqual(maintRes.body.invoice.transactionId, orgTxId);

      // Unrelated user is rejected with 403
      const outsiderRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTxId}?format=json`)
        .set("Authorization", `Bearer ${signUser(outsider)}`)
        .expect(403);
      assert.ok(outsiderRes.body.error.includes("Forbidden"));
    },
  );
});

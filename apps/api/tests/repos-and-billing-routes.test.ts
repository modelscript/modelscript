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

test("Repository Management and Billing REST Routes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repos-billing-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  await t.test("Repos: GET /api/v1/repos/popular returns public popular repositories", async () => {
    const res = await request(app).get("/api/v1/repos/popular");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.repos));
  });

  await t.test("Repos: GET /api/v1/repos requires authentication", async () => {
    const res = await request(app).get("/api/v1/repos");
    assert.strictEqual(res.status, 401);
  });

  await t.test("Repos: POST /api/v1/repos requires authentication", async () => {
    const res = await request(app).post("/api/v1/repos").send({
      provider: "github",
      external_repo_id: "12345",
      repo_full_name: "test/repo",
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test("Repos: DELETE /api/v1/repos/:id requires authentication", async () => {
    const res = await request(app).delete("/api/v1/repos/99");
    assert.strictEqual(res.status, 401);
  });

  await t.test("Billing: GET /api/v1/billing/wallet returns wallet for user", async () => {
    const res = await request(app).get("/api/v1/billing/wallet");
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.balance === "number");
  });

  await t.test("Billing: GET /api/v1/billing/transactions returns transaction history", async () => {
    const res = await request(app).get("/api/v1/billing/transactions");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.transactions));
  });

  await t.test("Billing: personal getUserTransactions does NOT include organization transactions", () => {
    const user = db.createUser("org_tx_isolation_user", "org_tx_iso@test.com", "pwd", "Org Tx Iso");
    const org = db.createOrganization({ name: "Tx Isolation Org", slug: "tx-isolation-org", createdBy: user.id });

    // Perform org wallet transactions attributed to this user
    db.grantOrgCredits(org.id, 150.0, user.id, "Org Seed Top-Up");
    db.deductOrgCredits(org.id, 20.0, user.id, null, "Org Compute Charge");
    const orgJob = db.createJob("Org Scoped Job", "RUNNING", "ADHOC", "ide", null, {}, user.id);
    db.holdOrgCredits(org.id, 30.0, user.id, orgJob, "Org Escrow Hold");
    db.releaseOrgEscrow(org.id, orgJob, "Org Escrow Release");

    // Personal transaction history must only contain personal transactions (initial_grant)
    const personalTxs = db.getUserTransactions(user.id, 50, 0);
    assert.strictEqual(personalTxs.length, 1);
    assert.strictEqual(db.getUserTransactionCount(user.id), 1);
    assert.strictEqual(personalTxs[0]!.type, "initial_grant");
    assert.ok(
      personalTxs.every((tx) => !tx.type.startsWith("org_") && (tx as { org_id?: number | null }).org_id == null),
      "Personal transactions must not include any organization ledger entries",
    );

    // Organization wallet summary must contain the 4 org transactions
    const orgSummary = db.getOrgWalletSummary(org.id);
    assert.ok(orgSummary);
    assert.strictEqual(orgSummary.transactions.length, 4);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";
import {
  BaseRepository,
  BillingRepository,
  PackageRepository,
  ReferralRepository,
  UserRepository,
} from "../src/database/repositories/index.js";

test("Modular Domain Repositories Architecture", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-domain-repos-test-"));
  const db = new LibraryDatabase(tmpDir);

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("repositories instantiated on LibraryDatabase facade", () => {
    assert.ok(db.referrals instanceof ReferralRepository, "db.referrals should be instance of ReferralRepository");
    assert.ok(db.referrals instanceof BaseRepository, "ReferralRepository inherits BaseRepository");
    assert.ok(db.users instanceof UserRepository, "db.users should be instance of UserRepository");
    assert.ok(db.packages instanceof PackageRepository, "db.packages should be instance of PackageRepository");
    assert.ok(db.billing instanceof BillingRepository, "db.billing should be instance of BillingRepository");
  });

  await t.test("UserRepository queries and operations", () => {
    // Create a user directly or via auth
    const createRes = db.createUser("repo_alice", "alice@example.com", "hash123", { accountType: "human" });
    assert.ok(createRes.id > 0);

    const user = db.users.getUserById(createRes.id);
    assert.ok(user);
    assert.equal(user.username, "repo_alice");

    const userByName = db.users.getUserByUsername("REPO_ALICE");
    assert.ok(userByName);
    assert.equal(userByName.id, createRes.id);

    const userByEmail = db.users.getUserByEmail("alice@example.com");
    assert.ok(userByEmail);
    assert.equal(userByEmail.id, createRes.id);

    const count = db.users.getUserCount();
    assert.ok(count >= 1);

    const updated = db.users.updateUserPersona(createRes.id, "control_systems");
    assert.equal(updated, true);

    const verified = db.users.setUserEmailVerified(createRes.id, true);
    assert.equal(verified, true);
  });

  await t.test("ReferralRepository operations via repository instance", () => {
    const alice = db.users.getUserByUsername("repo_alice")!;
    const bobRes = db.createUser("repo_bob", "bob@example.com", "hash456", { accountType: "human" });

    // Golden ticket generation
    const invite = db.referrals.generateUserGoldenTicket(alice.id, "Golden ticket for Bob", 200);
    assert.ok(invite.code);

    // Onboarding status
    const status = db.referrals.getUserOnboardingStatus(alice.id);
    assert.equal(status.persona, "control_systems");

    // Waitlist submission
    const waitlist = db.referrals.createWaitlistSubmission({
      email: "engineer@testlab.io",
      full_name: "Research Engineer",
      organization: "MIT",
    });
    assert.equal(waitlist.email, "engineer@testlab.io");
    assert.equal(waitlist.status, "pending");

    const fetched = db.referrals.getWaitlistSubmissionByEmail("engineer@testlab.io");
    assert.ok(fetched);
    assert.equal(fetched.id, waitlist.id);

    const approved = db.referrals.approveWaitlistSubmission(waitlist.id, alice.id);
    assert.equal(approved.success, true);
    assert.ok(approved.inviteCode);
  });

  await t.test("PackageRepository and BillingRepository operations", () => {
    const pkgCount = db.packages.getPackageCount();
    assert.ok(typeof pkgCount === "number");

    db.packages.recordPackageDownload("ModelicaStandardLibrary", "4.0.0");

    const alice = db.users.getUserByUsername("repo_alice")!;
    const bal = db.billing.getUserCreditBalance(alice.id);
    assert.ok(typeof bal === "number");
  });
});

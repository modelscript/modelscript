// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";

test("Ansatz Onboarding, User Referrals & Waitlist Submissions Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-onboarding-test-"));
  const db = new LibraryDatabase(tmpDir);

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Migration 0020 applied successfully in ledger", () => {
    const applied = db.migrationRunner.getApplied();
    const m20 = applied.find((m) => m.name === "0020_ansatz_onboarding_and_referrals");
    assert.ok(m20, "Expected migration 0020 to be recorded in applied migrations ledger");
  });

  await t.test("Instance Settings includes waitlist, referral, and fast-track defaults", () => {
    const settings = db.getInstanceSettings();
    assert.strictEqual(settings.waitlistEnabled, false);
    assert.strictEqual(settings.userInvitesEnabled, false);
    assert.strictEqual(settings.userDefaultInviteCount, 5);
    assert.strictEqual(settings.academicFastTrackEnabled, false);
    assert.ok(Array.isArray(settings.academicDomainPatterns));
    assert.ok(settings.academicDomainPatterns.includes("edu"));
    assert.strictEqual(settings.onboardingWizardEnabled, false);

    // Update settings via updateInstanceSettings
    const updated = db.updateInstanceSettings({
      waitlistEnabled: true,
      userInvitesEnabled: true,
      userDefaultInviteCount: 10,
      academicFastTrackEnabled: true,
      academicDomainPatterns: ["edu", "ac.uk", "mit.edu", "cern.ch"],
      onboardingWizardEnabled: true,
    });

    assert.strictEqual(updated.waitlistEnabled, true);
    assert.strictEqual(updated.userInvitesEnabled, true);
    assert.strictEqual(updated.userDefaultInviteCount, 10);
    assert.strictEqual(updated.academicFastTrackEnabled, true);
    assert.deepStrictEqual(updated.academicDomainPatterns, ["edu", "ac.uk", "mit.edu", "cern.ch"]);
    assert.strictEqual(updated.onboardingWizardEnabled, true);
  });

  // Create test users for referrals & onboarding
  const aliceId = db.createUser("alice", "alice@ansatz.social", "hashed_pw").id;
  const bobId = db.createUser("bob", "bob@mit.edu", "hashed_pw").id;
  const adminId = db.createUser("admin_operator", "admin@ansatz.social", "hashed_pw").id;

  await t.test("User Onboarding lifecycle (status, persona, and completion)", () => {
    const initialStatus = db.getUserOnboardingStatus(aliceId);
    assert.strictEqual(initialStatus.completed, false);
    assert.strictEqual(initialStatus.persona, null);
    assert.strictEqual(initialStatus.invitesRemaining, 5);

    const completed = db.completeUserOnboarding(aliceId, "physical_systems");
    assert.strictEqual(completed, true);

    const afterStatus = db.getUserOnboardingStatus(aliceId);
    assert.strictEqual(afterStatus.completed, true);
    assert.strictEqual(afterStatus.persona, "physical_systems");
  });

  await t.test("Golden Tickets / User Invites generation and quota decrement", () => {
    const invite = db.generateUserGoldenTicket(aliceId, "Golden ticket for Bob", 150);
    assert.ok(invite.code.toLowerCase().startsWith("msx-inv-"));
    assert.strictEqual(invite.createdBy, aliceId);
    assert.strictEqual(invite.initialCredits, 150);
    assert.strictEqual(invite.maxUses, 1);

    // Quota should decrement from 5 to 4
    const status = db.getUserOnboardingStatus(aliceId);
    assert.strictEqual(status.invitesRemaining, 4);

    const userInvites = db.getUserInvites(aliceId);
    assert.strictEqual(userInvites.length, 1);
    assert.strictEqual(userInvites[0]!.code, invite.code);
    assert.strictEqual(userInvites[0]!.creator_username, "alice");
  });

  await t.test("Consuming user invite code captures creator for referral lineage", () => {
    const invite = db.generateUserGoldenTicket(aliceId, "Golden ticket for Charlie");
    const consumeRes = db.validateAndConsumeInstanceInvite(invite.code);
    assert.strictEqual(consumeRes.valid, true);
    assert.strictEqual(consumeRes.invite?.createdBy, aliceId);
    assert.strictEqual(consumeRes.invite?.id, invite.id);
  });

  await t.test("User Referral recording, querying, and credit bonus fulfillment", () => {
    const initialAliceBalance = db.getUserById(aliceId)?.credit_balance ?? 0;
    const initialBobBalance = db.getUserById(bobId)?.credit_balance ?? 0;

    // 1. Record referral
    const referral = db.recordUserReferral(aliceId, bobId, null, 75.0);
    assert.strictEqual(referral.referrer_id, aliceId);
    assert.strictEqual(referral.referee_id, bobId);
    assert.strictEqual(referral.reward_granted, false);
    assert.strictEqual(referral.reward_amount, 75.0);

    // Query referrals for Alice
    const aliceReferrals = db.getUserReferrals(aliceId);
    assert.strictEqual(aliceReferrals.length, 1);
    assert.strictEqual(aliceReferrals[0]!.referee_username, "bob");
    assert.strictEqual(aliceReferrals[0]!.reward_granted, false);

    // Query referral by referee
    const byReferee = db.getReferralByReferee(bobId);
    assert.ok(byReferee);
    assert.strictEqual(byReferee.referrer_id, aliceId);

    // 2. Grant reward (e.g. after Bob's first successful simulation)
    const rewarded = db.grantReferralReward(bobId);
    assert.strictEqual(rewarded, true);

    // Both balances should increase by 75
    const newAliceBalance = db.getUserById(aliceId)?.credit_balance ?? 0;
    const newBobBalance = db.getUserById(bobId)?.credit_balance ?? 0;
    assert.strictEqual(newAliceBalance, initialAliceBalance + 75.0);
    assert.strictEqual(newBobBalance, initialBobBalance + 75.0);

    // Referral is now marked as granted
    const updatedReferrals = db.getUserReferrals(aliceId);
    assert.strictEqual(updatedReferrals[0]!.reward_granted, true);

    // Double-granting is a no-op
    const doubleReward = db.grantReferralReward(bobId);
    assert.strictEqual(doubleReward, false);
  });

  await t.test("Waitlist Submissions (application, idempotency, querying, and admin review)", () => {
    // 1. Application
    const sub1 = db.createWaitlistSubmission({
      email: "engineer@boeing.com",
      full_name: "Dave Aerospace",
      organization: "Boeing",
      discipline: "physical_systems",
      portfolio_url: "https://github.com/dave-aero",
      statement: "Modeling hypersonic thermal DAEs in Modelica",
      ip_address: "192.168.1.100",
    });

    assert.strictEqual(sub1.email, "engineer@boeing.com");
    assert.strictEqual(sub1.status, "pending");
    assert.strictEqual(sub1.full_name, "Dave Aerospace");

    // Idempotent resubmission returns existing submission
    const duplicate = db.createWaitlistSubmission({
      email: "ENGINEER@boeing.com",
      full_name: "Dave Aerospace Updated",
    });
    assert.strictEqual(duplicate.id, sub1.id);

    // Create a second submission
    const sub2 = db.createWaitlistSubmission({
      email: "researcher@cern.ch",
      full_name: "Elena CERN",
      organization: "CERN",
      discipline: "academic",
      statement: "Particle detector cooling loop simulation",
    });

    // 2. Querying
    const allPending = db.getWaitlistSubmissions({ status: "pending" });
    assert.strictEqual(allPending.length, 2);

    const fetchedByEmail = db.getWaitlistSubmissionByEmail("engineer@boeing.com");
    assert.ok(fetchedByEmail);
    assert.strictEqual(fetchedByEmail.id, sub1.id);

    // 3. Approval
    const approveRes = db.approveWaitlistSubmission(sub1.id, adminId);
    assert.strictEqual(approveRes.success, true);
    assert.ok(approveRes.inviteCode?.toLowerCase().startsWith("msx-inv-"));
    assert.strictEqual(approveRes.submission?.status, "approved");
    assert.strictEqual(approveRes.submission?.approved_by, adminId);

    // Re-approving returns existing invite code
    const reApprove = db.approveWaitlistSubmission(sub1.id, adminId);
    assert.strictEqual(reApprove.inviteCode, approveRes.inviteCode);

    // 4. Rejection
    const rejectRes = db.rejectWaitlistSubmission(sub2.id, adminId);
    assert.strictEqual(rejectRes, true);

    const sub2Updated = db.getWaitlistSubmissionById(sub2.id);
    assert.strictEqual(sub2Updated?.status, "rejected");
    assert.strictEqual(sub2Updated?.approved_by, adminId);

    // Filtered lists
    const approvedList = db.getWaitlistSubmissions({ status: "approved" });
    assert.strictEqual(approvedList.length, 1);
    assert.strictEqual(approvedList[0]!.id, sub1.id);

    const rejectedList = db.getWaitlistSubmissions({ status: "rejected" });
    assert.strictEqual(rejectedList.length, 1);
    assert.strictEqual(rejectedList[0]!.id, sub2.id);
  });
});

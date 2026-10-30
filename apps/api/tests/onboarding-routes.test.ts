// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Ansatz Onboarding, Waitlist & Referral HTTP Routes Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-onboarding-routes-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Provision admin & standard users
  const adminUser = db.createUser("admin_node", "admin@ansatz.social", "hashed_pw", {
    accountType: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const memberUser = db.createUser("alice_member", "alice@ansatz.social", "hashed_pw", {
    accountType: "user",
    emailVerified: true,
  });
  const memberToken = jwt.sign(
    { id: memberUser.id, username: memberUser.username, email: memberUser.email, accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("GET /api/v1/instance/banner exposes onboarding, waitlist, and fast-track flags", async () => {
    const res = await request(app).get("/api/v1/instance/banner").expect(200);
    assert.strictEqual(typeof res.body.waitlistEnabled, "boolean");
    assert.strictEqual(typeof res.body.userInvitesEnabled, "boolean");
    assert.strictEqual(typeof res.body.academicFastTrackEnabled, "boolean");
    assert.strictEqual(typeof res.body.onboardingWizardEnabled, "boolean");
  });

  await t.test("GET /api/v1/instance/capabilities exposes tier, edition, and granular capabilities", async () => {
    const res = await request(app).get("/api/v1/instance/capabilities").expect(200);
    assert.ok(res.body.tier);
    assert.ok(["ce", "ee"].includes(res.body.edition));
    assert.strictEqual(typeof res.body.airgapEnforced, "boolean");
    assert.ok(res.body.capabilities);
    assert.strictEqual(typeof res.body.capabilities.userInvites, "boolean");
    assert.strictEqual(typeof res.body.capabilities.offlineSandbox, "boolean");
    assert.strictEqual(typeof res.body.capabilities.caeCompute, "boolean");
  });

  await t.test("POST /api/v1/waitlist/apply validates gating, emails, and records applications", async () => {
    // 1. When waitlist is disabled, application is rejected with 400
    db.updateInstanceSettings({ waitlistEnabled: false });
    const resDisabled = await request(app)
      .post("/api/v1/waitlist/apply")
      .send({ email: "engineer@boeing.com" })
      .expect(400);
    assert.ok(resDisabled.body.error.includes("disabled"));

    // 2. Enable waitlist
    db.updateInstanceSettings({ waitlistEnabled: true });

    // 3. Reject disposable emails
    const resDisposable = await request(app)
      .post("/api/v1/waitlist/apply")
      .send({ email: "spammer@mailinator.com" })
      .expect(400);
    assert.ok(resDisposable.body.error.includes("Disposable"));

    // 4. Valid application succeeds
    const resSuccess = await request(app)
      .post("/api/v1/waitlist/apply")
      .send({
        email: "engineer@boeing.com",
        fullName: "Dave Aero",
        organization: "Boeing",
        discipline: "physical_systems",
        statement: "Hypersonic aero-thermal simulation",
      })
      .expect(201);

    assert.strictEqual(resSuccess.body.success, true);
    assert.strictEqual(resSuccess.body.submission.email, "engineer@boeing.com");
    assert.strictEqual(resSuccess.body.submission.status, "pending");

    // 5. Idempotent re-submission returns same record
    const resDuplicate = await request(app)
      .post("/api/v1/waitlist/apply")
      .send({ email: "ENGINEER@boeing.com", fullName: "Dave Aero Updated" })
      .expect(201);
    assert.strictEqual(resDuplicate.body.submission.id, resSuccess.body.submission.id);
  });

  await t.test("Admin waitlist moderation endpoints (GET /admin/waitlist, /approve, /reject)", async () => {
    // Standard user is forbidden
    await request(app).get("/api/v1/admin/waitlist").set("Authorization", `Bearer ${memberToken}`).expect(403);

    // Admin can list waitlist candidates
    const resList = await request(app)
      .get("/api/v1/admin/waitlist?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(resList.body.submissions));
    assert.strictEqual(resList.body.submissions.length, 1);
    const sub = resList.body.submissions[0];
    assert.strictEqual(sub.email, "engineer@boeing.com");

    // Admin approves waitlist application -> generates invite code
    const resApprove = await request(app)
      .post(`/api/v1/admin/waitlist/${sub.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(resApprove.body.success, true);
    assert.ok(resApprove.body.inviteCode.toLowerCase().startsWith("msx-inv-"));
    assert.strictEqual(resApprove.body.submission.status, "approved");

    // Create a second application to reject
    const app2 = db.createWaitlistSubmission({
      email: "reject_candidate@example.com",
      statement: "test reject",
    });

    const resReject = await request(app)
      .post(`/api/v1/admin/waitlist/${app2.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(resReject.body.success, true);
    const updatedApp2 = db.getWaitlistSubmissionById(app2.id);
    assert.strictEqual(updatedApp2?.status, "rejected");
  });

  await t.test("Academic Fast-Track bypasses invite-only registration gating", async () => {
    // Configure instance to invite_only + academic fast-track enabled for .edu
    db.updateInstanceSettings({
      registrationMode: "invite_only",
      academicFastTrackEnabled: true,
      academicDomainPatterns: ["edu", "ac.uk"],
    });

    // 1. Non-academic email without invite code is blocked
    const resNonAcademic = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "commercial_dev",
        email: "dev@company.com",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "valid-mock-token",
      })
      .expect(403);

    assert.ok(resNonAcademic.body.error.toLowerCase().includes("invitation code is required"));

    // 2. Academic email with .edu domain passes fast-track without invite code
    const resAcademic = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "mit_student",
        email: "researcher@mit.edu",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "valid-mock-token",
      })
      .expect(201);

    assert.strictEqual(resAcademic.body.user.username, "mit_student");
    assert.strictEqual(resAcademic.body.user.email, "researcher@mit.edu");
  });

  await t.test("User Onboarding lifecycle (GET/POST /api/v1/users/me/onboarding)", async () => {
    // 1. Initial status is not completed
    const resStatus1 = await request(app)
      .get("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    assert.strictEqual(resStatus1.body.completed, false);
    assert.strictEqual(resStatus1.body.persona, null);
    assert.strictEqual(resStatus1.body.invitesRemaining, 5);

    // Test singular /api/v1/user/onboarding route alias
    const resAlias = await request(app)
      .get("/api/v1/user/onboarding")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);
    assert.strictEqual(resAlias.body.completed, false);

    // 2. Complete onboarding with engineering discipline persona
    const resComplete = await request(app)
      .post("/api/v1/users/me/onboarding/complete")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ persona: "physical_systems" })
      .expect(200);

    assert.strictEqual(resComplete.body.success, true);
    assert.strictEqual(resComplete.body.status.completed, true);
    assert.strictEqual(resComplete.body.status.persona, "physical_systems");

    // 3. Status is now persisted
    const resStatus2 = await request(app)
      .get("/api/v1/users/me/onboarding")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    assert.strictEqual(resStatus2.body.completed, true);
    assert.strictEqual(resStatus2.body.persona, "physical_systems");
  });

  await t.test("Golden Tickets generation & Referral tracking via user registration", async () => {
    // 1. When user invites disabled, generation returns 403
    db.updateInstanceSettings({ userInvitesEnabled: false });
    await request(app)
      .post("/api/v1/users/me/invites/generate")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ note: "Ticket for Bob" })
      .expect(403);

    // 2. Enable user invites
    db.updateInstanceSettings({ userInvitesEnabled: true });

    // 3. Generate a golden ticket
    const resGen = await request(app)
      .post("/api/v1/users/me/invites/generate")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ note: "Ticket for colleague Bob" })
      .expect(201);

    assert.strictEqual(resGen.body.success, true);
    const goldenTicketCode = resGen.body.invite.code;
    assert.ok(goldenTicketCode.toLowerCase().startsWith("msx-inv-"));
    assert.strictEqual(resGen.body.invitesRemaining, 4);

    // 4. Bob registers using Alice's Golden Ticket
    const resBobReg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "bob_engineer",
        email: "bob@engineering.org",
        password: "Password123!",
        inviteCode: goldenTicketCode,
        acceptTerms: true,
        captchaToken: "valid-mock-token",
      })
      .expect(201);

    assert.strictEqual(resBobReg.body.user.username, "bob_engineer");

    // 5. Query Alice's invite list: Bob should appear in her referrals
    const resAliceInvites = await request(app)
      .get("/api/v1/users/me/invites")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    assert.strictEqual(resAliceInvites.body.invitesRemaining, 4);
    assert.strictEqual(resAliceInvites.body.invites.length, 1);
    assert.strictEqual(resAliceInvites.body.referrals.length, 1);
    assert.strictEqual(resAliceInvites.body.referrals[0].referee_username, "bob_engineer");
    assert.strictEqual(resAliceInvites.body.referrals[0].reward_granted, false);

    // 6. Grant referral bonus to both Alice and Bob
    const bobRow = db.getUserByUsername("bob_engineer");
    assert.ok(bobRow);
    const rewarded = db.grantReferralReward(bobRow.id);
    assert.strictEqual(rewarded, true);

    const resAliceInvitesAfter = await request(app)
      .get("/api/v1/users/me/invites")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);
    assert.strictEqual(resAliceInvitesAfter.body.referrals[0].reward_granted, true);
  });

  await t.test("Tier 2 Enterprise / Air-Gapped decoupling verification", async () => {
    // 1. Switch instance settings to Tier 2 Ansatz Enterprise configuration
    db.updateInstanceSettings(
      {
        instanceName: "Ansatz Enterprise",
        instanceBadge: "Enterprise",
        registrationMode: "domain_allowlist",
        allowedEmailDomains: ["corp.internal", "aerospace.com"],
        federationMode: "disabled",
        waitlistEnabled: false,
        userInvitesEnabled: false,
        academicFastTrackEnabled: false,
      },
      adminUser.id,
    );

    // 2. GET /instance/banner should reflect enterprise settings and disabled waitlist
    const bannerRes = await request(app).get("/api/v1/instance/banner").expect(200);
    assert.strictEqual(bannerRes.body.instanceName, "Ansatz Enterprise");
    assert.strictEqual(bannerRes.body.instanceBadge, "Enterprise");
    assert.strictEqual(bannerRes.body.registrationMode, "domain_allowlist");
    assert.strictEqual(bannerRes.body.waitlistEnabled, false);
    assert.strictEqual(bannerRes.body.userInvitesEnabled, false);
    assert.strictEqual(bannerRes.body.academicFastTrackEnabled, false);

    // 3. POST /waitlist/apply should be rejected with 400
    const waitlistRes = await request(app)
      .post("/api/v1/waitlist/apply")
      .send({ email: "outsider@external.com" })
      .expect(400);
    assert.match(waitlistRes.body.error, /Waitlist applications are currently disabled/i);

    // 4. Generating member invites / golden tickets should be rejected with 403
    const genRes = await request(app)
      .post("/api/v1/users/me/invites/generate")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({})
      .expect(403);
    assert.match(genRes.body.error, /disabled on this instance/i);

    // 5. Registration with unauthorized domain should be rejected
    const unauthReg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "unauth_user",
        email: "intruder@gmail.com",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "mock-valid",
      })
      .expect(403);
    assert.match(unauthReg.body.error, /approved email domains/i);

    // 6. Registration with authorized domain succeeds without requiring invite code
    const authReg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "corp_engineer",
        email: "alice@corp.internal",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "mock-valid",
      })
      .expect(201);
    assert.strictEqual(authReg.body.user.username, "corp_engineer");
  });
});

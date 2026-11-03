// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Settings & Preferences API: Granular Notifications and Connected Accounts", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-preferences-test-"));
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

  const user = db.createUser("sarah", "sarah@modelscript.test", "hashed_pwd", { emailVerified: true });
  const userToken = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET);

  await t.test("GET /api/v1/auth/notifications returns empty object or stored settings", async () => {
    const res = await request(app).get("/api/v1/auth/notifications").set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {});
  });

  await t.test("PUT /api/v1/auth/notifications saves and updates granular preference tree", async () => {
    const updatedPreferences = {
      qualityFilter: false,
      channels: {
        email: false,
        browserPush: true,
      },
      inAppSounds: false,
      emailDigestFrequency: "weekly",
      events: {
        social: {
          mentions: true,
          replies: false,
          follows: true,
          reposts: false,
        },
        engineering: {
          packageUpdates: true,
          starredRepoCommits: false,
          federatedMentions: true,
        },
        computeHpc: {
          jobCompleted: true,
          jobFailed: true,
          quotaThresholdAlert: true,
        },
      },
    };

    const putRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${userToken}`)
      .send(updatedPreferences);

    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.success, true);

    // Verify GET retrieves the persisted preferences
    const getRes = await request(app).get("/api/v1/auth/notifications").set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.qualityFilter, false);
    assert.strictEqual(getRes.body.channels?.email, false);
    assert.strictEqual(getRes.body.channels?.browserPush, true);
    assert.strictEqual(getRes.body.inAppSounds, false);
    assert.strictEqual(getRes.body.emailDigestFrequency, "weekly");
    assert.strictEqual(getRes.body.events?.social?.replies, false);
    assert.strictEqual(getRes.body.events?.engineering?.starredRepoCommits, false);
    assert.strictEqual(getRes.body.events?.computeHpc?.quotaThresholdAlert, true);
  });

  await t.test("Connected Accounts: Listing, Linking, and Unlinking OAuth providers", async () => {
    // Initial fetch should show all providers disconnected
    const initialRes = await request(app)
      .get("/api/v1/auth/connected-accounts")
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(initialRes.status, 200);
    assert.ok(Array.isArray(initialRes.body.providers));
    assert.strictEqual(initialRes.body.providers.length, 4);

    const githubAcc = initialRes.body.providers.find((a: any) => a.provider === "github");
    assert.ok(githubAcc);
    assert.strictEqual(githubAcc.connected, false);

    // Link a GitHub account in the database
    db.linkOAuthAccount(user.id, "github", "gh_user_9921", "mock_gh_token");

    // Fetch accounts again
    const linkedRes = await request(app)
      .get("/api/v1/auth/connected-accounts")
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(linkedRes.status, 200);
    const updatedGithub = linkedRes.body.providers.find((a: any) => a.provider === "github");
    assert.ok(updatedGithub);
    assert.strictEqual(updatedGithub.connected, true);
    assert.strictEqual(updatedGithub.identifier, "gh_user_9921");

    // Unlink the GitHub account
    const unlinkRes = await request(app)
      .delete("/api/v1/auth/connected-accounts/github")
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(unlinkRes.status, 200);
    assert.strictEqual(unlinkRes.body.success, true);

    // Verify account is now unlinked
    const postUnlinkRes = await request(app)
      .get("/api/v1/auth/connected-accounts")
      .set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(postUnlinkRes.status, 200);
    const postGithub = postUnlinkRes.body.providers.find((a: any) => a.provider === "github");
    assert.ok(postGithub);
    assert.strictEqual(postGithub.connected, false);
  });

  await t.test("Privacy, Blocked, and Muted Accounts endpoints", async () => {
    const privRes = await request(app).get("/api/v1/users/me/privacy").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(privRes.status, 200);
    assert.strictEqual(privRes.body.discoverable, true);
    assert.strictEqual(privRes.body.indexable, true);
    assert.strictEqual(privRes.body.locked, false);

    const updateRes = await request(app)
      .put("/api/v1/users/me")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ discoverable: false, locked: true, default_post_visibility: "unlisted" });
    assert.strictEqual(updateRes.status, 200);

    const updatedPrivRes = await request(app)
      .get("/api/v1/users/me/privacy")
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(updatedPrivRes.status, 200);
    assert.strictEqual(updatedPrivRes.body.discoverable, false);
    assert.strictEqual(updatedPrivRes.body.locked, true);
    assert.strictEqual(updatedPrivRes.body.default_post_visibility, "unlisted");

    const peer = db.createUser("peer_user", "peer@modelscript.test", "hashed_pwd", { emailVerified: true });
    await request(app).post(`/api/v1/users/${peer.username}/block`).set("Authorization", `Bearer ${userToken}`);
    await request(app).post(`/api/v1/users/${peer.username}/mute`).set("Authorization", `Bearer ${userToken}`);

    const blockedRes = await request(app).get("/api/v1/users/me/blocked").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(blockedRes.status, 200);
    assert.strictEqual(blockedRes.body.blocked.length, 1);
    assert.strictEqual(blockedRes.body.blocked[0].username, "peer_user");

    const mutedRes = await request(app).get("/api/v1/users/me/muted").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(mutedRes.status, 200);
    assert.strictEqual(mutedRes.body.muted.length, 1);
    assert.strictEqual(mutedRes.body.muted[0].username, "peer_user");
  });

  await t.test("Bots: Simulation/Modelica scopes and token rotation", async () => {
    const createBotRes = await request(app)
      .post("/api/v1/users/me/bots")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        username: "sim_helper_bot",
        display_name: "Sim Helper Bot",
        scopes: "social:read,social:write,social:simulate,modelica:validate",
      });
    assert.strictEqual(createBotRes.status, 200);
    assert.ok(createBotRes.body.token.startsWith("ms_bot_"));
    const botId = createBotRes.body.bot.id;
    const oldToken = createBotRes.body.token;

    const rotateRes = await request(app)
      .post(`/api/v1/users/me/bots/${botId}/rotate-token`)
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(rotateRes.status, 200);
    assert.ok(rotateRes.body.token.startsWith("ms_bot_"));
    assert.notStrictEqual(rotateRes.body.token, oldToken);
  });

  await t.test("Organizations: PATCH profile and PATCH member role normalization", async () => {
    const createOrgRes = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ slug: "thermo-labs", name: "Thermo Labs" });
    assert.strictEqual(createOrgRes.status, 201);

    const patchOrgRes = await request(app)
      .patch("/api/v1/organizations/thermo-labs")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        display_name: "Thermo Dynamics Labs",
        website: "https://thermo.example.com",
        billing_email: "billing@thermo.example.com",
      });
    assert.strictEqual(patchOrgRes.status, 200);
    assert.strictEqual(patchOrgRes.body.organization.display_name, "Thermo Dynamics Labs");
    assert.strictEqual(patchOrgRes.body.organization.website, "https://thermo.example.com");
    assert.strictEqual(patchOrgRes.body.organization.billing_email, "billing@thermo.example.com");

    const addMemberRes = await request(app)
      .post("/api/v1/organizations/thermo-labs/members")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ username: "peer_user", role: "member" });
    assert.strictEqual(addMemberRes.status, 200);
    assert.strictEqual(addMemberRes.body.role, "contributor");

    const patchRoleRes = await request(app)
      .patch("/api/v1/organizations/thermo-labs/members/peer_user")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ role: "admin" });
    assert.strictEqual(patchRoleRes.status, 200);
    assert.strictEqual(patchRoleRes.body.role, "maintainer");
  });

  await t.test(
    "Dynamic Instance URL: resolves actor_url from request Origin / Host and supports @username lookup",
    async () => {
      const privacyRes = await request(app)
        .get("/api/v1/users/me/privacy")
        .set("Authorization", `Bearer ${userToken}`)
        .set("Origin", "http://localhost:3001");
      assert.strictEqual(privacyRes.status, 200);
      assert.strictEqual(privacyRes.body.actor_url, "http://localhost:3001/users/sarah");

      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${userToken}`)
        .set("X-Forwarded-Proto", "https")
        .set("X-Forwarded-Host", "sim.acme-eng.org");
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.user.actor_url, "https://sim.acme-eng.org/users/sarah");
      assert.strictEqual(meRes.body.user.default_post_visibility, "unlisted");

      const atProfileRes = await request(app).get("/api/v1/users/@sarah").set("Origin", "http://localhost:3001");
      assert.strictEqual(atProfileRes.status, 200);
      assert.strictEqual(atProfileRes.body.profile.username, "sarah");
      assert.strictEqual(atProfileRes.body.profile.actor_url, "http://localhost:3001/users/sarah");
    },
  );
});

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
});

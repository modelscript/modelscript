// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
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
import { LibraryStorage } from "../src/storage.js";

test("Phase 2 Workstream 4: Invites, OAuth Provider Gating & Bots API", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase2-invites-bots-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  const passwordHash = await bcrypt.hash("StrongPassword123!", 10);
  const user = db.createUser("phase2_tester", "phase2.tester@example.com", passwordHash, {
    emailVerified: true,
    status: "active",
  });
  const authToken = jwt.sign({ id: user.id, username: user.username, email: user.email, tokenVersion: 1 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  await t.test("generateUserGoldenTicket atomically enforces invites_remaining quota", async () => {
    db.updateInstanceSettings({ userInvitesEnabled: true });
    db.db.prepare(`UPDATE users SET invites_remaining = 2 WHERE id = ?`).run(user.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        request(app)
          .post("/api/v1/users/me/invites/generate")
          .set("Authorization", `Bearer ${authToken}`)
          .send({ note: `Concurrent ticket ${idx}` }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status === 400);

    assert.strictEqual(succeeded.length, 2, "Exactly 2 invites should be minted when quota is 2");
    assert.strictEqual(failed.length, 3, "Remaining 3 requests beyond quota should fail with 400");

    const status = db.getUserOnboardingStatus(user.id);
    assert.strictEqual(status.invitesRemaining, 0, "invites_remaining must never drop below 0");

    assert.throws(() => db.generateUserGoldenTicket(user.id, "Should fail"), /No golden tickets \/ invites remaining/);
  });

  await t.test("getUserInvites returns accurate used_count, uses_count, and usesCount after redemption", async () => {
    db.db.prepare(`UPDATE users SET invites_remaining = 1 WHERE id = ?`).run(user.id);
    const minted = db.generateUserGoldenTicket(user.id, "Redemption test ticket");

    const beforeInvites = db.getUserInvites(user.id);
    const beforeItem = beforeInvites.find((inv) => inv.code === minted.code);
    assert.ok(beforeItem, "Minted invite should appear in getUserInvites");
    assert.strictEqual(beforeItem.used_count, 0);
    assert.strictEqual(beforeItem.uses_count, 0);
    assert.strictEqual(beforeItem.usesCount, 0);

    // Simulate redemption incrementing used_count
    db.db.prepare(`UPDATE instance_invites SET used_count = used_count + 1 WHERE id = ?`).run(minted.id);

    const res = await request(app).get("/api/v1/users/me/invites").set("Authorization", `Bearer ${authToken}`);

    assert.strictEqual(res.status, 200);
    const afterItem = (res.body.invites as Array<Record<string, unknown>>).find((inv) => inv["code"] === minted.code);
    assert.ok(afterItem, "Redeemed invite should appear in GET /users/me/invites");
    assert.strictEqual(afterItem["used_count"], 1);
    assert.strictEqual(afterItem["uses_count"], 1);
    assert.strictEqual(afterItem["usesCount"], 1);
  });

  await t.test("POST /api/v1/users/me/bots returns full bot metadata and PATCH clears BYOK API key", async () => {
    const createRes = await request(app)
      .post("/api/v1/users/me/bots")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        username: "phase2_dynamics_bot",
        display_name: "Phase 2 Dynamics Bot",
        bio: "Automated Modelica ODE assistant",
        avatar_url: "https://example.com/bot-avatar.png",
        scopes: "social:read,social:write,modelica:validate",
        system_prompt: "You validate Modelica equations.",
        model: "gpt-4o-mini",
        api_key: "sk-test-secret-key-1234",
        endpoint_url: "https://api.openai.com/v1",
      });

    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.body.success, true);
    assert.ok(typeof createRes.body.token === "string" && createRes.body.token.startsWith("ms_bot_"));

    const bot = createRes.body.bot;
    assert.ok(typeof bot.id === "number" && bot.id > 0);
    assert.strictEqual(bot.username, "phase2_dynamics_bot");
    assert.strictEqual(bot.display_name, "Phase 2 Dynamics Bot");
    assert.strictEqual(bot.bio, "Automated Modelica ODE assistant");
    assert.strictEqual(bot.avatar_url, "https://example.com/bot-avatar.png");
    assert.strictEqual(bot.bot_model, "gpt-4o-mini");
    assert.strictEqual(bot.bot_endpoint_url, "https://api.openai.com/v1");
    assert.strictEqual(bot.bot_system_prompt, "You validate Modelica equations.");
    assert.strictEqual(bot.bot_scopes, "social:read,social:write,modelica:validate");
    assert.strictEqual(bot.has_api_key, true);
    assert.strictEqual(bot.has_bot_api_key, true);
    assert.strictEqual(bot.bot_api_key, undefined, "Plaintext BYOK key must not be returned in create payload");
    assert.ok(typeof bot.created_at === "string" && bot.created_at.length > 0);

    // Clear stored API key via PATCH with api_key: ""
    const patchRes = await request(app)
      .patch(`/api/v1/users/me/bots/${bot.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ api_key: "" });

    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.bot.has_bot_api_key, false);
    assert.strictEqual(patchRes.body.bot.bot_api_key, null);
  });

  await t.test("GET /api/v1/auth/connected-accounts returns supportedProviders excluding oidc/twitter", async () => {
    const prevGithubId = process.env["GITHUB_CLIENT_ID"];
    const prevGitlabId = process.env["GITLAB_CLIENT_ID"];

    try {
      delete process.env["GITHUB_CLIENT_ID"];
      delete process.env["GITLAB_CLIENT_ID"];

      const unconfiguredRes = await request(app)
        .get("/api/v1/auth/connected-accounts")
        .set("Authorization", `Bearer ${authToken}`);

      assert.strictEqual(unconfiguredRes.status, 200);
      assert.ok(Array.isArray(unconfiguredRes.body.supportedProviders));
      assert.strictEqual(unconfiguredRes.body.supportedProviders.includes("oidc"), false);
      assert.strictEqual(unconfiguredRes.body.supportedProviders.includes("twitter"), false);

      process.env["GITHUB_CLIENT_ID"] = "gh-client-id-test";
      process.env["GITLAB_CLIENT_ID"] = "gl-client-id-test";

      const configuredRes = await request(app)
        .get("/api/v1/auth/connected-accounts")
        .set("Authorization", `Bearer ${authToken}`);

      assert.strictEqual(configuredRes.status, 200);
      assert.deepStrictEqual(configuredRes.body.supportedProviders, ["github", "gitlab"]);
      assert.strictEqual(configuredRes.body.supportedProviders.includes("oidc"), false);
      assert.strictEqual(configuredRes.body.supportedProviders.includes("twitter"), false);
    } finally {
      if (prevGithubId === undefined) {
        delete process.env["GITHUB_CLIENT_ID"];
      } else {
        process.env["GITHUB_CLIENT_ID"] = prevGithubId;
      }
      if (prevGitlabId === undefined) {
        delete process.env["GITLAB_CLIENT_ID"];
      } else {
        process.env["GITLAB_CLIENT_ID"] = prevGitlabId;
      }
    }
  });
});

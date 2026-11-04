// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["FEATURE_FLAG_TEST_STRICT"] = "true";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { checkComputeSandboxing } from "../src/util/compute-sandboxing.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";

const JWT_SECRET = process.env["JWT_SECRET"] || "ansatz-dev-jwt-secret-do-not-use-in-prod";

test("Decentralized Fediverse Authentication & Sandboxing Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fediverse-auth-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  await t.test("SSRF Protection: Rejects local, private, and cloud metadata domains", async () => {
    const testDir = path.join(tmpDir, "ssrf");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    await seedInitialAdmin(db, {
      username: "admin_ssrf",
      email: "admin@ssrf.test",
      password: "TestPassword123!",
      preset: "tier1_federated",
    });

    const app = createApp({ database: db });

    const blockedTargets = [
      "localhost",
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.5",
      "192.168.1.100",
      "172.16.0.1",
      "[::1]",
    ];

    for (const target of blockedTargets) {
      const res = await request(app).get(
        `/api/v1/auth/login/fediverse?domain=${encodeURIComponent(target)}&format=json`,
      );
      assert.strictEqual(res.status, 400, `Target ${target} should be rejected with 400`);
      assert.strictEqual(res.body.code, "SSRF_DISALLOWED_DOMAIN");
    }

    // Verify browser redirect on SSRF rejection without format=json
    const browserRes = await request(app).get("/api/v1/auth/login/fediverse?domain=127.0.0.1");
    assert.strictEqual(browserRes.status, 302);
    assert.ok((browserRes.headers["location"] as string).includes("error=DisallowedFediverseDomain"));

    db.db.close();
  });

  await t.test("Air-gap & disabled federation strictly blocks Fediverse login", async () => {
    const testDir = path.join(tmpDir, "airgap");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    await seedInitialAdmin(db, {
      username: "admin_corp",
      email: "admin@corp.test",
      password: "TestPassword123!",
      preset: "tier2_corporate",
    });

    const app = createApp({ database: db });

    // API JSON check
    const res = await request(app).get("/api/v1/auth/login/fediverse?domain=mastodon.social&format=json");
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, "FEDERATION_DISABLED");

    // Browser navigation redirect check
    const browserRes = await request(app).get("/api/v1/auth/login/fediverse?domain=mastodon.social");
    assert.strictEqual(browserRes.status, 302);
    assert.ok((browserRes.headers["location"] as string).includes("error=FederationDisabled"));

    db.db.close();
  });

  await t.test("Dynamic OAuth Client caching and authorization redirect", async () => {
    const testDir = path.join(tmpDir, "oauth_client");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    await seedInitialAdmin(db, {
      username: "admin_oauth",
      email: "admin@oauth.test",
      password: "TestPassword123!",
      preset: "tier1_federated",
    });

    // Seed mock client in database
    db.saveFederatedOAuthClient("fosstodon.org", "mock_client_id_123", "mock_client_secret_456");

    const cachedClient = db.getFederatedOAuthClient("fosstodon.org");
    assert.ok(cachedClient);
    assert.strictEqual(cachedClient.client_id, "mock_client_id_123");
    assert.strictEqual(cachedClient.client_secret, "mock_client_secret_456");

    const app = createApp({ database: db });

    // Request with handle @scientist@fosstodon.org
    const res = await request(app).get("/api/v1/auth/login/fediverse?handle=@scientist@fosstodon.org");
    assert.strictEqual(res.status, 302);
    const location = res.headers["location"] as string;
    assert.ok(location.startsWith("https://fosstodon.org/oauth/authorize"));
    assert.ok(location.includes("client_id=mock_client_id_123"));
    assert.ok(location.includes("response_type=code"));
    assert.ok(location.includes("scope=read%3Aaccounts"));

    db.db.close();
  });

  await t.test("User registration & identity provisioning for community federated accounts", async () => {
    const testDir = path.join(tmpDir, "provisioning");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    const user = db.registerFederatedUser("ada_lovelace", "ada@mathstodon.xyz", "fediverse", "mathstodon.xyz:9876", {
      accountType: "community_federated",
      displayName: "Ada Lovelace",
      bio: "Mathematician & Pioneer of Computing",
      avatarUrl: "https://mathstodon.xyz/avatars/ada.png",
      remoteDomain: "mathstodon.xyz",
      actorUrl: "https://mathstodon.xyz/users/ada_lovelace",
    });

    assert.ok(user.id);
    assert.strictEqual(user.username, "ada_lovelace");

    const fullUser = db.getUserById(user.id);
    assert.ok(fullUser);
    assert.strictEqual(fullUser.account_type, "community_federated");
    assert.strictEqual(fullUser.display_name, "Ada Lovelace");
    assert.strictEqual(fullUser.bio, "Mathematician & Pioneer of Computing");
    assert.strictEqual(fullUser.remote_domain, "mathstodon.xyz");
    assert.strictEqual(fullUser.actor_url, "https://mathstodon.xyz/users/ada_lovelace");
    assert.strictEqual(fullUser.email_verified, 0);

    // Verify lookup by actorUrl
    const byActor = db.getUserByActorUrl("https://mathstodon.xyz/users/ada_lovelace");
    assert.ok(byActor);
    assert.strictEqual(byActor.id, user.id);

    // Verify OAuth account linking
    const oauth = db.getOAuthAccount("fediverse", "mathstodon.xyz:9876");
    assert.ok(oauth);
    assert.strictEqual(oauth.user_id, user.id);

    db.db.close();
  });

  await t.test(
    "Compute sandboxing restricts unverified community federated users from heavy cloud solvers",
    async () => {
      const testDir = path.join(tmpDir, "sandboxing");
      fs.mkdirSync(testDir, { recursive: true });
      const db = new LibraryDatabase(testDir);
      setAuthDatabase(db);

      await seedInitialAdmin(db, {
        username: "admin_sim",
        email: "admin@sim.test",
        password: "TestPassword123!",
        preset: "tier1_federated",
      });

      // Create federated user (unverified email)
      const fedUser = db.registerFederatedUser(
        "bob_ross",
        "bob@artstodon.social",
        "fediverse",
        "artstodon.social:111",
        {
          accountType: "community_federated",
          displayName: "Bob Ross",
          remoteDomain: "artstodon.social",
          actorUrl: "https://artstodon.social/users/bob_ross",
        },
      );

      const fedUserRow = db.getUserById(fedUser.id);
      assert.ok(fedUserRow);

      // 1. Direct unit verification of checkComputeSandboxing
      const sandboxResult = checkComputeSandboxing(fedUserRow);
      assert.strictEqual(sandboxResult.sandboxed, true);
      assert.strictEqual(sandboxResult.code, "COMPUTE_TIER_SANDBOXED");
      assert.strictEqual(sandboxResult.fallbackAvailable, "wasm_in_browser");

      // 2. Verified user check
      const verifiedUser = db.createUser("regular_user", "reg@ansatz.test", "hash", {
        emailVerified: true,
      });
      const regularUserRow = db.getUserById(verifiedUser.id);
      const regResult = checkComputeSandboxing(regularUserRow);
      assert.strictEqual(regResult.sandboxed, false);

      // 3. HTTP endpoint check on /api/v1/simulate
      const app = createApp({ database: db });

      // Generate JWT for federated user
      const fedToken = jwt.sign(
        {
          id: fedUser.id,
          username: fedUser.username,
          email: fedUser.email,
          tokenVersion: 1,
        },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const simRes = await request(app).post("/api/v1/simulate").set("Authorization", `Bearer ${fedToken}`).send({
        modelName: "TestModel",
        modelSource: "model TestModel Real x; equation der(x) = -x; end TestModel;",
        profile: "high-memory",
      });

      assert.strictEqual(simRes.status, 403);
      assert.strictEqual(simRes.body.code, "COMPUTE_TIER_SANDBOXED");
      assert.strictEqual(simRes.body.fallbackAvailable, "wasm_in_browser");

      // 4. Verified user passes the compute sandboxing check
      const verifiedToken = jwt.sign(
        {
          id: verifiedUser.id,
          username: verifiedUser.username,
          email: verifiedUser.email,
          tokenVersion: 1,
        },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const verifiedSimRes = await request(app)
        .post("/api/v1/simulate")
        .set("Authorization", `Bearer ${verifiedToken}`)
        .send({
          modelName: "TestModel",
          modelSource: "model TestModel Real x; equation der(x) = -x; end TestModel;",
          profile: "standard",
        });

      // Should NOT be rejected with COMPUTE_TIER_SANDBOXED
      assert.notStrictEqual(verifiedSimRes.status, 403);
      assert.notStrictEqual(verifiedSimRes.body?.code, "COMPUTE_TIER_SANDBOXED");

      db.db.close();
    },
  );
});

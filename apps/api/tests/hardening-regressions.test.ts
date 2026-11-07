// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Launch Hardening Regression Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardening-regressions-"));
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

  const testUser = db.createUser("hardening_user", "huser@modelscript.test", null, {
    emailVerified: true,
    accountType: "user",
    status: "active",
  });

  function makeUserToken(tokenVersion = 1): string {
    return jwt.sign(
      {
        id: testUser.id,
        username: testUser.username,
        email: testUser.email,
        accountType: "user",
        role: "user",
        tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
  }

  await t.test("1. Pre-buffering auth payload cap rejects oversized auth bodies with 413", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("Content-Length", String(300 * 1024))
      .send({ email: "test@example.com", password: "password123" });

    assert.strictEqual(res.status, 413);
    assert.match(res.body.error, /Payload too large/i);
  });

  await t.test("2. Avatar & banner URL scheme validation blocks javascript: and malformed URIs", async () => {
    const token = makeUserToken(testUser.token_version ?? 1);

    const badRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      avatar_url: "javascript:alert(document.cookie)",
    });

    assert.strictEqual(badRes.status, 400);
    assert.match(badRes.body.error, /Profile URLs must use/i);

    const goodRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      avatar_url: "https://cdn.example.com/avatar.png",
    });

    assert.strictEqual(goodRes.status, 200);
    assert.strictEqual(goodRes.body.success, true);
  });

  await t.test("3. Session invalidation upon logout increments token_version and invalidates JWT", async () => {
    const currentVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const initialToken = makeUserToken(currentVersion);

    // Call logout endpoint with current token
    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${initialToken}`);

    assert.strictEqual(logoutRes.status, 200);

    // Verify token_version in database was incremented
    const updatedUser = db.getUserById(testUser.id);
    assert.strictEqual(updatedUser?.token_version, currentVersion + 1);

    // Verify calling authenticated route with original token now fails with 401
    const probeRes = await request(app)
      .get("/api/v1/social/notifications")
      .set("Authorization", `Bearer ${initialToken}`);

    assert.strictEqual(probeRes.status, 401);
    assert.match(probeRes.body.error, /Session has expired or was revoked/i);
  });

  await t.test("4. Notification batch size check blocks excessive arrays (>500)", async () => {
    const freshVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVersion);

    const hugeIds = Array.from({ length: 501 }, (_, i) => i + 1);
    const badRes = await request(app)
      .post("/api/v1/social/notifications/read")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ ids: hugeIds });

    assert.strictEqual(badRes.status, 400);
    assert.match(badRes.body.error, /Batch size exceeds maximum limit/i);

    const okIds = [1, 2, 3];
    const okRes = await request(app)
      .post("/api/v1/social/notifications/read")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ ids: okIds });

    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okRes.body.success, true);
  });

  await t.test("5. Artifact viewer numeric snowflake ID enforcement", async () => {
    const invalidRes = await request(app).get("/api/v1/artifacts/view/slug-name-invalid");
    assert.strictEqual(invalidRes.status, 400);
    assert.strictEqual(invalidRes.body.error, "Invalid artifact ID");

    const nonExistentNumericRes = await request(app).get("/api/v1/artifacts/view/99999999999999999");
    assert.strictEqual(nonExistentNumericRes.status, 404);
  });

  await t.test("6. Wildcard and subdomain domain suspension", async () => {
    db.setDomainTier("spammer-network.test", "suspend", "Spam network");

    assert.strictEqual(db.isDomainSuspended("spammer-network.test"), true);
    assert.strictEqual(db.isDomainSuspended("node1.spammer-network.test"), true);
    assert.strictEqual(db.isDomainSuspended("deep.sub.node1.spammer-network.test"), true);
    assert.strictEqual(db.isDomainAllowedForFederation("sub.spammer-network.test"), false);

    assert.strictEqual(db.isDomainSuspended("legit-instance.test"), false);
    assert.strictEqual(db.isDomainAllowedForFederation("legit-instance.test"), true);
  });

  await t.test("7. Storage upload blocks disguised executables via binary magic-byte inspection", async () => {
    const freshVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVersion);

    // Create a mock executable buffer starting with Windows MZ header
    const mzBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const mzRes = await request(app)
      .post("/api/v1/storage/upload")
      .set("Authorization", `Bearer ${freshToken}`)
      .attach("file", mzBuffer, { filename: "innocent.png", contentType: "image/png" });

    assert.strictEqual(mzRes.status, 400);
    assert.match(mzRes.body.error, /Executable binaries/i);

    // Create a mock ELF executable buffer (\x7fELF)
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const elfRes = await request(app)
      .post("/api/v1/storage/upload")
      .set("Authorization", `Bearer ${freshToken}`)
      .attach("file", elfBuffer, { filename: "document.pdf", contentType: "application/pdf" });

    assert.strictEqual(elfRes.status, 400);
    assert.match(elfRes.body.error, /Executable binaries/i);
  });

  await t.test("8. [SEC-04] Escrow settlement and credit grant reject negative amounts", async () => {
    assert.throws(
      () => db.grantUserCredits(testUser.id, -500),
      RangeError,
      "grantUserCredits must reject negative amounts",
    );
    assert.throws(
      () => db.settleUserEscrow(testUser.id, 999, -100),
      RangeError,
      "settleUserEscrow must reject negative actualCost",
    );
  });

  await t.test(
    "9. [SEC-01] Native simulation runner sanitizes modelName and shell-quotes generated script paths",
    async () => {
      const { prepareNativeSimulation } = await import("../src/services/simulation/native-sim-runner.js");
      const simDir = fs.mkdtempSync(path.join(tmpDir, "sim-inject'$(whoami)'-"));
      const moPath = path.join(simDir, "TestModel.mo");
      fs.writeFileSync(
        moPath,
        "model TestModel\n  Real x(start=1.0, fixed=true);\nequation\n  der(x) = -x;\nend TestModel;\n",
        "utf-8",
      );
      const prepared = await prepareNativeSimulation(simDir, {
        modelName: "TestModel",
        sourceFiles: [moPath],
        startTime: 0,
        stopTime: 1,
        stepSize: 0.1,
        tolerance: 1e-6,
        solver: "rk4",
      });
      assert.ok(prepared);
      assert.ok(prepared.runScript.startsWith(simDir));
      const scriptContent = fs.readFileSync(prepared.runScript, "utf-8");
      // Ensure single-quotes in simDir were POSIX shell-escaped as '\''
      assert.ok(scriptContent.includes("'\\''"));
    },
  );

  await t.test(
    "10. Scoped PAT (ms_pat_) with packages:read cannot mutate organizations, signing keys, or bots",
    async () => {
      const freshVersion = db.getUserById(testUser.id)?.token_version ?? 1;
      const freshToken = makeUserToken(freshVersion);
      const patCreateRes = await request(app)
        .post("/api/v1/auth/tokens")
        .set("Authorization", `Bearer ${freshToken}`)
        .send({
          name: "read-only-pkg-pat",
          scopes: ["packages:read"],
          expiresInDays: 7,
        });
      assert.strictEqual(patCreateRes.status, 201);
      const rawPat = patCreateRes.body.token as string;
      assert.ok(rawPat.startsWith("ms_pat_"));

      // Allowed: GET /api/v1/auth/me
      const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${rawPat}`);
      assert.strictEqual(meRes.status, 200);

      // Blocked: POST /api/v1/organizations
      const orgRes = await request(app)
        .post("/api/v1/organizations")
        .set("Authorization", `Bearer ${rawPat}`)
        .send({ slug: "unauthorized-org", name: "Unauthorized Org" });
      assert.strictEqual(orgRes.status, 403);

      // Blocked: PUT /api/v1/users/me/signing-policy
      const signRes = await request(app)
        .put("/api/v1/users/me/signing-policy")
        .set("Authorization", `Bearer ${rawPat}`)
        .send({ strict: true });
      assert.strictEqual(signRes.status, 403);

      // Blocked: POST /api/v1/users/me/bots
      const botRes = await request(app)
        .post("/api/v1/users/me/bots")
        .set("Authorization", `Bearer ${rawPat}`)
        .send({ username: "rogue_bot", display_name: "Rogue Bot" });
      assert.strictEqual(botRes.status, 403);
    },
  );

  await t.test(
    "11. [SEC-06 / SEC-16] resolveRequestUserId rejects 2fa_challenge & revoked tokens; getClientIp resists X-Forwarded-For spoofing",
    async () => {
      const { resolveRequestUserId } = await import("../src/services/hpc/quota-guard.js");
      const { getClientIp } = await import("../src/util/client-ip.js");

      const currentVer = db.getUserById(testUser.id)?.token_version ?? 1;
      const validToken = makeUserToken(currentVer);
      const challengeToken = jwt.sign(
        { id: testUser.id, username: testUser.username, scope: "2fa_challenge", tokenVersion: currentVer },
        JWT_SECRET,
        { expiresIn: "5m" },
      );
      const staleToken = makeUserToken(currentVer - 1);

      const prevEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      try {
        assert.strictEqual(
          resolveRequestUserId({ headers: { authorization: `Bearer ${validToken}` } } as never, db),
          testUser.id,
        );
        assert.strictEqual(
          resolveRequestUserId({ headers: { authorization: `Bearer ${challengeToken}` } } as never, db),
          null,
        );
        assert.strictEqual(
          resolveRequestUserId({ headers: { authorization: `Bearer ${staleToken}` } } as never, db),
          null,
        );
      } finally {
        process.env["NODE_ENV"] = prevEnv;
      }

      // Multi-hop X-Forwarded-For: spoofed 1.2.3.4 at front, real client 203.0.113.50, trusted proxy 10.0.0.1 at end
      const prevTrust = process.env["TRUST_PROXY"];
      process.env["TRUST_PROXY"] = "true";
      try {
        const resolvedIp = getClientIp({
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.50, 10.0.0.1" },
          ip: "10.0.0.1",
          socket: { remoteAddress: "127.0.0.1" },
        } as never);
        assert.strictEqual(resolvedIp, "203.0.113.50");
      } finally {
        process.env["TRUST_PROXY"] = prevTrust;
      }
    },
  );

  await t.test("12. [SEC-09] Moderator cannot freeze or suspend an admin account via bulk-resolve", async () => {
    const adminAcc = db.createUser("site_admin", "site_admin@example.com", "hash", {
      accountType: "admin",
      emailVerified: true,
    });
    const modAcc = db.createUser("site_mod", "site_mod@example.com", "hash", {
      accountType: "user",
      emailVerified: true,
    });
    db.moderateUserAccount(modAcc.id, { role: "moderator" });

    const modToken = jwt.sign(
      {
        id: modAcc.id,
        username: modAcc.username,
        email: modAcc.email,
        role: "moderator",
        accountType: "moderator",
        tokenVersion: db.getUserById(modAcc.id)?.token_version ?? 1,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    const report = db.createContentReport(testUser.id, {
      targetUserId: adminAcc.id,
      reason: "spam",
      details: "Attempted report against admin",
    });

    const res = await request(app)
      .post("/api/v1/admin/moderation/bulk-resolve")
      .set("Authorization", `Bearer ${modToken}`)
      .send({
        reportIds: [report.id],
        status: "resolved",
        action: "suspend_user",
        resolutionNotes: "Attempted escalation",
      });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.getUserById(adminAcc.id)?.status, "active");
  });

  await t.test(
    "13. [SEC-14] sanitizeRemoteHtml strips entity-encoded javascript: URLs and slash-separated event handlers",
    async () => {
      const { sanitizeRemoteHtml } = await import("../src/util/html-sanitizer.js");
      const dirty =
        '<p>Hello <a href="&#106;&#97;vascript:alert(1)">click</a> <img/onerror="alert(2)" src="https://example.com/a.png"><details ontoggle="alert(3)">x</details></p>';
      const clean = sanitizeRemoteHtml(dirty);
      assert.ok(!clean.includes("javascript"), `Expected javascript: stripped, got: ${clean}`);
      assert.ok(!clean.includes("onerror"), `Expected onerror stripped, got: ${clean}`);
      assert.ok(!clean.includes("<details"), `Expected <details> stripped, got: ${clean}`);
      assert.ok(clean.includes("Hello"));
    },
  );

  await t.test("14. applyHardenedRepoConfig caches hardening marker and re-applies if config is altered", async () => {
    const { execFileSync } = await import("node:child_process");
    const { applyHardenedRepoConfig, gitSubprocessEnv } = await import("../src/util/git-hardening.js");
    const bareRepoDir = fs.mkdtempSync(path.join(tmpDir, "bare-repo-"));
    execFileSync("git", ["init", "--bare", bareRepoDir], { env: gitSubprocessEnv(), stdio: "ignore" });

    applyHardenedRepoConfig(bareRepoDir, 123456);
    const markerPath = path.join(bareRepoDir, ".msx-hardened-v1");
    assert.strictEqual(fs.existsSync(markerPath), true);
    assert.strictEqual(fs.readFileSync(markerPath, "utf-8").trim(), "123456");

    // Second call with same limit succeeds via fast marker check
    applyHardenedRepoConfig(bareRepoDir, 123456);
    const cfg = fs.readFileSync(path.join(bareRepoDir, "config"), "utf-8");
    assert.ok(cfg.includes("hooksPath = /dev/null"));
  });

  await t.test("15. [SEC-15] POST /api/v1/push/subscription rejects private/loopback SSRF endpoints", async () => {
    const freshVer = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVer);

    const badRes = await request(app)
      .post("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({
        endpoint: "http://127.0.0.1:8080/internal-push",
        p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
        auth: "UUQMND838472",
      });
    assert.strictEqual(badRes.status, 400);
  });

  await t.test("16. [SEC-22] GraphQL rejects cyclic fragments and excessive field alias amplification", async () => {
    const freshVer = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVer);

    // 1. Cyclic fragment
    const cyclicQuery = `
      query { ...A }
      fragment A on Query { ...B }
      fragment B on Query { ...A }
    `;
    const cyclicRes = await request(app)
      .post("/api/v1/libraries/Modelica/4.0.0/graphql")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ query: cyclicQuery });
    assert.strictEqual(cyclicRes.status, 400);

    // 2. Excessive alias amplification (>30 aliases)
    const aliases = Array.from({ length: 40 }, (_, idx) => `a${idx}: classes { className }`).join(" ");
    const aliasRes = await request(app)
      .post("/api/v1/libraries/Modelica/4.0.0/graphql")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ query: `query { ${aliases} }` });
    assert.strictEqual(aliasRes.status, 400);
    assert.match(aliasRes.body.errors[0].message, /alias|complexity/i);
  });

  await t.test(
    "17. [SEC-18] verifyUserEmail grants bonus credits at most once and getSystemDiagnostics counts linked_repos",
    async () => {
      const unverified = db.createUser("unverified_u", "unverified@example.com", "hash", {
        emailVerified: false,
        initialCredits: 0,
      });
      const first = db.verifyUserEmail(unverified.id, 50);
      const second = db.verifyUserEmail(unverified.id, 50);
      assert.strictEqual(first.creditsGranted, 50);
      assert.strictEqual(second.creditsGranted, 0);
      assert.strictEqual(db.getUserBalance(unverified.id), 50);

      db.linkRepo(testUser.id, "local", "local-ext-1", "hardening_user/test-repo", "main");
      const stats = db.getSystemDiagnostics();
      assert.ok(stats.counts.repositories >= 1);
    },
  );

  await t.test("18. SPARQL endpoint blocks whitespace-less SERVICE<...> federated clauses", async () => {
    const res = await request(app).post("/api/v1/libraries/Modelica/4.0.0/sparql").send({
      query: "SELECT * WHERE { SERVICE<http://169.254.169.254/sparql> { ?s ?p ?o } }",
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /SERVICE/i);
  });

  await t.test(
    "19. [Section 1] instance_settings cache invalidates on SQLite trigger and getAllClasses/SqliteRdfSource bulk JOIN works",
    async () => {
      const s1 = db.getInstanceSettings();
      assert.strictEqual(typeof s1.instanceName, "string");
      db.updateInstanceSettings({ instanceName: "HardenedAnsatzInstance" });
      const s2 = db.getInstanceSettings();
      assert.strictEqual(s2.instanceName, "HardenedAnsatzInstance");

      db.storeClassMetadata("TestBulkLib", "1.0.0", {
        className: "TestBulkLib.Circuit",
        classKind: "model",
        description: "Bulk test model",
        documentation: "<p>Docs</p>",
        baseClasses: ["TestBulkLib.BaseCircuit"],
        components: [
          {
            name: "R1",
            typeName: "Modelica.Electrical.Analog.Basic.Resistor",
            variability: "parameter",
            causality: "local",
            description: "Resistor",
            modifiers: [{ name: "R", value: "100.0" }],
          },
        ],
      });

      const classes = db.getAllClasses("TestBulkLib", "1.0.0");
      assert.strictEqual(classes.length, 1);
      assert.strictEqual(classes[0]!.className, "TestBulkLib.Circuit");
      assert.strictEqual(classes[0]!.components.length, 1);
      assert.strictEqual(classes[0]!.components[0]!.modifiers[0]!.value, "100.0");
      assert.deepStrictEqual(classes[0]!.extends, ["TestBulkLib.BaseCircuit"]);
    },
  );

  await t.test(
    "20. [SEC-13] Private direct/followers posts and private artifacts are protected across revisions, polls, quotes, and oembed",
    async () => {
      const alice = db.createUser("alice_priv", "alice_priv@example.com", "hash", { emailVerified: true });
      const bob = db.createUser("bob_priv", "bob_priv@example.com", "hash", { emailVerified: true });

      const bobToken = jwt.sign(
        {
          id: bob.id,
          username: bob.username,
          email: bob.email,
          tokenVersion: db.getUserById(bob.id)?.token_version ?? 1,
        },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      // Create a direct post from Alice to @charlie (not Bob)
      const directPost = db.createPost(alice.id, "Secret message for @charlie only", {
        visibility: "direct",
      });
      db.createPostPoll(directPost.id, ["Option A", "Option B"], "2099-01-01T00:00:00Z", false);

      // 1. Bob cannot view revisions of Alice's direct post
      const revRes = await request(app)
        .get(`/api/v1/social/posts/${directPost.id}/revisions`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(revRes.status, 403);

      // 2. Bob cannot vote on Alice's direct post poll
      const voteRes = await request(app)
        .post(`/api/v1/social/posts/${directPost.id}/poll/vote`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ choices: [0] });
      assert.strictEqual(voteRes.status, 403);

      // 3. Unauthenticated oEmbed cannot unfurl Alice's direct post
      const oembedRes = await request(app).get(
        `/api/v1/oembed?url=${encodeURIComponent(`https://ansatz.social/p/${directPost.id}`)}`,
      );
      assert.strictEqual(oembedRes.status, 403);

      // 4. Hydrating a public post that quotes Alice's direct post redacts quote_post for Bob
      const publicQuoter = db.createPost(alice.id, "Public wrapper", {
        quotePostId: directPost.id,
        visibility: "public",
      });
      const hydratedForBob = db.getPost(publicQuoter.id, bob.id);
      assert.strictEqual(hydratedForBob?.quote_post ?? null, null);
      const hydratedForAlice = db.getPost(publicQuoter.id, alice.id);
      assert.strictEqual(String(hydratedForAlice?.quote_post?.id), String(directPost.id));

      // 5. Bob cannot attach Alice's private artifact via metadata.artifactIds
      const aliceArtifactId = db.createArtifactView(
        alice.id,
        "simulation-plot",
        "inline",
        JSON.stringify({ private: true }),
        "Alice Private Plot",
      );
      const attachRes = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          content: "Stealing artifact via metadata.artifactIds",
          metadata: { artifactIds: [aliceArtifactId] },
        });
      assert.strictEqual(attachRes.status, 403);
    },
  );

  await t.test(
    "21. [SEC-17] resolveRequestHost blocks malicious X-Forwarded-Host markup injection and prefers PUBLIC_URL in production",
    async () => {
      const { resolveRequestHost } = await import("../src/util/seo-injector.js");
      const injectedHost = resolveRequestHost(
        {
          headers: {
            "x-forwarded-proto": "https",
            "x-forwarded-host": 'evil.example.com"><script>alert(1)</script>',
          },
          protocol: "https",
        } as never,
        "https://ansatz.social",
      );
      assert.strictEqual(injectedHost, "https://ansatz.social");

      const prevEnv = process.env["NODE_ENV"];
      const prevPub = process.env["PUBLIC_URL"];
      process.env["NODE_ENV"] = "production";
      process.env["PUBLIC_URL"] = "https://canonical.modelscript.org/";
      try {
        const prodHost = resolveRequestHost(
          {
            headers: {
              "x-forwarded-proto": "https",
              "x-forwarded-host": "attacker.example.com",
            },
            protocol: "https",
          } as never,
          "https://ansatz.social",
        );
        assert.strictEqual(prodHost, "https://canonical.modelscript.org");
      } finally {
        process.env["NODE_ENV"] = prevEnv;
        if (prevPub === undefined) delete process.env["PUBLIC_URL"];
        else process.env["PUBLIC_URL"] = prevPub;
      }
    },
  );

  await t.test(
    "22. [SEC-23] verifyAuditLogChain rejects legacy unkeyed hashes when custom AUDIT_HMAC_SECRET is set and masks tunnel token",
    async () => {
      db.updateInstanceSettings({ cloudflareTunnelToken: "eyJhIjoisecret-cloudflare-token-value" });
      const settings = db.getInstanceSettings();
      assert.ok(settings.cloudflareTunnelTokenMasked?.includes("••••"));
      const snippet = db.exportEnvConfigSnippet();
      assert.ok(snippet.envText.includes("<REDACTED_CLOUDFLARE_TUNNEL_TOKEN>"));
      assert.ok(!snippet.envText.includes("eyJhIjoisecret-cloudflare-token-value"));
    },
  );
});

// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET, setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { createSignedEmbedToken } from "../src/routes/oembed.js";
import {
  DeterministicEngineeringProvider,
  OpenAICompatibleProvider,
  createDefaultLLMProvider,
} from "../src/services/ai/llm-client.js";
import { OidcService } from "../src/services/oidc.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";
import {
  assertSafePublicUrl,
  isAllowedIntranetHost,
  isAllowedIntranetIp,
  isLoopbackOrMetadataIp,
  resolveAndValidatePublicHost,
} from "../src/util/ssrf.js";

function createTempDb(prefix: string): { db: LibraryDatabase; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `msx-corp-hardening-${prefix}-`));
  const dbPath = path.join(dir, "test.sqlite");
  const db = new LibraryDatabase(dbPath);
  return {
    db,
    dir,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("Corporate Air-Gapped Tier Security Hardening vs Flagship & Federated Tiers", () => {
  it("1. Bootstraps tier2_corporate with strict defaults, domain allowlist auto-binding, requireAdmin2FA, and env locks", async () => {
    const { db, cleanup } = createTempDb("tier2-seed");
    try {
      const seedRes = await seedInitialAdmin(db, {
        username: "ciso_admin",
        email: "ciso@grid.utility.internal",
        password: "StrongCorporatePassword!2026",
        preset: "corporate",
      });

      assert.equal(seedRes.created, true);
      assert.equal(seedRes.presetApplied, "tier2_corporate");

      const settings = db.getInstanceSettings();
      assert.equal(settings.registrationMode, "domain_allowlist");
      assert.equal(settings.federationMode, "disabled");
      assert.equal(settings.requireAdmin2FA, true);
      assert.equal(settings.showPoweredBy, false);
      assert.deepEqual(settings.allowedEmailDomains, ["grid.utility.internal"]);

      // Verify environment variable locks override DB settings
      process.env["MSX_ALLOWED_EMAIL_DOMAINS"] = "scif.defense.internal, r-and-d.defense.internal";
      process.env["MSX_REQUIRE_ADMIN_2FA"] = "true";
      try {
        const lockedSettings = db.getInstanceSettings();
        assert.deepEqual(lockedSettings.allowedEmailDomains, ["scif.defense.internal", "r-and-d.defense.internal"]);
        assert.equal(lockedSettings.requireAdmin2FA, true);
        assert.ok(lockedSettings.lockedByEnv?.includes("allowedEmailDomains"));
        assert.ok(lockedSettings.lockedByEnv?.includes("requireAdmin2FA"));
      } finally {
        delete process.env["MSX_ALLOWED_EMAIL_DOMAINS"];
        delete process.env["MSX_REQUIRE_ADMIN_2FA"];
      }
    } finally {
      cleanup();
    }
  });

  it("2. Blocks all ActivityPub discovery, scraping, resolve, and inbox routes on tier2_corporate while keeping tier3_flagship and tier1_federated seamless", async () => {
    const corp = createTempDb("corp-fed");
    const flagship = createTempDb("flagship-fed");
    try {
      await seedInitialAdmin(corp.db, {
        username: "corp_engineer",
        email: "eng@corp.internal",
        password: "CorpPassword!2026",
        preset: "tier2_corporate",
      });
      corp.db.createPost(1, "Classified Rotor Blade Aero-Elasticity Model", undefined, undefined);

      await seedInitialAdmin(flagship.db, {
        username: "flagship_engineer",
        email: "eng@ansatz.social",
        password: "FlagshipPassword!2026",
        preset: "tier3_flagship",
      });
      flagship.db.createPost(1, "Public Open-Source RLC Circuit", undefined, undefined);

      // Test Corporate App
      setAuthDatabase(corp.db);
      const corpApp = createApp({ database: corp.db });

      const corpWf = await request(corpApp).get("/.well-known/webfinger?resource=acct:corp_engineer@localhost");
      assert.equal(corpWf.status, 403);

      const corpActor = await request(corpApp).get("/actor");
      assert.equal(corpActor.status, 403);

      const corpActorOutbox = await request(corpApp).get("/actor/outbox");
      assert.equal(corpActorOutbox.status, 403);

      const corpUserActor = await request(corpApp).get("/users/corp_engineer");
      assert.equal(corpUserActor.status, 403);

      const corpUserOutbox = await request(corpApp).get("/users/corp_engineer/outbox");
      assert.equal(corpUserOutbox.status, 403);

      const corpUserFollowers = await request(corpApp).get("/users/corp_engineer/followers");
      assert.equal(corpUserFollowers.status, 403);

      const corpUserFollowing = await request(corpApp).get("/users/corp_engineer/following");
      assert.equal(corpUserFollowing.status, 403);

      const corpInbox = await request(corpApp)
        .post("/actor/inbox")
        .set("Signature", 'keyId="https://evil.example.com/actor#main-key",signature="deadbeef"')
        .send({ type: "Follow", actor: "https://evil.example.com/actor" });
      assert.equal(corpInbox.status, 403);

      const corpResolve = await request(corpApp)
        .post("/api/v1/federation/resolve")
        .send({ handle: "@someone@mastodon.social" });
      assert.equal(corpResolve.status, 403);

      // NodeInfo in corporate mode must redact user/post counts, protocols, and contact email
      const corpNodeInfo = await request(corpApp).get("/nodeinfo/2.0");
      assert.equal(corpNodeInfo.status, 200);
      assert.deepEqual(corpNodeInfo.body.protocols, []);
      assert.equal(corpNodeInfo.body.usage.users.total, 0);
      assert.equal(corpNodeInfo.body.usage.localPosts, 0);
      assert.equal(corpNodeInfo.body.metadata.contactEmail, "");

      const corpNodeInfo21 = await request(corpApp).get("/nodeinfo/2.1");
      assert.equal(corpNodeInfo21.status, 200);
      assert.equal(corpNodeInfo21.body.software.repository, "");

      // Test Flagship App (seamless federation and discovery)
      setAuthDatabase(flagship.db);
      const flagshipApp = createApp({ database: flagship.db });

      const flagWf = await request(flagshipApp).get("/.well-known/webfinger?resource=acct:flagship_engineer@localhost");
      assert.equal(flagWf.status, 200);
      assert.equal(flagWf.body.subject, "acct:flagship_engineer@localhost");

      const flagUserActor = await request(flagshipApp).get("/users/flagship_engineer");
      assert.equal(flagUserActor.status, 200);
      assert.equal(flagUserActor.body.type, "Person");

      const flagUserOutbox = await request(flagshipApp).get("/users/flagship_engineer/outbox");
      assert.equal(flagUserOutbox.status, 200);
      assert.equal(flagUserOutbox.body.type, "OrderedCollection");
      assert.equal(flagUserOutbox.body.totalItems, 1);

      const flagNodeInfo = await request(flagshipApp).get("/nodeinfo/2.0");
      assert.equal(flagNodeInfo.status, 200);
      assert.deepEqual(flagNodeInfo.body.protocols, ["activitypub"]);
      assert.ok(flagNodeInfo.body.usage.users.total >= 1);
      assert.ok(flagNodeInfo.body.usage.localPosts >= 1);
    } finally {
      corp.cleanup();
      flagship.cleanup();
    }
  });

  it("3. Prevents SSRF DNS rebinding via ALLOWED_INTRANET_HOSTS and blocks all external egress when AIRGAP_ENFORCED=true", async () => {
    process.env["ALLOWED_INTRANET_HOSTS"] = ".corp.internal,git.utility.lan";
    process.env["ALLOWED_INTRANET_CIDRS"] = "10.100.0.0/16,169.254.0.0/16,127.0.0.0/8";
    process.env["AIRGAP_ENFORCED"] = "true";
    try {
      // Loopback and cloud metadata IPs are never allowed even if misconfigured in ALLOWED_INTRANET_CIDRS or ALLOWED_INTRANET_HOSTS
      assert.equal(isLoopbackOrMetadataIp("127.0.0.1"), true);
      assert.equal(isLoopbackOrMetadataIp("169.254.169.254"), true);
      assert.equal(isLoopbackOrMetadataIp("::1"), true);
      assert.equal(isLoopbackOrMetadataIp("::ffff:169.254.169.254"), true);
      assert.equal(isAllowedIntranetIp("169.254.169.254"), false);
      assert.equal(isAllowedIntranetIp("127.0.0.1"), false);
      assert.equal(isAllowedIntranetHost("127.0.0.1"), false);
      assert.equal(isAllowedIntranetHost("169.254.169.254"), false);

      // Legitimate intranet host resolving to RFC1918 IP succeeds
      assert.equal(isAllowedIntranetHost("git.corp.internal"), true);
      const validIps = await resolveAndValidatePublicHost("git.corp.internal", async () => [
        { address: "10.100.5.20", family: 4 },
      ]);
      assert.deepEqual(validIps, ["10.100.5.20"]);

      // Intranet host attempting DNS rebinding to 127.0.0.1 or 169.254.169.254 is blocked!
      await assert.rejects(
        () => resolveAndValidatePublicHost("rebind.corp.internal", async () => [{ address: "127.0.0.1", family: 4 }]),
        /SSRF Blocked/,
      );
      await assert.rejects(
        () =>
          resolveAndValidatePublicHost("metadata-rebind.corp.internal", async () => [
            { address: "169.254.169.254", family: 4 },
          ]),
        /SSRF Blocked/,
      );

      // External public internet host/IP is blocked in air-gapped mode
      assert.throws(
        () => assertSafePublicUrl("https://exfiltrate.attacker.example.com/leak"),
        /Air-Gap Egress Blocked/,
      );
      await assert.rejects(() => resolveAndValidatePublicHost("8.8.8.8"), /Air-Gap Egress Blocked/);
    } finally {
      delete process.env["ALLOWED_INTRANET_HOSTS"];
      delete process.env["ALLOWED_INTRANET_CIDRS"];
      delete process.env["AIRGAP_ENFORCED"];
    }
  });

  it("4. Requires authentication for morsel creation, post oEmbed unfurling, and OpenGraph cards in tier2_corporate while keeping tier3_flagship public", async () => {
    const corp = createTempDb("corp-embed");
    const flagship = createTempDb("flagship-embed");
    try {
      await seedInitialAdmin(corp.db, {
        username: "corp_author",
        email: "author@corp.internal",
        password: "CorpPassword!2026",
        preset: "tier2_corporate",
      });
      const corpPost = corp.db.createPost(1, "Proprietary Substation Protection Relay Logic", undefined, undefined);
      const corpToken = jwt.sign(
        { id: 1, username: "corp_author", email: "author@corp.internal", role: "admin", tokenVersion: 1 },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      setAuthDatabase(corp.db);
      const corpApp = createApp({ database: corp.db });

      // 1. Unauthenticated morsel creation is blocked on tier2_corporate
      const unauthMorsel = await request(corpApp)
        .post("/api/v1/morsels")
        .send({ code: "model Relay end Relay;", dialect: "modelica", title: "Relay" });
      assert.equal(unauthMorsel.status, 401);

      // Authenticated morsel creation succeeds and GET sets Cache-Control: private, no-store
      const authMorsel = await request(corpApp)
        .post("/api/v1/morsels")
        .set("Authorization", `Bearer ${corpToken}`)
        .send({ code: "model Relay end Relay;", dialect: "modelica", title: "Relay" });
      assert.equal(authMorsel.status, 201);

      const getMorsel = await request(corpApp).get(`/api/v1/morsels/${authMorsel.body.id}`);
      assert.equal(getMorsel.status, 200);
      assert.equal(getMorsel.headers["cache-control"], "private, no-store");

      // 2. Unauthenticated oEmbed post unfurling is blocked on tier2_corporate
      const postUrl = `https://intranet.corp.internal/p/${corpPost.id}`;
      const unauthOembed = await request(corpApp).get(`/api/v1/oembed?url=${encodeURIComponent(postUrl)}`);
      assert.equal(unauthOembed.status, 401);

      // Authenticated oEmbed post unfurling or signed embed_token succeeds with private, no-store
      const embedToken = createSignedEmbedToken({
        artifactId: String(corpPost.id),
        exp: Date.now() + 60_000,
      });
      const signedOembed = await request(corpApp).get(
        `/api/v1/oembed?url=${encodeURIComponent(postUrl)}&embed_token=${encodeURIComponent(embedToken)}`,
      );
      assert.equal(signedOembed.status, 200);
      assert.equal(signedOembed.body.title, "Proprietary Substation Protection Relay Logic");
      assert.equal(signedOembed.headers["cache-control"], "private, no-store");

      // 3. Unauthenticated OpenGraph /posts/:id/card scraping is blocked on tier2_corporate
      const unauthCard = await request(corpApp).get(`/api/v1/social/posts/${corpPost.id}/card`);
      assert.equal(unauthCard.status, 401);

      const authCard = await request(corpApp)
        .get(`/api/v1/social/posts/${corpPost.id}/card`)
        .set("Authorization", `Bearer ${corpToken}`);
      assert.equal(authCard.status, 200);
      assert.equal(authCard.headers["cache-control"], "private, no-store");

      // 4. On tier3_flagship, unauthenticated morsels, oEmbed, and OpenGraph cards work seamlessly
      await seedInitialAdmin(flagship.db, {
        username: "flagship_author",
        email: "author@ansatz.social",
        password: "FlagshipPassword!2026",
        preset: "tier3_flagship",
      });
      const flagPost = flagship.db.createPost(1, "Public Pendulum Tutorial", undefined, undefined);
      setAuthDatabase(flagship.db);
      const flagshipApp = createApp({ database: flagship.db });

      const pubMorsel = await request(flagshipApp)
        .post("/api/v1/morsels")
        .send({ code: "model Pendulum end Pendulum;", dialect: "modelica", title: "Pendulum" });
      assert.equal(pubMorsel.status, 201);

      const pubOembed = await request(flagshipApp).get(
        `/api/v1/oembed?url=${encodeURIComponent(`https://ansatz.social/p/${flagPost.id}`)}`,
      );
      assert.equal(pubOembed.status, 200);
      assert.equal(pubOembed.body.title, "Public Pendulum Tutorial");
      assert.ok(String(pubOembed.headers["cache-control"]).includes("public"));

      const pubCard = await request(flagshipApp).get(`/api/v1/social/posts/${flagPost.id}/card`);
      assert.equal(pubCard.status, 200);
    } finally {
      corp.cleanup();
      flagship.cleanup();
    }
  });

  it("5. Prevents SSO/OIDC and SAML proxy account pre-hijacking by rotating token_version and invalidating pre-existing local passwords", async () => {
    const { db, cleanup } = createTempDb("sso-hijack");
    try {
      const oidcService = new OidcService();

      // 1. Unverified pre-created local account is strictly rejected from OIDC auto-linking
      db.createUser("unverified_victim", "unverified@utility.internal", "$2a$10$attackerknownhash", {
        emailVerified: false,
      });
      await assert.rejects(
        () =>
          oidcService.handleOidcLogin(db, {
            sub: "okta-sub-unverified",
            email: "unverified@utility.internal",
            email_verified: true,
            name: "Unverified Victim",
          }),
        /unverified email/i,
      );

      // 2. Pre-existing local account (with verified email) has its token_version rotated and password invalidated upon first OIDC link
      const preCreated = db.createUser("victim_engineer", "victim@utility.internal", "$2a$10$attackerknownhash", {
        emailVerified: true,
      });
      const attackerJwt = jwt.sign(
        {
          id: preCreated.id,
          username: "victim_engineer",
          email: "victim@utility.internal",
          tokenVersion: preCreated.token_version ?? 1,
        },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const oidcResult = await oidcService.handleOidcLogin(db, {
        sub: "okta-sub-999111",
        email: "victim@utility.internal",
        email_verified: true,
        name: "Victim Engineer",
      });

      assert.equal(oidcResult.user.id, preCreated.id);
      const updatedUser = db.getUserById(preCreated.id)!;
      assert.ok((updatedUser.token_version ?? 1) > (preCreated.token_version ?? 1));
      assert.equal(updatedUser.password_hash, "!oidc_sso_only");

      // Attacker's pre-issued JWT is now rejected because token_version was rotated
      setAuthDatabase(db);
      const app = createApp({ database: db });
      const attackerMeRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${attackerJwt}`);
      assert.equal(attackerMeRes.status, 401);
    } finally {
      cleanup();
    }
  });

  it("6. Blocks external cloud LLM endpoints in air-gapped mode while allowing local/intranet Ollama and vLLM", async () => {
    process.env["AIRGAP_ENFORCED"] = "true";
    process.env["OPENAI_API_KEY"] = "sk-accidental-cloud-key-in-env";
    delete process.env["AI_BASE_URL"];
    try {
      // Default provider in air-gapped mode without local AI_BASE_URL falls back to deterministic local provider
      const defaultProvider = createDefaultLLMProvider();
      assert.ok(defaultProvider instanceof DeterministicEngineeringProvider);

      // Direct invocation of OpenAICompatibleProvider against api.openai.com is blocked in air-gapped mode
      const cloudProvider = new OpenAICompatibleProvider("sk-test", "https://api.openai.com/v1", true);
      await assert.rejects(
        () => cloudProvider.complete([{ role: "user", content: "Synthesize model" }]),
        /Air-Gap Egress Blocked/,
      );

      // Configuring an intranet vLLM endpoint is permitted by createDefaultLLMProvider
      process.env["AI_BASE_URL"] = "http://vllm.utility.internal:8000/v1";
      const intranetProvider = createDefaultLLMProvider();
      assert.ok(intranetProvider instanceof OpenAICompatibleProvider);
    } finally {
      delete process.env["AIRGAP_ENFORCED"];
      delete process.env["OPENAI_API_KEY"];
      delete process.env["AI_BASE_URL"];
    }
  });
});

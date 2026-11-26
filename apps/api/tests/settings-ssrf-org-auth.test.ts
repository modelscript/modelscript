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
import { AnthropicProvider, OpenAICompatibleProvider } from "../src/services/ai/llm-client.js";
import { LibraryStorage } from "../src/storage.js";

test("Org Members Auth & Website URL Validation", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "org-auth-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      app.locals["jobQueue"]?.clear();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const owner = db.createUser("org_owner", "owner@example.com", "hash", { emailVerified: true });
  const member = db.createUser("org_member", "member@example.com", "hash", { emailVerified: true });
  const outsider = db.createUser("org_outsider", "outsider@example.com", "hash", { emailVerified: true });
  const admin = db.createUser("site_admin", "admin@example.com", "hash", {
    emailVerified: true,
    accountType: "admin",
  });

  const ownerToken = jwt.sign({ id: owner.id, username: owner.username }, JWT_SECRET);
  const memberToken = jwt.sign({ id: member.id, username: member.username }, JWT_SECRET);
  const outsiderToken = jwt.sign({ id: outsider.id, username: outsider.username }, JWT_SECRET);
  const adminToken = jwt.sign({ id: admin.id, username: admin.username, accountType: "admin" }, JWT_SECRET);

  // Create org and add contributor member
  await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ slug: "aero-corp", name: "Aero Corp" })
    .expect(201);

  await request(app)
    .post("/api/v1/organizations/aero-corp/members")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ username: "org_member", role: "contributor" })
    .expect(200);

  await t.test("GET /api/v1/organizations/:slug/members requires auth and org membership", async () => {
    // 1. Unauthenticated -> 401
    await request(app).get("/api/v1/organizations/aero-corp/members").expect(401);

    // 2. Authenticated non-member -> 403
    await request(app)
      .get("/api/v1/organizations/aero-corp/members")
      .set("Authorization", `Bearer ${outsiderToken}`)
      .expect(403);

    // 3. Authenticated org member (contributor) -> 200
    const memberRes = await request(app)
      .get("/api/v1/organizations/aero-corp/members")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);
    assert.equal(memberRes.body.members.length, 2);

    // 4. Authenticated org owner -> 200
    const ownerRes = await request(app)
      .get("/api/v1/organizations/aero-corp/members")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(ownerRes.body.members.length, 2);

    // 5. Instance admin (non-member) -> 200
    const adminRes = await request(app)
      .get("/api/v1/organizations/aero-corp/members")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(adminRes.body.members.length, 2);
  });

  await t.test("PATCH/PUT /api/v1/organizations/:slug rejects javascript: and data: website URLs", async () => {
    await request(app)
      .patch("/api/v1/organizations/aero-corp")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ website: "javascript:alert(1)" })
      .expect(400);

    await request(app)
      .put("/api/v1/organizations/aero-corp")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ website: "javascript:alert(1)" })
      .expect(400);

    await request(app)
      .patch("/api/v1/organizations/aero-corp")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ website: "data:text/html,<script>alert(1)</script>" })
      .expect(400);

    await request(app)
      .patch("/api/v1/organizations/aero-corp")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ avatar_url: "javascript:alert(2)" })
      .expect(400);

    await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ slug: "bad-avatar-org", name: "Bad Avatar Org", avatarUrl: "javascript:alert(3)" })
      .expect(400);

    // Legitimate https:// website succeeds
    const validRes = await request(app)
      .patch("/api/v1/organizations/aero-corp")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ website: "https://aero-corp.example.com" })
      .expect(200);
    assert.equal(validRes.body.organization.website, "https://aero-corp.example.com");
  });
});

test("LLM Providers SSRF & DNS-Rebinding Protection via safePublicFetch", async (t) => {
  await t.test("OpenAICompatibleProvider rejects cloud metadata and private IP endpoints", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should not reach", { status: 200 });
    }) as typeof fetch;

    try {
      const blockedUrls = [
        "http://169.254.169.254/latest/meta-data",
        "http://127.0.0.1:8080/v1",
        "http://localhost:11434/v1",
        "http://10.0.0.5/v1",
        "http://192.168.1.10/v1",
      ];

      for (const url of blockedUrls) {
        const provider = new OpenAICompatibleProvider("sk-test", url);
        await assert.rejects(
          () => provider.complete([{ role: "user", content: "hi" }]),
          /Forbidden|SSRF Blocked/i,
          `Expected complete() to reject ${url}`,
        );
        await assert.rejects(async () => {
          for await (const _chunk of provider.completeStream([{ role: "user", content: "hi" }])) {
            // should not yield
          }
        }, /Forbidden|SSRF Blocked/i);
      }

      assert.equal(fetchCalled, false, "Underlying fetch must never be called for blocked URLs");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("OpenAICompatibleProvider blocks DNS-rebinding to private/metadata IPs", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should not reach", { status: 200 });
    }) as typeof fetch;

    try {
      const rebindToMetadata = async () => [{ address: "169.254.169.254", family: 4 }];
      const providerMeta = new OpenAICompatibleProvider(
        "sk-test",
        "https://rebind.attacker.example/v1",
        false,
        rebindToMetadata,
      );
      await assert.rejects(
        () => providerMeta.complete([{ role: "user", content: "hi" }]),
        /SSRF Blocked.*169\.254\.169\.254/,
      );

      const rebindToLoopback = async () => [{ address: "127.0.0.1", family: 4 }];
      const providerLoopback = new OpenAICompatibleProvider(
        "sk-test",
        "https://rebind.attacker.example/v1",
        false,
        rebindToLoopback,
      );
      await assert.rejects(
        () => providerLoopback.complete([{ role: "user", content: "hi" }]),
        /SSRF Blocked.*127\.0\.0\.1/,
      );

      const rebindToRfc1918 = async () => [{ address: "10.20.30.40", family: 4 }];
      const providerPrivate = new OpenAICompatibleProvider(
        "sk-test",
        "https://rebind.attacker.example/v1",
        false,
        rebindToRfc1918,
      );
      await assert.rejects(
        () => providerPrivate.complete([{ role: "user", content: "hi" }]),
        /SSRF Blocked.*10\.20\.30\.40/,
      );

      assert.equal(fetchCalled, false, "Underlying fetch must never be called when DNS resolves to private IP");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("OpenAICompatibleProvider blocks redirects to internal/metadata IPs", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" },
      });
    }) as typeof fetch;

    try {
      const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
      const provider = new OpenAICompatibleProvider(
        "sk-test",
        "https://public-bot.example.com/v1",
        false,
        publicResolver,
      );
      await assert.rejects(() => provider.complete([{ role: "user", content: "hi" }]), /Forbidden|SSRF Blocked/i);
      assert.equal(calls, 1, "Should stop before following redirect to metadata IP");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("AnthropicProvider blocks private/metadata URLs and DNS rebinding", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should not reach", { status: 200 });
    }) as typeof fetch;

    try {
      const providerLiteral = new AnthropicProvider("sk-ant-test", "http://169.254.169.254/latest/meta-data");
      await assert.rejects(
        () => providerLiteral.complete([{ role: "user", content: "hi" }]),
        /Forbidden|SSRF Blocked/i,
      );

      const rebindResolver = async () => [{ address: "169.254.169.254", family: 4 }];
      const providerRebind = new AnthropicProvider("sk-ant-test", "https://rebind.attacker.example/v1", rebindResolver);
      await assert.rejects(
        () => providerRebind.complete([{ role: "user", content: "hi" }]),
        /SSRF Blocked.*169\.254\.169\.254/,
      );

      assert.equal(fetchCalled, false, "Underlying fetch must never be called for blocked Anthropic endpoints");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

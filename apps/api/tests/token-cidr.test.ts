// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["TRUST_PROXY"] = "true";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { isIpInAllowlist, isValidIpOrCidr } from "../src/util/cidr-matcher.js";

test("Granular Scoped API Tokens: IP/CIDR Restrictions & Namespace RBAC", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-cidr-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Unit: isValidIpOrCidr validates IPs, CIDR subnets, and wildcards", () => {
    assert.strictEqual(isValidIpOrCidr("192.168.1.1"), true);
    assert.strictEqual(isValidIpOrCidr("10.0.0.0/8"), true);
    assert.strictEqual(isValidIpOrCidr("172.16.0.0/12"), true);
    assert.strictEqual(isValidIpOrCidr("192.168.1.*"), true);
    assert.strictEqual(isValidIpOrCidr("::1"), true);
    assert.strictEqual(isValidIpOrCidr("*"), true);

    // Invalid inputs
    assert.strictEqual(isValidIpOrCidr("10.0.0.0/99"), false);
    assert.strictEqual(isValidIpOrCidr("not-an-ip"), false);
    assert.strictEqual(isValidIpOrCidr("256.256.256.256"), false);
  });

  await t.test("Unit: isIpInAllowlist accurately filters allowed subnets and blocks foreign IPs", () => {
    const allowlist = "10.0.0.0/8, 192.168.1.0/24, 127.0.0.1";

    assert.strictEqual(isIpInAllowlist("10.5.22.100", allowlist), true);
    assert.strictEqual(isIpInAllowlist("192.168.1.55", allowlist), true);
    assert.strictEqual(isIpInAllowlist("127.0.0.1", allowlist), true);
    assert.strictEqual(isIpInAllowlist("::ffff:127.0.0.1", allowlist), true);

    // Foreign IPs
    assert.strictEqual(isIpInAllowlist("172.16.0.5", allowlist), false);
    assert.strictEqual(isIpInAllowlist("192.168.2.1", allowlist), false);
    assert.strictEqual(isIpInAllowlist("8.8.8.8", allowlist), false);
  });

  // Seed user and session JWT
  const user = db.createUser("cidr_user", "cidr@modelscript.test", "hashed_pwd", { emailVerified: true });
  const sessionToken = jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  let restrictedPat = "";

  await t.test("POST /api/v1/auth/tokens validates and stores CIDR IP allowlist", async () => {
    // 1. Rejects invalid CIDR
    const badRes = await request(app)
      .post("/api/v1/auth/tokens")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        name: "bad-token",
        scopes: ["packages:publish"],
        cidr: "invalid/mask/99",
      });
    assert.strictEqual(badRes.status, 400);
    assert.ok(badRes.body.error?.includes("Invalid IP address or CIDR mask"));

    // 2. Creates token with corporate CIDR: 10.0.0.0/8
    const res = await request(app)
      .post("/api/v1/auth/tokens")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        name: "corporate-ci-token",
        scopes: ["packages:publish", "packages:read"],
        packagePattern: "@acme/*",
        cidr: "10.0.0.0/8",
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token.startsWith("ms_pat_"));
    assert.strictEqual(res.body.ipAllowlist, "10.0.0.0/8");

    restrictedPat = res.body.token;
  });

  await t.test("PAT authentication succeeds when client IP satisfies CIDR allowlist", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${restrictedPat}`)
      .set("X-Forwarded-For", "10.1.2.3");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.username, "cidr_user");
  });

  await t.test("PAT authentication is rejected with 403 when client IP violates CIDR allowlist", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${restrictedPat}`)
      .set("X-Forwarded-For", "192.168.1.99");

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error?.includes("not permitted by API token IP allowlist"));
  });
});

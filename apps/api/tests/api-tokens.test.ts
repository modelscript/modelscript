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

test("Granular Scoped API Tokens (PAT) Authentication & Policy", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-tokens-test-"));
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

  // Seed user & session JWT
  const user = db.createUser("pat_tester", "pat@modelscript.test", "hash_pw", "PAT Tester");
  assert.ok(user);
  const sessionToken = jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  let createdPat = "";
  let createdPatId = 0;

  await t.test("POST /api/v1/auth/tokens creates a new personal access token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/tokens")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        name: "ci-publishing-token",
        scopes: ["packages:publish", "packages:read"],
        packagePattern: "@pat_tester/*",
        expiresInDays: 30,
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token.startsWith("ms_pat_"), "Token should start with ms_pat_");
    assert.strictEqual(res.body.name, "ci-publishing-token");
    assert.deepStrictEqual(res.body.scopes, ["packages:publish", "packages:read"]);
    assert.strictEqual(res.body.packagePattern, "@pat_tester/*");
    assert.ok(res.body.expiresAt);
    assert.ok(res.body.id);

    createdPat = res.body.token;
    createdPatId = res.body.id;
  });

  await t.test("GET /api/v1/auth/tokens lists active tokens without exposing secret", async () => {
    const res = await request(app).get("/api/v1/auth/tokens").set("Authorization", `Bearer ${sessionToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.tokens));
    assert.strictEqual(res.body.tokens.length, 1);
    assert.strictEqual(res.body.tokens[0].id, createdPatId);
    assert.strictEqual(res.body.tokens[0].name, "ci-publishing-token");
    assert.strictEqual(res.body.tokens[0].token_hash, undefined);
    assert.deepStrictEqual(res.body.tokens[0].scopes, ["packages:publish", "packages:read"]);
  });

  await t.test("GET /api/v1/auth/me authenticates successfully using ms_pat_ token", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${createdPat}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.username, "pat_tester");
    assert.strictEqual(res.body.user.id, user.id);
  });

  await t.test("Rejection with expired or invalid ms_pat_ token", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer ms_pat_invaliddeadbeef000000000000000000000000");

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "Invalid API token");
  });

  await t.test("DELETE /api/v1/auth/tokens/:id revokes the token", async () => {
    const res = await request(app)
      .delete(`/api/v1/auth/tokens/${createdPatId}`)
      .set("Authorization", `Bearer ${sessionToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    // After revocation, token should no longer work
    const authRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${createdPat}`);

    assert.strictEqual(authRes.status, 401);
  });
});

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
import { OidcService } from "../src/services/oidc.js";
import { LibraryStorage } from "../src/storage.js";

test("Enterprise OIDC / SSO Authentication & RBAC Group Mapping", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oidc-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const oidc = new OidcService({
    issuerUrl: "https://login.microsoftonline.com/tenant/v2.0",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    adminGroup: "Engineering-Admins",
  });

  await t.test("extractClaims extracts identity and corporate group claims", () => {
    const mockIdToken = jwt.sign(
      {
        sub: "oidc-sub-123",
        email: "alice@corporate.aerospace.com",
        name: "Alice Engineer",
        preferred_username: "alice_eng",
        groups: ["Flight-Dynamics", "Engineering-Admins"],
      },
      "dummy-secret",
    );

    const claims = oidc.extractClaims(mockIdToken);
    assert.strictEqual(claims.sub, "oidc-sub-123");
    assert.strictEqual(claims.email, "alice@corporate.aerospace.com");
    assert.strictEqual(claims.preferred_username, "alice_eng");
    assert.ok(claims.groups?.includes("Engineering-Admins"));
  });

  await t.test("handleOidcLogin provisions admin account when user belongs to adminGroup", async () => {
    const claims = {
      sub: "azure-sub-456",
      email: "director@corporate.aerospace.com",
      preferred_username: "director",
      groups: ["Engineering-Admins", "Staff"],
    };

    const result = await oidc.handleOidcLogin(db, claims);
    assert.strictEqual(result.isNewUser, true);
    assert.strictEqual(result.user.account_type, "admin");

    const decoded = jwt.decode(result.token) as any;
    assert.strictEqual(decoded.accountType, "admin");
  });

  await t.test("handleOidcLogin provisions standard user account when user is not in adminGroup", async () => {
    const claims = {
      sub: "azure-sub-789",
      email: "bob@corporate.aerospace.com",
      preferred_username: "bob_cad",
      groups: ["CAD-Designers", "General-Staff"],
    };

    const result = await oidc.handleOidcLogin(db, claims);
    assert.strictEqual(result.isNewUser, true);
    assert.strictEqual(result.user.account_type, "user");

    const decoded = jwt.decode(result.token) as any;
    assert.strictEqual(decoded.accountType, "user");
  });

  await t.test("GET /api/v1/auth/oidc/config returns provider status", async () => {
    const res = await request(app).get("/api/v1/auth/oidc/config").expect(200);
    assert.strictEqual(typeof res.body.enabled, "boolean");
    assert.strictEqual(res.body.adminGroup, "Engineering-Admins");
  });

  await t.test("POST /api/v1/auth/oidc/token logs in and returns session token", async () => {
    const mockIdToken = jwt.sign(
      {
        sub: "direct-oidc-999",
        email: "charlie@corporate.aerospace.com",
        preferred_username: "charlie",
        groups: ["Thermal-FEA"],
      },
      "dummy-secret",
    );

    const res = await request(app).post("/api/v1/auth/oidc/token").send({ idToken: mockIdToken }).expect(200);

    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.email, "charlie@corporate.aerospace.com");
    assert.strictEqual(res.body.user.account_type, "user");
  });

  await t.test("handleOidcLogin provisions username from email prefix when preferred_username is absent", async () => {
    const claims = {
      sub: "azure-sub-fallback-1",
      email: "dan_fe@corporate.aerospace.com",
    };

    const result = await oidc.handleOidcLogin(db, claims);
    assert.strictEqual(result.isNewUser, true);
    assert.strictEqual(result.user.username, "dan_fe");
  });

  await t.test("handleOidcLogin throws error when both preferred_username and email prefix are empty", async () => {
    const claims = {
      sub: "azure-sub-fallback-2",
      email: "@corporate.aerospace.com",
    };

    await assert.rejects(
      async () => oidc.handleOidcLogin(db, claims),
      /Unable to provision OIDC user: missing preferred_username and email prefix/,
    );
  });
});

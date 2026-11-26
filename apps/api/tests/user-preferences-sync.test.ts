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

test("User UI Preferences Sync API: Cross-Device Persistence & GDPR Erasure", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-preferences-sync-test-"));
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

  const user = db.createUser("prefsync", "prefsync@modelscript.test", "hashed_pwd", { emailVerified: true });
  const userToken = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET);

  await t.test("GET /api/v1/auth/preferences requires authentication (401)", async () => {
    const res = await request(app).get("/api/v1/auth/preferences");
    assert.strictEqual(res.status, 401);
  });

  await t.test("GET /api/v1/auth/preferences returns { preferences: {} } initially", async () => {
    const res = await request(app).get("/api/v1/auth/preferences").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { preferences: {} });
  });

  await t.test(
    "PUT /api/v1/auth/preferences rejects non-object, unknown top-level keys, and oversized payloads",
    async () => {
      // Non-object (array)
      const arrayRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send(["theme"]);
      assert.strictEqual(arrayRes.status, 400);

      // Unknown top-level key
      const unknownKeyRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ theme: "dark", maliciousKey: true });
      assert.strictEqual(unknownKeyRes.status, 400);

      // Oversized payload (> 16 KB)
      const oversizedRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ display: { blob: "x".repeat(17 * 1024) } });
      assert.strictEqual(oversizedRes.status, 400);
    },
  );

  await t.test(
    "PUT /api/v1/auth/preferences persists modeling, display, and theme across requests and merges partial updates",
    async () => {
      // 1. Save modeling preferences
      const modelingRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          modeling: {
            fontSize: 16,
            tabSize: 4,
            defaultSolver: "ida",
            flattenerBackend: "wasm",
          },
        });
      assert.strictEqual(modelingRes.status, 200);
      assert.strictEqual(modelingRes.body.success, true);
      assert.deepStrictEqual(modelingRes.body.preferences, {
        modeling: {
          fontSize: 16,
          tabSize: 4,
          defaultSolver: "ida",
          flattenerBackend: "wasm",
        },
      });

      // 2. Save display preferences in a separate request (modeling must be preserved)
      const displayRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          display: {
            compactMode: true,
            fontScale: 1.1,
          },
        });
      assert.strictEqual(displayRes.status, 200);
      assert.strictEqual(displayRes.body.preferences.modeling.fontSize, 16);
      assert.deepStrictEqual(displayRes.body.preferences.display, {
        compactMode: true,
        fontScale: 1.1,
      });

      // 3. Save theme and partially update display (existing display keys preserved)
      const themeRes = await request(app)
        .put("/api/v1/auth/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          theme: "dark_dimmed",
          display: {
            compactMode: false,
          },
        });
      assert.strictEqual(themeRes.status, 200);

      // 4. Verify GET returns all merged namespaces
      const getRes = await request(app).get("/api/v1/auth/preferences").set("Authorization", `Bearer ${userToken}`);
      assert.strictEqual(getRes.status, 200);
      assert.deepStrictEqual(getRes.body, {
        preferences: {
          modeling: {
            fontSize: 16,
            tabSize: 4,
            defaultSolver: "ida",
            flattenerBackend: "wasm",
          },
          display: {
            compactMode: false,
            fontScale: 1.1,
          },
          theme: "dark_dimmed",
        },
      });
    },
  );

  await t.test("anonymizeUser(userId) deletes user_ui_preferences row", () => {
    const beforeRow = db.db.prepare(`SELECT * FROM user_ui_preferences WHERE user_id = ?`).get(user.id);
    assert.ok(beforeRow, "Expected user_ui_preferences row to exist before anonymization");

    const anonResult = db.anonymizeUser(user.id);
    assert.strictEqual(anonResult.success, true);

    const afterRow = db.db.prepare(`SELECT * FROM user_ui_preferences WHERE user_id = ?`).get(user.id);
    assert.strictEqual(afterRow, undefined, "Expected user_ui_preferences row to be deleted on GDPR erasure");
    assert.deepStrictEqual(db.userLifecycle.getUserUiPreferences(user.id), {});
  });
});

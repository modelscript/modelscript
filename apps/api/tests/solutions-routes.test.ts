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

test("Engineering Solutions Platform & Multi-Target Publishing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solutions-test-"));
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

  const user = db.createUser("solutions_author", "author@modelscript.test", "hash_pw", "Solutions Author");
  assert.ok(user);
  const sessionToken = jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: user.account_type },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("POST /api/v1/solutions/publish creates a new solution and release", async () => {
    const res = await request(app)
      .post("/api/v1/solutions/publish")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        slug: "simulink-linter",
        name: "Simulink Pre-Flight Linter",
        description: "Static analyzer for Simulink models",
        category: "Control Systems",
        icon: "cpu",
        supported_formats: [".slx", ".mdl"],
        version: "1.0.0",
        changelog: "Initial release",
        bundle_url: "https://cdn.modelscript.org/solutions/simulink-linter/index.html",
        tauri_windows_url: "https://github.com/org/repo/releases/download/v1.0.0/linter.exe",
        tauri_linux_url: "https://github.com/org/repo/releases/download/v1.0.0/linter.AppImage",
        tauri_darwin_url: "https://github.com/org/repo/releases/download/v1.0.0/linter.dmg",
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.url, "/solutions/solutions_author/simulink-linter");
  });

  await t.test("GET /api/v1/solutions/:author/:slug returns full solution and release metadata", async () => {
    const res = await request(app).get("/api/v1/solutions/solutions_author/simulink-linter");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.solution.name, "Simulink Pre-Flight Linter");
    assert.deepStrictEqual(res.body.solution.supported_formats, [".slx", ".mdl"]);
    assert.strictEqual(res.body.release.version, "1.0.0");
    assert.strictEqual(
      res.body.release.tauri_windows_url,
      "https://github.com/org/repo/releases/download/v1.0.0/linter.exe",
    );
  });

  await t.test("GET /api/v1/users/:username/solutions lists solutions for user profile", async () => {
    const res = await request(app).get("/api/v1/users/solutions_author/solutions");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(Array.isArray(res.body.solutions), true);
    assert.strictEqual(res.body.solutions.length, 1);
    assert.strictEqual(res.body.solutions[0].slug, "simulink-linter");
    assert.strictEqual(res.body.solutions[0].latest_version, "1.0.0");
  });

  await t.test("GET /api/v1/solutions lists public solutions", async () => {
    const res = await request(app).get("/api/v1/solutions");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Array.isArray(res.body.solutions), true);
    assert.ok(res.body.solutions.length >= 1);
  });
});

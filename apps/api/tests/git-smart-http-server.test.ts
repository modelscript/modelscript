// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";

test("Native Embedded Git Smart HTTP Server", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-server-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  const reposDir = path.join(tmpDir, "git-repos");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(reposDir, { recursive: true });

  process.env["GIT_REPOS_DIR"] = reposDir;

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const alicePassword = "SecretPassword123!";
  const passwordHash = bcrypt.hashSync(alicePassword, 10);
  const alice = db.createUser("alice", "alice@example.com", passwordHash, { emailVerified: true });

  const basicAuthHeader = "Basic " + Buffer.from(`alice:${alicePassword}`).toString("base64");
  const badAuthHeader = "Basic " + Buffer.from("alice:wrongpassword").toString("base64");

  await t.test("Rejects dumb HTTP requests missing ?service= parameter", async () => {
    await request(app).get("/git/alice/chassis.git/info/refs").expect(400);
  });

  await t.test("git-receive-pack reference discovery requires authentication", async () => {
    // Unauthenticated
    const res = await request(app).get("/git/alice/chassis.git/info/refs?service=git-receive-pack").expect(401);

    assert.ok(res.headers["www-authenticate"]);
    assert.ok(res.headers["www-authenticate"].includes("Basic"));

    // Invalid credentials
    await request(app)
      .get("/git/alice/chassis.git/info/refs?service=git-receive-pack")
      .set("Authorization", badAuthHeader)
      .expect(401);
  });

  await t.test("Authenticated user can discover refs and initializes bare repo on push discovery", async () => {
    const res = await request(app)
      .get("/git/alice/chassis.git/info/refs?service=git-receive-pack")
      .set("Authorization", basicAuthHeader)
      .expect(200);

    assert.strictEqual(res.headers["content-type"], "application/x-git-receive-pack-advertisement");

    // The output starts with the packet-line # service=git-receive-pack\n followed by flush 0000
    const text = res.text;
    assert.ok(text.includes("# service=git-receive-pack"));
    assert.ok(text.includes("0000"));

    // Verify bare repo was created on disk
    const expectedRepoPath = path.join(reposDir, "alice", "chassis.git");
    assert.ok(fs.existsSync(expectedRepoPath));

    const isBare = execFileSync("git", ["-C", expectedRepoPath, "rev-parse", "--is-bare-repository"]).toString().trim();
    assert.strictEqual(isBare, "true");
  });

  await t.test("git-upload-pack reference discovery works for initialized repo", async () => {
    const res = await request(app).get("/git/alice/chassis.git/info/refs?service=git-upload-pack").expect(200);

    assert.strictEqual(res.headers["content-type"], "application/x-git-upload-pack-advertisement");
    assert.ok(res.text.includes("# service=git-upload-pack"));
    assert.ok(res.text.includes("0000"));
  });

  await t.test("Non-existent repository returns 404 for git-upload-pack", async () => {
    await request(app).get("/git/alice/nonexistent.git/info/refs?service=git-upload-pack").expect(404);
  });

  await t.test("Directory traversal attempts are rejected", async () => {
    await request(app).get("/git/invalid..traversal/shadow.git/info/refs?service=git-upload-pack").expect(400);
  });
});

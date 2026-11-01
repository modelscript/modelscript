// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import assert from "node:assert";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import request from "supertest";

const execFileAsync = promisify(execFile);

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import {
  cleanupExpiredActivityRepos,
  ensureUserActivityRepo,
  getUserActivityRepoDir,
} from "../src/services/activity-git.js";
import { LibraryStorage } from "../src/storage.js";

test("Owner-Authenticated Virtual Activity Git Repository (activity.git)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "activity-git-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  const reposDir = path.join(tmpDir, "git-repos");
  const clonesDir = path.join(tmpDir, "clones");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(reposDir, { recursive: true });
  fs.mkdirSync(clonesDir, { recursive: true });

  process.env["GIT_REPOS_DIR"] = reposDir;

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });
  const server = http.createServer(app);

  t.after(async () => {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  const password = "SecretPassword123!";
  const passwordHash = bcrypt.hashSync(password, 10);
  const alice = db.createUser("alice", "alice@example.com", passwordHash, { emailVerified: true });
  db.createUser("bob", "bob@example.com", passwordHash, { emailVerified: true, accountType: "admin" });

  const aliceBasicAuth = "Basic " + Buffer.from(`alice:${password}`).toString("base64");
  const bobBasicAuth = "Basic " + Buffer.from(`bob:${password}`).toString("base64");
  const aliceJwt = jwt.sign({ id: alice.id, username: alice.username, tokenVersion: 1 }, JWT_SECRET);
  const bobJwt = jwt.sign({ id: 2, username: "bob", tokenVersion: 1 }, JWT_SECRET);

  const post1 = db.createPost(alice.id, "First engineering simulation note: SECRET_LEGACY_TEXT_101");
  const post2 = db.createPost(alice.id, "Second Modelica thermal analysis update");
  const studyJobId = db.createJob(
    "ChuaCircuitSweep",
    "completed",
    "simulation",
    null,
    null,
    {
      modelCode: "model ChuaCircuitSweep Real x; equation der(x) = -x; end ChuaCircuitSweep;",
      standardFormat: "modelica",
    },
    alice.id,
  );

  await t.test("Unauthenticated requests to activity.git are rejected with 401", async () => {
    const res = await request(app).get("/git/alice/activity.git/info/refs?service=git-upload-pack").expect(401);

    assert.ok(res.headers["www-authenticate"]?.includes("Basic"));

    await request(app).post("/git/alice/activity.git/git-upload-pack").expect(401);
  });

  await t.test("Cross-user access (even by admin) to another user's activity.git is rejected with 403", async () => {
    await request(app)
      .get("/git/alice/activity.git/info/refs?service=git-upload-pack")
      .set("Authorization", bobBasicAuth)
      .expect(403);

    await request(app).post("/git/alice/activity.git/git-upload-pack").set("Authorization", bobBasicAuth).expect(403);
  });

  let aliceNarrowPat = "";

  await t.test(
    "PAT scope enforcement: narrow PAT (packages:read) is rejected with 403, while repos:read PAT is accepted",
    async () => {
      const narrowPatRes = await request(app)
        .post("/api/v1/auth/tokens")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .send({ name: "Packages Only Token", scopes: ["packages:read"] })
        .expect(201);
      aliceNarrowPat = narrowPatRes.body.token;
      const narrowBasic = "Basic " + Buffer.from(`alice:${aliceNarrowPat}`).toString("base64");

      await request(app)
        .get("/git/alice/activity.git/info/refs?service=git-upload-pack")
        .set("Authorization", narrowBasic)
        .expect(403);

      const validPatRes = await request(app)
        .post("/api/v1/auth/tokens")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .send({ name: "Activity Git Token", scopes: ["repos:read"] })
        .expect(201);
      const validBasic = "Basic " + Buffer.from(`alice:${validPatRes.body.token}`).toString("base64");

      await request(app)
        .get("/git/alice/activity.git/info/refs?service=git-upload-pack")
        .set("Authorization", validBasic)
        .expect(200);
    },
  );

  await t.test("Reserved repository name 'activity' cannot be created via POST /api/v1/repos", async () => {
    const res = await request(app)
      .post("/api/v1/repos")
      .set("Authorization", `Bearer ${aliceJwt}`)
      .send({
        provider: "local",
        external_repo_id: "alice/activity",
        repo_full_name: "alice/activity",
      })
      .expect(400);
    assert.ok(
      String(res.body.error || "")
        .toLowerCase()
        .includes("reserved"),
    );
  });

  await t.test("git-receive-pack (push) to activity.git is rejected with 403 as read-only", async () => {
    await request(app)
      .get("/git/alice/activity.git/info/refs?service=git-receive-pack")
      .set("Authorization", aliceBasicAuth)
      .expect(403);

    await request(app)
      .post("/git/alice/activity.git/git-receive-pack")
      .set("Authorization", aliceBasicAuth)
      .expect(403);
  });

  const aliceCloneDir = path.join(clonesDir, "alice-activity");

  await t.test(
    "Owner can git clone /git/alice/activity.git and inspect files, TIMELINE.md, scripts/, and accurate chronological commits",
    async () => {
      const cloneUrl = `http://alice:${encodeURIComponent(password)}@127.0.0.1:${port}/git/alice/activity.git`;
      await execFileAsync("git", ["clone", cloneUrl, aliceCloneDir]);

      assert.ok(fs.existsSync(path.join(aliceCloneDir, "README.md")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "TIMELINE.md")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "index.html")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "data", "profile.json")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "data", "posts.json")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "data", "compliance.json")));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "posts", `post-${post1.id}.md`)));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "posts", `post-${post2.id}.md`)));
      assert.ok(fs.existsSync(path.join(aliceCloneDir, "scripts", `study-${studyJobId}-chuacircuitsweep.mo`)));

      const timelineMd = fs.readFileSync(path.join(aliceCloneDir, "TIMELINE.md"), "utf-8");
      assert.ok(timelineMd.includes(`Post #${post1.id}`));
      assert.ok(timelineMd.includes("ChuaCircuitSweep"));

      const post1Md = fs.readFileSync(path.join(aliceCloneDir, "posts", `post-${post1.id}.md`), "utf-8");
      assert.ok(post1Md.includes("SECRET_LEGACY_TEXT_101"));

      const logOutput = execFileSync("git", ["-C", aliceCloneDir, "log", "--oneline"], { encoding: "utf-8" });
      assert.ok(logOutput.includes(`Post #${post1.id}`));
      assert.ok(logOutput.includes(`Post #${post2.id}`));

      // Verify Commit 1 (initial commit) does NOT leak future posts in data/posts.json before their chronological commit
      const rootCommitSha = execFileSync("git", ["-C", aliceCloneDir, "rev-list", "--max-parents=0", "HEAD"], {
        encoding: "utf-8",
      }).trim();
      const rootTreeFiles = execFileSync("git", ["-C", aliceCloneDir, "ls-tree", "-r", "--name-only", rootCommitSha], {
        encoding: "utf-8",
      });
      assert.strictEqual(rootTreeFiles.includes("data/posts.json"), false);
    },
  );

  await t.test(
    "Owner can inspect status via GET /api/v1/users/me/activity-repo and browse via /api/v1/git/projects/alice%2Factivity",
    async () => {
      const statusRes = await request(app)
        .get("/api/v1/users/me/activity-repo")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);

      assert.strictEqual(statusRes.body.cached, true);
      assert.strictEqual(statusRes.body.postCount, 2);
      assert.strictEqual(statusRes.body.studyCount, 1);
      assert.ok(statusRes.body.commitCount >= 4);

      // Web Repository Browser & IDE API endpoints:
      await request(app).get("/api/v1/git/projects/alice%2Factivity").expect(401);

      await request(app)
        .get("/api/v1/git/projects/alice%2Factivity")
        .set("Authorization", `Bearer ${bobJwt}`)
        .expect(403);

      const projRes = await request(app)
        .get("/api/v1/git/projects/alice%2Factivity")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);
      assert.strictEqual(projRes.body.path_with_namespace, "alice/activity");
      assert.strictEqual(projRes.body.visibility, "private");

      const treeRes = await request(app)
        .get("/api/v1/git/projects/alice%2Factivity/repository/tree?recursive=true")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);
      assert.ok(Array.isArray(treeRes.body));
      assert.ok(treeRes.body.some((item: { path: string }) => item.path === "TIMELINE.md"));
      assert.ok(treeRes.body.some((item: { path: string }) => item.path === `posts/post-${post1.id}.md`));

      const rawFileRes = await request(app)
        .get("/api/v1/git/projects/alice%2Factivity/repository/files/TIMELINE.md/raw")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);
      assert.ok(rawFileRes.text.includes("Activity Timeline"));

      const commitsRes = await request(app)
        .get("/api/v1/git/projects/alice%2Factivity/repository/commits")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);
      assert.ok(Array.isArray(commitsRes.body) && commitsRes.body.length >= 4);

      // Narrow PAT without repos:read or account:read is rejected on Web Repo Browser API too
      await request(app)
        .get("/api/v1/git/projects/alice%2Factivity")
        .set("Authorization", `Bearer ${aliceNarrowPat}`)
        .expect(403);

      // VS Code Web IDE github-fs proxy endpoints (/api/github/repos/alice/activity/...)
      await request(app).get("/api/github/repos/alice/activity/git/trees/main?recursive=1").expect(401);

      await request(app)
        .get("/api/github/repos/alice/activity/git/trees/main?recursive=1")
        .set("Authorization", `Bearer ${bobJwt}`)
        .expect(403);

      await request(app)
        .get("/api/github/repos/alice/activity/git/trees/main?recursive=1")
        .set("Authorization", `Bearer ${aliceNarrowPat}`)
        .expect(403);

      const ideTreeRes = await request(app)
        .get("/api/github/repos/alice/activity/git/trees/main?recursive=1")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);
      assert.strictEqual(ideTreeRes.body.truncated, false);
      assert.ok(Array.isArray(ideTreeRes.body.tree));
      assert.ok(ideTreeRes.body.tree.some((item: { path: string }) => item.path === "TIMELINE.md"));

      const ideContentRes = await request(app)
        .get("/api/github/repos/alice/activity/contents/TIMELINE.md?ref=main")
        .set("Cookie", `modelscript_token=${encodeURIComponent(aliceJwt)}`)
        .expect(200);
      assert.strictEqual(ideContentRes.body.encoding, "base64");
      const decodedTimeline = Buffer.from(ideContentRes.body.content, "base64").toString("utf-8");
      assert.ok(decodedTimeline.includes("Activity Timeline"));
    },
  );

  await t.test("Owner can also access /git/me/activity.git alias and unchanged state is a 0ms cache hit", async () => {
    const res = await request(app)
      .get("/git/me/activity.git/info/refs?service=git-upload-pack")
      .set("Authorization", aliceBasicAuth)
      .expect(200);

    assert.ok(res.text.includes("# service=git-upload-pack"));

    const ensured = ensureUserActivityRepo(db, alice.id, reposDir);
    assert.strictEqual(ensured.mode, "hit");
  });

  await t.test(
    "Warm incremental changes (add post + delete post) append a forward commit so git pull fast-forwards",
    async () => {
      const post3 = db.createPost(alice.id, "Third post added incrementally");
      const delRes = db.deletePost(post1.id);
      assert.strictEqual(delRes.success, true);

      // Pull inside the existing clone
      await execFileAsync("git", ["-C", aliceCloneDir, "pull", "--ff-only"]);

      // Deleted post file is removed from working tree, new post file is present
      assert.strictEqual(fs.existsSync(path.join(aliceCloneDir, "posts", `post-${post1.id}.md`)), false);
      assert.strictEqual(fs.existsSync(path.join(aliceCloneDir, "posts", `post-${post3.id}.md`)), true);
      assert.strictEqual(fs.existsSync(path.join(aliceCloneDir, "posts", `post-${post2.id}.md`)), true);

      const logOutput = execFileSync("git", ["-C", aliceCloneDir, "log", "-n", "1", "--oneline"], {
        encoding: "utf-8",
      });
      assert.ok(logOutput.includes("Sync activity (+1 post(s), -1 deleted)"));
    },
  );

  await t.test(
    "Manual cache purge (DELETE /api/v1/users/me/activity-repo) and TTL expiry erase deleted blobs from server packfiles",
    async () => {
      const repoPath = getUserActivityRepoDir(alice.id, reposDir, db);
      assert.ok(fs.existsSync(repoPath));

      await request(app)
        .delete("/api/v1/users/me/activity-repo")
        .set("Authorization", `Bearer ${aliceJwt}`)
        .expect(200);

      assert.strictEqual(fs.existsSync(repoPath), false);

      // Fresh clone after purge should have zero trace of deleted post1's content anywhere in git history
      const freshCloneDir = path.join(clonesDir, "alice-fresh");
      const cloneUrl = `http://alice:${encodeURIComponent(password)}@127.0.0.1:${port}/git/alice/activity.git`;
      await execFileAsync("git", ["clone", cloneUrl, freshCloneDir]);

      const pickaxeSearch = execFileSync(
        "git",
        ["-C", freshCloneDir, "log", "--all", "-S", "SECRET_LEGACY_TEXT_101", "--oneline"],
        { encoding: "utf-8" },
      ).trim();
      assert.strictEqual(pickaxeSearch, "");

      // Verify TTL cleanup helper removes expired activity caches
      const cleanupRes = cleanupExpiredActivityRepos(reposDir, -1, db);
      assert.strictEqual(cleanupRes.removedCount, 1);
      assert.strictEqual(fs.existsSync(repoPath), false);
    },
  );

  await t.test(
    "GDPR Art. 17 account deletion (DELETE /api/v1/users/me) immediately wipes activity.git from disk",
    async () => {
      // Re-materialize cache
      const ensured = ensureUserActivityRepo(db, alice.id, reposDir);
      assert.ok(fs.existsSync(ensured.repoPath));

      await request(app).delete("/api/v1/users/me").set("Authorization", `Bearer ${aliceJwt}`).expect(200);

      assert.strictEqual(fs.existsSync(ensured.repoPath), false);
    },
  );
});

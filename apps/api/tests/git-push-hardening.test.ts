// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import assert from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";
import { GitBodyLimitError, ReceivePackGate, createByteLimiter } from "../src/util/git-hardening.js";

const CLEAN_ENV = { PATH: process.env["PATH"] || "/usr/bin:/bin", HOME: os.tmpdir(), GIT_TERMINAL_PROMPT: "0" };

/** Async on purpose: the HTTP server runs in this process, so a blocking spawn would deadlock pushes. */
function git(cwd: string, args: string[]): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, env: CLEAN_ENV });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    proc.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
}

test("git-hardening primitives", async (t) => {
  await t.test("byte limiter passes data under the cap and errors over it", async () => {
    const ok = createByteLimiter(10);
    const chunks: Buffer[] = [];
    ok.on("data", (c) => chunks.push(c));
    ok.write(Buffer.alloc(10));
    ok.end();
    await new Promise((r) => ok.on("end", r));
    assert.strictEqual(Buffer.concat(chunks).length, 10);

    const bad = createByteLimiter(10);
    const err = await new Promise<Error>((resolve) => {
      bad.on("error", resolve);
      bad.resume();
      bad.write(Buffer.alloc(11));
    });
    assert.ok(err instanceof GitBodyLimitError);
  });

  await t.test("gate enforces per-key and global limits and releases idempotently", () => {
    const gate = new ReceivePackGate(() => 2);
    const a = gate.tryAcquire("repoA");
    assert.ok("release" in a);
    assert.deepStrictEqual(gate.tryAcquire("repoA"), { reason: "busy-repo" });
    const b = gate.tryAcquire("repoB");
    assert.ok("release" in b);
    assert.deepStrictEqual(gate.tryAcquire("repoC"), { reason: "busy-global" });
    if ("release" in a) {
      a.release();
      a.release();
    }
    assert.strictEqual(gate.activeCount, 1);
    assert.ok("release" in gate.tryAcquire("repoA"));
  });
});

test("Smart HTTP push hardening (real git client)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-hardening-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  const reposDir = path.join(tmpDir, "git-repos");
  for (const d of [dbDir, storageDir, reposDir]) fs.mkdirSync(d, { recursive: true });

  process.env["GIT_REPOS_DIR"] = reposDir;
  process.env["GIT_RECEIVE_MAX_BYTES"] = String(64 * 1024);

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;

  t.after(() => {
    server.closeAllConnections?.();
    server.close();
    delete process.env["GIT_RECEIVE_MAX_BYTES"];
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  const password = "SecretPassword123!";
  db.createUser("alice", "alice@example.com", bcrypt.hashSync(password, 10), { emailVerified: true });
  const remote = `http://alice:${encodeURIComponent(password)}@127.0.0.1:${port}/git/alice/hardened.git`;
  const repoPath = path.join(reposDir, "alice", "hardened.git");

  async function makeClone(name: string): Promise<string> {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir);
    await git(dir, ["init", "-b", "main"]);
    await git(dir, ["config", "user.email", "a@example.com"]);
    await git(dir, ["config", "user.name", "Alice"]);
    return dir;
  }

  async function commitFile(dir: string, file: string, content: string | Buffer, msg: string): Promise<void> {
    fs.writeFileSync(path.join(dir, file), content);
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", msg]);
  }

  const refsOnServer = (): string[] =>
    execFileSync("git", ["-C", repoPath, "for-each-ref", "--format=%(refname)"], { env: CLEAN_ENV })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);

  await t.test("small push succeeds and repo gets hardened config", async () => {
    const dir = await makeClone("small");
    await commitFile(dir, "a.txt", "hello\n", "init");
    const push = await git(dir, ["push", remote, "main"]);
    assert.strictEqual(push.status, 0, push.out);

    const cfg = (k: string) => execFileSync("git", ["-C", repoPath, "config", k], { env: CLEAN_ENV }).toString().trim();
    assert.strictEqual(cfg("receive.fsckObjects"), "true");
    assert.strictEqual(cfg("receive.denyNonFastForwards"), "true");
    assert.strictEqual(cfg("receive.denyDeletes"), "true");
    assert.strictEqual(cfg("receive.maxInputSize"), String(64 * 1024));
  });

  await t.test("oversized push is rejected and does not update the repo", async () => {
    const dir = await makeClone("big");
    // Incompressible data well over the 64 KiB cap.
    await commitFile(dir, "blob.bin", crypto.randomBytes(512 * 1024), "big");
    const push = await git(dir, ["push", remote, "main:refs/heads/big"]);
    assert.notStrictEqual(push.status, 0, "oversized push must fail");
    assert.ok(!refsOnServer().includes("refs/heads/big"));
  });

  await t.test("branch deletion is denied", async () => {
    const dir = await makeClone("delete");
    await commitFile(dir, "b.txt", "b\n", "b");
    const create = await git(dir, ["push", remote, "main:refs/heads/tmp-branch"]);
    assert.strictEqual(create.status, 0, create.out);
    const del = await git(dir, ["push", remote, ":refs/heads/tmp-branch"]);
    assert.notStrictEqual(del.status, 0, "deleting a ref must be denied");
    assert.ok(refsOnServer().includes("refs/heads/tmp-branch"));
  });

  await t.test("non-fast-forward (force) push is denied", async () => {
    const dir = await makeClone("force");
    await commitFile(dir, "c.txt", "c\n", "c");
    const first = await git(dir, ["push", remote, "main:refs/heads/ff"]);
    assert.strictEqual(first.status, 0, first.out);
    await git(dir, ["commit", "--amend", "-m", "rewritten"]);
    const forced = await git(dir, ["push", "--force", remote, "main:refs/heads/ff"]);
    assert.notStrictEqual(forced.status, 0, "force push must be denied");
  });
});

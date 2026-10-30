// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yargs from "yargs";
import { Db } from "../src/commands/db.js";

test("Air-Gapped Offline CLI Maintenance Tooling (msx db --db)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-cli-offline-test-"));
  const tmpDb = path.join(tmpDir, "airgap.sqlite");

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const runCli = async (cmd: string[]) => {
    const parser = yargs(cmd).command(Db);
    await parser.parseAsync();
  };

  await t.test("offline dry-run identifies pending migrations", async () => {
    // Should run dry-run without errors
    await runCli(["db", "upgrade", "--db", tmpDb, "--dry-run"]);
    assert.equal(fs.existsSync(tmpDb), false, "Dry run must not create physical db");
  });

  await t.test("offline upgrade initializes and applies migrations", async () => {
    await runCli(["db", "upgrade", "--db", tmpDb, "--skip-backup"]);
    assert.equal(fs.existsSync(tmpDb), true, "Database file physically created");
  });

  await t.test("offline status reports fully upgraded schema", async () => {
    await runCli(["db", "status", "--db", tmpDb]);
  });

  await t.test("offline verify confirms relational and physical integrity", async () => {
    await runCli(["db", "verify", "--db", tmpDb]);
  });

  await t.test("offline plan reports up-to-date state", async () => {
    await runCli(["db", "plan", "--db", tmpDb]);
  });

  await t.test("offline rollback rolls back the last migration", async () => {
    await runCli(["db", "rollback", "--db", tmpDb, "--skip-backup"]);
    // Re-upgrade back to HEAD
    await runCli(["db", "upgrade", "--db", tmpDb, "--skip-backup"]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["FEATURE_FLAG_TEST_STRICT"] = "true";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";

test("Federation Tier Defaults & Air-Gap Compliance Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier-defaults-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  await t.test(
    "Tier 1 (Ansatz Lab) automatically seeds open federation and enables activitypub_federation flag",
    async () => {
      const labDir = path.join(tmpDir, "lab");
      fs.mkdirSync(labDir, { recursive: true });
      const db = new LibraryDatabase(labDir);
      setAuthDatabase(db);

      await seedInitialAdmin(db, {
        username: "lab_admin",
        email: "lab@ansatz.test",
        password: "LabAdminPassword!2026",
        preset: "tier1_federated",
      });

      const settings = db.getInstanceSettings();
      assert.strictEqual(settings.federationMode, "open");

      const app = createApp({ database: db });

      // NodeInfo should advertise activitypub protocol
      const nodeInfoRes = await request(app).get("/nodeinfo/2.0");
      assert.strictEqual(nodeInfoRes.status, 200);
      assert.deepStrictEqual(nodeInfoRes.body.protocols, ["activitypub"]);

      // Flags endpoint should show activitypub_federation: true for all users/guests
      const flagsRes = await request(app).get("/api/v1/flags");
      assert.strictEqual(flagsRes.status, 200);
      assert.strictEqual(flagsRes.body.activitypub_federation, true);

      // WebFinger should respond for seeded admin
      const wfRes = await request(app).get("/.well-known/webfinger?resource=acct:lab_admin@localhost");
      assert.strictEqual(wfRes.status, 200);
      assert.strictEqual(wfRes.body.subject, "acct:lab_admin@localhost");

      db.db.close();
    },
  );

  await t.test(
    "Tier 3 (Ansatz Flagship) automatically seeds open federation and enables activitypub_federation flag",
    async () => {
      const flagDir = path.join(tmpDir, "flagship");
      fs.mkdirSync(flagDir, { recursive: true });
      const db = new LibraryDatabase(flagDir);
      setAuthDatabase(db);

      await seedInitialAdmin(db, {
        username: "flag_admin",
        email: "flagship@ansatz.test",
        password: "FlagAdminPassword!2026",
        preset: "tier3_flagship",
      });

      const settings = db.getInstanceSettings();
      assert.strictEqual(settings.federationMode, "open");

      const app = createApp({ database: db });

      const flagsRes = await request(app).get("/api/v1/flags");
      assert.strictEqual(flagsRes.status, 200);
      assert.strictEqual(flagsRes.body.activitypub_federation, true);

      const nodeInfoRes = await request(app).get("/nodeinfo/2.1");
      assert.strictEqual(nodeInfoRes.status, 200);
      assert.deepStrictEqual(nodeInfoRes.body.protocols, ["activitypub"]);

      db.db.close();
    },
  );

  await t.test("Tier 2 (Enterprise Corporate) strictly disables federation and flags", async () => {
    const corpDir = path.join(tmpDir, "corp");
    fs.mkdirSync(corpDir, { recursive: true });
    const db = new LibraryDatabase(corpDir);
    setAuthDatabase(db);

    await seedInitialAdmin(db, {
      username: "corp_admin",
      email: "corp@corp.test",
      password: "CorpAdminPassword!2026",
      preset: "tier2_corporate",
    });

    const settings = db.getInstanceSettings();
    assert.strictEqual(settings.federationMode, "disabled");

    const app = createApp({ database: db });

    // NodeInfo protocols must be empty
    const nodeInfoRes = await request(app).get("/nodeinfo/2.0");
    assert.strictEqual(nodeInfoRes.status, 200);
    assert.deepStrictEqual(nodeInfoRes.body.protocols, []);

    // Flags endpoint should show activitypub_federation: false
    const flagsRes = await request(app).get("/api/v1/flags");
    assert.strictEqual(flagsRes.status, 200);
    assert.strictEqual(flagsRes.body.activitypub_federation, false);

    // WebFinger must be rejected with 403
    const wfRes = await request(app).get("/.well-known/webfinger?resource=acct:corp_admin@localhost");
    assert.strictEqual(wfRes.status, 403);

    db.db.close();
  });
});

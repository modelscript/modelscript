// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";
import { resolveTierPreset } from "../src/util/tier-presets.js";

test("Headless Preinstall & Deployment Presets", async (t) => {
  await t.test("resolveTierPreset resolves canonical names and aliases", () => {
    assert.equal(resolveTierPreset("tier3_flagship")?.id, "tier3_flagship");
    assert.equal(resolveTierPreset("flagship")?.id, "tier3_flagship");
    assert.equal(resolveTierPreset("tier1_federated")?.id, "tier1_federated");
    assert.equal(resolveTierPreset("federated")?.id, "tier1_federated");
    assert.equal(resolveTierPreset("federated-lite")?.id, "tier1_federated");
    assert.equal(resolveTierPreset("federated_lite")?.id, "tier1_federated");
    assert.equal(resolveTierPreset("tier2_corporate")?.id, "tier2_corporate");
    assert.equal(resolveTierPreset("corporate")?.id, "tier2_corporate");
    assert.equal(resolveTierPreset("enterprise")?.id, "tier2_corporate");
    assert.equal(resolveTierPreset("tier0_local_dev")?.id, "tier0_local_dev");
    assert.equal(resolveTierPreset("standalone")?.id, "tier0_local_dev");
    assert.equal(resolveTierPreset("non_existent"), undefined);
    assert.equal(resolveTierPreset(null), undefined);
  });

  await t.test("seedInitialAdmin with tier3_flagship configures flagship branding and locks wizard", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "preinstall-flagship-test-"));
    const dbPath = path.join(tmpDir, "db");
    const db = new LibraryDatabase(dbPath);
    let app: ReturnType<typeof createApp> | undefined;

    try {
      // Prior to seeding, needsSetup should be true
      const preStatus = db.getSetupStatus();
      assert.equal(preStatus.needsSetup, true);
      assert.equal(preStatus.hasAdmin, false);

      // Perform headless preinstall
      const seedResult = await seedInitialAdmin(db, {
        username: "superadmin",
        email: "admin@ansatz.social",
        password: "StrongSecretFlagshipPassword123!",
        preset: "tier3_flagship",
      });

      assert.equal(seedResult.created, true);
      assert.equal(seedResult.username, "superadmin");
      assert.equal(seedResult.email, "admin@ansatz.social");
      assert.equal(seedResult.presetApplied, "tier3_flagship");

      // Verify setup status is locked and needsSetup is false
      const postStatus = db.getSetupStatus();
      assert.equal(postStatus.needsSetup, false);
      assert.equal(postStatus.hasAdmin, true);
      assert.equal(postStatus.setupCompleted, true);

      // Verify flagship settings were applied
      const settings = db.getInstanceSettings();
      assert.equal(settings.instanceName, "Ansatz");
      assert.equal(settings.docsBaseUrl, "https://modelscript.org");
      assert.equal(settings.federationMode, "open");
      assert.equal(settings.registrationMode, "open");
      assert.equal(settings.waitlistEnabled, true);
      assert.equal(settings.contactEmail, "admin@ansatz.social");

      // Verify setup/complete endpoint rejects subsequent calls with 403 Forbidden
      const storage = new LibraryStorage(path.join(tmpDir, "storage"));
      app = createApp({ database: db, storage });
      const completeRes = await request(app).post("/api/v1/setup/complete").send({
        profileTier: "tier1_federated",
      });
      assert.equal(completeRes.status, 403);
    } finally {
      if (app) {
        if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
        if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
        if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
        if (app.locals.autoBackupInterval) clearInterval(app.locals.autoBackupInterval);
        if (app.locals.federationWorker) app.locals.federationWorker.stop();
        if (app.locals.botMentionWorker) app.locals.botMentionWorker.stop();
      }
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test("seedInitialAdmin with corporate preset configures airgapped settings", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "preinstall-corp-test-"));
    const dbPath = path.join(tmpDir, "db");
    const db = new LibraryDatabase(dbPath);

    try {
      const seedResult = await seedInitialAdmin(db, {
        username: "corpadmin",
        email: "it@utility.internal",
        password: "CorporateIntranetPassword2026!",
        preset: "corporate",
      });

      assert.equal(seedResult.created, true);
      assert.equal(seedResult.presetApplied, "tier2_corporate");

      const settings = db.getInstanceSettings();
      assert.equal(settings.instanceName, "Ansatz Enterprise");
      assert.equal(settings.docsBaseUrl, "/docs");
      assert.equal(settings.federationMode, "disabled");
      assert.equal(settings.registrationMode, "domain_allowlist");

      const status = db.getSetupStatus();
      assert.equal(status.needsSetup, false);
      assert.equal(status.setupCompleted, true);
    } finally {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

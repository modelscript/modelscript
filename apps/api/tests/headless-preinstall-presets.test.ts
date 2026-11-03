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
      app = createApp({ database: db, storage, seedStdlibOnBoot: false, enableWorkers: false });
      const completeRes = await request(app).post("/api/v1/setup/complete").send({
        profileTier: "tier1_federated",
      });
      assert.equal(completeRes.status, 403);

      // Verify flagship node has ZERO dev mock data (0 posts, 0 mock personas, 0 jobs)
      const postCount = (db.db.prepare("SELECT count(*) as c FROM posts").get() as { c: number }).c;
      const jobCount = (db.db.prepare("SELECT count(*) as c FROM jobs").get() as { c: number }).c;
      assert.equal(postCount, 0);
      assert.equal(jobCount, 0);
      const allUsers = db.db.prepare("SELECT username FROM users").all() as { username: string }[];
      assert.equal(allUsers.length, 1);
      assert.equal(allUsers[0]?.username, "superadmin");
    } finally {
      if (app) {
        if (app.locals.jobQueue) app.locals.jobQueue.clear();
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

  await t.test("createApp with DEPLOYMENT_PRESET=tier3_flagship strictly blocks dev auto-seeding", async () => {
    const origPreset = process.env["DEPLOYMENT_PRESET"];
    const origNodeEnv = process.env["NODE_ENV"];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flagship-no-seed-test-"));
    const dbPath = path.join(tmpDir, "db");
    const db = new LibraryDatabase(dbPath);
    let app: ReturnType<typeof createApp> | undefined;

    try {
      process.env["DEPLOYMENT_PRESET"] = "tier3_flagship";
      // Even if NODE_ENV is omitted or not "production", flagship preset must NEVER seed dev data
      delete process.env["NODE_ENV"];

      app = createApp({
        database: db,
        storage: new LibraryStorage(path.join(tmpDir, "storage")),
        seedStdlibOnBoot: false,
        enableWorkers: false,
      });

      // Ensure no mock dev data was seeded
      const postCount = (db.db.prepare("SELECT count(*) as c FROM posts").get() as { c: number }).c;
      const jobCount = (db.db.prepare("SELECT count(*) as c FROM jobs").get() as { c: number }).c;
      assert.equal(postCount, 0);
      assert.equal(jobCount, 0);
      const users = db.db.prepare("SELECT username FROM users").all() as { username: string }[];
      assert.equal(users.length, 0);
    } finally {
      if (origPreset !== undefined) process.env["DEPLOYMENT_PRESET"] = origPreset;
      else delete process.env["DEPLOYMENT_PRESET"];
      if (origNodeEnv !== undefined) process.env["NODE_ENV"] = origNodeEnv;
      else delete process.env["NODE_ENV"];

      if (app) {
        if (app.locals.jobQueue) app.locals.jobQueue.clear();
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

  await t.test(
    "createApp with DEPLOYMENT_PRESET=tier3_flagship and ALLOW_DEV_SEEDING=true enables mock data seeding in dev",
    async () => {
      const origPreset = process.env["DEPLOYMENT_PRESET"];
      const origAllowDev = process.env["ALLOW_DEV_SEEDING"];
      const origSeedExamples = process.env["SEED_EXAMPLES"];
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flagship-allow-seed-test-"));
      const dbPath = path.join(tmpDir, "db");
      const db = new LibraryDatabase(dbPath);
      let app: ReturnType<typeof createApp> | undefined;

      try {
        process.env["DEPLOYMENT_PRESET"] = "tier3_flagship";
        process.env["ALLOW_DEV_SEEDING"] = "true";
        process.env["SEED_EXAMPLES"] = "false";

        app = createApp({
          database: db,
          storage: new LibraryStorage(path.join(tmpDir, "storage")),
          seedStdlibOnBoot: false,
          enableWorkers: false,
        });

        // Verify that mock personas were seeded immediately
        const users = db.db.prepare("SELECT username FROM users").all() as { username: string }[];
        assert.ok(users.length > 0, "Expected mock users to be seeded when ALLOW_DEV_SEEDING is true");
        assert.ok(users.some((u) => u.username === "elena_vance"));
      } finally {
        if (origPreset !== undefined) process.env["DEPLOYMENT_PRESET"] = origPreset;
        else delete process.env["DEPLOYMENT_PRESET"];
        if (origAllowDev !== undefined) process.env["ALLOW_DEV_SEEDING"] = origAllowDev;
        else delete process.env["ALLOW_DEV_SEEDING"];
        if (origSeedExamples !== undefined) process.env["SEED_EXAMPLES"] = origSeedExamples;
        else delete process.env["SEED_EXAMPLES"];

        if (app) {
          if (app.locals.jobQueue) app.locals.jobQueue.clear();
          if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
          if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
          if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
          if (app.locals.autoBackupInterval) clearInterval(app.locals.autoBackupInterval);
          if (app.locals.federationWorker) app.locals.federationWorker.stop();
          if (app.locals.botMentionWorker) app.locals.botMentionWorker.stop();
          if (app.locals.devSeedPromise) {
            try {
              await app.locals.devSeedPromise;
            } catch {
              // Ignored
            }
          }
        }
        db.db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

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

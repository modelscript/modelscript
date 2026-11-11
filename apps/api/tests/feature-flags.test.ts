// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
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
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Feature Flag System & Launch Readiness Matrix Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  });

  const regularUser = db.createUser("normal_engineer", "eng@modelscript.test", "hash123", {
    accountType: "user",
    role: "user",
    emailVerified: true,
  });
  const regularToken = jwt.sign(
    { id: regularUser.id, username: regularUser.username, email: regularUser.email, role: "user", accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const adminUser = db.createUser("platform_admin", "admin@modelscript.test", "hash456", {
    accountType: "admin",
    role: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, role: "admin", accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("GET /api/v1/flags returns evaluated launch readiness defaults", async () => {
    // Guest evaluation
    const guestRes = await request(app).get("/api/v1/flags").expect(200);
    assert.strictEqual(guestRes.body.modelica_simulation, true);
    assert.strictEqual(guestRes.body.morsel_playground, true);
    assert.strictEqual(guestRes.body.package_browser, true);
    assert.strictEqual(guestRes.body.cad_step_viewer, true);
    assert.strictEqual(guestRes.body.heavy_vscode_ide, true);

    // Gated flags must be false for guest
    assert.strictEqual(guestRes.body.git_repositories, false);
    assert.strictEqual(guestRes.body.repositories, false);
    assert.strictEqual(guestRes.body.references, false);
    assert.strictEqual(guestRes.body.scientific_references, false);
    assert.strictEqual(guestRes.body.cae_cloud_solver, false);
    assert.strictEqual(guestRes.body.billing_stripe_live, false);
    assert.strictEqual(guestRes.body.digital_twins, false);
    assert.strictEqual(guestRes.body.cosim_mqtt, false);
    assert.strictEqual(guestRes.body.timescaledb_historian, false);
    assert.strictEqual(guestRes.body.activitypub_federation, false);
    assert.strictEqual(guestRes.body.sysml2_omg_api, false);
    assert.strictEqual(guestRes.body.experimental_viewers, false);
    assert.strictEqual(guestRes.body.composer_ai_polish, false);
    assert.strictEqual(guestRes.body.feeds_page, false);
    assert.strictEqual(guestRes.body.rss_feeds, false);
    assert.strictEqual(guestRes.body.spaces_hub, false);
    assert.strictEqual(guestRes.body.spaces, false);
    assert.strictEqual(guestRes.body.space_chat, false);
    assert.strictEqual(guestRes.body.chat, false);

    // Regular user evaluation
    const userRes = await request(app).get("/api/v1/flags").set("Authorization", `Bearer ${regularToken}`).expect(200);
    assert.strictEqual(userRes.body.git_repositories, false);
    assert.strictEqual(userRes.body.references, false);
    assert.strictEqual(userRes.body.cae_cloud_solver, false);
    assert.strictEqual(userRes.body.billing_stripe_live, false);
    assert.strictEqual(userRes.body.composer_ai_polish, false);
    assert.strictEqual(userRes.body.feeds_page, false);
    assert.strictEqual(userRes.body.rss_feeds, false);
    assert.strictEqual(userRes.body.spaces_hub, false);
    assert.strictEqual(userRes.body.spaces, false);
    assert.strictEqual(userRes.body.space_chat, false);
    assert.strictEqual(userRes.body.chat, false);

    // Admin user evaluation (default-disabled flags must be false for everyone including admin)
    const adminRes = await request(app).get("/api/v1/flags").set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.strictEqual(adminRes.body.git_repositories, false);
    assert.strictEqual(adminRes.body.references, false);
    assert.strictEqual(adminRes.body.cae_cloud_solver, false);
    assert.strictEqual(adminRes.body.billing_stripe_live, false);
    assert.strictEqual(adminRes.body.feeds_page, false);
    assert.strictEqual(adminRes.body.rss_feeds, false);
    assert.strictEqual(adminRes.body.spaces_hub, false);
    assert.strictEqual(adminRes.body.spaces, false);
    assert.strictEqual(adminRes.body.space_chat, false);
    assert.strictEqual(adminRes.body.chat, false);
  });

  await t.test("Gated endpoints return 404 when disabled (including for admin)", async () => {
    // CAE / HPC profiles endpoint disabled for regular user
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // CAE / HPC profiles endpoint disabled even for admin when flag is disabled
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${adminToken}`).expect(404);

    // Cloud balance endpoint
    await request(app).get("/api/v1/cloud/balance").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Billing wallet endpoint
    await request(app).get("/api/v1/billing/wallet").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Digital twins endpoint
    await request(app).get("/api/v1/twins").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Cluster status endpoint
    await request(app).get("/api/v1/cluster/status").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Co-simulation endpoint
    await request(app).get("/api/v1/cosim/ssp/import").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Historian endpoint
    await request(app).get("/api/v1/historian/sessions").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // RSS feeds endpoint
    await request(app).get("/api/v1/social/feeds").set("Authorization", `Bearer ${regularToken}`).expect(404);
    await request(app).get("/api/v1/social/feeds").set("Authorization", `Bearer ${adminToken}`).expect(404);
  });

  await t.test("Admin can list and dynamically toggle flags via /api/v1/admin/flags", async () => {
    // List flags
    const listRes = await request(app)
      .get("/api/v1/admin/flags")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert(Array.isArray(listRes.body.flags));
    const caeFlag = listRes.body.flags.find((f: any) => f.key === "cae_cloud_solver");
    assert(caeFlag);

    // 1. Enable cae_cloud_solver for admin only
    await request(app)
      .patch("/api/v1/admin/flags/cae_cloud_solver")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isEnabled: true, allowedRoles: "admin" })
      .expect(200);

    const adminFlags = await request(app).get("/api/v1/flags").set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.strictEqual(adminFlags.body.cae_cloud_solver, true);
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${adminToken}`).expect(200);

    const userFlagsRoleGated = await request(app)
      .get("/api/v1/flags")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(200);
    assert.strictEqual(userFlagsRoleGated.body.cae_cloud_solver, false);
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // 2. Toggle cae_cloud_solver to true globally
    await request(app)
      .patch("/api/v1/admin/flags/cae_cloud_solver")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isEnabled: true, allowedRoles: "user,admin,guest" })
      .expect(200);

    // Now regular user should have cae_cloud_solver enabled and route accessible!
    const updatedFlags = await request(app)
      .get("/api/v1/flags")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(200);
    assert.strictEqual(updatedFlags.body.cae_cloud_solver, true);

    // CAE endpoint should now respond with 200
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(200);

    // 3. Toggle it back off
    await request(app)
      .patch("/api/v1/admin/flags/cae_cloud_solver")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isEnabled: false, allowedRoles: "admin" })
      .expect(200);

    // Route is 404 again for regular user and admin
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(404);
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${adminToken}`).expect(404);
  });
});

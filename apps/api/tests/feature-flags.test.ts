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

    // Gated flags must be false for guest
    assert.strictEqual(guestRes.body.cae_cloud_solver, false);
    assert.strictEqual(guestRes.body.billing_stripe_live, false);
    assert.strictEqual(guestRes.body.digital_twins, false);
    assert.strictEqual(guestRes.body.cosim_mqtt, false);
    assert.strictEqual(guestRes.body.activitypub_federation, false);
    assert.strictEqual(guestRes.body.sysml2_omg_api, false);
    assert.strictEqual(guestRes.body.heavy_vscode_ide, false);
    assert.strictEqual(guestRes.body.experimental_viewers, false);

    // Regular user evaluation
    const userRes = await request(app).get("/api/v1/flags").set("Authorization", `Bearer ${regularToken}`).expect(200);
    assert.strictEqual(userRes.body.cae_cloud_solver, false);
    assert.strictEqual(userRes.body.billing_stripe_live, false);

    // Admin user evaluation (admin has access to role-gated flags)
    const adminRes = await request(app).get("/api/v1/flags").set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.strictEqual(adminRes.body.cae_cloud_solver, true);
    assert.strictEqual(adminRes.body.billing_stripe_live, true);
  });

  await t.test("Gated endpoints return 404 for unprivileged users when disabled", async () => {
    // CAE / HPC profiles endpoint
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Cloud balance endpoint
    await request(app).get("/api/v1/cloud/balance").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Billing wallet endpoint
    await request(app).get("/api/v1/billing/wallet").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Digital twins endpoint
    await request(app).get("/api/v1/twins").set("Authorization", `Bearer ${regularToken}`).expect(404);

    // Co-simulation endpoint
    await request(app).get("/api/v1/cosim/ssp/import").set("Authorization", `Bearer ${regularToken}`).expect(404);
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

    // Toggle cae_cloud_solver to true globally
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

    // Toggle it back off
    await request(app)
      .patch("/api/v1/admin/flags/cae_cloud_solver")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isEnabled: false, allowedRoles: "admin" })
      .expect(200);

    // Route is 404 again for regular user
    await request(app).get("/api/v1/cae/profiles").set("Authorization", `Bearer ${regularToken}`).expect(404);
  });
});

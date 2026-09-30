// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { FederationWorker } from "../src/services/federation-worker.js";
import { LibraryStorage } from "../src/storage.js";

test("Federation Topology Modes & Asymmetric Gating", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fed-modes-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });
  const worker = new FederationWorker(db);

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test("FEDERATION_MODE=disabled rejects external inbox requests with 403", async () => {
    const originalMode = process.env["FEDERATION_MODE"];
    try {
      process.env["FEDERATION_MODE"] = "disabled";

      const res = await request(app)
        .post("/actor/inbox")
        .set("Content-Type", "application/activity+json")
        .send({ type: "Follow" })
        .expect(403);

      assert.ok(res.body.error.includes("Federation is disabled on this node"));
    } finally {
      process.env["FEDERATION_MODE"] = originalMode;
    }
  });

  await t.test("FederationWorker blocks outbound deliveries destined for export-sanctioned jurisdictions", async () => {
    // Enqueue a delivery targeting North Korea IP (175.45.176.1)
    const { id: deliveryId } = db.enqueueFederationDelivery(
      "Create",
      "https://hub.modelscript.org/activities/test-1",
      { type: "Create", object: { type: "Note", content: "CAD Model Release" } },
      "https://175.45.176.1/inbox",
      "175.45.176.1",
    );

    // Process delivery queue with worker
    const processed = await worker.processQueue();
    assert.strictEqual(processed, 1);

    // Check delivery status was marked failed due to export control
    const failedItem = db.db
      .prepare(`SELECT status, last_error FROM federation_delivery_queue WHERE id = ?`)
      .get(deliveryId) as any;
    assert.strictEqual(failedItem.status, "failed");
    assert.ok(failedItem.last_error.includes("export control regulations"));
    assert.ok(failedItem.last_error.includes("KP"));

    // Verify compliance audit log was recorded
    const auditLogs = db.getAuditLogs(10, 0, "export_control_federation_blocked");
    assert.ok(auditLogs.length >= 1);
    assert.strictEqual(auditLogs[0].resource_id, "175.45.176.1");
  });

  await t.test("FEDERATION_MODE=curated-hub enforces scoped package namespaces under origin domain", async () => {
    const originalMode = process.env["FEDERATION_MODE"];
    try {
      process.env["FEDERATION_MODE"] = "curated-hub";

      // Create local user to host inbox
      const localUser = db.createUser("core_receiver", "receiver@modelscript.test", "pwd123", { emailVerified: true });

      const packageActivity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://aerospace-consortium.de/users/lead_engineer",
        object: {
          type: "SoftwareApplication",
          name: "PropulsionModels",
          version: "2.1.0",
          checksum: "sha256:abcd1234ef",
          downloadUrl: "https://aerospace-consortium.de/packages/propulsion.zip",
          description: "High-temperature turbine Modelica components",
        },
      };

      await request(app)
        .post(`/users/${localUser.username}/inbox`)
        .set("Content-Type", "application/activity+json")
        .set("x-test-bypass-sig", "true")
        .send(packageActivity)
        .expect(202);

      // Verify recorded package in remote_packages is scoped under @aerospace-consortium.de/PropulsionModels
      const remotePackages = db.getRemotePackages(10, 0);
      const pkg = remotePackages.find((p) => p.download_url?.includes("propulsion.zip"));
      assert.ok(pkg, "Package should be recorded in remote_packages");
      assert.strictEqual(pkg.name, "@aerospace-consortium.de/PropulsionModels");
      assert.strictEqual(pkg.version, "2.1.0");
    } finally {
      process.env["FEDERATION_MODE"] = originalMode;
    }
  });
});

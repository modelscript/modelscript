// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { provisioningRouter } from "../src/routes/provisioning.js";
import { FactoryProvisioningService } from "../src/services/security/factory-provisioning-service.js";

describe("Factory Provisioning & Anti-Cloning Gateway", () => {
  it("enforces strict batch production quotas and prevents overproduction", () => {
    const prov = new FactoryProvisioningService();

    const batch = prov.createBatch({
      sku: "SENSOR-IOT-V2",
      cmPartnerId: "FOXCONN-SHENZHEN-01",
      authorizedQuota: 2,
      firmwareHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });

    assert.equal(batch.authorizedQuota, 2);
    assert.equal(batch.unitsProvisioned, 0);
    assert.equal(batch.status, "active");

    // Provision unit 1
    const devKey1 = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const res1 = prov.provisionDevice({
      batchId: batch.batchId,
      ateFixtureId: "ATE-LINE-4A",
      devicePublicKey: devKey1.publicKey,
      deviceUid: "SILICON-UID-0001",
    });

    assert.equal(res1.success, true);
    assert.equal(res1.remainingBatchQuota, 1);
    assert.ok(res1.deviceCertificate.includes("SENSOR-IOT-V2"));

    // Provision unit 2
    const devKey2 = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const res2 = prov.provisionDevice({
      batchId: batch.batchId,
      ateFixtureId: "ATE-LINE-4A",
      devicePublicKey: devKey2.publicKey,
      deviceUid: "SILICON-UID-0002",
    });

    assert.equal(res2.success, true);
    assert.equal(res2.remainingBatchQuota, 0);

    const updatedBatch = prov.getBatch(batch.batchId)!;
    assert.equal(updatedBatch.unitsProvisioned, 2);
    assert.equal(updatedBatch.status, "exhausted");

    // Attempt unit 3 (should fail with quota exceeded)
    const devKey3 = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    assert.throws(
      () => {
        prov.provisionDevice({
          batchId: batch.batchId,
          ateFixtureId: "ATE-LINE-4A",
          devicePublicKey: devKey3.publicKey,
          deviceUid: "SILICON-UID-0003",
        });
      },
      /QUOTA_EXCEEDED/,
      "Must reject provisioning once authorized quota is exhausted",
    );
  });

  it("authenticates device attestation signatures and handles quarantine", () => {
    const prov = new FactoryProvisioningService();

    const batch = prov.createBatch({
      sku: "GATEWAY-PRO",
      cmPartnerId: "SANMINA-GUADALAJARA",
      authorizedQuota: 10,
      firmwareHash: "a".repeat(64),
    });

    const deviceKeys = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const provisionRes = prov.provisionDevice({
      batchId: batch.batchId,
      ateFixtureId: "ATE-FIXTURE-1",
      devicePublicKey: deviceKeys.publicKey,
      deviceUid: "UID-CHIP-9999",
    });

    // Valid attestation challenge response
    const challenge = "random-nonce-challenge-" + Date.now();
    const signature = crypto.sign(null, Buffer.from(challenge), deviceKeys.privateKey).toString("base64");

    const verifyRes = prov.verifyAttestation({
      deviceId: provisionRes.deviceId,
      challenge,
      signature,
    });

    assert.equal(verifyRes.verified, true);
    assert.equal(verifyRes.status, "activated");
    assert.equal(verifyRes.sku, "GATEWAY-PRO");

    // Bad signature
    const badVerify = prov.verifyAttestation({
      deviceId: provisionRes.deviceId,
      challenge: "wrong-challenge",
      signature,
    });
    assert.equal(badVerify.verified, false);

    // Quarantine device
    const quarantined = prov.quarantineDevice(provisionRes.deviceId);
    assert.equal(quarantined, true);

    const postQuarantineVerify = prov.verifyAttestation({
      deviceId: provisionRes.deviceId,
      challenge,
      signature,
    });
    assert.equal(postQuarantineVerify.verified, false);
    assert.equal(postQuarantineVerify.status, "quarantined");
  });

  it("REST API endpoints handle batch creation and provisioning lifecycle", async () => {
    const prov = new FactoryProvisioningService();
    const app = express();
    app.use(express.json());
    app.use("/api/v1/provisioning", provisioningRouter(prov));

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Create Batch
      const batchRes = await fetch(`${baseUrl}/api/v1/provisioning/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: "SMART-METER-4G",
          cmPartnerId: "JABIL-PENANG",
          authorizedQuota: 1,
          firmwareHash: "c0ffee".repeat(10),
        }),
      });
      assert.equal(batchRes.status, 201);
      const batchData = await batchRes.json();
      assert.ok(batchData.batchId);
      assert.equal(batchData.authorizedQuota, 1);

      // 2. Provision Unit 1
      const devKeys = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const provRes = await fetch(`${baseUrl}/api/v1/provisioning/device-cert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batchData.batchId,
          ateFixtureId: "JABIL-ATE-03",
          devicePublicKey: devKeys.publicKey,
          deviceUid: "MCU-SERIAL-4444",
        }),
      });
      assert.equal(provRes.status, 201);
      const provData = await provRes.json();
      assert.ok(provData.deviceId);
      assert.equal(provData.remainingBatchQuota, 0);

      // 3. Provision Unit 2 (Must be 403 Forbidden - Quota Exceeded)
      const provRes2 = await fetch(`${baseUrl}/api/v1/provisioning/device-cert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batchData.batchId,
          ateFixtureId: "JABIL-ATE-03",
          devicePublicKey: devKeys.publicKey,
          deviceUid: "MCU-SERIAL-5555",
        }),
      });
      assert.equal(provRes2.status, 403);
      const errData = await provRes2.json();
      assert.ok(errData.error.includes("QUOTA_EXCEEDED"));
    } finally {
      server.close();
    }
  });
});

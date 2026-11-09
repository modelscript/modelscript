// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

export interface ProductionBatch {
  batchId: string;
  sku: string;
  cmPartnerId: string;
  authorizedQuota: number;
  unitsProvisioned: number;
  firmwareHash: string; // SHA-256 of authorized binary
  rootPublicKey: string; // Base64 or PEM
  status: "active" | "exhausted" | "revoked";
  createdAt: string;
  expiresAt: string;
}

export interface CreateBatchParams {
  sku: string;
  cmPartnerId: string;
  authorizedQuota: number;
  firmwareHash: string;
  validityDays?: number | undefined;
}

export interface ProvisionDeviceParams {
  batchId: string;
  ateFixtureId: string;
  devicePublicKey: string; // Public key generated in device secure element
  deviceUid: string; // Hardware unique silicon identifier (e.g. 96-bit MCU UID)
}

export interface ProvisionedDevice {
  deviceId: string;
  batchId: string;
  serialNumber: string;
  deviceUid: string;
  devicePublicKey: string;
  certificate: string;
  provisionedAt: string;
  ateFixtureId: string;
  status: "provisioned" | "activated" | "quarantined";
}

export interface ProvisionResult {
  success: boolean;
  deviceId: string;
  serialNumber: string;
  deviceCertificate: string;
  encryptedPersonalizationBlob: string;
  remainingBatchQuota: number;
}

export interface VerifyAttestationParams {
  deviceId: string;
  challenge: string;
  signature: string; // Signature of challenge created by device private key
}

export interface AttestationVerificationResult {
  verified: boolean;
  deviceId: string;
  sku?: string | undefined;
  batchId?: string | undefined;
  status: string;
  error?: string | undefined;
}

export class FactoryProvisioningService {
  private batches = new Map<string, ProductionBatch>();
  private devices = new Map<string, ProvisionedDevice>();
  private devicesByUid = new Map<string, string>(); // deviceUid -> deviceId

  // OEM Root-of-Trust Ed25519 keypair for signing device certificates
  private rootKeyPair: { publicKey: string; privateKey: string };

  constructor() {
    this.rootKeyPair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }

  /**
   * Authorize a new factory production batch with strict hardware quota.
   */
  public createBatch(params: CreateBatchParams): ProductionBatch {
    if (params.authorizedQuota <= 0) {
      throw new Error("Authorized quota must be greater than zero.");
    }
    if (!params.firmwareHash || params.firmwareHash.length < 32) {
      throw new Error("Valid SHA-256 firmware hash is required.");
    }

    const batchId = `batch_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.validityDays ?? 30) * 86400000);

    const batch: ProductionBatch = {
      batchId,
      sku: params.sku,
      cmPartnerId: params.cmPartnerId,
      authorizedQuota: params.authorizedQuota,
      unitsProvisioned: 0,
      firmwareHash: params.firmwareHash,
      rootPublicKey: this.rootKeyPair.publicKey,
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  /**
   * Retrieve batch details.
   */
  public getBatch(batchId: string): ProductionBatch | null {
    return this.batches.get(batchId) || null;
  }

  /**
   * Provision a single hardware device from the automated test equipment (ATE) fixture.
   * Enforces zero-trust quota to guarantee CMs cannot overproduce or clone boards.
   */
  public provisionDevice(params: ProvisionDeviceParams): ProvisionResult {
    const batch = this.batches.get(params.batchId);
    if (!batch) {
      throw new Error(`Production batch '${params.batchId}' not found.`);
    }

    if (batch.status === "exhausted" || batch.unitsProvisioned >= batch.authorizedQuota) {
      batch.status = "exhausted";
      throw new Error(
        `QUOTA_EXCEEDED: Batch '${params.batchId}' has reached its authorized quota of ${batch.authorizedQuota} units. Provisioning denied.`,
      );
    }

    if (batch.status === "revoked") {
      throw new Error(`BATCH_REVOKED: Batch '${params.batchId}' has been revoked by OEM.`);
    }

    if (new Date() > new Date(batch.expiresAt)) {
      throw new Error(`BATCH_EXPIRED: Batch '${params.batchId}' production window has expired.`);
    }

    // Check silicon UID uniqueness (prevent replay/duplicate burning on same chip)
    const existingDevId = this.devicesByUid.get(params.deviceUid);
    if (existingDevId) {
      const existing = this.devices.get(existingDevId)!;
      return {
        success: true,
        deviceId: existing.deviceId,
        serialNumber: existing.serialNumber,
        deviceCertificate: existing.certificate,
        encryptedPersonalizationBlob: "DUPLICATE_CHIP_REPROVISION_BLOCKED",
        remainingBatchQuota: batch.authorizedQuota - batch.unitsProvisioned,
      };
    }

    // Increment quota counter atomically
    batch.unitsProvisioned += 1;
    if (batch.unitsProvisioned >= batch.authorizedQuota) {
      batch.status = "exhausted";
    }

    const deviceId = `dev_${crypto.randomUUID().slice(0, 12)}`;
    const serialNumber = `${batch.sku}-${batch.batchId.slice(-4).toUpperCase()}-${String(batch.unitsProvisioned).padStart(6, "0")}`;

    // Issue cryptographic OEM Device Certificate signed by RoT Private Key
    const certPayload = JSON.stringify({
      deviceId,
      serialNumber,
      batchId: batch.batchId,
      sku: batch.sku,
      deviceUid: params.deviceUid,
      devicePublicKey: params.devicePublicKey,
      firmwareHash: batch.firmwareHash,
      issuedAt: new Date().toISOString(),
    });

    const signature = crypto.sign(null, Buffer.from(certPayload), this.rootKeyPair.privateKey);
    const certificate = JSON.stringify({
      payload: certPayload,
      signature: signature.toString("base64"),
      rootPublicKey: this.rootKeyPair.publicKey,
    });

    // Encrypt device-specific personalization secret (e.g., cloud MQTT client keys)
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const secretPayload = JSON.stringify({
      provisioningToken: crypto.randomBytes(16).toString("hex"),
      fleetEndpoint: "https://hub.modelscript.ansatz.social/telemetry",
    });
    const encrypted = Buffer.concat([cipher.update(secretPayload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const encryptedBlob = JSON.stringify({
      iv: iv.toString("base64"),
      ciphertext: encrypted.toString("base64"),
      tag: tag.toString("base64"),
      wrappedKey: aesKey.toString("base64"), // In production, wrapped with devicePublicKey
    });

    const provisioned: ProvisionedDevice = {
      deviceId,
      batchId: batch.batchId,
      serialNumber,
      deviceUid: params.deviceUid,
      devicePublicKey: params.devicePublicKey,
      certificate,
      provisionedAt: new Date().toISOString(),
      ateFixtureId: params.ateFixtureId,
      status: "provisioned",
    };

    this.devices.set(deviceId, provisioned);
    this.devicesByUid.set(params.deviceUid, deviceId);

    return {
      success: true,
      deviceId,
      serialNumber,
      deviceCertificate: certificate,
      encryptedPersonalizationBlob: encryptedBlob,
      remainingBatchQuota: batch.authorizedQuota - batch.unitsProvisioned,
    };
  }

  /**
   * Verify hardware cryptographic attestation report.
   */
  public verifyAttestation(params: VerifyAttestationParams): AttestationVerificationResult {
    const device = this.devices.get(params.deviceId);
    if (!device) {
      return { verified: false, deviceId: params.deviceId, status: "unknown", error: "Device not found" };
    }

    if (device.status === "quarantined") {
      return {
        verified: false,
        deviceId: params.deviceId,
        status: "quarantined",
        error: "Device has been quarantined",
      };
    }

    const batch = this.batches.get(device.batchId);

    // Verify signature of the challenge
    try {
      const isValid = crypto.verify(
        null,
        Buffer.from(params.challenge),
        device.devicePublicKey,
        Buffer.from(params.signature, "base64"),
      );

      if (isValid) {
        device.status = "activated";
        return {
          verified: true,
          deviceId: device.deviceId,
          sku: batch?.sku,
          batchId: device.batchId,
          status: "activated",
        };
      } else {
        return {
          verified: false,
          deviceId: device.deviceId,
          status: device.status,
          error: "Signature verification failed",
        };
      }
    } catch (err) {
      return {
        verified: false,
        deviceId: device.deviceId,
        status: device.status,
        error: `Attestation verification exception: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Quarantine a compromised device ID.
   */
  public quarantineDevice(deviceId: string): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;
    dev.status = "quarantined";
    return true;
  }

  /**
   * Get device record.
   */
  public getDevice(deviceId: string): ProvisionedDevice | null {
    return this.devices.get(deviceId) || null;
  }
}

export const factoryProvisioningService = new FactoryProvisioningService();

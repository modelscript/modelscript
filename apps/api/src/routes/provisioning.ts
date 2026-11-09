// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Factory Provisioning & Zero-Trust Hardware Security REST API Routes.
 *
 * Exposes endpoints for production batch quotas, ATE fixture device certification,
 * cryptographic attestation, and anti-cloning enforcement.
 */

import { Router, type Request, type Response } from "express";
import {
  FactoryProvisioningService,
  factoryProvisioningService,
} from "../services/security/factory-provisioning-service.js";

export function provisioningRouter(service?: FactoryProvisioningService): Router {
  const router = Router();
  const prov = service ?? factoryProvisioningService;

  /**
   * POST /api/v1/provisioning/batch
   * Authorizes a production batch with strict hardware quota.
   */
  router.post("/batch", async (req: Request, res: Response) => {
    try {
      const { sku, cmPartnerId, authorizedQuota, firmwareHash, validityDays } = req.body as {
        sku?: string;
        cmPartnerId?: string;
        authorizedQuota?: number;
        firmwareHash?: string;
        validityDays?: number;
      };

      if (!sku || !cmPartnerId || !authorizedQuota || !firmwareHash) {
        res.status(400).json({ error: "Missing required fields: sku, cmPartnerId, authorizedQuota, firmwareHash." });
        return;
      }

      const batch = prov.createBatch({
        sku,
        cmPartnerId,
        authorizedQuota,
        firmwareHash,
        validityDays,
      });

      res.status(201).json(batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/provisioning/batch/:batchId
   * Gets details and remaining quota for a production batch.
   */
  router.get("/batch/:batchId", async (req: Request, res: Response) => {
    try {
      const rawBatchId = req.params["batchId"];
      const batchId = Array.isArray(rawBatchId) ? rawBatchId[0] : rawBatchId;
      if (!batchId) {
        res.status(400).json({ error: "Missing batchId parameter." });
        return;
      }

      const batch = prov.getBatch(batchId);
      if (!batch) {
        res.status(404).json({ error: `Batch '${batchId}' not found.` });
        return;
      }

      res.json(batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/provisioning/device-cert
   * ATE Fixture requests device certificate & personalization blob.
   * Enforces zero-trust quota.
   */
  router.post("/device-cert", async (req: Request, res: Response) => {
    try {
      const { batchId, ateFixtureId, devicePublicKey, deviceUid } = req.body as {
        batchId?: string;
        ateFixtureId?: string;
        devicePublicKey?: string;
        deviceUid?: string;
      };

      if (!batchId || !ateFixtureId || !devicePublicKey || !deviceUid) {
        res.status(400).json({
          error: "Missing required fields: batchId, ateFixtureId, devicePublicKey, deviceUid.",
        });
        return;
      }

      const result = prov.provisionDevice({
        batchId,
        ateFixtureId,
        devicePublicKey,
        deviceUid,
      });

      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = msg.includes("QUOTA_EXCEEDED");
      res.status(isQuota ? 403 : 400).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/provisioning/verify-attestation
   * Cryptographically verifies device signature against registered public key.
   */
  router.post("/verify-attestation", async (req: Request, res: Response) => {
    try {
      const { deviceId, challenge, signature } = req.body as {
        deviceId?: string;
        challenge?: string;
        signature?: string;
      };

      if (!deviceId || !challenge || !signature) {
        res.status(400).json({ error: "Missing required fields: deviceId, challenge, signature." });
        return;
      }

      const result = prov.verifyAttestation({
        deviceId,
        challenge,
        signature,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/provisioning/device/:deviceId/quarantine
   * Quarantines a device ID.
   */
  router.post("/device/:deviceId/quarantine", async (req: Request, res: Response) => {
    try {
      const rawDeviceId = req.params["deviceId"];
      const deviceId = Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId;
      if (!deviceId) {
        res.status(400).json({ error: "Missing deviceId parameter." });
        return;
      }

      const success = prov.quarantineDevice(deviceId);
      if (!success) {
        res.status(404).json({ error: `Device '${deviceId}' not found.` });
        return;
      }

      res.json({ success: true, deviceId, status: "quarantined" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

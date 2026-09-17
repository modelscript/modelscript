// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { Pool } from "pg";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

export function instancesRouter(database: LibraryDatabase, pool: Pool | null): Router {
  const router = createRouter();

  /**
   * POST /api/v1/instances
   * Register a new physical hardware instance (birth certificate).
   */
  router.post("/", requireAuth, (req: Request, res: Response): void => {
    const { serialNumber, packageName, version, commitSha, variant, birthData } = req.body;

    if (!serialNumber || typeof serialNumber !== "string") {
      res.status(400).json({ error: "serialNumber is required" });
      return;
    }

    if (!packageName || typeof packageName !== "string") {
      res.status(400).json({ error: "packageName is required" });
      return;
    }

    if (!version || typeof version !== "string") {
      res.status(400).json({ error: "version is required" });
      return;
    }

    const pkg = database.getPackage(packageName);
    if (!pkg) {
      res.status(404).json({ error: `Package '${packageName}' not found` });
      return;
    }

    try {
      const birthDataStr =
        birthData && typeof birthData === "object"
          ? JSON.stringify(birthData)
          : typeof birthData === "string"
            ? birthData
            : null;

      const instanceId = database.createInstance({
        serialNumber,
        packageId: pkg.id,
        version,
        commitSha: commitSha ?? null,
        variant: variant ?? null,
        birthData: birthDataStr,
      });

      const instance = database.getInstanceBySerialNumber(serialNumber);

      res.status(201).json({
        id: instanceId,
        instance,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        res.status(409).json({ error: `Instance with serialNumber '${serialNumber}' already exists` });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/instances
   * List registered instances.
   */
  router.get("/", (req: Request, res: Response): void => {
    const limit = Math.min(Number(req.query["limit"]) || 50, 100);
    const packageName = req.query["package"];

    if (typeof packageName === "string") {
      const pkg = database.getPackage(packageName);
      if (!pkg) {
        res.json({ instances: [] });
        return;
      }
      const instances = database.listInstancesForPackage(pkg.id, limit);
      res.json({ instances });
      return;
    }

    const instances = database.listInstances(limit);
    res.json({ instances });
  });

  /**
   * GET /api/v1/instances/:serialNumber
   * Get metadata and birth certificate for a specific hardware instance.
   */
  router.get("/:serialNumber", (req: Request, res: Response): void => {
    const rawSerial = req.params["serialNumber"];
    const serialNumber = Array.isArray(rawSerial) ? rawSerial[0] : rawSerial;
    if (!serialNumber || typeof serialNumber !== "string") {
      res.status(400).json({ error: "serialNumber is required" });
      return;
    }

    const instance = database.getInstanceBySerialNumber(serialNumber);
    if (!instance) {
      res.status(404).json({ error: `Instance with serialNumber '${serialNumber}' not found` });
      return;
    }

    res.json({
      ...instance,
      birth_data: instance.birth_data ? JSON.parse(instance.birth_data) : null,
    });
  });

  /**
   * GET /api/v1/instances/:serialNumber/twin
   * Get the full Digital Twin view: design specifications + birth certificate + live telemetry links.
   */
  router.get("/:serialNumber/twin", async (req: Request, res: Response): Promise<void> => {
    const rawSerial = req.params["serialNumber"];
    const serialNumber = Array.isArray(rawSerial) ? rawSerial[0] : rawSerial;
    if (!serialNumber || typeof serialNumber !== "string") {
      res.status(400).json({ error: "serialNumber is required" });
      return;
    }

    const instance = database.getInstanceBySerialNumber(serialNumber);
    if (!instance) {
      res.status(404).json({ error: `Instance with serialNumber '${serialNumber}' not found` });
      return;
    }

    // Retrieve package version details
    const versionRecord = database.getPackageVersion(instance.package_id, instance.version);

    // Retrieve any telemetry sessions from historian
    let telemetrySessions: unknown[] = [];
    if (pool) {
      try {
        const queryResult = await pool.query(
          `SELECT id, start_time, stop_time, state FROM sessions WHERE metadata->>'serialNumber' = $1 ORDER BY start_time DESC LIMIT 10`,
          [serialNumber],
        );
        telemetrySessions = queryResult.rows;
      } catch {
        // Fall back to empty if historian query fails
      }
    }

    res.json({
      instance: {
        ...instance,
        birth_data: instance.birth_data ? JSON.parse(instance.birth_data) : null,
      },
      design: {
        package_name: instance.package_name,
        version: instance.version,
        commit_sha: instance.commit_sha,
        variant: instance.variant,
        manifest: versionRecord ? JSON.parse(versionRecord.manifest) : null,
      },
      telemetry: {
        sessionCount: telemetrySessions.length,
        recentSessions: telemetrySessions,
      },
    });
  });

  return router;
}

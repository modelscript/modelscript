// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Smart RFQ & CM Portal REST API Routes.
 *
 * Provides endpoints for:
 *   - Generating and retrieving Smart RFQ packages
 *   - Filing and resolving spatial pin-annotated Engineering Queries (EQs)
 */

import { Router, type Request, type Response } from "express";
import { RfqBundleGenerator, type SmartRfqBundle } from "../services/rfq/rfq-bundle-generator.js";
import {
  defaultEngineeringQueryService,
  type EngineeringQueryService,
} from "../services/spaces/engineering-query-service.js";

// Cache of latest RFQ bundles by spaceId
const spaceBundles = new Map<string, SmartRfqBundle>();

export function rfqRouter(eqService?: EngineeringQueryService): Router {
  const router = Router();
  const eqs = eqService ?? defaultEngineeringQueryService;

  /**
   * POST /api/v1/spaces/:id/rfq
   * Generates a Smart RFQ package for a space.
   */
  router.post("/:id/rfq", async (req: Request, res: Response) => {
    try {
      const spaceId = String(req.params["id"]);
      const { projectName, revision, oemName, oemContact, layout, bomComponents, targetQuantity, fabricationSpecs } =
        req.body as any;

      if (!layout || !bomComponents) {
        res.status(400).json({ error: "Missing required 'layout' or 'bomComponents' in payload." });
        return;
      }

      const bundle = await RfqBundleGenerator.generateBundle({
        projectName: projectName ?? `Space_${spaceId}`,
        revision: revision ?? "1.0.0",
        oemName: oemName ?? "Ansatz Space Member",
        oemContact: oemContact ?? "oem@modelscript.org",
        layout,
        bomComponents,
        targetQuantity: targetQuantity ?? 1000,
        fabricationSpecs,
      });

      spaceBundles.set(spaceId, bundle);

      res.json({
        success: true,
        spaceId,
        manifest: bundle.manifest,
        totalFilesGenerated: bundle.files.size,
        tarSizeBytes: bundle.tarArchive.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to generate RFQ bundle: ${msg}` });
    }
  });

  /**
   * GET /api/v1/spaces/:id/rfq/latest
   * Returns manifest and download link for latest RFQ package.
   */
  router.get("/:id/rfq/latest", (req: Request, res: Response) => {
    const spaceId = String(req.params["id"]);
    const bundle = spaceBundles.get(spaceId);
    if (!bundle) {
      res.status(404).json({ error: `No RFQ bundle found for Space ${spaceId}` });
      return;
    }
    res.json({
      manifest: bundle.manifest,
      files: Array.from(bundle.files.keys()),
      tarSizeBytes: bundle.tarArchive.length,
    });
  });

  /**
   * GET /api/v1/spaces/:id/rfq/download
   * Streams the uncompressed USTAR archive.
   */
  router.get("/:id/rfq/download", (req: Request, res: Response) => {
    const spaceId = String(req.params["id"]);
    const bundle = spaceBundles.get(spaceId);
    if (!bundle) {
      res.status(404).json({ error: `No RFQ bundle found for Space ${spaceId}` });
      return;
    }

    res.setHeader("Content-Type", "application/x-tar");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${bundle.manifest.project}_${bundle.manifest.revision}_rfq.tar"`,
    );
    res.send(Buffer.from(bundle.tarArchive));
  });

  /**
   * POST /api/v1/spaces/:id/eq
   * Files a spatial pin-annotated Engineering Query (EQ).
   */
  router.post("/:id/eq", (req: Request, res: Response) => {
    try {
      const spaceId = String(req.params["id"]);
      const {
        revision,
        boardCoordinates,
        layer,
        refDes,
        net,
        title,
        description,
        severity,
        authorId,
        authorName,
        authorOrg,
      } = req.body as any;

      if (!revision || !boardCoordinates || !layer || !title || !description) {
        res.status(400).json({ error: "Missing required fields for Engineering Query." });
        return;
      }

      const eq = eqs.createEQ({
        spaceId,
        revision,
        boardCoordinates,
        layer,
        refDes,
        net,
        title,
        description,
        severity,
        authorId: authorId ?? "user-cm-1",
        authorName: authorName ?? "CM Manufacturing Engineer",
        authorOrg: authorOrg ?? "EMS Partner",
      });

      res.status(201).json(eq);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to file EQ: ${msg}` });
    }
  });

  /**
   * GET /api/v1/spaces/:id/eq
   * Lists all EQs filed for this space.
   */
  router.get("/:id/eq", (req: Request, res: Response) => {
    const spaceId = String(req.params["id"]);
    const revision = typeof req.query["revision"] === "string" ? req.query["revision"] : undefined;
    const list = eqs.listEQsForSpace(spaceId, revision);
    res.json({ spaceId, totalQueries: list.length, queries: list });
  });

  /**
   * PATCH /api/v1/spaces/:id/eq/:eqId
   * Resolves an EQ (approves deviation, requests ECO, or clarifies).
   */
  router.patch("/:id/eq/:eqId", (req: Request, res: Response) => {
    try {
      const eqId = String(req.params["eqId"]);
      const { status, resolutionNotes, resolvedById, resolvedByName } = req.body as any;

      if (!status || !resolutionNotes) {
        res.status(400).json({ error: "Missing 'status' or 'resolutionNotes'." });
        return;
      }

      const updated = eqs.resolveEQ(eqId, {
        status,
        resolutionNotes,
        resolvedById: resolvedById ?? "user-oem-lead",
        resolvedByName: resolvedByName ?? "Lead Hardware Engineer",
      });

      if (!updated) {
        res.status(404).json({ error: `EQ '${eqId}' not found.` });
        return;
      }

      res.json(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to resolve EQ: ${msg}` });
    }
  });

  return router;
}

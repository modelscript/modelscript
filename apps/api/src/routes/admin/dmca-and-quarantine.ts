// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import { authRateLimiter } from "../../middleware/rate-limiter.js";
import { getClientIp } from "../../util/client-ip.js";
import { moderatorAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createDmcaAndQuarantineRouter({ database }: AdminRouteContext): Router {
  const router = express.Router();

  // ── DMCA Notices & Universal Resource Quarantine ──

  /**
   * POST /api/v1/admin/dmca/notices
   * Public intake for DMCA takedown requests
   */
  router.post("/admin/dmca/notices", authRateLimiter, express.json(), (req: Request, res: Response) => {
    const { claimantName, claimantEmail, copyrightOwner, workDescription, infringingUrl, resourceType, resourceId } =
      req.body;

    if (!claimantName || !claimantEmail || !copyrightOwner || !workDescription || !infringingUrl) {
      res.status(400).json({
        error:
          "Missing required DMCA fields (claimantName, claimantEmail, copyrightOwner, workDescription, infringingUrl)",
      });
      return;
    }

    if (
      String(claimantName).length > 256 ||
      String(claimantEmail).length > 256 ||
      String(copyrightOwner).length > 256 ||
      String(infringingUrl).length > 2048 ||
      String(workDescription).length > 10000
    ) {
      res.status(400).json({ error: "One or more DMCA notice fields exceed maximum allowed length" });
      return;
    }

    try {
      const notice = database.createDmcaNotice({
        claimantName: String(claimantName).slice(0, 256),
        claimantEmail: String(claimantEmail).slice(0, 256),
        copyrightOwner: String(copyrightOwner).slice(0, 256),
        workDescription: String(workDescription).slice(0, 10000),
        infringingUrl: String(infringingUrl).slice(0, 2048),
        resourceType: resourceType ? String(resourceType).slice(0, 64) : undefined,
        resourceId: resourceId ? String(resourceId).slice(0, 256) : undefined,
      });

      database.logAudit({
        actorId: null,
        action: "dmca_notice_filed",
        resourceType: resourceType || "package",
        resourceId: resourceId || null,
        ipAddress: getClientIp(req),
        details: { noticeId: notice.id, infringingUrl },
      });

      res.status(201).json({
        success: true,
        noticeId: notice.id,
        message: "DMCA takedown notice received and queued for statutory processing.",
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] File DMCA notice error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to file DMCA notice" });
    }
  });

  /**
   * GET /api/v1/admin/dmca/notices
   */
  router.get("/admin/dmca/notices", moderatorAuth, (req: Request, res: Response) => {
    try {
      const status = req.query["status"] as string | undefined;
      const notices = database.listDmcaNotices(status);
      res.json({ notices, count: notices.length });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/dmca/notices error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list DMCA notices" });
    }
  });

  /**
   * POST /api/v1/admin/dmca/notices/:id/resolve
   */
  router.post("/admin/dmca/notices/:id/resolve", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const id = Number(req.params["id"]);
    const { actionTaken, status: rawStatus, quarantineResource, resourceType, resourceId } = req.body;
    const status: "resolved" | "rejected" = rawStatus === "rejected" ? "rejected" : "resolved";

    if (!actionTaken || typeof actionTaken !== "string") {
      res.status(400).json({ error: "actionTaken is required" });
      return;
    }

    try {
      const notice = database.getDmcaNotice(id);
      if (!notice) {
        res.status(404).json({ error: "DMCA notice not found" });
        return;
      }

      let quarantinedRecord: { id: number; resourceType: string; resourceId: string } | null = null;
      if (quarantineResource && status === "resolved") {
        const resType = (typeof resourceType === "string" && resourceType.trim()) || notice.resource_type || "package";
        const resId =
          (typeof resourceId === "string" && resourceId.trim()) || notice.resource_id || notice.infringing_url;
        if (resType === "post" && resId) {
          const postId = Number(resId);
          if (Number.isFinite(postId)) {
            database.deletePost(postId);
          }
        }
        quarantinedRecord = database.quarantineResource({
          resourceType: resType,
          resourceId: resId,
          reason: actionTaken,
          dmcaNoticeId: id,
          quarantinedBy: req.user?.id ?? null,
        });
      }

      const success = database.resolveDmcaNotice(id, actionTaken, status);
      if (!success) {
        res.status(404).json({ error: "DMCA notice not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: status === "rejected" ? "dmca_notice_rejected" : "dmca_notice_resolved",
        resourceType: "dmca_notice",
        resourceId: String(id),
        ipAddress: getClientIp(req),
        details: {
          actionTaken,
          status,
          quarantineResource: Boolean(quarantineResource),
          quarantinedRecord,
        },
      });

      res.json({ success: true, noticeId: id, status, actionTaken, quarantinedRecord });
    } catch (err: unknown) {
      console.error("[AdminRouter] Resolve DMCA notice error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve DMCA notice" });
    }
  });

  /**
   * POST /api/v1/admin/dmca/notices/:id/counter-notice
   * Records a statutory DMCA 17 U.S.C. § 512(g) counter-notice with a 14-day restoration window
   */
  router.post(
    "/admin/dmca/notices/:id/counter-notice",
    moderatorAuth,
    express.json(),
    (req: Request, res: Response) => {
      const id = Number(req.params["id"]);
      const counterNoticeText =
        typeof req.body?.counterNoticeText === "string" ? req.body.counterNoticeText.trim() : "";

      if (!counterNoticeText) {
        res.status(400).json({ error: "counterNoticeText is required" });
        return;
      }

      try {
        const result = database.fileDmcaCounterNotice(id, counterNoticeText);
        if (!result.success) {
          res.status(404).json({ error: "DMCA notice not found" });
          return;
        }

        database.logAudit({
          actorId: req.user?.id || null,
          action: "dmca_counter_notice_recorded",
          resourceType: "dmca_notice",
          resourceId: String(id),
          ipAddress: getClientIp(req),
          details: { noticeId: id, restoreAfter: result.restoreAfter, counterNoticeText },
        });

        res.json({
          success: true,
          noticeId: id,
          restoreAfter: result.restoreAfter,
          restoreEligibleAt: result.restoreAfter,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to record DMCA counter-notice" });
      }
    },
  );

  /**
   * GET /api/v1/admin/quarantine
   * Lists quarantined resources across posts, packages, repositories, FMUs, and solutions
   */
  router.get("/admin/quarantine", moderatorAuth, (req: Request, res: Response) => {
    try {
      const status = req.query["status"] as string | undefined;
      const items = database.listQuarantinedResources(status);
      res.json({ items, resources: items, count: items.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list quarantined resources" });
    }
  });

  /**
   * POST /api/v1/admin/quarantine/restore
   * Restores a previously quarantined resource
   */
  router.post("/admin/quarantine/restore", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const resourceType = typeof req.body?.resourceType === "string" ? req.body.resourceType.trim() : "";
    const resourceId = typeof req.body?.resourceId === "string" ? req.body.resourceId.trim() : "";
    if (!resourceType || !resourceId) {
      res.status(400).json({ error: "resourceType and resourceId are required" });
      return;
    }

    try {
      const restored = database.restoreQuarantinedResource(resourceType, resourceId);
      if (!restored) {
        res.status(404).json({ error: "Quarantined resource not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "quarantined_resource_restored",
        resourceType,
        resourceId,
        ipAddress: getClientIp(req),
      });

      res.json({ success: true, resourceType, resourceId });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to restore quarantined resource" });
    }
  });

  return router;
}

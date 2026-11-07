// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import { assertSafePublicUrl } from "../util/ssrf.js";

export function pushRouter(database: LibraryDatabase): Router {
  const router = express.Router();

  /**
   * GET /api/v1/push/vapid-key
   * Public endpoint to retrieve server's VAPID public key for Web Push subscription.
   */
  router.get("/push/vapid-key", (_req: Request, res: Response) => {
    const keys = database.getInstanceVapidKeys();
    res.json({ publicKey: keys.publicKey });
  });

  /**
   * GET /api/v1/push/subscription
   * Mastodon API parity: Retrieve current user's active push subscription.
   */
  router.get("/push/subscription", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subs = database.listPushSubscriptions(userId);
    if (!subs || subs.length === 0) {
      res.status(404).json({ error: "No active push subscription found" });
      return;
    }
    const latest = subs[0]!;
    const keys = database.getInstanceVapidKeys();
    res.json({
      id: latest.id,
      endpoint: latest.endpoint,
      server_key: keys.publicKey,
      alerts: latest.alerts,
      policy: latest.policy,
    });
  });

  /**
   * POST /api/v1/push/subscription
   * Mastodon API parity: Register a new push subscription.
   */
  router.post("/push/subscription", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subData = req.body?.subscription || req.body;
    const endpoint = subData?.endpoint;
    const p256dh = subData?.keys?.p256dh || req.body?.p256dh;
    const auth = subData?.keys?.auth || req.body?.auth;
    const alerts = req.body?.data?.alerts || req.body?.alerts;
    const policy = req.body?.data?.policy || req.body?.policy || "all";

    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: "Missing required subscription endpoint or keys." });
      return;
    }

    try {
      assertSafePublicUrl(String(endpoint));
      const saved = database.upsertPushSubscription(
        userId,
        String(endpoint),
        String(p256dh),
        String(auth),
        alerts && typeof alerts === "object" ? alerts : undefined,
        policy,
      );

      const keys = database.getInstanceVapidKeys();
      res.status(201).json({
        id: saved.id,
        endpoint: saved.endpoint,
        server_key: keys.publicKey,
        alerts: saved.alerts,
        policy: saved.policy,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to register push subscription";
      res.status(400).json({ error: msg });
    }
  });

  /**
   * PUT /api/v1/push/subscription
   * Mastodon API parity: Update alerts or policy on active push subscription.
   */
  router.put("/push/subscription", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subs = database.listPushSubscriptions(userId);
    if (!subs || subs.length === 0) {
      res.status(404).json({ error: "No active push subscription found to update" });
      return;
    }
    const target = subs[0]!;
    const alerts = req.body?.data?.alerts || req.body?.alerts || target.alerts;
    const policy = req.body?.data?.policy || req.body?.policy || target.policy;

    const updated = database.upsertPushSubscription(
      userId,
      target.endpoint,
      target.p256dh,
      target.auth,
      alerts,
      policy,
    );

    const keys = database.getInstanceVapidKeys();
    res.json({
      id: updated.id,
      endpoint: updated.endpoint,
      server_key: keys.publicKey,
      alerts: updated.alerts,
      policy: updated.policy,
    });
  });

  /**
   * DELETE /api/v1/push/subscription
   * Mastodon API parity: Remove user's push subscription.
   */
  router.delete("/push/subscription", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subs = database.listPushSubscriptions(userId);
    if (!subs || subs.length === 0) {
      res.status(404).json({ error: "No active push subscription found" });
      return;
    }
    for (const sub of subs) {
      database.deletePushSubscription(userId, sub.id);
    }
    res.json({ success: true });
  });

  return router;
}

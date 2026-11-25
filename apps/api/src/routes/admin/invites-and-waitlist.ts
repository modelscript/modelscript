// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { resolveBrandInstanceName } from "../../util/registration-policy.js";
import { adminAuth, moderatorAuth, staffAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createInvitesAndWaitlistRouter({ database }: AdminRouteContext): Router {
  const router = express.Router();

  // ── Registration Invites ──

  /**
   * GET /api/v1/admin/invites
   * Lists registration invite codes
   */
  router.get("/admin/invites", adminAuth, (_req: Request, res: Response) => {
    try {
      const invites = database.listInstanceInvites();
      res.json({ invites, count: invites.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list instance invites" });
    }
  });

  /**
   * POST /api/v1/admin/invites
   * Generates a new registration invite code with optional maxUses, initialCredits, assignedRole, expiration, and recipientEmail
   */
  router.post("/admin/invites", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const recipientEmail =
        typeof req.body?.recipientEmail === "string" && req.body.recipientEmail.trim()
          ? req.body.recipientEmail.trim()
          : undefined;
      const invite = database.createInstanceInvite({
        code: typeof req.body?.code === "string" ? req.body.code : undefined,
        createdBy: req.user?.id ?? null,
        maxUses: req.body?.maxUses !== undefined ? Number(req.body.maxUses) : undefined,
        initialCredits: req.body?.initialCredits !== undefined ? Number(req.body.initialCredits) : undefined,
        assignedRole: typeof req.body?.assignedRole === "string" ? req.body.assignedRole : undefined,
        note:
          typeof req.body?.note === "string" ? req.body.note : recipientEmail ? `Invited ${recipientEmail}` : undefined,
        expiresInDays: req.body?.expiresInDays !== undefined ? Number(req.body.expiresInDays) : undefined,
      });

      if (recipientEmail) {
        void defaultMailer
          .sendInviteEmail(recipientEmail, invite.code, {
            instanceName: resolveBrandInstanceName(database),
            invitedBy: req.user?.username,
          })
          .catch(() => {
            // Non-blocking: invite code remains valid even if outbound email fails
          });
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "instance_invite_created",
        resourceType: "invite",
        resourceId: invite.code,
        ipAddress: getClientIp(req),
        details: { ...invite, ...(recipientEmail ? { recipientEmail } : {}) },
      });

      res.status(201).json({ success: true, invite, emailDispatched: Boolean(recipientEmail) });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create invite code" });
    }
  });

  /**
   * DELETE /api/v1/admin/invites/:id
   * Revokes an existing invite code
   */
  router.delete("/admin/invites/:id", adminAuth, (req: Request, res: Response) => {
    try {
      const id = Number(req.params["id"]);
      const revoked = database.revokeInstanceInvite(id);
      if (!revoked) {
        res.status(404).json({ error: "Invite not found or already revoked" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "instance_invite_revoked",
        resourceType: "invite",
        resourceId: String(id),
        ipAddress: getClientIp(req),
      });

      res.json({ success: true, id });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to revoke invite" });
    }
  });

  // ── Waitlist Management ──

  /**
   * GET /api/v1/admin/waitlist
   * Returns paginated waitlist applications filtered by status
   */
  router.get("/admin/waitlist", staffAuth, (req: Request, res: Response) => {
    try {
      const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 50));
      const offset = Math.max(0, Number(req.query["offset"]) || 0);

      const submissions = database.getWaitlistSubmissions({
        ...(status && (status === "pending" || status === "approved" || status === "rejected") ? { status } : {}),
        limit,
        offset,
      });

      res.json({ submissions, count: submissions.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch waitlist" });
    }
  });

  /**
   * POST /api/v1/admin/waitlist/:id/approve
   * Approves a waitlist candidate, generating an invite code and optionally dispatching notification
   */
  router.post("/admin/waitlist/:id/approve", moderatorAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params["id"]);
      const result = database.approveWaitlistSubmission(id, req.user?.id || null);
      if (!result.success || !result.submission) {
        res.status(404).json({ error: "Waitlist submission not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "waitlist_submission_approved",
        resourceType: "waitlist",
        resourceId: String(id),
        ipAddress: getClientIp(req),
        details: {
          email: result.submission.email,
          inviteCode: result.inviteCode,
        },
      });

      // Attempt to send invite email if mailer is configured
      if (defaultMailer.isConfiguredForLiveDelivery() && result.submission.email && result.inviteCode) {
        try {
          await defaultMailer.sendInviteEmail(result.submission.email, result.inviteCode, {
            instanceName: resolveBrandInstanceName(database),
          });
        } catch {
          // Non-blocking mailer warning
        }
      }

      res.json({
        success: true,
        submission: result.submission,
        inviteCode: result.inviteCode,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to approve waitlist submission" });
    }
  });

  /**
   * POST /api/v1/admin/waitlist/:id/reject
   * Rejects a waitlist candidate
   */
  router.post("/admin/waitlist/:id/reject", moderatorAuth, express.json(), (req: Request, res: Response) => {
    try {
      const id = Number(req.params["id"]);
      const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;
      const rejected = database.rejectWaitlistSubmission(id, req.user?.id || null, reason);
      if (!rejected) {
        res.status(404).json({ error: "Waitlist submission not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "waitlist_submission_rejected",
        resourceType: "waitlist",
        resourceId: String(id),
        ipAddress: getClientIp(req),
        details: reason ? { reason } : undefined,
      });

      res.json({ success: true, id, ...(reason ? { reason } : {}) });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to reject waitlist submission" });
    }
  });

  return router;
}

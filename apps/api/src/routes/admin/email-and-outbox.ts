// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import {
  defaultMailer,
  type EmailTemplateId,
  type EmailTemplateOverride,
  type EmailThemeConfig,
  type MailerDriverPreference,
  type MailerRuntimeConfig,
  type SmtpTlsMode,
} from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { adminAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createEmailAndOutboxRouter({ database, verifyAdminSudo }: AdminRouteContext): Router {
  const router = express.Router();

  /**
   * POST /api/v1/admin/system/test-email
   * Dispatches a live diagnostic test email using the active MailerService driver (or renders a specific templateId)
   */
  router.post(
    "/admin/system/test-email",
    adminAuth,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      try {
        database.syncMailerFromDatabase();
        const settings = database.getInstanceSettings();
        const recipient =
          (typeof req.body?.recipientEmail === "string" && req.body.recipientEmail.trim()) ||
          req.user?.email ||
          settings.contactEmail ||
          "admin@modelscript.org";

        const rawTemplateId = typeof req.body?.templateId === "string" ? req.body.templateId.trim() : "";
        const validTemplateIds: EmailTemplateId[] = [
          "verification",
          "password_reset",
          "invite",
          "security_alert",
          "social_notification",
          "digest",
        ];

        let mailResult: { success: boolean; messageId?: string | undefined; error?: string | undefined };
        if (validTemplateIds.includes(rawTemplateId as EmailTemplateId)) {
          const tplId = rawTemplateId as EmailTemplateId;
          const preview = defaultMailer.previewTemplate(tplId, {
            variables: {
              instanceName: settings.instanceName,
              username: req.user?.username || "admin",
            },
          });
          mailResult = await defaultMailer.sendMail({
            to: recipient,
            subject: `[TEST] ${preview.subject}`,
            text: preview.text,
            html: preview.html,
            templateId: tplId,
          });
        } else {
          mailResult = await defaultMailer.sendMail({
            to: recipient,
            subject: `[${settings.instanceName}] Outbound Mailer Diagnostic Test`,
            text: `This is an automated diagnostic test email from ${settings.instanceName} (driver: ${defaultMailer.getDriver()}) triggered at ${new Date().toISOString()}.`,
            templateId: "test",
          });
        }

        database.logAudit({
          actorId: req.user?.id || null,
          action: "admin.test_email_sent",
          resourceType: "system",
          resourceId: recipient,
          ipAddress: getClientIp(req),
          details: {
            recipient,
            templateId: rawTemplateId || "test",
            driver: defaultMailer.getDriver(),
            success: mailResult.success,
            messageId: mailResult.messageId,
            error: mailResult.error,
          },
        });

        if (!mailResult.success) {
          res.status(502).json({
            success: false,
            driver: defaultMailer.getDriver(),
            recipient,
            error: mailResult.error || "Outbound email delivery failed",
          });
          return;
        }

        res.json({
          success: true,
          driver: defaultMailer.getDriver(),
          recipient,
          templateId: rawTemplateId || "test",
          messageId: mailResult.messageId,
          sentAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to dispatch test email" });
      }
    },
  );

  // ── Admin Email Transport, SMTP Handshake Diagnostics, Template Studio & Outbox ──

  /**
   * GET /api/v1/admin/email/config
   * Returns current email transport settings, masked secret state, customizable templates, and recent outbox deliveries
   */
  router.get("/admin/email/config", adminAuth, (_req: Request, res: Response) => {
    try {
      const config = database.getEmailConfig();
      const outbox = defaultMailer.getSentMails().slice().reverse();
      res.json({
        config,
        outbox,
        outboxCount: outbox.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load admin email configuration" });
    }
  });

  /**
   * PUT / PATCH /api/v1/admin/email/config
   * Updates email transport settings, encrypts secrets at rest, saves template overrides, and hot-reloads defaultMailer
   */
  const handleUpdateEmailConfig = (req: Request, res: Response): void => {
    try {
      const patch = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const config = database.updateEmailConfig(patch, req.user?.id ?? null);

      const redactedDetails: Record<string, unknown> = { ...patch };
      if ("smtpPass" in redactedDetails) redactedDetails["smtpPass"] = "[REDACTED]";
      if ("sendgridApiKey" in redactedDetails) redactedDetails["sendgridApiKey"] = "[REDACTED]";
      if ("resendApiKey" in redactedDetails) redactedDetails["resendApiKey"] = "[REDACTED]";

      database.logAudit({
        actorId: req.user?.id || null,
        action: "admin.email_config_updated",
        resourceType: "instance_settings",
        resourceId: "email_config",
        ipAddress: getClientIp(req),
        details: redactedDetails,
      });

      res.json({
        success: true,
        config,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update email configuration" });
    }
  };

  router.put("/admin/email/config", adminAuth, express.json(), verifyAdminSudo, handleUpdateEmailConfig);
  router.patch("/admin/email/config", adminAuth, express.json(), verifyAdminSudo, handleUpdateEmailConfig);

  /**
   * POST /api/v1/admin/email/test-connection
   * Runs step-by-step DNS, TCP, EHLO, STARTTLS, and AUTH diagnostics against the active or candidate SMTP/API configuration
   */
  router.post(
    "/admin/email/test-connection",
    adminAuth,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      try {
        database.syncMailerFromDatabase();
        const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
        const overrideConfig: MailerRuntimeConfig = {
          ...(typeof body["driver"] === "string" ? { driver: body["driver"] as MailerDriverPreference } : {}),
          ...(typeof body["smtpHost"] === "string" ? { smtpHost: body["smtpHost"] } : {}),
          ...(body["smtpPort"] !== undefined ? { smtpPort: Number(body["smtpPort"]) } : {}),
          ...(typeof body["smtpUser"] === "string" ? { smtpUser: body["smtpUser"] } : {}),
          ...(typeof body["smtpPass"] === "string" && body["smtpPass"] ? { smtpPass: body["smtpPass"] } : {}),
          ...(typeof body["smtpTlsMode"] === "string" ? { smtpTlsMode: body["smtpTlsMode"] as SmtpTlsMode } : {}),
          ...(body["smtpTlsRejectUnauthorized"] !== undefined
            ? { smtpTlsRejectUnauthorized: Boolean(body["smtpTlsRejectUnauthorized"]) }
            : {}),
          ...(typeof body["smtpCaCertPath"] === "string" ? { smtpCaCertPath: body["smtpCaCertPath"] } : {}),
          ...(typeof body["sendgridApiKey"] === "string" && body["sendgridApiKey"]
            ? { sendgridApiKey: body["sendgridApiKey"] }
            : {}),
          ...(typeof body["resendApiKey"] === "string" && body["resendApiKey"]
            ? { resendApiKey: body["resendApiKey"] }
            : {}),
        };

        const diagnostic = await defaultMailer.testConnection(overrideConfig);

        database.logAudit({
          actorId: req.user?.id || null,
          action: "admin.email_connection_tested",
          resourceType: "system",
          resourceId: diagnostic.driver,
          ipAddress: getClientIp(req),
          details: {
            driver: diagnostic.driver,
            host: diagnostic.host,
            port: diagnostic.port,
            success: diagnostic.success,
            totalLatencyMs: diagnostic.totalLatencyMs,
          },
        });

        res.json(diagnostic);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to run connection diagnostics" });
      }
    },
  );

  /**
   * POST /api/v1/admin/email/preview
   * Renders a live HTML and plaintext preview of an email template with sample or custom variables and theme overrides
   */
  router.post("/admin/email/preview", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      database.syncMailerFromDatabase();
      const rawTemplateId = typeof req.body?.templateId === "string" ? req.body.templateId.trim() : "verification";
      const validIds: EmailTemplateId[] = [
        "verification",
        "password_reset",
        "invite",
        "security_alert",
        "social_notification",
        "digest",
      ];
      const templateId: EmailTemplateId = validIds.includes(rawTemplateId as EmailTemplateId)
        ? (rawTemplateId as EmailTemplateId)
        : "verification";

      const templateOverride =
        req.body?.templateOverride && typeof req.body.templateOverride === "object"
          ? (req.body.templateOverride as EmailTemplateOverride)
          : undefined;
      const themeOverride =
        req.body?.themeOverride && typeof req.body.themeOverride === "object"
          ? (req.body.themeOverride as EmailThemeConfig)
          : undefined;
      const variables =
        req.body?.variables && typeof req.body.variables === "object"
          ? (req.body.variables as Record<string, string>)
          : undefined;

      const preview = defaultMailer.previewTemplate(templateId, {
        variables,
        templateOverride,
        themeOverride,
      });

      res.json({
        templateId,
        ...preview,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to render email template preview" });
    }
  });

  /**
   * GET /api/v1/admin/email/outbox
   * Returns recent outbound email deliveries and statuses
   */
  router.get("/admin/email/outbox", adminAuth, (_req: Request, res: Response) => {
    try {
      const items = defaultMailer.getSentMails().slice().reverse();
      res.json({
        items,
        count: items.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch email outbox" });
    }
  });

  /**
   * POST /api/v1/admin/email/outbox/:id/retry
   * Retries a recent outbound email from the outbox
   */
  router.post(
    "/admin/email/outbox/:id/retry",
    adminAuth,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      try {
        database.syncMailerFromDatabase();
        const id = String(req.params["id"] || "").trim();
        const result = await defaultMailer.retryMail(id);
        if (!result.success) {
          res.status(result.error?.includes("not found") ? 404 : 502).json({
            success: false,
            error: result.error || "Retry failed",
          });
          return;
        }
        database.logAudit({
          actorId: req.user?.id || null,
          action: "admin.email_outbox_retried",
          resourceType: "system",
          resourceId: id,
          ipAddress: getClientIp(req),
          details: { originalId: id, newMessageId: result.messageId },
        });
        res.json({
          success: true,
          originalId: id,
          messageId: result.messageId,
          outbox: defaultMailer.getSentMails().slice().reverse(),
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to retry email" });
      }
    },
  );

  /**
   * POST /api/v1/admin/email/dispatch-digests
   * Compiles and sends pending daily/weekly notification digest emails
   */
  router.post(
    "/admin/email/dispatch-digests",
    adminAuth,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      try {
        database.syncMailerFromDatabase();
        const rawFreq = typeof req.body?.frequency === "string" ? req.body.frequency.trim().toLowerCase() : undefined;
        const frequency: "daily" | "weekly" | undefined =
          rawFreq === "daily" || rawFreq === "weekly" ? rawFreq : undefined;

        const digestResult = await database.dispatchEmailDigests(frequency);

        database.logAudit({
          actorId: req.user?.id || null,
          action: "admin.email_digests_dispatched",
          resourceType: "system",
          resourceId: frequency || "all",
          ipAddress: getClientIp(req),
          details: {
            frequency: frequency || "all",
            dispatchedUsers: digestResult.dispatchedUsers,
            totalItemsCompiled: digestResult.totalItemsCompiled,
          },
        });

        res.json({
          success: true,
          ...digestResult,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to dispatch email digests" });
      }
    },
  );

  return router;
}

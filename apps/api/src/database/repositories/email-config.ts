// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  defaultMailer,
  type EmailTemplateDefinition,
  type EmailTemplateId,
  type EmailTemplateOverride,
  type EmailThemeConfig,
  type MailerDriver,
  type MailerDriverPreference,
  type SmtpTlsMode,
} from "../../services/mailer.js";
import { decryptSecretAtRest, encryptSecretAtRest, maskSecretPreview } from "../../util/totp.js";
import { BaseRepository } from "./base.js";

export interface EmailConfigView {
  driver: MailerDriverPreference;
  activeDriver: MailerDriver;
  configuredForLiveDelivery: boolean;
  airgapEnforced: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassConfigured: boolean;
  smtpPassMasked: string;
  smtpTlsMode: SmtpTlsMode;
  smtpTlsRejectUnauthorized: boolean;
  smtpCaCertPath: string;
  sendgridApiKeyConfigured: boolean;
  sendgridApiKeyMasked: string;
  resendApiKeyConfigured: boolean;
  resendApiKeyMasked: string;
  theme: Required<EmailThemeConfig>;
  templates: Record<EmailTemplateId, EmailTemplateDefinition>;
  defaultTemplates: Record<EmailTemplateId, EmailTemplateDefinition>;
  templateOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
  lockedByEnv: string[];
}

export class EmailConfigRepository extends BaseRepository {
  syncMailerFromDatabase(): void {
    try {
      const rows = this.db.prepare(`SELECT key, value FROM instance_settings`).all() as {
        key: string;
        value: string;
      }[];
      const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
      const instanceSettings = this.facade.getInstanceSettings();

      const rawDriver = (process.env["EMAIL_DRIVER"] || map.get("emailDriver") || "auto").trim().toLowerCase();
      const driver: MailerDriverPreference =
        rawDriver === "console" || rawDriver === "smtp" || rawDriver === "sendgrid" || rawDriver === "resend"
          ? rawDriver
          : "auto";

      const rawTls = (map.get("smtpTlsMode") || "starttls").trim().toLowerCase();
      const smtpTlsMode: SmtpTlsMode = rawTls === "implicit" || rawTls === "none" ? rawTls : "starttls";

      let smtpPass: string | undefined;
      const encSmtpPass = map.get("smtpPassEncrypted");
      if (encSmtpPass) {
        try {
          smtpPass = decryptSecretAtRest(encSmtpPass);
        } catch {
          // Undecryptable stored SMTP secret falls back to unset
        }
      }

      let sendgridApiKey: string | undefined;
      const encSendgrid = map.get("sendgridApiKeyEncrypted");
      if (encSendgrid) {
        try {
          sendgridApiKey = decryptSecretAtRest(encSendgrid);
        } catch {
          // Undecryptable stored SendGrid secret falls back to unset
        }
      }

      let resendApiKey: string | undefined;
      const encResend = map.get("resendApiKeyEncrypted");
      if (encResend) {
        try {
          resendApiKey = decryptSecretAtRest(encResend);
        } catch {
          // Undecryptable stored Resend secret falls back to unset
        }
      }

      let templates: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {};
      const rawTemplates = map.get("emailTemplatesJson");
      if (rawTemplates) {
        try {
          const parsed = JSON.parse(rawTemplates) as unknown;
          if (parsed && typeof parsed === "object") {
            templates = parsed as Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
          }
        } catch {
          // Malformed template override JSON falls back to defaults
        }
      }

      defaultMailer.configure({
        driver,
        fromName: map.get("emailFromName") || `${instanceSettings.instanceName} Security`,
        fromEmail: map.get("emailFromEmail") || "noreply@ansatz.social",
        replyTo: map.get("emailReplyTo") || instanceSettings.contactEmail || undefined,
        smtpHost: map.get("smtpHost") || undefined,
        smtpPort: map.get("smtpPort") ? Number.parseInt(map.get("smtpPort")!, 10) || 587 : 587,
        smtpUser: map.get("smtpUser") || undefined,
        smtpPass,
        smtpTlsMode,
        smtpTlsRejectUnauthorized: map.get("smtpTlsRejectUnauthorized") !== "false",
        smtpCaCertPath: map.get("smtpCaCertPath") || undefined,
        sendgridApiKey,
        resendApiKey,
        instanceName: instanceSettings.instanceName,
        theme: {
          headerBgColor: map.get("emailHeaderBgColor") || "#0f172a",
          accentColor: map.get("emailAccentColor") || instanceSettings.brandAccentColor || "#2563eb",
          logoUrl: map.get("emailLogoUrl") || instanceSettings.brandLogoUrl || "",
          footerText: map.get("emailFooterText") || "",
        },
        templates,
      });
    } catch {
      // Non-fatal if instance_settings is not yet initialized
    }
  }

  getEmailConfig(): EmailConfigView {
    this.syncMailerFromDatabase();
    const rows = this.db.prepare(`SELECT key, value FROM instance_settings`).all() as {
      key: string;
      value: string;
    }[];
    const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
    const instanceSettings = this.facade.getInstanceSettings();

    const lockedByEnv: string[] = [];
    if (process.env["EMAIL_DRIVER"]) lockedByEnv.push("driver");
    if (process.env["EMAIL_FROM"]) lockedByEnv.push("fromEmail", "fromName");
    if (process.env["EMAIL_REPLY_TO"]) lockedByEnv.push("replyTo");
    if (process.env["SMTP_HOST"]) lockedByEnv.push("smtpHost");
    if (process.env["SMTP_PORT"]) lockedByEnv.push("smtpPort");
    if (process.env["SMTP_USER"]) lockedByEnv.push("smtpUser");
    if (process.env["SMTP_PASS"]) lockedByEnv.push("smtpPass");
    if (process.env["SMTP_SECURE"] || process.env["SMTP_IGNORE_STARTTLS"]) lockedByEnv.push("smtpTlsMode");
    if (process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== undefined) lockedByEnv.push("smtpTlsRejectUnauthorized");
    if (process.env["SMTP_CA_CERT_PATH"]) lockedByEnv.push("smtpCaCertPath");
    if (process.env["SENDGRID_API_KEY"]) lockedByEnv.push("sendgridApiKey");
    if (process.env["RESEND_API_KEY"]) lockedByEnv.push("resendApiKey");

    const rawDriver = (process.env["EMAIL_DRIVER"] || map.get("emailDriver") || "auto").trim().toLowerCase();
    const driver: MailerDriverPreference =
      rawDriver === "console" || rawDriver === "smtp" || rawDriver === "sendgrid" || rawDriver === "resend"
        ? rawDriver
        : "auto";

    const smtpPort = Number.parseInt(process.env["SMTP_PORT"] || map.get("smtpPort") || "587", 10) || 587;
    const rawTls = (map.get("smtpTlsMode") || (smtpPort === 465 ? "implicit" : "starttls")).trim().toLowerCase();
    const smtpTlsMode: SmtpTlsMode =
      process.env["SMTP_SECURE"] === "true"
        ? "implicit"
        : process.env["SMTP_IGNORE_STARTTLS"] === "true"
          ? "none"
          : rawTls === "implicit" || rawTls === "none"
            ? rawTls
            : "starttls";

    const rawSmtpPass = process.env["SMTP_PASS"] || map.get("smtpPassEncrypted") || "";
    const rawSendgridKey = process.env["SENDGRID_API_KEY"] || map.get("sendgridApiKeyEncrypted") || "";
    const rawResendKey = process.env["RESEND_API_KEY"] || map.get("resendApiKeyEncrypted") || "";

    let templateOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {};
    const rawTemplates = map.get("emailTemplatesJson");
    if (rawTemplates) {
      try {
        const parsed = JSON.parse(rawTemplates) as unknown;
        if (parsed && typeof parsed === "object") {
          templateOverrides = parsed as Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
        }
      } catch {
        // Malformed template override JSON falls back to defaults
      }
    }

    return {
      driver,
      activeDriver: defaultMailer.getDriver(),
      configuredForLiveDelivery: defaultMailer.isConfiguredForLiveDelivery(),
      airgapEnforced: process.env["AIRGAP_ENFORCED"] === "true",
      fromName: map.get("emailFromName") || `${instanceSettings.instanceName} Security`,
      fromEmail: process.env["EMAIL_FROM"] || map.get("emailFromEmail") || "noreply@ansatz.social",
      replyTo: process.env["EMAIL_REPLY_TO"] || map.get("emailReplyTo") || instanceSettings.contactEmail || "",
      smtpHost: process.env["SMTP_HOST"] || map.get("smtpHost") || "",
      smtpPort,
      smtpUser: process.env["SMTP_USER"] || map.get("smtpUser") || "",
      smtpPassConfigured: Boolean(rawSmtpPass),
      smtpPassMasked: maskSecretPreview(rawSmtpPass),
      smtpTlsMode,
      smtpTlsRejectUnauthorized:
        process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== undefined
          ? process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== "false"
          : map.get("smtpTlsRejectUnauthorized") !== "false",
      smtpCaCertPath: process.env["SMTP_CA_CERT_PATH"] || map.get("smtpCaCertPath") || "",
      sendgridApiKeyConfigured: Boolean(rawSendgridKey),
      sendgridApiKeyMasked: maskSecretPreview(rawSendgridKey),
      resendApiKeyConfigured: Boolean(rawResendKey),
      resendApiKeyMasked: maskSecretPreview(rawResendKey),
      theme: {
        headerBgColor: map.get("emailHeaderBgColor") || "#0f172a",
        accentColor: map.get("emailAccentColor") || instanceSettings.brandAccentColor || "#2563eb",
        logoUrl: map.get("emailLogoUrl") || instanceSettings.brandLogoUrl || "",
        footerText: map.get("emailFooterText") || "",
      },
      templates: defaultMailer.getEffectiveTemplates(),
      defaultTemplates: defaultMailer.getDefaultTemplates(),
      templateOverrides,
      lockedByEnv,
    };
  }

  updateEmailConfig(patch: Record<string, unknown>, actorId: number | null = null): EmailConfigView {
    const upsertStmt = this.db.prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    );
    const deleteStmt = this.db.prepare(`DELETE FROM instance_settings WHERE key = ?`);

    const current = this.getEmailConfig();
    let nextOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {
      ...current.templateOverrides,
    };

    const validActorId = this.facade.instanceAdmin.resolveValidActorId(actorId);

    const tx = this.db.transaction(() => {
      if (typeof patch["driver"] === "string") {
        upsertStmt.run("emailDriver", patch["driver"].trim().toLowerCase(), validActorId);
      }
      if (typeof patch["fromName"] === "string") {
        upsertStmt.run("emailFromName", patch["fromName"].trim(), validActorId);
      }
      if (typeof patch["fromEmail"] === "string") {
        upsertStmt.run("emailFromEmail", patch["fromEmail"].trim(), validActorId);
      }
      if (typeof patch["replyTo"] === "string") {
        upsertStmt.run("emailReplyTo", patch["replyTo"].trim(), validActorId);
      }
      if (typeof patch["smtpHost"] === "string") {
        upsertStmt.run("smtpHost", patch["smtpHost"].trim(), validActorId);
      }
      if (patch["smtpPort"] !== undefined) {
        const port = Math.max(1, Math.min(65535, Number.parseInt(String(patch["smtpPort"]), 10) || 587));
        upsertStmt.run("smtpPort", String(port), validActorId);
      }
      if (typeof patch["smtpUser"] === "string") {
        upsertStmt.run("smtpUser", patch["smtpUser"].trim(), validActorId);
      }
      if (typeof patch["smtpTlsMode"] === "string") {
        upsertStmt.run("smtpTlsMode", patch["smtpTlsMode"].trim().toLowerCase(), validActorId);
      }
      if (patch["smtpTlsRejectUnauthorized"] !== undefined) {
        upsertStmt.run("smtpTlsRejectUnauthorized", String(Boolean(patch["smtpTlsRejectUnauthorized"])), validActorId);
      }
      if (typeof patch["smtpCaCertPath"] === "string") {
        upsertStmt.run("smtpCaCertPath", patch["smtpCaCertPath"].trim(), validActorId);
      }

      // Encrypted secrets at rest
      if (patch["clearSmtpPass"] === true) {
        deleteStmt.run("smtpPassEncrypted");
      } else if (typeof patch["smtpPass"] === "string" && patch["smtpPass"].trim()) {
        upsertStmt.run("smtpPassEncrypted", encryptSecretAtRest(patch["smtpPass"].trim()), validActorId);
      }

      if (patch["clearSendgridApiKey"] === true) {
        deleteStmt.run("sendgridApiKeyEncrypted");
      } else if (typeof patch["sendgridApiKey"] === "string" && patch["sendgridApiKey"].trim()) {
        upsertStmt.run("sendgridApiKeyEncrypted", encryptSecretAtRest(patch["sendgridApiKey"].trim()), validActorId);
      }

      if (patch["clearResendApiKey"] === true) {
        deleteStmt.run("resendApiKeyEncrypted");
      } else if (typeof patch["resendApiKey"] === "string" && patch["resendApiKey"].trim()) {
        upsertStmt.run("resendApiKeyEncrypted", encryptSecretAtRest(patch["resendApiKey"].trim()), validActorId);
      }

      // Theme settings
      if (patch["theme"] && typeof patch["theme"] === "object") {
        const theme = patch["theme"] as Record<string, unknown>;
        if (typeof theme["headerBgColor"] === "string") {
          upsertStmt.run("emailHeaderBgColor", theme["headerBgColor"].trim(), validActorId);
        }
        if (typeof theme["accentColor"] === "string") {
          upsertStmt.run("emailAccentColor", theme["accentColor"].trim(), validActorId);
        }
        if (typeof theme["logoUrl"] === "string") {
          upsertStmt.run("emailLogoUrl", theme["logoUrl"].trim(), validActorId);
        }
        if (typeof theme["footerText"] === "string") {
          upsertStmt.run("emailFooterText", theme["footerText"].trim(), validActorId);
        }
      }

      // Template overrides & reset support
      if (typeof patch["resetTemplateId"] === "string") {
        const resetId = patch["resetTemplateId"] as EmailTemplateId;
        const { [resetId]: _removed, ...rest } = nextOverrides;
        nextOverrides = rest;
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), validActorId);
      }
      if (patch["resetAllTemplates"] === true) {
        nextOverrides = {};
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), validActorId);
      }
      if (patch["templates"] && typeof patch["templates"] === "object") {
        const incoming = patch["templates"] as Record<string, EmailTemplateOverride>;
        for (const [tplId, ov] of Object.entries(incoming)) {
          if (!ov || typeof ov !== "object") continue;
          const validIds: EmailTemplateId[] = [
            "verification",
            "password_reset",
            "invite",
            "security_alert",
            "social_notification",
            "digest",
          ];
          if (!validIds.includes(tplId as EmailTemplateId)) continue;
          nextOverrides[tplId as EmailTemplateId] = {
            ...(nextOverrides[tplId as EmailTemplateId] || {}),
            ...(ov.subject !== undefined ? { subject: String(ov.subject) } : {}),
            ...(ov.heading !== undefined ? { heading: String(ov.heading) } : {}),
            ...(ov.body !== undefined ? { body: String(ov.body) } : {}),
            ...(ov.ctaLabel !== undefined ? { ctaLabel: String(ov.ctaLabel) } : {}),
            ...(ov.enabled !== undefined ? { enabled: Boolean(ov.enabled) } : {}),
          };
        }
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), validActorId);
      }
    });

    tx();
    return this.getEmailConfig();
  }
}

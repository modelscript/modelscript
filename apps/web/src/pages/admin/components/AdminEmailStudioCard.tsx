// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  EyeIcon,
  LockIcon,
  MailIcon,
  PulseIcon,
  ShieldLockIcon,
  SyncIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useState } from "react";
import {
  dispatchAdminEmailDigests,
  getAdminEmailConfig,
  previewAdminEmailTemplate,
  retryAdminEmailOutboxItem,
  sendAdminTestEmail,
  testAdminEmailConnection,
  updateAdminEmailConfig,
  type AdminEmailConfig,
  type AdminEmailConnectionDiagnostic,
  type AdminEmailOutboxItem,
  type AdminEmailTemplateDefinition,
  type AdminEmailTemplateId,
} from "../../../api/admin";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, FilterPill, Input, Select, Table, Textarea } from "../styles";

export interface AdminEmailStudioCardProps {
  onStatusMessage?: ((msg: string) => void) | undefined;
  onErrorMessage?: ((err: string) => void) | undefined;
}

type StudioSubTab = "transport" | "templates" | "social_digest" | "outbox";

const TEMPLATE_ORDER: AdminEmailTemplateId[] = [
  "verification",
  "password_reset",
  "invite",
  "security_alert",
  "social_notification",
  "digest",
];

export const AdminEmailStudioCard: React.FC<AdminEmailStudioCardProps> = ({ onStatusMessage, onErrorMessage }) => {
  const [subTab, setSubTab] = useState<StudioSubTab>("transport");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AdminEmailConfig | null>(null);
  const [outbox, setOutbox] = useState<AdminEmailOutboxItem[]>([]);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Transport draft state
  const [driver, setDriver] = useState<AdminEmailConfig["driver"]>("auto");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassInput, setSmtpPassInput] = useState("");
  const [smtpTlsMode, setSmtpTlsMode] = useState<AdminEmailConfig["smtpTlsMode"]>("starttls");
  const [smtpTlsRejectUnauthorized, setSmtpTlsRejectUnauthorized] = useState(true);
  const [smtpCaCertPath, setSmtpCaCertPath] = useState("");
  const [sendgridApiKeyInput, setSendgridApiKeyInput] = useState("");
  const [resendApiKeyInput, setResendApiKeyInput] = useState("");

  // Diagnostics & Test email state
  const [diagnosticResult, setDiagnosticResult] = useState<AdminEmailConnectionDiagnostic | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testTemplateId, setTestTemplateId] = useState<string>("test");
  const [sendingTest, setSendingTest] = useState(false);

  // Template Studio state
  const [selectedTemplateId, setSelectedTemplateId] = useState<AdminEmailTemplateId>("verification");
  const [tplSubject, setTplSubject] = useState("");
  const [tplHeading, setTplHeading] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplCtaLabel, setTplCtaLabel] = useState("");
  const [tplEnabled, setTplEnabled] = useState(true);
  const [themeHeaderBg, setThemeHeaderBg] = useState("#0f172a");
  const [themeAccentColor, setThemeAccentColor] = useState("#2563eb");
  const [themeLogoUrl, setThemeLogoUrl] = useState("");
  const [themeFooterText, setThemeFooterText] = useState("");
  const [previewMode, setPreviewMode] = useState<"html" | "text">("html");
  const [previewData, setPreviewData] = useState<{
    subject: string;
    html: string;
    text: string;
  } | null>(null);

  // Digest state
  const [digestDispatchResult, setDigestDispatchResult] = useState<{
    dispatchedUsers: number;
    totalItemsCompiled: number;
  } | null>(null);

  const notifySuccess = (msg: string) => {
    setLocalStatus(msg);
    setLocalError(null);
    onStatusMessage?.(msg);
  };

  const notifyError = useCallback(
    (err: string) => {
      setLocalError(err);
      setLocalStatus(null);
      onErrorMessage?.(err);
    },
    [onErrorMessage],
  );

  const applyConfigToState = useCallback((cfg: AdminEmailConfig, currentTplId: AdminEmailTemplateId) => {
    setConfig(cfg);
    setDriver(cfg.driver);
    setFromName(cfg.fromName);
    setFromEmail(cfg.fromEmail);
    setReplyTo(cfg.replyTo);
    setSmtpHost(cfg.smtpHost);
    setSmtpPort(cfg.smtpPort);
    setSmtpUser(cfg.smtpUser);
    setSmtpTlsMode(cfg.smtpTlsMode);
    setSmtpTlsRejectUnauthorized(cfg.smtpTlsRejectUnauthorized);
    setSmtpCaCertPath(cfg.smtpCaCertPath);
    setThemeHeaderBg(cfg.theme.headerBgColor || "#0f172a");
    setThemeAccentColor(cfg.theme.accentColor || "#2563eb");
    setThemeLogoUrl(cfg.theme.logoUrl || "");
    setThemeFooterText(cfg.theme.footerText || "");

    const tpl: AdminEmailTemplateDefinition | undefined = cfg.templates[currentTplId];
    if (tpl) {
      setTplSubject(tpl.subject);
      setTplHeading(tpl.heading);
      setTplBody(tpl.body);
      setTplCtaLabel(tpl.ctaLabel);
      setTplEnabled(tpl.enabled);
    }
  }, []);

  const loadEmailStudio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminEmailConfig();
      applyConfigToState(res.config, selectedTemplateId);
      setOutbox(res.outbox || []);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to load email configuration");
    } finally {
      setLoading(false);
    }
  }, [applyConfigToState, notifyError, selectedTemplateId]);

  useEffect(() => {
    void loadEmailStudio();
  }, [loadEmailStudio]);

  const handleSelectTemplate = (tplId: AdminEmailTemplateId) => {
    setSelectedTemplateId(tplId);
    if (config && config.templates[tplId]) {
      const tpl = config.templates[tplId];
      setTplSubject(tpl.subject);
      setTplHeading(tpl.heading);
      setTplBody(tpl.body);
      setTplCtaLabel(tpl.ctaLabel);
      setTplEnabled(tpl.enabled);
    }
  };

  const refreshLivePreview = useCallback(async () => {
    try {
      const res = await previewAdminEmailTemplate({
        templateId: selectedTemplateId,
        templateOverride: {
          subject: tplSubject,
          heading: tplHeading,
          body: tplBody,
          ctaLabel: tplCtaLabel,
          enabled: tplEnabled,
        },
        themeOverride: {
          headerBgColor: themeHeaderBg,
          accentColor: themeAccentColor,
          logoUrl: themeLogoUrl,
          footerText: themeFooterText,
        },
      });
      setPreviewData({
        subject: res.subject,
        html: res.html,
        text: res.text,
      });
    } catch {
      // Ignore transient preview errors while typing
    }
  }, [
    selectedTemplateId,
    tplSubject,
    tplHeading,
    tplBody,
    tplCtaLabel,
    tplEnabled,
    themeHeaderBg,
    themeAccentColor,
    themeLogoUrl,
    themeFooterText,
  ]);

  useEffect(() => {
    if (subTab === "templates") {
      void refreshLivePreview();
    }
  }, [subTab, refreshLivePreview]);

  const applyPreset = (preset: "intranet_relay" | "aws_ses" | "m365" | "gmail" | "resend" | "sendgrid") => {
    if (preset === "intranet_relay") {
      setDriver("smtp");
      setSmtpHost("smtp.corp.internal");
      setSmtpPort(25);
      setSmtpTlsMode("none");
      notifySuccess("Applied Enterprise Intranet SMTP Relay preset (Port 25). Update hostname and save.");
    } else if (preset === "aws_ses") {
      setDriver("smtp");
      setSmtpHost("email-smtp.us-east-1.amazonaws.com");
      setSmtpPort(587);
      setSmtpTlsMode("starttls");
      setSmtpTlsRejectUnauthorized(true);
      notifySuccess("Applied Amazon SES STARTTLS preset (Port 587). Enter IAM SMTP credentials and save.");
    } else if (preset === "m365") {
      setDriver("smtp");
      setSmtpHost("smtp.office365.com");
      setSmtpPort(587);
      setSmtpTlsMode("starttls");
      setSmtpTlsRejectUnauthorized(true);
      notifySuccess("Applied Microsoft 365 Exchange Online preset (Port 587 STARTTLS).");
    } else if (preset === "gmail") {
      setDriver("smtp");
      setSmtpHost("smtp.gmail.com");
      setSmtpPort(465);
      setSmtpTlsMode("implicit");
      setSmtpTlsRejectUnauthorized(true);
      notifySuccess("Applied Google Workspace SMTP Relay preset (Port 465 Implicit TLS).");
    } else if (preset === "resend") {
      setDriver("resend");
      notifySuccess("Selected Resend HTTP API driver. Provide your Resend API key and save.");
    } else if (preset === "sendgrid") {
      setDriver("sendgrid");
      notifySuccess("Selected SendGrid HTTP API driver. Provide your SendGrid API key and save.");
    }
  };

  const handleSaveTransport = async () => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        driver,
        fromName,
        fromEmail,
        replyTo,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpTlsMode,
        smtpTlsRejectUnauthorized,
        smtpCaCertPath,
      };
      if (smtpPassInput.trim()) {
        payload["smtpPass"] = smtpPassInput.trim();
      }
      if (sendgridApiKeyInput.trim()) {
        payload["sendgridApiKey"] = sendgridApiKeyInput.trim();
      }
      if (resendApiKeyInput.trim()) {
        payload["resendApiKey"] = resendApiKeyInput.trim();
      }

      const res = await updateAdminEmailConfig(payload);
      setSmtpPassInput("");
      setSendgridApiKeyInput("");
      setResendApiKeyInput("");
      applyConfigToState(res.config, selectedTemplateId);
      notifySuccess(`Saved email transport settings. Active driver: ${res.config.activeDriver.toUpperCase()}.`);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to save email transport configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const diag = await testAdminEmailConnection({
        driver,
        smtpHost,
        smtpPort,
        smtpUser,
        ...(smtpPassInput.trim() ? { smtpPass: smtpPassInput.trim() } : {}),
        smtpTlsMode,
        smtpTlsRejectUnauthorized,
        smtpCaCertPath,
        ...(sendgridApiKeyInput.trim() ? { sendgridApiKey: sendgridApiKeyInput.trim() } : {}),
        ...(resendApiKeyInput.trim() ? { resendApiKey: resendApiKeyInput.trim() } : {}),
      });
      setDiagnosticResult(diag);
      if (diag.success) {
        notifySuccess(`Connection diagnostic passed (${diag.driver.toUpperCase()} in ${diag.totalLatencyMs}ms).`);
      } else {
        notifyError(`Connection diagnostic reported issues for ${diag.driver.toUpperCase()}.`);
      }
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Connection handshake test failed");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSendTestEmail = async (overrideTemplateId?: string) => {
    setSendingTest(true);
    try {
      const tplToUse = overrideTemplateId || (testTemplateId === "test" ? undefined : testTemplateId);
      const res = await sendAdminTestEmail(testRecipient.trim() || undefined, tplToUse);
      notifySuccess(
        `Test email (${res.templateId || "diagnostic"}) dispatched to ${res.recipient} via ${res.driver.toUpperCase()}.`,
      );
      const refreshed = await getAdminEmailConfig();
      setOutbox(refreshed.outbox || []);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to send test email");
    } finally {
      setSendingTest(false);
    }
  };

  const handleSaveTemplateAndTheme = async () => {
    setLoading(true);
    try {
      const res = await updateAdminEmailConfig({
        theme: {
          headerBgColor: themeHeaderBg,
          accentColor: themeAccentColor,
          logoUrl: themeLogoUrl,
          footerText: themeFooterText,
        },
        templates: {
          [selectedTemplateId]: {
            subject: tplSubject,
            heading: tplHeading,
            body: tplBody,
            ctaLabel: tplCtaLabel,
            enabled: tplEnabled,
          },
        },
      });
      applyConfigToState(res.config, selectedTemplateId);
      await refreshLivePreview();
      notifySuccess(`Saved template '${res.config.templates[selectedTemplateId].name}' and global email theme.`);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to save template customizations");
    } finally {
      setLoading(false);
    }
  };

  const handleResetTemplate = async () => {
    setLoading(true);
    try {
      const res = await updateAdminEmailConfig({
        resetTemplateId: selectedTemplateId,
      });
      applyConfigToState(res.config, selectedTemplateId);
      await refreshLivePreview();
      notifySuccess(`Reset '${res.config.templates[selectedTemplateId].name}' to factory default.`);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to reset template");
    } finally {
      setLoading(false);
    }
  };

  const handleDispatchDigests = async (freq?: "daily" | "weekly") => {
    setLoading(true);
    try {
      const res = await dispatchAdminEmailDigests(freq);
      setDigestDispatchResult({
        dispatchedUsers: res.dispatchedUsers,
        totalItemsCompiled: res.totalItemsCompiled,
      });
      const refreshed = await getAdminEmailConfig();
      setOutbox(refreshed.outbox || []);
      notifySuccess(
        `Dispatched ${freq || "all"} digests to ${res.dispatchedUsers} user(s) (${res.totalItemsCompiled} notifications compiled).`,
      );
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to dispatch digest emails");
    } finally {
      setLoading(false);
    }
  };

  const handleRetryOutbox = async (id: string) => {
    setLoading(true);
    try {
      const res = await retryAdminEmailOutboxItem(id);
      setOutbox(res.outbox || []);
      notifySuccess(`Retried message ${id} → new delivery ID ${res.messageId}.`);
    } catch (err: any) {
      notifyError(err?.response?.data?.error || "Failed to retry outbox email");
    } finally {
      setLoading(false);
    }
  };

  const insertVariableIntoBody = (variableName: string) => {
    setTplBody((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}{{${variableName}}}`);
  };

  const activeTemplateDef = config?.templates[selectedTemplateId];
  const isTemplateCustomized = Boolean(config?.templateOverrides?.[selectedTemplateId]);

  return (
    <Card style={{ marginBottom: "24px", border: "1px solid rgba(56, 189, 248, 0.28)" }}>
      {/* ── STUDIO HEADER ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <MailIcon size={18} />
          <Box display="flex" flexDirection="column">
            <span style={{ fontWeight: 700, fontSize: "15px" }}>
              Email Transport, SMTP Handshake &amp; Template Studio
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Configure live SMTP relays or HTTP providers (AES-256-GCM encrypted at rest), inspect TLS handshakes, and
              customize transactional &amp; social email templates.
            </span>
          </Box>
        </Box>
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Badge $variant={config?.configuredForLiveDelivery ? "success" : "warning"}>
            {config?.configuredForLiveDelivery
              ? `Live Delivery (${config.activeDriver.toUpperCase()})`
              : `Console / Local Capture (${(config?.activeDriver || "console").toUpperCase()})`}
          </Badge>
          {config?.airgapEnforced && (
            <Badge $variant="warning">
              <LockIcon size={11} /> Air-Gap Enforced
            </Badge>
          )}
        </Box>
      </Box>

      {/* ── STATUS / ERROR BANNER ── */}
      {localStatus && (
        <Box
          p={2}
          style={{
            background: "rgba(35, 134, 54, 0.14)",
            border: "1px solid rgba(46, 160, 67, 0.4)",
            borderRadius: "6px",
            fontSize: "12px",
            color: "var(--ms-success)",
          }}
        >
          {localStatus}
        </Box>
      )}
      {localError && (
        <Box
          p={2}
          style={{
            background: "rgba(218, 54, 51, 0.14)",
            border: "1px solid rgba(248, 81, 73, 0.4)",
            borderRadius: "6px",
            fontSize: "12px",
            color: "var(--ms-danger)",
          }}
        >
          {localError}
        </Box>
      )}

      {/* ── SUB-TAB NAVIGATION ── */}
      <Box
        display="flex"
        gap={2}
        flexWrap="wrap"
        style={{
          borderBottom: "1px solid var(--color-border-subtle)",
          paddingBottom: "10px",
          marginTop: "4px",
        }}
      >
        <FilterPill $active={subTab === "transport"} onClick={() => setSubTab("transport")}>
          1. SMTP &amp; Provider Transport
        </FilterPill>
        <FilterPill $active={subTab === "templates"} onClick={() => setSubTab("templates")}>
          2. Email Template Studio &amp; Live Preview
        </FilterPill>
        <FilterPill $active={subTab === "social_digest"} onClick={() => setSubTab("social_digest")}>
          3. Social Notifications &amp; Digest Scheduler
        </FilterPill>
        <FilterPill $active={subTab === "outbox"} onClick={() => setSubTab("outbox")}>
          4. Delivery Outbox Log ({outbox.length})
        </FilterPill>
      </Box>

      {/* ── TAB 1: SMTP & PROVIDER TRANSPORT ── */}
      {subTab === "transport" && (
        <Box display="flex" flexDirection="column" gap={3} mt={1}>
          {/* Provider Quick Presets */}
          <Box
            p={2}
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                Quick Transport Presets:
              </span>
              <Box display="flex" gap={1} flexWrap="wrap">
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("intranet_relay")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Enterprise Intranet Relay (Port 25)
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("aws_ses")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Amazon SES (Port 587 STARTTLS)
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("m365")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Microsoft 365 / Exchange
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("gmail")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Google Workspace (Port 465 TLS)
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("resend")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Resend HTTP API
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => applyPreset("sendgrid")}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  SendGrid HTTP API
                </ActionButton>
              </Box>
            </Box>
          </Box>

          {/* Driver & Sender Identity */}
          <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Outbound Transport Driver</label>
              <Select
                aria-label="Outbound Transport Driver"
                value={driver}
                onChange={(e) => setDriver(e.target.value as AdminEmailConfig["driver"])}
              >
                <option value="auto">Auto-Detect (Provider API → SMTP → Console)</option>
                <option value="smtp">SMTP Server / Intranet MTA Relay</option>
                <option value="resend">Resend HTTP API</option>
                <option value="sendgrid">SendGrid HTTP API</option>
                <option value="console">Console / Air-Gap Local Capture</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Sender Display Name</label>
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Ansatz Security" />
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Sender From Email Address</label>
              <Input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="noreply@ansatz.social"
              />
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Reply-To Email Address</label>
              <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="support@ansatz.social" />
            </Box>
          </Box>

          {/* SMTP Server & TLS Settings */}
          {(driver === "auto" || driver === "smtp") && (
            <Box
              p={3}
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <span style={{ fontWeight: 700, fontSize: "13px" }}>
                  SMTP Relay &amp; STARTTLS / Corporate PKI Configuration
                </span>
                {config?.smtpPassConfigured && (
                  <Badge $variant="success">
                    <ShieldLockIcon size={11} /> SMTP Password Encrypted ({config.smtpPassMasked})
                  </Badge>
                )}
              </Box>
              <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px" }}>
                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>SMTP Hostname / IP</label>
                  <Input
                    aria-label="SMTP Hostname"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com or 10.0.0.25"
                  />
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>SMTP Port</label>
                  <Input
                    aria-label="SMTP Port"
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value) || 587)}
                    placeholder="587"
                  />
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>TLS Encryption Mode</label>
                  <Select
                    aria-label="TLS Encryption Mode"
                    value={smtpTlsMode}
                    onChange={(e) => setSmtpTlsMode(e.target.value as AdminEmailConfig["smtpTlsMode"])}
                  >
                    <option value="starttls">STARTTLS Upgrade (Port 587 Recommended)</option>
                    <option value="implicit">Implicit TLS / SMTPS (Port 465)</option>
                    <option value="none">Plaintext Intranet Relay (Port 25 No TLS)</option>
                  </Select>
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>SMTP Auth Username (Optional)</label>
                  <Input
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="apikey or smtp-user@domain.com"
                  />
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>
                    SMTP Auth Password {config?.smtpPassConfigured ? "(Leave blank to keep)" : "(Optional)"}
                  </label>
                  <Input
                    type="password"
                    value={smtpPassInput}
                    onChange={(e) => setSmtpPassInput(e.target.value)}
                    placeholder={
                      config?.smtpPassConfigured
                        ? `Stored: ${config.smtpPassMasked}`
                        : "Enter SMTP password (encrypted at rest)"
                    }
                  />
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Custom CA Bundle Path (Enterprise PKI)</label>
                  <Input
                    value={smtpCaCertPath}
                    onChange={(e) => setSmtpCaCertPath(e.target.value)}
                    placeholder="/etc/ssl/certs/corporate-root-ca.pem"
                  />
                </Box>
              </Box>

              <Box display="flex" alignItems="center" gap={2} mt={2}>
                <label
                  style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={smtpTlsRejectUnauthorized}
                    onChange={(e) => setSmtpTlsRejectUnauthorized(e.target.checked)}
                  />
                  <span>
                    Strictly verify SMTP server TLS certificate chain (disable only for self-signed internal relays)
                  </span>
                </label>
              </Box>
            </Box>
          )}

          {/* HTTP API Providers (Resend / SendGrid) */}
          {(driver === "auto" || driver === "resend" || driver === "sendgrid") && (
            <Box
              p={3}
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "13px" }}>
                Cloud HTTP Transactional API Keys (AES-256-GCM Encrypted at Rest)
              </span>
              <Box
                display="grid"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}
                mt={2}
              >
                <Box display="flex" flexDirection="column" gap={1}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Resend API Key</label>
                    {config?.resendApiKeyConfigured && <Badge $variant="success">{config.resendApiKeyMasked}</Badge>}
                  </Box>
                  <Input
                    type="password"
                    value={resendApiKeyInput}
                    onChange={(e) => setResendApiKeyInput(e.target.value)}
                    placeholder={
                      config?.resendApiKeyConfigured
                        ? `Stored: ${config.resendApiKeyMasked} (enter new to rotate)`
                        : "re_123456789..."
                    }
                  />
                </Box>

                <Box display="flex" flexDirection="column" gap={1}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>SendGrid API Key</label>
                    {config?.sendgridApiKeyConfigured && (
                      <Badge $variant="success">{config.sendgridApiKeyMasked}</Badge>
                    )}
                  </Box>
                  <Input
                    type="password"
                    value={sendgridApiKeyInput}
                    onChange={(e) => setSendgridApiKeyInput(e.target.value)}
                    placeholder={
                      config?.sendgridApiKeyConfigured
                        ? `Stored: ${config.sendgridApiKeyMasked} (enter new to rotate)`
                        : "SG.xxxxx..."
                    }
                  />
                </Box>
              </Box>
            </Box>
          )}

          {/* Save & Connection Handshake Action Bar */}
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Box display="flex" gap={2} flexWrap="wrap">
              <ActionButton
                $variant="primary"
                type="button"
                onClick={() => void handleSaveTransport()}
                disabled={loading}
              >
                <CheckCircleIcon size={14} />
                <span>Save &amp; Hot-Reload Transport</span>
              </ActionButton>
              <ActionButton
                $variant="secondary"
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={testingConnection || loading}
              >
                <PulseIcon size={14} />
                <span>{testingConnection ? "Probing Handshake..." : "Test Connection & Handshake"}</span>
              </ActionButton>
            </Box>

            <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
              <Input
                aria-label="Diagnostic Test Recipient"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="Test recipient (defaults to admin email)..."
                style={{ width: "240px" }}
              />
              <Select
                aria-label="Test Email Template"
                value={testTemplateId}
                onChange={(e) => setTestTemplateId(e.target.value)}
              >
                <option value="test">Diagnostic Ping</option>
                <option value="verification">Account Verification Template</option>
                <option value="password_reset">Password Reset Template</option>
                <option value="invite">User Invitation Template</option>
                <option value="security_alert">Security Alert Template</option>
                <option value="social_notification">Social Notification Template</option>
                <option value="digest">Daily/Weekly Digest Template</option>
              </Select>
              <ActionButton
                $variant="secondary"
                type="button"
                onClick={() => void handleSendTestEmail()}
                disabled={sendingTest || loading}
              >
                <MailIcon size={14} />
                <span>{sendingTest ? "Sending..." : "Send Test Email"}</span>
              </ActionButton>
            </Box>
          </Box>

          {/* Interactive Handshake Step-by-Step Output */}
          {diagnosticResult && (
            <Box
              p={3}
              style={{
                background: "var(--color-bg-primary)",
                border: `1px solid ${diagnosticResult.success ? "rgba(46, 160, 67, 0.45)" : "rgba(248, 81, 73, 0.45)"}`,
                borderRadius: "8px",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <span style={{ fontWeight: 700, fontSize: "13px" }}>
                  Interactive Transport Handshake Trace ({diagnosticResult.driver.toUpperCase()})
                </span>
                <Badge $variant={diagnosticResult.success ? "success" : "danger"}>
                  {diagnosticResult.success ? "HANDSHAKE OK" : "HANDSHAKE FAILED"} • {diagnosticResult.totalLatencyMs}ms
                </Badge>
              </Box>
              <Table>
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Diagnostic Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnosticResult.steps.map((s, idx) => (
                    <tr key={`${s.step}_${idx}`}>
                      <td style={{ fontWeight: 600, fontSize: "12px" }}>{s.label}</td>
                      <td>
                        <Badge
                          $variant={
                            s.status === "ok"
                              ? "success"
                              : s.status === "warning"
                                ? "warning"
                                : s.status === "error"
                                  ? "danger"
                                  : "neutral"
                          }
                        >
                          {s.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{s.latencyMs}ms</td>
                      <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{s.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Box>
          )}
        </Box>
      )}

      {/* ── TAB 2: EMAIL TEMPLATE STUDIO & LIVE PREVIEW ── */}
      {subTab === "templates" && (
        <Box display="flex" flexDirection="column" gap={3} mt={1}>
          {/* Template Picker */}
          <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
            {TEMPLATE_ORDER.map((tplId) => {
              const def = config?.templates[tplId];
              const hasCustom = Boolean(config?.templateOverrides?.[tplId]);
              return (
                <FilterPill
                  key={tplId}
                  $active={selectedTemplateId === tplId}
                  onClick={() => handleSelectTemplate(tplId)}
                >
                  {def?.name || tplId} {hasCustom ? "• Customized" : ""}
                </FilterPill>
              );
            })}
          </Box>

          {/* Global Email Theme Bar */}
          <Box
            p={2}
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px" }}>
              Global Email Theme &amp; White-Label Branding
            </div>
            <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Header Background Hex</label>
                <Input value={themeHeaderBg} onChange={(e) => setThemeHeaderBg(e.target.value)} placeholder="#0f172a" />
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>CTA Button Accent Hex</label>
                <Input
                  value={themeAccentColor}
                  onChange={(e) => setThemeAccentColor(e.target.value)}
                  placeholder="#2563eb"
                />
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Header Brand Logo URL</label>
                <Input
                  value={themeLogoUrl}
                  onChange={(e) => setThemeLogoUrl(e.target.value)}
                  placeholder="https://hub.modelscript.org/logo.png"
                />
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Custom Footer Disclaimer</label>
                <Input
                  value={themeFooterText}
                  onChange={(e) => setThemeFooterText(e.target.value)}
                  placeholder="Default security/unsubscribe footer"
                />
              </Box>
            </Box>
          </Box>

          {/* Side-by-side Editor & Live Preview */}
          <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px" }}>
            {/* Left Column: Template Editor */}
            <Box
              p={3}
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" flexDirection="column">
                  <span style={{ fontWeight: 700, fontSize: "14px" }}>
                    {activeTemplateDef?.name || selectedTemplateId}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    {activeTemplateDef?.description}
                  </span>
                </Box>
                <Badge $variant={isTemplateCustomized ? "warning" : "neutral"}>
                  {isTemplateCustomized ? "Customized" : "Default"}
                </Badge>
              </Box>

              {/* Clickable Interpolation Variable Chips */}
              {activeTemplateDef?.availableVariables && (
                <Box display="flex" flexDirection="column" gap={1}>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Available Variables (click to insert into body):
                  </span>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    {activeTemplateDef.availableVariables.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariableIntoBody(v)}
                        style={{
                          background: "rgba(56, 189, 248, 0.12)",
                          color: "#38bdf8",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                          borderRadius: "4px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontFamily: "monospace",
                          cursor: "pointer",
                        }}
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </Box>
                </Box>
              )}

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Email Subject Line</label>
                <Input
                  aria-label="Template Subject Line"
                  value={tplSubject}
                  onChange={(e) => setTplSubject(e.target.value)}
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Headline / Banner Heading</label>
                <Input
                  aria-label="Template Heading"
                  value={tplHeading}
                  onChange={(e) => setTplHeading(e.target.value)}
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Body Copy</label>
                <Textarea
                  aria-label="Template Body Copy"
                  value={tplBody}
                  onChange={(e) => setTplBody(e.target.value)}
                  style={{ minHeight: "110px" }}
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Primary Action Button Label</label>
                <Input
                  aria-label="Template CTA Label"
                  value={tplCtaLabel}
                  onChange={(e) => setTplCtaLabel(e.target.value)}
                />
              </Box>

              {(selectedTemplateId === "social_notification" || selectedTemplateId === "digest") && (
                <label
                  style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}
                >
                  <input type="checkbox" checked={tplEnabled} onChange={(e) => setTplEnabled(e.target.checked)} />
                  <span>Enable outbound delivery for this notification template</span>
                </label>
              )}

              <Box display="flex" gap={2} flexWrap="wrap" mt={1}>
                <ActionButton
                  $variant="primary"
                  type="button"
                  onClick={() => void handleSaveTemplateAndTheme()}
                  disabled={loading}
                >
                  <CheckCircleIcon size={14} />
                  <span>Save Template &amp; Theme</span>
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => void handleSendTestEmail(selectedTemplateId)}
                  disabled={sendingTest || loading}
                >
                  <MailIcon size={14} />
                  <span>Send Test of This Template</span>
                </ActionButton>
                {isTemplateCustomized && (
                  <ActionButton
                    $variant="danger"
                    type="button"
                    onClick={() => void handleResetTemplate()}
                    disabled={loading}
                  >
                    <SyncIcon size={14} />
                    <span>Reset to Default</span>
                  </ActionButton>
                )}
              </Box>
            </Box>

            {/* Right Column: Live HTML & Plaintext Preview */}
            <Box
              p={3}
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                  <EyeIcon size={14} />
                  <span style={{ fontWeight: 700, fontSize: "13px" }}>Live Rendered Preview</span>
                </Box>
                <Box display="flex" gap={1}>
                  <FilterPill $active={previewMode === "html"} onClick={() => setPreviewMode("html")}>
                    HTML View
                  </FilterPill>
                  <FilterPill $active={previewMode === "text"} onClick={() => setPreviewMode("text")}>
                    Plaintext MIME
                  </FilterPill>
                </Box>
              </Box>

              <Box
                p={2}
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  border: "1px solid var(--color-border-subtle)",
                }}
              >
                <strong>Subject:</strong> {previewData?.subject || tplSubject}
              </Box>

              {previewMode === "html" ? (
                <div
                  style={{
                    background: "#f1f5f9",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  <iframe
                    title="Email Preview"
                    sandbox=""
                    srcDoc={previewData?.html || ""}
                    style={{
                      width: "100%",
                      height: "360px",
                      border: "none",
                      display: "block",
                      background: "#fff",
                    }}
                  />
                </div>
              ) : (
                <pre
                  style={{
                    background: "#0f172a",
                    color: "#e2e8f0",
                    borderRadius: "6px",
                    padding: "14px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    maxHeight: "420px",
                    overflowY: "auto",
                    margin: 0,
                  }}
                >
                  {previewData?.text || ""}
                </pre>
              )}
            </Box>
          </Box>
        </Box>
      )}

      {/* ── TAB 3: SOCIAL NOTIFICATIONS & DIGEST SCHEDULER ── */}
      {subTab === "social_digest" && (
        <Box display="flex" flexDirection="column" gap={3} mt={1}>
          <Box
            p={3}
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Social Platform Activity &amp; Engineering Notification Emails
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "6px 0 12px 0" }}>
              Outbound social emails automatically include the actor&apos;s <code>@username</code>, display name, post
              or reply snippet, and direct deep-link CTA for:
            </p>
            <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
              <Badge $variant="success">New Followers (@handle + Bio)</Badge>
              <Badge $variant="success">Post Likes (+ Post Snippet)</Badge>
              <Badge $variant="success">Replies &amp; Threads (+ Reply Preview)</Badge>
              <Badge $variant="success">@Mentions (+ Post Snippet)</Badge>
              <Badge $variant="success">Reposts (+ Post Snippet)</Badge>
              <Badge $variant="success">Package Releases</Badge>
              <Badge $variant="success">Simulation Completed / Failed</Badge>
              <Badge $variant="success">Security &amp; 2FA Alerts</Badge>
            </Box>

            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
              gap={2}
              mt={2}
              style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: "12px" }}
            >
              <Box display="flex" flexDirection="column">
                <span style={{ fontWeight: 600, fontSize: "13px" }}>Compile &amp; Dispatch Pending Email Digests</span>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  Compiles unread notifications for active users subscribed to <code>daily</code> or <code>weekly</code>{" "}
                  email digests.
                </span>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap">
                <ActionButton
                  $variant="primary"
                  type="button"
                  onClick={() => void handleDispatchDigests("daily")}
                  disabled={loading}
                >
                  <MailIcon size={14} />
                  <span>Run Daily Digests</span>
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => void handleDispatchDigests("weekly")}
                  disabled={loading}
                >
                  <MailIcon size={14} />
                  <span>Run Weekly Digests</span>
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => void handleDispatchDigests()}
                  disabled={loading}
                >
                  <SyncIcon size={14} />
                  <span>Dispatch All Digests</span>
                </ActionButton>
              </Box>
            </Box>

            {digestDispatchResult && (
              <Box mt={2} style={{ fontSize: "12px", color: "var(--ms-success)" }}>
                Last digest run: Dispatched to <strong>{digestDispatchResult.dispatchedUsers}</strong> user(s) with{" "}
                <strong>{digestDispatchResult.totalItemsCompiled}</strong> notification item(s).
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── TAB 4: DELIVERY OUTBOX LOG ── */}
      {subTab === "outbox" && (
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <span style={{ fontSize: "13px", fontWeight: 600 }}>
              Recent Outbound Email Deliveries ({outbox.length})
            </span>
            <ActionButton $variant="secondary" type="button" onClick={() => void loadEmailStudio()} disabled={loading}>
              <SyncIcon size={14} />
              <span>Refresh Outbox</span>
            </ActionButton>
          </Box>

          {outbox.length === 0 ? (
            <Box p={3} style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>
              No outbound emails recorded in the current session outbox yet.
            </Box>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Recipient</th>
                  <th>Template</th>
                  <th>Subject</th>
                  <th>Driver</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {outbox.slice(0, 25).map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ fontSize: "12px", fontWeight: 600 }}>{item.to}</td>
                    <td>
                      <Badge $variant="neutral">{item.templateId || "custom"}</Badge>
                    </td>
                    <td style={{ fontSize: "12px" }}>
                      {item.subject}
                      {item.error && (
                        <div style={{ fontSize: "11px", color: "var(--ms-danger)", marginTop: "2px" }}>
                          {item.error}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge $variant="neutral">{item.driver.toUpperCase()}</Badge>
                    </td>
                    <td>
                      <Badge $variant={item.status === "sent" ? "success" : "danger"}>
                        {item.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{item.latencyMs}ms</td>
                    <td style={{ textAlign: "right" }}>
                      <ActionButton
                        $variant="secondary"
                        type="button"
                        onClick={() => void handleRetryOutbox(item.id)}
                        disabled={loading}
                        style={{ padding: "4px 10px", fontSize: "11px" }}
                      >
                        <SyncIcon size={12} />
                        <span>Redeliver</span>
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Box>
      )}
    </Card>
  );
};

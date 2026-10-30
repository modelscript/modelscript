// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, KeyIcon, PlusIcon, TrashIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { exportInstanceEnvConfig } from "../../../api";
import AnsatzMark from "../../../components/AnsatzLogo";
import Box from "../../../components/Box";
import { notifyInstanceBrandingUpdated } from "../../../InstanceBrandingContext";
import { AdminEmailStudioCard } from "../components/AdminEmailStudioCard";
import { ActionButton, Badge, Card, Input, Select, Table, Textarea } from "../styles";
import type { AdminInstanceInvite, AdminInstanceSettings } from "../types";

export interface AdminSettingsTabProps {
  settings: AdminInstanceSettings | null;
  invites: (AdminInstanceInvite & {
    usesCount?: number | undefined;
    maxUses?: number | undefined;
    expiresAt?: string | null | undefined;
    revoked?: boolean | undefined;
  })[];
  onSaveSettings: (patch: Partial<AdminInstanceSettings>) => Promise<void>;
  onCreateInvite: (payload: {
    note?: string | undefined;
    maxUses?: number | undefined;
    expiresInDays?: number | undefined;
    assignedRole?: string | undefined;
    initialCredits?: number | undefined;
  }) => Promise<void>;
  onRevokeInvite: (id: number) => Promise<void>;
  loading: boolean;
}

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  settings,
  invites,
  onSaveSettings,
  onCreateInvite,
  onRevokeInvite,
  loading,
}) => {
  const [instanceName, setInstanceName] = useState(settings?.instanceName || "Ansatz");
  const [instanceBadge, setInstanceBadge] = useState(settings?.instanceBadge ?? "");
  const [instanceTagline, setInstanceTagline] = useState(
    settings?.instanceTagline || "The Federated Scientific & Engineering Network",
  );
  const [instanceDescription, setInstanceDescription] = useState(settings?.instanceDescription || "");
  const [contactEmail, setContactEmail] = useState(settings?.contactEmail || "");
  const [brandLogoUrl, setBrandLogoUrl] = useState(settings?.brandLogoUrl || "");
  const [brandLogoDarkUrl, setBrandLogoDarkUrl] = useState(settings?.brandLogoDarkUrl || "");
  const [brandFaviconUrl, setBrandFaviconUrl] = useState(settings?.brandFaviconUrl || "");
  const [brandAccentColor, setBrandAccentColor] = useState(settings?.brandAccentColor || "#06b6d4");
  const [docsBaseUrl, setDocsBaseUrl] = useState(settings?.docsBaseUrl || "https://modelscript.org");
  const [showPoweredBy, setShowPoweredBy] = useState<boolean>(settings?.showPoweredBy ?? true);
  const [registrationMode, setRegistrationMode] = useState<"open" | "invite_only" | "domain_allowlist" | "closed">(
    settings?.registrationMode || "open",
  );
  const [allowedDomainsRaw, setAllowedDomainsRaw] = useState((settings?.allowedEmailDomains || []).join(", "));
  const [federationMode, setFederationMode] = useState<"open" | "allowlist" | "disabled">(
    settings?.federationMode || "open",
  );
  const [maintenanceMode, setMaintenanceMode] = useState(Boolean(settings?.maintenanceMode));
  const [maintenanceLevel, setMaintenanceLevel] = useState<"off" | "scheduled" | "read_only" | "lockdown">(
    settings?.maintenanceLevel || (settings?.maintenanceMode ? "read_only" : "off"),
  );
  const [maintenanceEta, setMaintenanceEta] = useState(settings?.maintenanceEta || "");
  const [announcementBanner, setAnnouncementBanner] = useState(settings?.announcementBanner || "");
  const [announcementLevel, setAnnouncementLevel] = useState<"info" | "warning" | "critical">(
    settings?.announcementLevel || "info",
  );
  const [autoQuarantineThreshold, setAutoQuarantineThreshold] = useState(
    String(settings?.autoQuarantineReportThreshold ?? 5),
  );
  const [backupRetentionCount, setBackupRetentionCount] = useState(String(settings?.backupRetentionCount ?? 14));
  const [autoBackupIntervalHours, setAutoBackupIntervalHours] = useState(
    String(settings?.autoBackupIntervalHours ?? 0),
  );
  const [autoFilterKeywordsRaw, setAutoFilterKeywordsRaw] = useState((settings?.autoFilterKeywords || []).join(", "));
  const [autoFilterAction, setAutoFilterAction] = useState<"cw" | "silence" | "quarantine">(
    settings?.autoFilterAction || "cw",
  );
  const [customTermsMarkdown, setCustomTermsMarkdown] = useState(settings?.customTermsMarkdown || "");
  const [customPrivacyMarkdown, setCustomPrivacyMarkdown] = useState(settings?.customPrivacyMarkdown || "");

  // Config export state
  const [exportedEnv, setExportedEnv] = useState<{ envSnippet: string; dockerComposeSnippet: string } | null>(null);

  // Invite creation state
  const [inviteNote, setInviteNote] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("5");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState("14");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteCredits, setInviteCredits] = useState("500");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setInstanceName(settings.instanceName || "Ansatz");
    setInstanceBadge(settings.instanceBadge ?? "");
    setInstanceTagline(settings.instanceTagline || "The Federated Scientific & Engineering Network");
    setInstanceDescription(settings.instanceDescription || "");
    setContactEmail(settings.contactEmail || "");
    setBrandLogoUrl(settings.brandLogoUrl || "");
    setBrandLogoDarkUrl(settings.brandLogoDarkUrl || "");
    setBrandFaviconUrl(settings.brandFaviconUrl || "");
    setBrandAccentColor(settings.brandAccentColor || "#06b6d4");
    setDocsBaseUrl(settings.docsBaseUrl || "https://modelscript.org");
    setShowPoweredBy(settings.showPoweredBy ?? true);
    setRegistrationMode(settings.registrationMode || "open");
    setAllowedDomainsRaw((settings.allowedEmailDomains || []).join(", "));
    setFederationMode(settings.federationMode || "open");
    setMaintenanceMode(Boolean(settings.maintenanceMode));
    setMaintenanceLevel(settings.maintenanceLevel || (settings.maintenanceMode ? "read_only" : "off"));
    setMaintenanceEta(settings.maintenanceEta || "");
    setAnnouncementBanner(settings.announcementBanner || "");
    setAnnouncementLevel(settings.announcementLevel || "info");
    setAutoQuarantineThreshold(String(settings.autoQuarantineReportThreshold ?? 5));
    setBackupRetentionCount(String(settings.backupRetentionCount ?? 14));
    setAutoBackupIntervalHours(String(settings.autoBackupIntervalHours ?? 0));
    setAutoFilterKeywordsRaw((settings.autoFilterKeywords || []).join(", "));
    setAutoFilterAction(settings.autoFilterAction || "cw");
    setCustomTermsMarkdown(settings.customTermsMarkdown || "");
    setCustomPrivacyMarkdown(settings.customPrivacyMarkdown || "");
  }, [settings]);

  const handleSave = async () => {
    const allowedEmailDomains = allowedDomainsRaw
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const autoFilterKeywords = autoFilterKeywordsRaw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const patch: Partial<AdminInstanceSettings> = {
      instanceName: instanceName.trim() || "Ansatz",
      instanceBadge: instanceBadge.trim(),
      instanceTagline: instanceTagline.trim(),
      instanceDescription: instanceDescription.trim(),
      contactEmail: contactEmail.trim(),
      brandLogoUrl: brandLogoUrl.trim(),
      brandLogoDarkUrl: brandLogoDarkUrl.trim(),
      brandFaviconUrl: brandFaviconUrl.trim(),
      brandAccentColor: brandAccentColor.trim() || "#06b6d4",
      docsBaseUrl: docsBaseUrl.trim() || "https://modelscript.org",
      showPoweredBy,
      registrationMode,
      allowedEmailDomains,
      federationMode,
      maintenanceMode,
      maintenanceLevel,
      maintenanceEta: maintenanceEta.trim(),
      announcementBanner: announcementBanner.trim(),
      announcementLevel,
      autoQuarantineReportThreshold: Math.max(0, parseInt(autoQuarantineThreshold, 10) || 0),
      backupRetentionCount: Math.max(1, parseInt(backupRetentionCount, 10) || 14),
      autoBackupIntervalHours: Math.max(0, parseInt(autoBackupIntervalHours, 10) || 0),
      autoFilterKeywords,
      autoFilterAction,
      customTermsMarkdown: customTermsMarkdown.trim(),
      customPrivacyMarkdown: customPrivacyMarkdown.trim(),
    };
    await onSaveSettings(patch);
    notifyInstanceBrandingUpdated(patch);
  };

  const handleExportEnvConfig = async () => {
    try {
      const data = await exportInstanceEnvConfig();
      setExportedEnv({
        envSnippet: data.envSnippet,
        dockerComposeSnippet: data.dockerComposeSnippet,
      });
    } catch {
      // Handled by caller
    }
  };

  const handleCreateInvite = async () => {
    await onCreateInvite({
      note: inviteNote.trim() || undefined,
      maxUses: Math.max(1, parseInt(inviteMaxUses, 10) || 1),
      expiresInDays: Math.max(1, parseInt(inviteExpiresInDays, 10) || 14),
      assignedRole: inviteRole,
      initialCredits: Math.max(0, parseInt(inviteCredits, 10) || 0),
    });
    setInviteNote("");
  };

  const handleCopyInviteLink = (code: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
    const link = `${origin}/signup?invite=${encodeURIComponent(code)}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(link);
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div>
      {/* ── INSTANCE IDENTITY, WHITE-LABEL BRANDING & NODEINFO ── */}
      <Card style={{ marginBottom: "24px" }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Instance Identity, White-Label Branding &amp; NodeInfo 2.0/2.1 Metadata
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Configure your instance brand name, header badge, logos, accent color, documentation URL, and operator
              contact advertised to users and ActivityPub peers.
            </span>
          </Box>
          <ActionButton
            $variant="secondary"
            type="button"
            onClick={() => void handleExportEnvConfig()}
            disabled={loading}
          >
            <DownloadIcon size={14} />
            <span>Export .env &amp; Docker Config</span>
          </ActionButton>
        </Box>

        {exportedEnv && (
          <Box
            mt={2}
            display="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}
          >
            <Box>
              <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>.env Configuration Snippet</div>
              <pre
                style={{
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "6px",
                  padding: "10px",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  margin: 0,
                  overflowX: "auto",
                }}
              >
                {exportedEnv.envSnippet}
              </pre>
            </Box>
            <Box>
              <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>docker-compose.yml Snippet</div>
              <pre
                style={{
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "6px",
                  padding: "10px",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  margin: 0,
                  overflowX: "auto",
                }}
              >
                {exportedEnv.dockerComposeSnippet}
              </pre>
            </Box>
          </Box>
        )}

        {/* Live Brand Preview */}
        <Box
          mt={2}
          p={2}
          data-testid="admin-brand-preview"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            borderRadius: "12px",
            border: "1px solid var(--color-border-primary)",
            background: "var(--color-bg-primary)",
            padding: "10px 14px",
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <AnsatzMark
              size={36}
              logoUrl={brandLogoUrl}
              alt={instanceName || "Ansatz"}
              accentColor={brandAccentColor}
            />
            <Box display="flex" flexDirection="column">
              <Box display="flex" alignItems="center" gap={1} style={{ lineHeight: 1.05 }}>
                <span style={{ fontWeight: 800, fontSize: "17.5px", letterSpacing: "-0.035em" }}>
                  {instanceName.trim() || "Ansatz"}
                </span>
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "999px",
                    backgroundColor: brandAccentColor || "#22d3ee",
                    display: "inline-block",
                  }}
                />
                {instanceBadge.trim() && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      padding: "1.5px 5px",
                      borderRadius: "5px",
                      background: "rgba(6, 182, 212, 0.14)",
                      border: `1px solid ${brandAccentColor || "#06b6d4"}`,
                      color: brandAccentColor || "#06b6d4",
                    }}
                  >
                    {instanceBadge.trim()}
                  </span>
                )}
              </Box>
              <span
                style={{
                  fontSize: "11.5px",
                  fontFamily: "var(--ms-font-mono, monospace)",
                  color: "var(--color-text-muted)",
                  marginTop: "3px",
                }}
              >
                ansatz.social
              </span>
            </Box>
          </Box>
          <Box display="flex" alignItems="center" gap={2}>
            {showPoweredBy && (
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Powered by ModelScript</span>
            )}
            <span
              style={{
                padding: "2px 6px",
                borderRadius: "6px",
                fontFamily: "var(--ms-font-mono, monospace)",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border-primary)",
              }}
            >
              ⌘K
            </span>
          </Box>
        </Box>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Instance Name</label>
            <Input
              aria-label="Instance Name"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              placeholder="Ansatz"
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Header Badge Pill (Optional)</label>
            <Input
              aria-label="Instance Badge"
              value={instanceBadge}
              onChange={(e) => setInstanceBadge(e.target.value)}
              placeholder="e.g. Lab, Internal, Beta"
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Operator Contact Email</label>
            <Input
              aria-label="Operator Contact Email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="admin@example.org"
            />
          </Box>
        </Box>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Instance Tagline / Subtitle</label>
            <Input
              aria-label="Instance Tagline"
              value={instanceTagline}
              onChange={(e) => setInstanceTagline(e.target.value)}
              placeholder="The Federated Scientific & Engineering Network"
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Documentation Portal Base URL</label>
            <Input
              aria-label="Documentation Base URL"
              value={docsBaseUrl}
              onChange={(e) => setDocsBaseUrl(e.target.value)}
              placeholder="https://modelscript.org"
            />
          </Box>
        </Box>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Light Brand Logo URL</label>
            <Input
              aria-label="Brand Logo URL"
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="/ansatz-logo.svg or https://..."
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Dark Brand Logo URL</label>
            <Input
              aria-label="Brand Dark Logo URL"
              value={brandLogoDarkUrl}
              onChange={(e) => setBrandLogoDarkUrl(e.target.value)}
              placeholder="/ansatz-logo.svg or https://..."
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Favicon URL</label>
            <Input
              aria-label="Brand Favicon URL"
              value={brandFaviconUrl}
              onChange={(e) => setBrandFaviconUrl(e.target.value)}
              placeholder="/favicon.ico or https://..."
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Accent Color (Hex)</label>
            <Input
              aria-label="Brand Accent Color"
              value={brandAccentColor}
              onChange={(e) => setBrandAccentColor(e.target.value)}
              placeholder="#06b6d4"
            />
          </Box>
        </Box>

        <Box display="flex" alignItems="center" gap={2} mt={2}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              aria-label="Show Powered by ModelScript"
              checked={showPoweredBy}
              onChange={(e) => setShowPoweredBy(e.target.checked)}
            />
            Display subtle &ldquo;Powered by ModelScript&rdquo; attribution link in sidebar footer
          </label>
        </Box>

        <Box display="flex" flexDirection="column" gap={1} mt={2}>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>Instance Description</label>
          <Textarea
            aria-label="Instance Description"
            value={instanceDescription}
            onChange={(e) => setInstanceDescription(e.target.value)}
            placeholder="Polyglot Cyber-Physical Systems Modeling & Simulation Hub"
          />
        </Box>
      </Card>

      {/* ── EMAIL TRANSPORT, SMTP HANDSHAKE & TEMPLATE STUDIO ── */}
      <AdminEmailStudioCard />

      {/* ── REGISTRATION, FEDERATION & AUTOMATION POLICIES ── */}
      <Card style={{ marginBottom: "24px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>
          Registration, Federation Topology &amp; Safety Policies
        </span>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Registration Policy</label>
            <Select
              aria-label="Registration Policy"
              value={registrationMode}
              onChange={(e) => setRegistrationMode(e.target.value as typeof registrationMode)}
            >
              <option value="open">Open Public Registration</option>
              <option value="invite_only">Invite-Only (Requires Invite Token)</option>
              <option value="domain_allowlist">Corporate Email Domain Allowlist</option>
              <option value="closed">Closed (Admin Provisioning Only)</option>
            </Select>
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Federation Topology Mode</label>
            <Select
              aria-label="Federation Topology Mode"
              value={federationMode}
              onChange={(e) => setFederationMode(e.target.value as typeof federationMode)}
            >
              <option value="open">Open Fediverse (Blocklist Mode)</option>
              <option value="allowlist">Corporate Allowlist Only (Trusted Peers)</option>
              <option value="disabled">Air-Gapped / Federation Disabled</option>
            </Select>
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Auto-Quarantine Report Threshold</label>
            <Input
              aria-label="Auto-Quarantine Report Threshold"
              type="number"
              min="0"
              value={autoQuarantineThreshold}
              onChange={(e) => setAutoQuarantineThreshold(e.target.value)}
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Hot Backup Retention Count</label>
            <Input
              aria-label="Hot Backup Retention Count"
              type="number"
              min="1"
              value={backupRetentionCount}
              onChange={(e) => setBackupRetentionCount(e.target.value)}
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Scheduled Auto-Backup Interval</label>
            <Select
              aria-label="Scheduled Auto-Backup Interval"
              value={autoBackupIntervalHours}
              onChange={(e) => setAutoBackupIntervalHours(e.target.value)}
            >
              <option value="0">Manual Snapshots Only (Off)</option>
              <option value="6">Every 6 Hours</option>
              <option value="12">Every 12 Hours</option>
              <option value="24">Daily (Every 24 Hours)</option>
              <option value="168">Weekly (Every 168 Hours)</option>
            </Select>
          </Box>
        </Box>

        {registrationMode === "domain_allowlist" && (
          <Box display="flex" flexDirection="column" gap={1} mt={2}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>
              Allowed Corporate Email Domains (comma-separated)
            </label>
            <Input
              aria-label="Allowed Corporate Email Domains"
              placeholder="acme.corp, engineering.university.edu"
              value={allowedDomainsRaw}
              onChange={(e) => setAllowedDomainsRaw(e.target.value)}
            />
          </Box>
        )}

        {/* Automated Keyword & Regex Content Filter */}
        <Box display="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>
              Automated Content Filter Keywords / Regex Rules (comma-separated)
            </label>
            <Input
              aria-label="Automated Content Filter Keywords"
              placeholder="crypto giveaway, /spam-link\.(xyz|top)/i, Export Control ITAR"
              value={autoFilterKeywordsRaw}
              onChange={(e) => setAutoFilterKeywordsRaw(e.target.value)}
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Automated Filter Action</label>
            <Select
              aria-label="Automated Filter Action"
              value={autoFilterAction}
              onChange={(e) => setAutoFilterAction(e.target.value as typeof autoFilterAction)}
            >
              <option value="cw">Apply Content Warning (CW Blur)</option>
              <option value="silence">Silence Post (Followers-Only)</option>
              <option value="quarantine">Auto-Quarantine &amp; Flag</option>
            </Select>
          </Box>
        </Box>
      </Card>

      {/* ── CUSTOM INSTANCE TERMS OF SERVICE & PRIVACY POLICY ── */}
      <Card style={{ marginBottom: "24px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>
          Custom Instance Legal &amp; Compliance Policies (Markdown)
        </span>
        <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          Optionally override or append instance-specific Terms of Service, Acceptable Use Policy, or corporate intranet
          compliance notices.
        </span>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Custom Terms of Service / AUP (Markdown)</label>
            <Textarea
              aria-label="Custom Terms of Service"
              value={customTermsMarkdown}
              onChange={(e) => setCustomTermsMarkdown(e.target.value)}
              placeholder="# Instance Acceptable Use Policy..."
            />
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>
              Custom Privacy &amp; Data Retention Policy (Markdown)
            </label>
            <Textarea
              aria-label="Custom Privacy Policy"
              value={customPrivacyMarkdown}
              onChange={(e) => setCustomPrivacyMarkdown(e.target.value)}
              placeholder="# Data Retention & Telemetry Policy..."
            />
          </Box>
        </Box>
      </Card>

      {/* ── MAINTENANCE MODE & GLOBAL BANNER ── */}
      <Card style={{ marginBottom: "24px" }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Maintenance Lifecycle, Takedown Posture &amp; System Announcement Banner
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Transition between normal operations, pre-maintenance countdowns, read-only mode (pauses background
              workers and blocks non-admin writes), or full lockdown (displays the live status &amp; offline WASM
              sandbox portal).
            </span>
          </Box>
          {settings?.lockedByEnv?.includes("maintenanceMode") && (
            <Badge $variant="warning">Locked by MSX_MAINTENANCE_MODE</Badge>
          )}
        </Box>

        <Box display="flex" alignItems="center" gap={3} flexWrap="wrap" mt={2}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={maintenanceMode}
              onChange={(e) => {
                const checked = e.target.checked;
                setMaintenanceMode(checked);
                setMaintenanceLevel(checked ? (maintenanceLevel === "lockdown" ? "lockdown" : "read_only") : "off");
              }}
            />
            Enable Read-Only Maintenance Mode (Blocks non-admin writes with HTTP 503)
          </label>

          <Select
            aria-label="Maintenance Operational Posture"
            value={maintenanceLevel}
            onChange={(e) => {
              const lvl = e.target.value as typeof maintenanceLevel;
              setMaintenanceLevel(lvl);
              setMaintenanceMode(lvl === "read_only" || lvl === "lockdown");
            }}
            style={{ padding: "6px 10px", fontSize: "12px" }}
          >
            <option value="off">Operational (Normal Traffic)</option>
            <option value="scheduled">Scheduled Window (Pre-Maintenance Countdown Banner)</option>
            <option value="read_only">Soft Maintenance (Read-Only + Workers Paused)</option>
            <option value="lockdown">Hard Lockdown (Full Status Portal + Offline WASM Sandbox)</option>
          </Select>

          <Select
            aria-label="Announcement Banner Severity"
            value={announcementLevel}
            onChange={(e) => setAnnouncementLevel(e.target.value as typeof announcementLevel)}
            style={{ padding: "6px 10px", fontSize: "12px" }}
          >
            <option value="info">Info Banner</option>
            <option value="warning">Warning Banner</option>
            <option value="critical">Critical Outage / Maintenance Banner</option>
          </Select>
        </Box>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Global Announcement Banner Text</label>
            <Input
              aria-label="Global Announcement Banner Text"
              placeholder="e.g. Scheduled solver cluster upgrade at 02:00 UTC..."
              value={announcementBanner}
              onChange={(e) => setAnnouncementBanner(e.target.value)}
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Estimated Completion (ISO Timestamp or ETA)</label>
              <Box display="flex" gap={1}>
                {[
                  { label: "+15m", mins: 15 },
                  { label: "+30m", mins: 30 },
                  { label: "+1h", mins: 60 },
                  { label: "Clear", mins: 0 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setMaintenanceEta(
                        preset.mins > 0 ? new Date(Date.now() + preset.mins * 60 * 1000).toISOString() : "",
                      )
                    }
                    style={{
                      padding: "1px 6px",
                      fontSize: "10px",
                      fontWeight: 700,
                      borderRadius: "4px",
                      border: "1px solid var(--color-border-primary)",
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </Box>
            </Box>
            <Input
              aria-label="Maintenance ETA"
              placeholder="e.g. 2026-10-30T03:00:00Z"
              value={maintenanceEta}
              onChange={(e) => setMaintenanceEta(e.target.value)}
            />
          </Box>
        </Box>

        <Box display="flex" justifyContent="flex-end" mt={3}>
          <ActionButton $variant="primary" onClick={() => void handleSave()} disabled={loading}>
            <CheckIcon size={14} />
            <span>Save Instance Settings</span>
          </ActionButton>
        </Box>
      </Card>

      {/* ── INVITE CODES MANAGEMENT ── */}
      <Card>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <KeyIcon size={16} />
            <span style={{ fontWeight: 700, fontSize: "14px" }}>Registration Invite Codes</span>
          </Box>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
            <Input
              aria-label="Invite Note"
              placeholder="Note (e.g. Lab Team A)"
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value)}
              style={{ width: "160px", padding: "6px 10px", fontSize: "12px" }}
            />
            <Select
              aria-label="Assigned Role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{ padding: "6px 10px", fontSize: "12px" }}
              title="Assigned Account Role"
            >
              <option value="user">Role: User</option>
              <option value="moderator">Role: Moderator</option>
              <option value="auditor">Role: Auditor</option>
              <option value="admin">Role: Admin</option>
            </Select>
            <Input
              aria-label="Initial Credits"
              type="number"
              min="0"
              value={inviteCredits}
              onChange={(e) => setInviteCredits(e.target.value)}
              style={{ width: "86px", padding: "6px 10px", fontSize: "12px" }}
              title="Initial Compute Credits"
            />
            <Input
              aria-label="Max Uses"
              type="number"
              min="1"
              value={inviteMaxUses}
              onChange={(e) => setInviteMaxUses(e.target.value)}
              style={{ width: "74px", padding: "6px 10px", fontSize: "12px" }}
              title="Max Uses"
            />
            <Input
              aria-label="Expires in Days"
              type="number"
              min="1"
              value={inviteExpiresInDays}
              onChange={(e) => setInviteExpiresInDays(e.target.value)}
              style={{ width: "80px", padding: "6px 10px", fontSize: "12px" }}
              title="Expires in Days"
            />
            <ActionButton $variant="primary" onClick={() => void handleCreateInvite()} disabled={loading}>
              <PlusIcon size={13} />
              <span>Generate Invite Code</span>
            </ActionButton>
          </Box>
        </Box>

        <Table style={{ marginTop: "12px" }}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Note</th>
              <th>Role / Credits</th>
              <th>Uses</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "18px" }}>
                  No registration invite codes generated.
                </td>
              </tr>
            ) : (
              invites.map((inv) => {
                const used = inv.usesCount ?? inv.used_count ?? 0;
                const max = inv.maxUses ?? inv.max_uses ?? 1;
                const isRevoked = Boolean(inv.revoked ?? inv.revoked_at);
                const expires = inv.expiresAt ?? inv.expires_at ?? null;
                const role = inv.assigned_role || "user";
                const credits = inv.initial_credits ?? 500;
                return (
                  <tr key={inv.id}>
                    <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{inv.code}</td>
                    <td>{inv.note || "—"}</td>
                    <td style={{ fontSize: "12px" }}>
                      <Badge $variant="neutral">{role}</Badge>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>+{credits} cr</span>
                    </td>
                    <td>
                      {used} / {max}
                    </td>
                    <td>
                      <Badge $variant={isRevoked ? "danger" : used >= max ? "neutral" : "success"}>
                        {isRevoked ? "revoked" : used >= max ? "exhausted" : "active"}
                      </Badge>
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      {expires ? new Date(expires).toLocaleDateString() : "Never"}
                    </td>
                    <td>
                      <Box display="flex" gap={1} flexWrap="wrap">
                        {!isRevoked && (
                          <ActionButton
                            $variant="secondary"
                            type="button"
                            onClick={() => handleCopyInviteLink(inv.code)}
                            title="Copy direct signup invite URL (/signup?invite=...)"
                          >
                            <CopyIcon size={12} />
                            <span>{copiedCode === inv.code ? "Copied!" : "Copy Signup Link"}</span>
                          </ActionButton>
                        )}
                        {!isRevoked && (
                          <ActionButton
                            $variant="danger"
                            onClick={() => void onRevokeInvite(inv.id)}
                            disabled={loading}
                          >
                            <TrashIcon size={12} />
                            <span>Revoke</span>
                          </ActionButton>
                        )}
                      </Box>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
};

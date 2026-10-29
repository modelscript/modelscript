// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, KeyIcon, PlusIcon, TrashIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, Input, Select, Table, Textarea } from "../styles";
import type { AdminInstanceInvite, AdminInstanceSettings } from "../types";

export interface AdminSettingsTabProps {
  settings: AdminInstanceSettings | null;
  invites: AdminInstanceInvite[];
  onSaveSettings: (patch: Partial<AdminInstanceSettings>) => Promise<void>;
  onCreateInvite: (payload: {
    note?: string | undefined;
    maxUses?: number | undefined;
    expiresInDays?: number | undefined;
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
  const [instanceName, setInstanceName] = useState(settings?.instanceName || "ModelScript Cloud");
  const [instanceDescription, setInstanceDescription] = useState(settings?.instanceDescription || "");
  const [contactEmail, setContactEmail] = useState(settings?.contactEmail || "");
  const [registrationMode, setRegistrationMode] = useState<"open" | "invite_only" | "domain_allowlist" | "closed">(
    settings?.registrationMode || "open",
  );
  const [allowedDomainsRaw, setAllowedDomainsRaw] = useState((settings?.allowedEmailDomains || []).join(", "));
  const [federationMode, setFederationMode] = useState<"open" | "allowlist" | "disabled">(
    settings?.federationMode || "open",
  );
  const [maintenanceMode, setMaintenanceMode] = useState(Boolean(settings?.maintenanceMode));
  const [announcementBanner, setAnnouncementBanner] = useState(settings?.announcementBanner || "");
  const [announcementLevel, setAnnouncementLevel] = useState<"info" | "warning" | "critical">(
    settings?.announcementLevel || "info",
  );
  const [autoQuarantineThreshold, setAutoQuarantineThreshold] = useState(
    String(settings?.autoQuarantineReportThreshold ?? 5),
  );
  const [backupRetentionCount, setBackupRetentionCount] = useState(String(settings?.backupRetentionCount ?? 14));

  // Invite creation state
  const [inviteNote, setInviteNote] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("5");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState("14");

  useEffect(() => {
    if (!settings) return;
    setInstanceName(settings.instanceName || "ModelScript Cloud");
    setInstanceDescription(settings.instanceDescription || "");
    setContactEmail(settings.contactEmail || "");
    setRegistrationMode(settings.registrationMode || "open");
    setAllowedDomainsRaw((settings.allowedEmailDomains || []).join(", "));
    setFederationMode(settings.federationMode || "open");
    setMaintenanceMode(Boolean(settings.maintenanceMode));
    setAnnouncementBanner(settings.announcementBanner || "");
    setAnnouncementLevel(settings.announcementLevel || "info");
    setAutoQuarantineThreshold(String(settings.autoQuarantineReportThreshold ?? 5));
    setBackupRetentionCount(String(settings.backupRetentionCount ?? 14));
  }, [settings]);

  const handleSave = async () => {
    const allowedEmailDomains = allowedDomainsRaw
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    await onSaveSettings({
      instanceName: instanceName.trim(),
      instanceDescription: instanceDescription.trim(),
      contactEmail: contactEmail.trim(),
      registrationMode,
      allowedEmailDomains,
      federationMode,
      maintenanceMode,
      announcementBanner: announcementBanner.trim(),
      announcementLevel,
      autoQuarantineReportThreshold: Math.max(0, parseInt(autoQuarantineThreshold, 10) || 0),
      backupRetentionCount: Math.max(1, parseInt(backupRetentionCount, 10) || 14),
    });
  };

  const handleCreateInvite = async () => {
    await onCreateInvite({
      note: inviteNote.trim() || undefined,
      maxUses: Math.max(1, parseInt(inviteMaxUses, 10) || 1),
      expiresInDays: Math.max(1, parseInt(inviteExpiresInDays, 10) || 14),
    });
    setInviteNote("");
  };

  return (
    <div>
      {/* ── INSTANCE IDENTITY & NODEINFO ── */}
      <Card style={{ marginBottom: "24px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>Instance Identity &amp; NodeInfo 2.0/2.1 Metadata</span>
        <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          Configure your instance title, public description, and operator contact advertised to users and ActivityPub
          peers.
        </span>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }} mt={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>Instance Name</label>
            <Input
              aria-label="Instance Name"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              placeholder="ModelScript Cloud"
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

      {/* ── REGISTRATION, FEDERATION & AUTOMATION POLICIES ── */}
      <Card style={{ marginBottom: "24px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>
          Registration, Federation Topology &amp; Safety Policies
        </span>

        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }} mt={2}>
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
      </Card>

      {/* ── MAINTENANCE MODE & GLOBAL BANNER ── */}
      <Card style={{ marginBottom: "24px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>Maintenance Mode &amp; System Announcement Banner</span>

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
            <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
            Enable Read-Only Maintenance Mode
          </label>

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

        <Box display="flex" flexDirection="column" gap={1} mt={2}>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>Global Announcement Banner Text</label>
          <Input
            aria-label="Global Announcement Banner Text"
            placeholder="e.g. Scheduled solver cluster upgrade at 02:00 UTC..."
            value={announcementBanner}
            onChange={(e) => setAnnouncementBanner(e.target.value)}
          />
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
              style={{ width: "180px", padding: "6px 10px", fontSize: "12px" }}
            />
            <Input
              aria-label="Max Uses"
              type="number"
              min="1"
              value={inviteMaxUses}
              onChange={(e) => setInviteMaxUses(e.target.value)}
              style={{ width: "80px", padding: "6px 10px", fontSize: "12px" }}
              title="Max Uses"
            />
            <Input
              aria-label="Expires in Days"
              type="number"
              min="1"
              value={inviteExpiresInDays}
              onChange={(e) => setInviteExpiresInDays(e.target.value)}
              style={{ width: "90px", padding: "6px 10px", fontSize: "12px" }}
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
              <th>Uses</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "18px" }}>
                  No registration invite codes generated.
                </td>
              </tr>
            ) : (
              invites.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{inv.code}</td>
                  <td>{inv.note || "—"}</td>
                  <td>
                    {inv.usesCount} / {inv.maxUses}
                  </td>
                  <td>
                    <Badge $variant={inv.revoked ? "danger" : inv.usesCount >= inv.maxUses ? "neutral" : "success"}>
                      {inv.revoked ? "revoked" : inv.usesCount >= inv.maxUses ? "exhausted" : "active"}
                    </Badge>
                  </td>
                  <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never"}
                  </td>
                  <td>
                    {!inv.revoked && (
                      <ActionButton $variant="danger" onClick={() => void onRevokeInvite(inv.id)} disabled={loading}>
                        <TrashIcon size={12} />
                        <span>Revoke</span>
                      </ActionButton>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
};

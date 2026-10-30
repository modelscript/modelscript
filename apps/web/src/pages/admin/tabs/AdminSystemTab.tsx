// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  CpuIcon,
  DatabaseIcon,
  DownloadIcon,
  MailIcon,
  PulseIcon,
  ShieldCheckIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import {
  type AdminPreflightResult,
  downloadAdminSupportBundle,
  fetchAdminPrometheusMetrics,
  sendAdminTestEmail,
} from "../../../api";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, Input, Table } from "../styles";
import type { AdminSystemHealth } from "../types";

export interface AdminSystemTabProps {
  systemHealth:
    | (AdminSystemHealth & {
        preflight?: AdminPreflightResult | undefined;
        mailerDriver?: string | undefined;
        schemaVersion?: string | number | null | undefined;
        pendingMigrations?: number | undefined;
        diagnostics?: {
          dbSizeBytes: number;
          walSizeBytes: number;
          counts: {
            users: number;
            posts: number;
            packages: number;
            repositories: number;
            jobs: number;
            auditLogs: number;
            quarantinedResources: number;
          };
          backups: { count: number; totalBytes: number; latestAt: string | null };
          jobQueue: { pending: number; running: number; completed: number; failed: number };
        };
      })
    | null;
  loading: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export const AdminSystemTab: React.FC<AdminSystemTabProps> = ({ systemHealth, loading }) => {
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [testEmailStatus, setTestEmailStatus] = useState<string | null>(null);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [supportBundleStatus, setSupportBundleStatus] = useState<string | null>(null);

  if (!systemHealth) {
    return (
      <Card>
        <Box color="var(--color-text-muted)" textAlign="center" py={4}>
          {loading ? "Loading system diagnostics..." : "System diagnostics unavailable."}
        </Box>
      </Card>
    );
  }

  const dbSizeBytes = systemHealth.dbSizeBytes ?? systemHealth.diagnostics?.dbSizeBytes ?? 0;
  const walSizeBytes = systemHealth.walSizeBytes ?? systemHealth.diagnostics?.walSizeBytes ?? 0;
  const backupCount = systemHealth.backupCount ?? systemHealth.diagnostics?.backups?.count ?? 0;
  const totalBackupBytes = systemHealth.totalBackupBytes ?? systemHealth.diagnostics?.backups?.totalBytes ?? 0;
  const counts = systemHealth.counts ??
    systemHealth.diagnostics?.counts ?? {
      users: 0,
      posts: 0,
      packages: 0,
      repositories: 0,
      jobs: 0,
      auditLogs: 0,
      quarantinedResources: 0,
    };
  const jobQueue = systemHealth.jobQueue ??
    systemHealth.diagnostics?.jobQueue ?? {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
  const schemaCurrent = systemHealth.schema?.currentVersion ?? systemHealth.schemaVersion ?? 19;
  const schemaTarget = systemHealth.schema?.targetVersion ?? schemaCurrent;
  const schemaPending = systemHealth.schema?.pendingCount ?? systemHealth.pendingMigrations ?? 0;

  const handleSendTestEmail = async () => {
    try {
      setTestEmailStatus("Sending...");
      const res = await sendAdminTestEmail(testEmailRecipient.trim() || undefined);
      setTestEmailStatus(`Delivered to ${res.recipient} via ${res.driver} driver.`);
    } catch {
      setTestEmailStatus("Failed to send test email. Check SMTP environment configuration.");
    }
  };

  const handleDownloadSupportBundle = async () => {
    try {
      const bundle = await downloadAdminSupportBundle();
      if (typeof window !== "undefined") {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `modelscript-support-bundle-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setSupportBundleStatus("Redacted support bundle generated and downloaded.");
    } catch {
      setSupportBundleStatus("Failed to generate support bundle.");
    }
  };

  const handleViewPrometheusMetrics = async () => {
    try {
      const text = await fetchAdminPrometheusMetrics();
      setMetricsText(text);
    } catch {
      setMetricsText("# Failed to fetch /api/v1/admin/metrics");
    }
  };

  return (
    <div>
      {/* ── READINESS SCORECARD ── */}
      <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }} mb={3}>
        <Card style={{ marginBottom: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Runtime Edition
          </span>
          <Box display="flex" alignItems="center" gap={2} mt={1}>
            <span style={{ fontSize: "20px", fontWeight: 800 }}>{systemHealth.edition.toUpperCase()}</span>
            <Badge $variant={systemHealth.edition === "ee" ? "success" : "neutral"}>
              {systemHealth.edition === "ee" ? "Enterprise" : "Community"}
            </Badge>
          </Box>
        </Card>

        <Card style={{ marginBottom: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Audit Hash Chain
          </span>
          <Box display="flex" alignItems="center" gap={2} mt={1}>
            <ShieldCheckIcon size={18} />
            <Badge $variant={systemHealth.auditChainValid ? "success" : "danger"}>
              {systemHealth.auditChainValid ? "Intact" : "Broken"}
            </Badge>
          </Box>
        </Card>

        <Card style={{ marginBottom: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            SQLite Storage (DB + WAL)
          </span>
          <span style={{ fontSize: "18px", fontWeight: 800, marginTop: "4px" }}>
            {formatBytes(dbSizeBytes + walSizeBytes)}
          </span>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            DB: {formatBytes(dbSizeBytes)} | WAL: {formatBytes(walSizeBytes)}
          </span>
        </Card>

        <Card style={{ marginBottom: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Hot Backups
          </span>
          <span style={{ fontSize: "18px", fontWeight: 800, marginTop: "4px" }}>{backupCount} snapshots</span>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            Total: {formatBytes(totalBackupBytes)}
          </span>
        </Card>
      </Box>

      {/* ── DEPLOYMENT PREFLIGHT & SECURITY READINESS CHECKLIST ── */}
      {systemHealth.preflight && systemHealth.preflight.checks.length > 0 && (
        <Card style={{ marginBottom: "24px" }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <CheckCircleIcon size={16} />
              <span style={{ fontWeight: 700, fontSize: "14px" }}>
                Deployment Preflight &amp; Security Readiness Checklist
              </span>
            </Box>
            <Badge $variant={systemHealth.preflight.readyForProduction ? "success" : "warning"}>
              {systemHealth.preflight.readyForProduction ? "Production Ready" : "Action Recommended"}
            </Badge>
          </Box>
          <Table style={{ marginTop: "8px" }}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Diagnostic &amp; Remediation</th>
              </tr>
            </thead>
            <tbody>
              {systemHealth.preflight.checks.map((chk) => (
                <tr key={chk.id}>
                  <td style={{ fontWeight: 600 }}>{chk.label}</td>
                  <td>
                    <Badge $variant={chk.status === "pass" ? "success" : chk.status === "warn" ? "warning" : "danger"}>
                      {chk.status.toUpperCase()}
                    </Badge>
                  </td>
                  <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    <div>{chk.detail}</div>
                    {chk.remediation && (
                      <div style={{ color: "var(--color-accent-fg)", marginTop: "2px" }}>
                        Remediation: {chk.remediation}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ── SUBSYSTEM HEALTH CHECKS ── */}
      <Card style={{ marginBottom: "24px" }}>
        <Box display="flex" alignItems="center" gap={2}>
          <PulseIcon size={16} />
          <span style={{ fontWeight: 700, fontSize: "14px" }}>Subsystem Readiness &amp; Compliance Checks</span>
        </Box>

        <Table style={{ marginTop: "8px" }}>
          <thead>
            <tr>
              <th>Subsystem</th>
              <th>Status</th>
              <th>Diagnostic Summary</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Schema &amp; Migrations</td>
              <td>
                <Badge $variant={schemaPending === 0 ? "success" : "warning"}>
                  v{schemaCurrent} / v{schemaTarget}
                </Badge>
              </td>
              <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {schemaPending === 0 ? "All database migrations applied." : `${schemaPending} pending migration(s).`}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Outbound Mailer (SMTP / Console)</td>
              <td>
                <Badge $variant="success">{systemHealth.mailerConfigured ? "Configured" : "Offline"}</Badge>
              </td>
              <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Transactional notifications, password resets, and moderation alerts ready.
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>MaxMind GeoIP Telemetry</td>
              <td>
                <Badge $variant={systemHealth.geoIpReady ? "success" : "neutral"}>
                  {systemHealth.geoIpReady ? "Active" : "Fallback"}
                </Badge>
              </td>
              <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {systemHealth.geoIpMessage || "Privacy-preserving IP geolocation lookup."}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Network Egress &amp; Air-Gap Posture</td>
              <td>
                <Badge $variant={systemHealth.airgapMode ? "warning" : "neutral"}>
                  {systemHealth.airgapMode ? "Air-Gapped" : "Connected"}
                </Badge>
              </td>
              <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {systemHealth.airgapMode
                  ? "Strict air-gap mode active; external federation and telemetry disabled."
                  : "Standard network egress enabled."}
              </td>
            </tr>
          </tbody>
        </Table>
      </Card>

      {/* ── INTERACTIVE MAILER VERIFICATION & OBSERVABILITY EXPORT ── */}
      <Card style={{ marginBottom: "24px" }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Outbound Mailer Test, Support Bundle &amp; Prometheus Metrics
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Verify transactional email delivery, export a secret-redacted diagnostic bundle for support, or inspect{" "}
              <code>/api/v1/admin/metrics</code>.
            </span>
          </Box>
          <Box display="flex" gap={2} flexWrap="wrap">
            <ActionButton
              $variant="secondary"
              type="button"
              onClick={() => void handleDownloadSupportBundle()}
              disabled={loading}
            >
              <DownloadIcon size={14} />
              <span>Export Redacted Support Bundle</span>
            </ActionButton>
            <ActionButton
              $variant="secondary"
              type="button"
              onClick={() => void handleViewPrometheusMetrics()}
              disabled={loading}
            >
              <PulseIcon size={14} />
              <span>Inspect Prometheus /metrics</span>
            </ActionButton>
          </Box>
        </Box>

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" mt={2}>
          <Input
            aria-label="Test Email Recipient"
            placeholder="Test recipient email (optional, defaults to admin email)..."
            value={testEmailRecipient}
            onChange={(e) => setTestEmailRecipient(e.target.value)}
            style={{ width: "320px" }}
          />
          <ActionButton $variant="primary" type="button" onClick={() => void handleSendTestEmail()} disabled={loading}>
            <MailIcon size={14} />
            <span>Send Test Email</span>
          </ActionButton>
          {testEmailStatus && (
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{testEmailStatus}</span>
          )}
          {supportBundleStatus && (
            <span style={{ fontSize: "12px", color: "var(--ms-success)" }}>{supportBundleStatus}</span>
          )}
        </Box>

        {metricsText && (
          <Box mt={2}>
            <pre
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "6px",
                padding: "12px",
                fontSize: "11px",
                fontFamily: "monospace",
                maxHeight: "220px",
                overflowY: "auto",
                margin: 0,
              }}
            >
              {metricsText}
            </pre>
          </Box>
        )}
      </Card>

      {/* ── COMPUTE JOB QUEUE & ENTITY COUNTS ── */}
      <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
        <Card style={{ marginBottom: 0 }}>
          <Box display="flex" alignItems="center" gap={2}>
            <CpuIcon size={16} />
            <span style={{ fontWeight: 700, fontSize: "14px" }}>Simulation &amp; Compute Job Queue</span>
          </Box>
          <Box display="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }} mt={2}>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Pending Jobs</div>
              <div style={{ fontSize: "18px", fontWeight: 800 }}>{jobQueue.pending}</div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Running Workers</div>
              <div style={{ fontSize: "18px", fontWeight: 800 }}>{jobQueue.running}</div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Completed</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-success-fg, #2ea043)" }}>
                {jobQueue.completed}
              </div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Failed</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-danger-fg, #f85149)" }}>
                {jobQueue.failed}
              </div>
            </Box>
          </Box>
        </Card>

        <Card style={{ marginBottom: 0 }}>
          <Box display="flex" alignItems="center" gap={2}>
            <DatabaseIcon size={16} />
            <span style={{ fontWeight: 700, fontSize: "14px" }}>Instance Entity Inventory</span>
          </Box>
          <Table style={{ marginTop: "8px" }}>
            <tbody>
              <tr>
                <td>Registered Accounts</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.users}</td>
              </tr>
              <tr>
                <td>Social Posts &amp; Engineering Notes</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.posts}</td>
              </tr>
              <tr>
                <td>Published Modelica / Engineering Packages</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.packages}</td>
              </tr>
              <tr>
                <td>Git Repositories</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.repositories}</td>
              </tr>
              <tr>
                <td>Quarantined Resources</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.quarantinedResources}</td>
              </tr>
              <tr>
                <td>Immutable Audit Log Entries</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{counts.auditLogs}</td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </Box>
    </div>
  );
};

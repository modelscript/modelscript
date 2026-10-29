// SPDX-License-Identifier: AGPL-3.0-or-later

import { CpuIcon, DatabaseIcon, PulseIcon, ShieldCheckIcon } from "@primer/octicons-react";
import React from "react";
import Box from "../../../components/Box";
import { Badge, Card, Table } from "../styles";
import type { AdminSystemHealth } from "../types";

export interface AdminSystemTabProps {
  systemHealth: AdminSystemHealth | null;
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
  if (!systemHealth) {
    return (
      <Card>
        <Box color="var(--color-text-muted)" textAlign="center" py={4}>
          {loading ? "Loading system diagnostics..." : "System diagnostics unavailable."}
        </Box>
      </Card>
    );
  }

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
            {formatBytes(systemHealth.dbSizeBytes + systemHealth.walSizeBytes)}
          </span>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            DB: {formatBytes(systemHealth.dbSizeBytes)} | WAL: {formatBytes(systemHealth.walSizeBytes)}
          </span>
        </Card>

        <Card style={{ marginBottom: 0 }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
            Hot Backups
          </span>
          <span style={{ fontSize: "18px", fontWeight: 800, marginTop: "4px" }}>
            {systemHealth.backupCount} snapshots
          </span>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            Total: {formatBytes(systemHealth.totalBackupBytes)}
          </span>
        </Card>
      </Box>

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
                <Badge $variant={systemHealth.schema.pendingCount === 0 ? "success" : "warning"}>
                  v{systemHealth.schema.currentVersion} / v{systemHealth.schema.targetVersion}
                </Badge>
              </td>
              <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {systemHealth.schema.pendingCount === 0
                  ? "All database migrations applied."
                  : `${systemHealth.schema.pendingCount} pending migration(s).`}
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
              <div style={{ fontSize: "18px", fontWeight: 800 }}>{systemHealth.jobQueue.pending}</div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Running Workers</div>
              <div style={{ fontSize: "18px", fontWeight: 800 }}>{systemHealth.jobQueue.running}</div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Completed</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#2ea043" }}>
                {systemHealth.jobQueue.completed}
              </div>
            </Box>
            <Box p={2} style={{ background: "var(--color-bg-primary)", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Failed</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#f85149" }}>{systemHealth.jobQueue.failed}</div>
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
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.users}</td>
              </tr>
              <tr>
                <td>Social Posts &amp; Engineering Notes</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.posts}</td>
              </tr>
              <tr>
                <td>Published Modelica / Engineering Packages</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.packages}</td>
              </tr>
              <tr>
                <td>Git Repositories</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.repositories}</td>
              </tr>
              <tr>
                <td>Quarantined Resources</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.quarantinedResources}</td>
              </tr>
              <tr>
                <td>Immutable Audit Log Entries</td>
                <td style={{ fontWeight: 700, textAlign: "right" }}>{systemHealth.counts.auditLogs}</td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </Box>
    </div>
  );
};

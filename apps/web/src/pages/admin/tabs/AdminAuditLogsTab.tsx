// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, DownloadIcon, ShieldCheckIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import type { AdminAuditChainVerification } from "../../../api";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, FilterPill, Input, Table } from "../styles";
import type { AdminAuditLog } from "../types";

export interface AdminAuditLogsTabProps {
  auditLogs: AdminAuditLog[];
  totalCount?: number | undefined;
  auditActionFilter: string;
  setAuditActionFilter: (filter: string) => void;
  auditResourceFilter?: string | undefined;
  setAuditResourceFilter?: ((resourceType: string) => void) | undefined;
  auditPageOffset?: number | undefined;
  setAuditPageOffset?: ((offset: number) => void) | undefined;
  auditPageSize?: number | undefined;
  chainVerification?: AdminAuditChainVerification | null | undefined;
  onVerifyChain?: (() => Promise<void>) | undefined;
  onRedactExpiredLogs?: (() => Promise<void>) | undefined;
  loading?: boolean | undefined;
}

const RESOURCE_FILTERS = [
  "all",
  "report",
  "user",
  "post",
  "federation_domain",
  "dmca_notice",
  "database",
  "instance_settings",
];

export const AdminAuditLogsTab: React.FC<AdminAuditLogsTabProps> = ({
  auditLogs,
  totalCount,
  auditActionFilter,
  setAuditActionFilter,
  auditResourceFilter = "all",
  setAuditResourceFilter,
  auditPageOffset = 0,
  setAuditPageOffset,
  auditPageSize = 50,
  chainVerification,
  onVerifyChain,
  onRedactExpiredLogs,
  loading = false,
}) => {
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelscript-audit-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
          <Input
            style={{ width: "280px" }}
            placeholder="Filter by action (e.g. report_resolved)..."
            value={auditActionFilter}
            onChange={(e) => setAuditActionFilter(e.target.value)}
          />
          {setAuditResourceFilter &&
            RESOURCE_FILTERS.map((resType) => (
              <FilterPill
                key={resType}
                $active={auditResourceFilter === resType}
                onClick={() => setAuditResourceFilter(resType)}
              >
                {resType === "all" ? "All Resources" : resType}
              </FilterPill>
            ))}
        </Box>

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          {onRedactExpiredLogs && (
            <ActionButton $variant="secondary" onClick={() => void onRedactExpiredLogs()} disabled={loading}>
              <ShieldCheckIcon size={13} />
              <span>Redact Expired IPs (GDPR)</span>
            </ActionButton>
          )}
          {onVerifyChain && (
            <ActionButton $variant="secondary" onClick={() => void onVerifyChain()} disabled={loading}>
              <ShieldCheckIcon size={13} />
              <span>Verify Hash Chain</span>
            </ActionButton>
          )}
          <ActionButton $variant="secondary" onClick={handleExportJson} disabled={auditLogs.length === 0}>
            <DownloadIcon size={13} />
            <span>Export JSON</span>
          </ActionButton>
        </Box>
      </Box>

      {chainVerification && (
        <Card
          style={{
            marginBottom: "16px",
            border: chainVerification.valid
              ? "1px solid var(--color-status-verified, #2ea043)"
              : "1px solid var(--color-danger, #f85149)",
            background: chainVerification.valid
              ? "var(--color-status-verified-subtle, rgba(46, 160, 67, 0.08))"
              : "var(--color-danger-subtle, rgba(248, 81, 73, 0.08))",
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <CheckCircleIcon size={16} />
              <span style={{ fontWeight: 700, fontSize: "13px" }}>
                {chainVerification.valid
                  ? "Cryptographic SHA-256 Chain Intact"
                  : `Chain Integrity Failure at Entry #${chainVerification.brokenAtId ?? "unknown"}`}
              </span>
              <Badge $variant={chainVerification.valid ? "success" : "danger"}>
                {chainVerification.verifiedEntries} / {chainVerification.totalEntries} Verified
              </Badge>
            </Box>
            {chainVerification.headHash && (
              <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)" }}>
                Head SHA-256: {chainVerification.headHash.slice(0, 16)}&hellip;
              </span>
            )}
          </Box>
        </Card>
      )}

      <Table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Resource</th>
            <th>IP Address</th>
            <th>SHA-256 Chain</th>
            <th>Forensic Details</th>
          </tr>
        </thead>
        <tbody>
          {auditLogs.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                No audit records found.
              </td>
            </tr>
          ) : (
            auditLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              return (
                <React.Fragment key={log.id}>
                  <tr>
                    <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--color-text-muted)" }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                      <Badge $variant="neutral">{log.action}</Badge>
                    </td>
                    <td>
                      {log.actor_id ? (
                        <span>
                          {log.actor_username ? <strong>@{log.actor_username} </strong> : null}
                          <span style={{ color: "var(--color-text-muted)" }}>#{log.actor_id}</span>
                        </span>
                      ) : (
                        "System / Anonymous"
                      )}
                    </td>
                    <td>{log.resource_type ? `${log.resource_type}:${log.resource_id || ""}` : "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{log.ip_address || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "11px" }}>
                      {log.entry_hash ? (
                        <span title={`entry: ${log.entry_hash}\nprev: ${log.prev_hash || "GENESIS"}`}>
                          #{log.entry_hash.slice(0, 10)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {log.details ? (
                        <ActionButton $variant="secondary" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
                          {isExpanded ? "Hide JSON" : "Inspect JSON"}
                        </ActionButton>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && log.details && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--color-bg-primary)" }}>
                        <pre
                          style={{
                            margin: 0,
                            padding: "10px",
                            fontSize: "11px",
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            color: "var(--color-text-primary)",
                          }}
                        >
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(log.details), null, 2);
                            } catch {
                              return log.details;
                            }
                          })()}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </Table>

      {setAuditPageOffset && (
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={3}>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Showing offset {auditPageOffset} &ndash; {auditPageOffset + auditLogs.length}
            {typeof totalCount === "number" ? ` of ${totalCount}` : ""}
          </span>
          <Box display="flex" gap={2}>
            <ActionButton
              $variant="secondary"
              disabled={auditPageOffset === 0}
              onClick={() => setAuditPageOffset(Math.max(0, auditPageOffset - auditPageSize))}
            >
              Previous Page
            </ActionButton>
            <ActionButton
              $variant="secondary"
              disabled={auditLogs.length < auditPageSize}
              onClick={() => setAuditPageOffset(auditPageOffset + auditPageSize)}
            >
              Next Page
            </ActionButton>
          </Box>
        </Box>
      )}
    </div>
  );
};

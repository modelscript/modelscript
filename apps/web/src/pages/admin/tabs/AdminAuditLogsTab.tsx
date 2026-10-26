// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import Box from "../../../components/Box";
import { Badge, Input, Table } from "../styles";
import type { AdminAuditLog } from "../types";

export interface AdminAuditLogsTabProps {
  auditLogs: AdminAuditLog[];
  auditActionFilter: string;
  setAuditActionFilter: (filter: string) => void;
}

export const AdminAuditLogsTab: React.FC<AdminAuditLogsTabProps> = ({
  auditLogs,
  auditActionFilter,
  setAuditActionFilter,
}) => {
  return (
    <div>
      <Box display="flex" gap={2} mb={3}>
        <Input
          style={{ width: "100%", maxWidth: "320px" }}
          placeholder="Filter by action (e.g. report_resolved)..."
          value={auditActionFilter}
          onChange={(e) => setAuditActionFilter(e.target.value)}
        />
      </Box>

      <Table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Actor ID</th>
            <th>Resource</th>
            <th>IP Address</th>
          </tr>
        </thead>
        <tbody>
          {auditLogs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                No audit records found.
              </td>
            </tr>
          ) : (
            auditLogs.map((log) => (
              <tr key={log.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--color-text-muted)" }}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td>
                  <Badge $variant="neutral">{log.action}</Badge>
                </td>
                <td>{log.actor_id ? `#${log.actor_id}` : "System / Anonymous"}</td>
                <td>{log.resource_type ? `${log.resource_type}:${log.resource_id || ""}` : "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{log.ip_address || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
};

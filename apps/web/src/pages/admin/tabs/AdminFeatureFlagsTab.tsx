// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Table } from "../styles";
import type { AdminFeatureFlag } from "../types";

export interface AdminFeatureFlagsTabProps {
  featureFlags: AdminFeatureFlag[];
  togglingFlagKey: string | null;
  onToggleFlag: (flag: AdminFeatureFlag) => Promise<void>;
}

export const AdminFeatureFlagsTab: React.FC<AdminFeatureFlagsTabProps> = ({
  featureFlags,
  togglingFlagKey,
  onToggleFlag,
}) => {
  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box
        p={3}
        style={{
          border: "1px solid var(--color-border-default)",
          borderRadius: "8px",
          background: "var(--color-canvas-subtle)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-fg-default)" }}>
          Launch Readiness &amp; Subsystem Feature Gates
        </div>
        <div style={{ color: "var(--color-fg-muted)", fontSize: "13px", marginTop: "4px" }}>
          Control subsystem availability in real time across API routes and web UI. Toggling a flag takes effect
          immediately without restarting backend services.
        </div>
      </Box>

      <Table>
        <thead>
          <tr>
            <th>Feature Name &amp; Description</th>
            <th>Category</th>
            <th>Maturity</th>
            <th>Status</th>
            <th>Default</th>
            <th style={{ textAlign: "right" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {featureFlags.map((flag) => (
            <tr key={flag.key}>
              <td>
                <Box display="flex" flexDirection="column">
                  <span style={{ fontWeight: 700, color: "var(--color-fg-default)", fontSize: "14px" }}>
                    {flag.name}
                  </span>
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "12px", marginTop: "2px" }}>
                    {flag.description}
                  </span>
                  <code
                    style={{
                      fontSize: "11px",
                      color: "var(--color-accent-cyan)",
                      marginTop: "4px",
                      fontFamily: "monospace",
                    }}
                  >
                    {flag.key}
                  </code>
                </Box>
              </td>
              <td>
                <span style={{ textTransform: "capitalize", fontSize: "12px", color: "var(--color-fg-muted)" }}>
                  {flag.category}
                </span>
              </td>
              <td>
                <Badge
                  $variant={
                    flag.maturity === "production" ? "approved" : flag.maturity === "beta" ? "warning" : "pending"
                  }
                >
                  {flag.maturity.toUpperCase()}
                </Badge>
              </td>
              <td>
                <Badge $variant={flag.currentEnabled ? "approved" : "rejected"}>
                  {flag.currentEnabled ? "ACTIVE" : "DISABLED"}
                </Badge>
              </td>
              <td>
                <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                  {flag.defaultValue ? "True" : "False"}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <ActionButton
                  $variant={flag.currentEnabled ? "danger" : "primary"}
                  onClick={() => onToggleFlag(flag)}
                  disabled={togglingFlagKey === flag.key}
                >
                  {togglingFlagKey === flag.key ? "Saving..." : flag.currentEnabled ? "Disable" : "Enable"}
                </ActionButton>
              </td>
            </tr>
          ))}
          {featureFlags.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--color-fg-muted)" }}>
                No feature flags registered.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </Box>
  );
};

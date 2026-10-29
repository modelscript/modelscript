// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Select, Table } from "../styles";
import type { AdminFeatureFlag } from "../types";

export interface AdminFeatureFlagsTabProps {
  featureFlags: AdminFeatureFlag[];
  togglingFlagKey: string | null;
  onToggleFlag: (flag: AdminFeatureFlag) => Promise<void>;
  onUpdateFlagConfig?:
    | ((flag: AdminFeatureFlag, allowedRoles: string, rolloutPercentage: number) => Promise<void>)
    | undefined;
}

export const AdminFeatureFlagsTab: React.FC<AdminFeatureFlagsTabProps> = ({
  featureFlags,
  togglingFlagKey,
  onToggleFlag,
  onUpdateFlagConfig,
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
          Control subsystem availability, progressive rollout percentage, and role targeting in real time across API
          routes and web UI.
        </div>
      </Box>

      <Table>
        <thead>
          <tr>
            <th>Feature Name &amp; Description</th>
            <th>Category</th>
            <th>Maturity</th>
            <th>Rollout &amp; Roles</th>
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
                {(() => {
                  const rolesStr = Array.isArray(flag.allowedRoles)
                    ? flag.allowedRoles.join(",")
                    : flag.allowedRoles || "user,admin,guest";
                  return onUpdateFlagConfig ? (
                    <Box display="flex" flexDirection="column" gap={1}>
                      <Select
                        style={{ padding: "4px 8px", fontSize: "12px" }}
                        value={String(flag.rolloutPercentage ?? 100)}
                        disabled={togglingFlagKey === flag.key}
                        onChange={(e) => void onUpdateFlagConfig(flag, rolesStr, Number(e.target.value))}
                      >
                        <option value="0">0% Rollout</option>
                        <option value="10">10% Canary</option>
                        <option value="25">25% Rollout</option>
                        <option value="50">50% Rollout</option>
                        <option value="100">100% GA</option>
                      </Select>
                      <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Roles: {rolesStr}</span>
                    </Box>
                  ) : (
                    <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                      {flag.rolloutPercentage ?? 100}% ({rolesStr})
                    </span>
                  );
                })()}
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
              <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "var(--color-fg-muted)" }}>
                No feature flags registered.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </Box>
  );
};

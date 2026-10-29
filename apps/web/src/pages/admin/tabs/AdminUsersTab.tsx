// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, LockIcon, ShieldCheckIcon, TrashIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import {
  ActionButton,
  Badge,
  Card,
  FilterPill,
  Input,
  ModalBox,
  ModalOverlay,
  Select,
  StatGrid,
  Table,
  Textarea,
} from "../styles";
import type { AdminUserSummary } from "../types";

export interface AdminUsersTabProps {
  users: AdminUserSummary[];
  userSearchQuery: string;
  setUserSearchQuery: (q: string) => void;
  userStatusFilter: string;
  setUserStatusFilter: (status: string) => void;
  userRoleFilter: string;
  setUserRoleFilter: (role: string) => void;
  onModerateUser: (
    userId: number,
    payload: {
      status?: "active" | "frozen" | "suspended" | undefined;
      role?: "user" | "admin" | undefined;
      reason?: string | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
    },
  ) => Promise<void>;
  loading: boolean;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  users,
  userSearchQuery,
  setUserSearchQuery,
  userStatusFilter,
  setUserStatusFilter,
  userRoleFilter,
  setUserRoleFilter,
  onModerateUser,
  loading,
}) => {
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [targetStatus, setTargetStatus] = useState<"active" | "frozen" | "suspended">("active");
  const [targetRole, setTargetRole] = useState<"user" | "admin">("user");
  const [moderationReason, setModerationReason] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [purgePosts, setPurgePosts] = useState(false);

  const openGovernanceModal = (user: AdminUserSummary, presetStatus?: "active" | "frozen" | "suspended") => {
    setSelectedUser(user);
    const normalizedStatus: "active" | "frozen" | "suspended" =
      user.status === "frozen" || user.status === "suspended" ? user.status : "active";
    const nextStatus = presetStatus ?? normalizedStatus;
    setTargetStatus(nextStatus);
    setTargetRole(user.account_type === "admin" ? "admin" : "user");
    setModerationReason("");
    setRevokeSessions(nextStatus !== "active");
    setPurgePosts(false);
  };

  const handleConfirmGovernance = async () => {
    if (!selectedUser) return;
    await onModerateUser(selectedUser.id, {
      status: targetStatus,
      role: targetRole,
      reason: moderationReason.trim() || undefined,
      revokeSessions,
      purgePosts,
    });
    setSelectedUser(null);
  };

  const activeCount = users.filter((u) => u.status === "active").length;
  const frozenCount = users.filter((u) => u.status === "frozen").length;
  const suspendedCount = users.filter((u) => u.status === "suspended").length;

  return (
    <div>
      <StatGrid>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Matching Accounts</span>
          <span style={{ fontSize: "22px", fontWeight: 800 }}>{users.length}</span>
        </Card>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Active</span>
          <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--ms-success)" }}>{activeCount}</span>
        </Card>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Frozen (Read-Only)</span>
          <span style={{ fontSize: "22px", fontWeight: 800, color: "#d29922" }}>{frozenCount}</span>
        </Card>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Suspended</span>
          <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--ms-danger)" }}>{suspendedCount}</span>
        </Card>
      </StatGrid>

      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
          <FilterPill $active={userStatusFilter === "all"} onClick={() => setUserStatusFilter("all")}>
            All Statuses
          </FilterPill>
          <FilterPill $active={userStatusFilter === "active"} onClick={() => setUserStatusFilter("active")}>
            Active
          </FilterPill>
          <FilterPill $active={userStatusFilter === "frozen"} onClick={() => setUserStatusFilter("frozen")}>
            Frozen
          </FilterPill>
          <FilterPill $active={userStatusFilter === "suspended"} onClick={() => setUserStatusFilter("suspended")}>
            Suspended
          </FilterPill>

          <span style={{ color: "var(--color-border)", margin: "0 4px" }}>|</span>

          <FilterPill $active={userRoleFilter === "all"} onClick={() => setUserRoleFilter("all")}>
            All Roles
          </FilterPill>
          <FilterPill $active={userRoleFilter === "admin"} onClick={() => setUserRoleFilter("admin")}>
            Admins
          </FilterPill>
          <FilterPill $active={userRoleFilter === "user"} onClick={() => setUserRoleFilter("user")}>
            Users
          </FilterPill>
        </Box>

        <Input
          style={{ width: "280px" }}
          placeholder="Search @username, email, or domain..."
          value={userSearchQuery}
          onChange={(e) => setUserSearchQuery(e.target.value)}
        />
      </Box>

      <Table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Role &amp; Security</th>
            <th>Status</th>
            <th>Activity &amp; Reports</th>
            <th>Credits</th>
            <th style={{ textAlign: "right" }}>Governance Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                No user accounts match the current filters.
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Box display="flex" flexDirection="column">
                    <span style={{ fontWeight: 700, fontSize: "13px" }}>
                      @{u.username} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>#{u.id}</span>
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {u.email || (u.remote_domain ? `Federated (${u.remote_domain})` : "No email")}
                    </span>
                  </Box>
                </td>
                <td>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    <Badge $variant={u.account_type === "admin" ? "approved" : "neutral"}>{u.account_type}</Badge>
                    {u.totp_enabled === 1 && <Badge $variant="success">2FA</Badge>}
                    {u.email_verified === 1 && <Badge $variant="neutral">Verified</Badge>}
                  </Box>
                </td>
                <td>
                  <Badge $variant={u.status === "active" ? "success" : u.status === "frozen" ? "warning" : "danger"}>
                    {u.status}
                  </Badge>
                </td>
                <td>
                  <Box display="flex" flexDirection="column" fontSize="12px">
                    <span>{u.post_count} posts</span>
                    <span
                      style={{
                        color: u.report_count > 0 ? "var(--ms-danger)" : "var(--color-text-muted)",
                      }}
                    >
                      {u.report_count} reports ({u.resolved_violation_count} confirmed)
                    </span>
                  </Box>
                </td>
                <td style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{u.credit_balance ?? 0}</td>
                <td style={{ textAlign: "right" }}>
                  <Box display="flex" justifyContent="flex-end" gap={1} flexWrap="wrap">
                    {u.status !== "active" && (
                      <ActionButton
                        $variant="secondary"
                        disabled={loading}
                        onClick={() => openGovernanceModal(u, "active")}
                      >
                        <CheckCircleIcon size={13} />
                        <span>Restore</span>
                      </ActionButton>
                    )}
                    {u.status !== "frozen" && (
                      <ActionButton
                        $variant="secondary"
                        disabled={loading}
                        onClick={() => openGovernanceModal(u, "frozen")}
                      >
                        <LockIcon size={13} />
                        <span>Freeze</span>
                      </ActionButton>
                    )}
                    {u.status !== "suspended" && (
                      <ActionButton
                        $variant="danger"
                        disabled={loading}
                        onClick={() => openGovernanceModal(u, "suspended")}
                      >
                        <TrashIcon size={13} />
                        <span>Suspend</span>
                      </ActionButton>
                    )}
                    <ActionButton $variant="secondary" disabled={loading} onClick={() => openGovernanceModal(u)}>
                      <ShieldCheckIcon size={13} />
                      <span>Manage...</span>
                    </ActionButton>
                  </Box>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {selectedUser && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>
              Account Governance — @{selectedUser.username} (#{selectedUser.id})
            </span>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Account Standing</label>
              <Select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as "active" | "frozen" | "suspended")}
              >
                <option value="active">active — Full platform privileges</option>
                <option value="frozen">frozen — Read-only mode (cannot post or report)</option>
                <option value="suspended">suspended — Account locked &amp; sign-in blocked</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>RBAC Role</label>
              <Select value={targetRole} onChange={(e) => setTargetRole(e.target.value as "user" | "admin")}>
                <option value="user">user — Standard member</option>
                <option value="admin">admin — Instance Administrator</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Moderation Reason / Audit Note</label>
              <Textarea
                placeholder="Document the reason for this account standing or role change..."
                value={moderationReason}
                onChange={(e) => setModerationReason(e.target.value)}
              />
            </Box>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={revokeSessions} onChange={(e) => setRevokeSessions(e.target.checked)} />
              Revoke all active refresh tokens &amp; sign out existing sessions
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: "var(--ms-danger)",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={purgePosts} onChange={(e) => setPurgePosts(e.target.checked)} />
              Purge all posts authored by @{selectedUser.username}
            </label>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setSelectedUser(null)}>
                Cancel
              </ActionButton>
              <ActionButton $variant="primary" onClick={handleConfirmGovernance} disabled={loading}>
                Apply Governance Action
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};

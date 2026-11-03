// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  EyeIcon,
  KebabHorizontalIcon,
  LockIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import { type AdminUserForensics, getAdminUserForensics } from "../../../api/admin";
import Box from "../../../components/Box";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import {
  ActionButton,
  ActionMenuDropdown,
  ActionMenuItem,
  Badge,
  Card,
  FilterPill,
  Input,
  ModalBox,
  ModalOverlay,
  Select,
  StatGrid,
  Table,
  TableWrapper,
  Textarea,
} from "../styles";
import type { AdminUsersStatusBreakdown, AdminUserSummary } from "../types";

export interface AdminUsersTabProps {
  users: AdminUserSummary[];
  totalUsers?: number | undefined;
  statusBreakdown?: AdminUsersStatusBreakdown | null | undefined;
  userSearchQuery: string;
  setUserSearchQuery: (q: string) => void;
  userStatusFilter: string;
  setUserStatusFilter: (status: string) => void;
  userRoleFilter: string;
  setUserRoleFilter: (role: string) => void;
  userPageOffset?: number | undefined;
  setUserPageOffset?: ((offset: number) => void) | undefined;
  onModerateUser: (
    userId: number,
    payload: {
      status?: "active" | "frozen" | "suspended" | undefined;
      role?: "user" | "moderator" | "auditor" | "admin" | undefined;
      reason?: string | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
      emailVerified?: boolean | undefined;
      reset2FA?: boolean | undefined;
    },
  ) => Promise<void>;
  onAdjustUserCredits?: ((userId: number, amount: number, reason: string) => Promise<void>) | undefined;
  onCreateUser?:
    | ((payload: {
        username: string;
        email: string;
        password: string;
        displayName?: string | undefined;
        role?: "user" | "moderator" | "auditor" | "admin" | undefined;
        initialCredits?: number | undefined;
        emailVerified?: boolean | undefined;
      }) => Promise<void>)
    | undefined;
  initialForensics?: AdminUserForensics | null | undefined;
  loading: boolean;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  users,
  totalUsers,
  statusBreakdown,
  userSearchQuery,
  setUserSearchQuery,
  userStatusFilter,
  setUserStatusFilter,
  userRoleFilter,
  setUserRoleFilter,
  userPageOffset = 0,
  setUserPageOffset,
  onModerateUser,
  onAdjustUserCredits,
  onCreateUser,
  initialForensics = null,
  loading,
}) => {
  const hasBilling = useFeatureFlag("billing_stripe_live");
  const [openMenuUserId, setOpenMenuUserId] = useState<number | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openMenuUserId === null) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuUserId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [openMenuUserId]);

  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [targetStatus, setTargetStatus] = useState<"active" | "frozen" | "suspended">("active");
  const [targetRole, setTargetRole] = useState<"user" | "moderator" | "auditor" | "admin">("user");
  const [moderationReason, setModerationReason] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [purgePosts, setPurgePosts] = useState(false);
  const [markEmailVerified, setMarkEmailVerified] = useState(false);
  const [reset2FAFlag, setReset2FAFlag] = useState(false);
  const [confirmReset2FAUser, setConfirmReset2FAUser] = useState<AdminUserSummary | null>(null);

  const [creditModalUser, setCreditModalUser] = useState<AdminUserSummary | null>(null);
  const [creditDelta, setCreditDelta] = useState<string>("100");
  const [creditReason, setCreditReason] = useState<string>("Admin compute credit grant");

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "moderator" | "auditor" | "admin">("user");
  const [newCredits, setNewCredits] = useState("100");
  const [newEmailVerified, setNewEmailVerified] = useState(true);

  const [forensicsData, setForensicsData] = useState<AdminUserForensics | null>(initialForensics);
  const [forensicsLoading, setForensicsLoading] = useState(false);

  const resetUser2FA = async (userId: number) => {
    setConfirmReset2FAUser(null);
    await onModerateUser(userId, { reset2FA: true });
  };

  const handleOpenForensics = async (userId: number) => {
    setForensicsLoading(true);
    try {
      const data = await getAdminUserForensics(userId);
      setForensicsData(data);
    } catch {
      // Ignore error in read-only drawer
    } finally {
      setForensicsLoading(false);
    }
  };

  const openGovernanceModal = (user: AdminUserSummary, presetStatus?: "active" | "frozen" | "suspended") => {
    setSelectedUser(user);
    const normalizedStatus: "active" | "frozen" | "suspended" =
      user.status === "frozen" || user.status === "suspended" ? user.status : "active";
    const nextStatus = presetStatus ?? normalizedStatus;
    setTargetStatus(nextStatus);
    const currentRole =
      user.account_type === "admin" || user.account_type === "moderator" || user.account_type === "auditor"
        ? user.account_type
        : "user";
    setTargetRole(currentRole);
    setModerationReason("");
    setRevokeSessions(nextStatus !== "active");
    setPurgePosts(false);
    setMarkEmailVerified(false);
    setReset2FAFlag(false);
  };

  const handleConfirmGovernance = async () => {
    if (!selectedUser) return;
    await onModerateUser(selectedUser.id, {
      status: targetStatus,
      role: targetRole,
      reason: moderationReason.trim() || undefined,
      revokeSessions,
      purgePosts,
      ...(markEmailVerified ? { emailVerified: true } : {}),
      ...(reset2FAFlag ? { reset2FA: true } : {}),
    });
    setSelectedUser(null);
  };

  const handleConfirmCredits = async () => {
    if (!creditModalUser || !onAdjustUserCredits) return;
    const amount = Number(creditDelta);
    if (!Number.isFinite(amount) || amount === 0) return;
    await onAdjustUserCredits(creditModalUser.id, amount, creditReason.trim() || "Admin compute credit adjustment");
    setCreditModalUser(null);
  };

  const handleConfirmCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateUser || !newUsername.trim() || !newEmail.trim() || !newPassword) return;
    await onCreateUser({
      username: newUsername.trim(),
      email: newEmail.trim(),
      password: newPassword,
      ...(newDisplayName.trim() ? { displayName: newDisplayName.trim() } : {}),
      role: newRole,
      initialCredits: hasBilling ? Math.max(0, Number(newCredits) || 0) : undefined,
      emailVerified: newEmailVerified,
    });
    setCreateModalOpen(false);
    setNewUsername("");
    setNewEmail("");
    setNewDisplayName("");
    setNewPassword("");
    setNewRole("user");
    setNewCredits("100");
    setNewEmailVerified(true);
  };

  const activeCount = statusBreakdown ? statusBreakdown.active : users.filter((u) => u.status === "active").length;
  const frozenCount = statusBreakdown ? statusBreakdown.frozen : users.filter((u) => u.status === "frozen").length;
  const suspendedCount = statusBreakdown
    ? statusBreakdown.suspended
    : users.filter((u) => u.status === "suspended").length;
  const effectiveTotal = totalUsers ?? users.length;

  return (
    <div>
      <StatGrid>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Matching Accounts</span>
          <span style={{ fontSize: "22px", fontWeight: 800 }}>{effectiveTotal}</span>
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
          <FilterPill $active={userRoleFilter === "moderator"} onClick={() => setUserRoleFilter("moderator")}>
            Moderators
          </FilterPill>
          <FilterPill $active={userRoleFilter === "auditor"} onClick={() => setUserRoleFilter("auditor")}>
            Auditors
          </FilterPill>
          <FilterPill $active={userRoleFilter === "user"} onClick={() => setUserRoleFilter("user")}>
            Users
          </FilterPill>
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Input
            style={{ width: "260px" }}
            placeholder="Search @username, email, or domain..."
            value={userSearchQuery}
            onChange={(e) => setUserSearchQuery(e.target.value)}
          />
          {onCreateUser && (
            <ActionButton $variant="primary" type="button" disabled={loading} onClick={() => setCreateModalOpen(true)}>
              <PlusIcon size={13} />
              <span>Create User</span>
            </ActionButton>
          )}
        </Box>
      </Box>

      <TableWrapper>
        <Table style={{ minWidth: hasBilling ? "860px" : "740px" }}>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role &amp; Security</th>
              <th>Status</th>
              <th>Activity &amp; Reports</th>
              {hasBilling && <th>Credits</th>}
              <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Governance Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={hasBilling ? 6 : 5}
                  style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}
                >
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
                      <Badge
                        $variant={
                          u.account_type === "admin"
                            ? "approved"
                            : u.account_type === "moderator" || u.account_type === "auditor"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {u.account_type}
                      </Badge>
                      {u.totp_enabled === 1 && <Badge $variant="success">2FA</Badge>}
                      {u.email_verified === 1 && <Badge $variant="neutral">Verified</Badge>}
                    </Box>
                  </td>
                  <td>
                    <Badge
                      $variant={
                        u.status === "active"
                          ? "success"
                          : u.status === "frozen" || u.status === "pending_verification"
                            ? "warning"
                            : "danger"
                      }
                    >
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
                  {hasBilling && (
                    <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                          {u.credit_balance ?? 0}
                        </span>
                        {onAdjustUserCredits && (
                          <ActionButton
                            $variant="secondary"
                            disabled={loading}
                            onClick={() => {
                              setCreditModalUser(u);
                              setCreditDelta("100");
                              setCreditReason("Admin compute credit grant");
                            }}
                            title="Grant or deduct compute credits"
                          >
                            <PlusIcon size={12} />
                            <span>Credits</span>
                          </ActionButton>
                        )}
                      </Box>
                    </td>
                  )}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Box display="inline-flex" alignItems="center" justifyContent="flex-end" gap={1}>
                      <ActionButton
                        $variant="secondary"
                        disabled={loading || forensicsLoading}
                        onClick={() => void handleOpenForensics(u.id)}
                        title="Inspect user forensic dossier and activity"
                      >
                        <EyeIcon size={13} />
                        <span>Forensics</span>
                      </ActionButton>

                      <ActionButton
                        $variant="secondary"
                        disabled={loading}
                        onClick={() => openGovernanceModal(u)}
                        title="Open full governance management dialog"
                      >
                        <ShieldCheckIcon size={13} />
                        <span>Manage</span>
                      </ActionButton>

                      <div
                        style={{ position: "relative" }}
                        ref={openMenuUserId === u.id ? menuContainerRef : undefined}
                      >
                        <ActionButton
                          $variant="secondary"
                          disabled={loading}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuUserId((prev) => (prev === u.id ? null : u.id));
                          }}
                          title="More governance actions"
                          aria-label={`More governance actions for @${u.username}`}
                          style={{ padding: "6px 8px" }}
                        >
                          <KebabHorizontalIcon size={14} />
                        </ActionButton>

                        {openMenuUserId === u.id && (
                          <ActionMenuDropdown onClick={(e) => e.stopPropagation()}>
                            {u.status !== "active" && (
                              <ActionMenuItem
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  openGovernanceModal(u, "active");
                                }}
                              >
                                <CheckCircleIcon size={13} />
                                <span>Restore Account</span>
                              </ActionMenuItem>
                            )}
                            {u.status !== "frozen" && (
                              <ActionMenuItem
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  openGovernanceModal(u, "frozen");
                                }}
                              >
                                <LockIcon size={13} />
                                <span>Freeze Account</span>
                              </ActionMenuItem>
                            )}
                            {u.status !== "suspended" && (
                              <ActionMenuItem
                                $danger
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  openGovernanceModal(u, "suspended");
                                }}
                              >
                                <TrashIcon size={13} />
                                <span>Suspend Account</span>
                              </ActionMenuItem>
                            )}
                            {!u.email_verified && !u.remote_domain && (
                              <ActionMenuItem
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  void onModerateUser(u.id, { emailVerified: true });
                                }}
                              >
                                <CheckCircleIcon size={13} />
                                <span>Verify Email</span>
                              </ActionMenuItem>
                            )}
                            {u.totp_enabled === 1 && (
                              <ActionMenuItem
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  setConfirmReset2FAUser(u);
                                }}
                              >
                                <ShieldCheckIcon size={13} />
                                <span>Reset 2FA</span>
                              </ActionMenuItem>
                            )}
                            {hasBilling && onAdjustUserCredits && (
                              <ActionMenuItem
                                type="button"
                                onClick={() => {
                                  setOpenMenuUserId(null);
                                  setCreditModalUser(u);
                                  setCreditDelta("100");
                                  setCreditReason("Admin compute credit grant");
                                }}
                              >
                                <PlusIcon size={13} />
                                <span>Adjust Credits</span>
                              </ActionMenuItem>
                            )}
                          </ActionMenuDropdown>
                        )}
                      </div>
                    </Box>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrapper>

      {setUserPageOffset && effectiveTotal > 50 && (
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={3}>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Showing {userPageOffset + 1}–{Math.min(userPageOffset + users.length, effectiveTotal)} of {effectiveTotal}
          </span>
          <Box display="flex" gap={2}>
            <ActionButton
              $variant="secondary"
              disabled={loading || userPageOffset === 0}
              onClick={() => setUserPageOffset(Math.max(0, userPageOffset - 50))}
            >
              Previous Page
            </ActionButton>
            <ActionButton
              $variant="secondary"
              disabled={loading || userPageOffset + 50 >= effectiveTotal}
              onClick={() => setUserPageOffset(userPageOffset + 50)}
            >
              Next Page
            </ActionButton>
          </Box>
        </Box>
      )}

      {forensicsData && (
        <ModalOverlay>
          <ModalBox style={{ maxWidth: "680px", maxHeight: "85vh", overflowY: "auto" }}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <span style={{ fontWeight: 800, fontSize: "16px" }}>
                User Forensic Dossier — @{forensicsData.user.username} (#{forensicsData.user.id})
              </span>
              <Badge $variant={forensicsData.user.status === "active" ? "success" : "danger"}>
                {forensicsData.user.status}
              </Badge>
            </Box>

            <Box display="flex" gap={2} flexWrap="wrap" fontSize="12px" color="var(--color-text-muted)">
              <span>
                Role: <strong>{forensicsData.user.account_type}</strong>
              </span>
              {hasBilling && (
                <>
                  <span>•</span>
                  <span>
                    Balance: <strong>{forensicsData.user.credit_balance} cr</strong> (Spent:{" "}
                    {forensicsData.user.total_spent} cr)
                  </span>
                </>
              )}
              <span>•</span>
              <span>
                2FA: <strong>{forensicsData.user.totp_enabled ? "Enabled" : "Off"}</strong>
              </span>
              <span>•</span>
              <span>
                Email Verified: <strong>{forensicsData.user.email_verified ? "Yes" : "No"}</strong>
              </span>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <span style={{ fontWeight: 700, fontSize: "13px" }}>
                Recent Posts ({forensicsData.recentPosts.length})
              </span>
              {forensicsData.recentPosts.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>No posts authored.</span>
              ) : (
                forensicsData.recentPosts.slice(0, 5).map((p) => (
                  <Box
                    key={p.id}
                    p={2}
                    style={{
                      background: "var(--color-bg-primary)",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-subtle)",
                      fontSize: "12px",
                    }}
                  >
                    <strong>#{p.id}</strong> ({p.visibility}){p.content_warning ? ` [CW: ${p.content_warning}]` : ""}:{" "}
                    {p.content.slice(0, 140)}
                  </Box>
                ))
              )}
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <span style={{ fontWeight: 700, fontSize: "13px" }}>
                Published Packages ({forensicsData.publishedPackages.length}) &amp; Reports (
                {forensicsData.reportsAgainstUser.length})
              </span>
              {forensicsData.publishedPackages.map((pkg) => (
                <Box key={pkg.name} fontSize="12px">
                  <code>{pkg.name}</code> — {pkg.description || "No description"}
                </Box>
              ))}
              {forensicsData.reportsAgainstUser.map((rep) => (
                <Box key={rep.id} fontSize="12px" color="var(--ms-danger)">
                  Report #{rep.id} ({rep.status}): {rep.reason}
                </Box>
              ))}
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <span style={{ fontWeight: 700, fontSize: "13px" }}>
                Recent Audit &amp; Credit Ledger ({forensicsData.recentAuditLogs.length} audit /{" "}
                {forensicsData.recentTransactions.length} tx)
              </span>
              {forensicsData.recentAuditLogs.slice(0, 5).map((log) => (
                <Box key={log.id} fontSize="11px" color="var(--color-text-muted)">
                  [{log.created_at}] <code>{log.action}</code> ({log.resource_type}:{log.resource_id || "-"}) IP:{" "}
                  <code>{log.ip_address || "-"}</code>
                </Box>
              ))}
            </Box>

            <Box display="flex" justifyContent="flex-end" mt={2}>
              <ActionButton $variant="secondary" onClick={() => setForensicsData(null)}>
                Close Dossier
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

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
              <Select
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value as "user" | "moderator" | "auditor" | "admin")}
              >
                <option value="user">user — Standard member</option>
                <option value="moderator">moderator — Trust &amp; Safety / Content &amp; DMCA Moderator</option>
                <option value="auditor">auditor — Read-Only Compliance &amp; Audit Inspector</option>
                <option value="admin">admin — Full Instance Administrator</option>
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

            {!selectedUser.email_verified && !selectedUser.remote_domain && (
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
                <input
                  type="checkbox"
                  checked={markEmailVerified}
                  onChange={(e) => setMarkEmailVerified(e.target.checked)}
                />
                Manually mark email address as verified
              </label>
            )}

            {selectedUser.totp_enabled === 1 && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "#d29922",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={reset2FAFlag} onChange={(e) => setReset2FAFlag(e.target.checked)} />
                Emergency reset 2FA (TOTP) &amp; recovery codes for @{selectedUser.username}
              </label>
            )}

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

      {confirmReset2FAUser && (
        <ModalOverlay onClick={() => setConfirmReset2FAUser(null)}>
          <ModalBox
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Emergency 2FA Reset"
          >
            <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-text-primary)" }}>
              Confirm Emergency 2FA Reset — @{confirmReset2FAUser.username} (#{confirmReset2FAUser.id})
            </span>
            <Box fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.5 }}>
              Are you sure you want to reset two-factor authentication (TOTP) and invalidate all recovery codes for{" "}
              <strong>@{confirmReset2FAUser.username}</strong>? This action is logged in the immutable audit trail.
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setConfirmReset2FAUser(null)} disabled={loading}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="danger"
                onClick={() => void resetUser2FA(confirmReset2FAUser.id)}
                disabled={loading}
              >
                Confirm Reset 2FA
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

      {hasBilling && creditModalUser && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>
              Adjust Compute Credits — @{creditModalUser.username} (Balance: {creditModalUser.credit_balance ?? 0})
            </span>

            <Box display="flex" gap={1} flexWrap="wrap">
              {[100, 500, 1000, -100].map((preset) => (
                <FilterPill
                  key={preset}
                  type="button"
                  $active={Number(creditDelta) === preset}
                  onClick={() => setCreditDelta(String(preset))}
                >
                  {preset > 0 ? `+${preset} Credits` : `${preset} Credits`}
                </FilterPill>
              ))}
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>
                Credit Delta (positive to grant, negative to deduct)
              </label>
              <Input
                type="number"
                value={creditDelta}
                onChange={(e) => setCreditDelta(e.target.value)}
                placeholder="e.g. 250 or -50"
              />
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Ledger &amp; Audit Note</label>
              <Input
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="e.g. Academic research grant / SLA refund"
              />
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setCreditModalUser(null)}>
                Cancel
              </ActionButton>
              <ActionButton $variant="primary" onClick={handleConfirmCredits} disabled={loading}>
                Apply Credit Adjustment
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

      {createModalOpen && (
        <ModalOverlay onClick={() => setCreateModalOpen(false)}>
          <ModalBox
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Create User Account"
          >
            <span style={{ fontWeight: 800, fontSize: "16px" }}>Create User Account</span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Directly provision an account on this instance (bypasses public registration mode restrictions).
            </span>

            <form
              onSubmit={(e) => void handleConfirmCreateUser(e)}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Username</label>
                <Input
                  placeholder="e.g. alice_chen"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                  autoFocus
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Email Address</label>
                <Input
                  type="email"
                  placeholder="e.g. alice@ansatz.social"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Display Name (optional)</label>
                <Input
                  placeholder="e.g. Dr. Alice Chen"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </Box>

              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Initial Password (min. 8 characters)</label>
                <Input
                  type="password"
                  placeholder="Initial password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </Box>

              <Box display="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <Box display="flex" flexDirection="column" gap={1}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>RBAC Role</label>
                  <Select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as "user" | "moderator" | "auditor" | "admin")}
                  >
                    <option value="user">user — Standard Member</option>
                    <option value="moderator">moderator — Moderator</option>
                    <option value="auditor">auditor — Compliance Auditor</option>
                    <option value="admin">admin — Instance Admin</option>
                  </Select>
                </Box>

                {hasBilling && (
                  <Box display="flex" flexDirection="column" gap={1}>
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Initial Compute Credits</label>
                    <Input type="number" min="0" value={newCredits} onChange={(e) => setNewCredits(e.target.value)} />
                  </Box>
                )}
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
                <input
                  type="checkbox"
                  checked={newEmailVerified}
                  onChange={(e) => setNewEmailVerified(e.target.checked)}
                />
                Mark email address as pre-verified (uncheck to send verification email)
              </label>

              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <ActionButton type="button" $variant="secondary" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </ActionButton>
                <ActionButton
                  type="submit"
                  $variant="primary"
                  disabled={loading || !newUsername.trim() || !newEmail.trim() || newPassword.length < 8}
                >
                  Create Account
                </ActionButton>
              </Box>
            </form>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};

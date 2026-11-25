// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon } from "@primer/octicons-react";
import { Button, Heading, Label, Text, TextInput } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import type { SpaceMemberRecord, SpaceRole } from "../../../api";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { ROLE_COLORS, ROLE_TITLES } from "./types";

export interface MembersSettingsSectionProps {
  canAdmin: boolean;
  totalMembers: number;
  filteredMembers: SpaceMemberRecord[];
  memberFilter: string;
  setMemberFilter: (value: string) => void;
  newMemberUsername: string;
  setNewMemberUsername: (value: string) => void;
  newMemberRole: SpaceRole;
  setNewMemberRole: (value: SpaceRole) => void;
  addingMember: boolean;
  onAddMember: (e: React.FormEvent) => Promise<void>;
  onRemoveMember: (userId: number, username: string) => Promise<void>;
  onChangeRole: (username: string, newRole: SpaceRole) => Promise<void>;
}

export const MembersSettingsSection: React.FC<MembersSettingsSectionProps> = ({
  canAdmin,
  totalMembers,
  filteredMembers,
  memberFilter,
  setMemberFilter,
  newMemberUsername,
  setNewMemberUsername,
  newMemberRole,
  setNewMemberRole,
  addingMember,
  onAddMember,
  onRemoveMember,
  onChangeRole,
}) => (
  <Box display="flex" flexDirection="column" gap={4}>
    <Box>
      <Heading
        as="h2"
        style={{
          fontSize: "24px",
          borderBottom: "1px solid var(--color-border-default)",
          paddingBottom: "8px",
          marginBottom: "8px",
        }}
      >
        Space Engineering Members & Roles
      </Heading>
      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
        Manage engineering team members, assign PLM sign-off signers, and maintain role-based access control.
      </Text>

      {/* Add Member Form */}
      {canAdmin && (
        <StyledBox p={3} mb={3}>
          <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
            Add or Update Team Member
          </Text>
          <form onSubmit={(e) => void onAddMember(e)}>
            <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
              <TextInput
                placeholder="Search user by @username..."
                value={newMemberUsername}
                onChange={(e) => setNewMemberUsername(e.target.value)}
                style={{ minWidth: "220px", flex: 1 }}
              />
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value as SpaceRole)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                  fontSize: "13.5px",
                }}
              >
                <option value="lead_engineer">Lead Engineer (Architecture & Merge)</option>
                <option value="approver">PLM Approver (ECO Sign-Off)</option>
                <option value="contributor">Contributor (Models & Living Docs)</option>
                <option value="reviewer">Reviewer (Simulation Audit)</option>
                <option value="viewer">Viewer (Read-Only)</option>
              </select>
              <Button variant="primary" type="submit" disabled={addingMember || !newMemberUsername.trim()}>
                {addingMember ? "Adding..." : "Add / Update Member"}
              </Button>
            </Box>
          </form>
        </StyledBox>
      )}

      {/* Filter Members */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <Text style={{ fontWeight: 700, fontSize: "15px" }}>Active Members</Text>
          <Label variant="accent">{totalMembers}</Label>
        </Box>
        {totalMembers > 3 && (
          <Box width="220px">
            <TextInput
              leadingVisual={SearchIcon}
              placeholder="Filter members..."
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              size="small"
              block
            />
          </Box>
        )}
      </Box>

      {/* Members List */}
      <StyledBox>
        {filteredMembers.length === 0 ? (
          <Box p={4} textAlign="center">
            <Text color="var(--color-fg-muted)">No matching members found.</Text>
          </Box>
        ) : (
          filteredMembers.map((m, idx) => {
            const roleColor = ROLE_COLORS[m.role] || ROLE_COLORS.contributor;
            const isSpaceOwner = m.role === "owner";
            return (
              <Box
                key={m.user_id}
                p={3}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                style={{
                  borderBottom: idx < filteredMembers.length - 1 ? "1px solid var(--color-border-muted)" : undefined,
                }}
              >
                <Box display="flex" alignItems="center" gap={3}>
                  {m.avatar_url ? (
                    <img
                      src={m.avatar_url}
                      alt={m.username}
                      style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: roleColor.bg,
                        color: roleColor.fg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                    >
                      {m.username.slice(0, 2).toUpperCase()}
                    </Box>
                  )}
                  <Box display="flex" flexDirection="column">
                    <Box display="flex" alignItems="center" gap={2}>
                      <Link
                        to={`/@${m.username}`}
                        style={{
                          fontWeight: 700,
                          color: "var(--color-text-primary)",
                          textDecoration: "none",
                          fontSize: "14px",
                        }}
                      >
                        @{m.username}
                      </Link>
                      {m.display_name && (
                        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>({m.display_name})</Text>
                      )}
                    </Box>
                    <Text style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", marginTop: "2px" }}>
                      Joined {new Date(m.created_at).toLocaleDateString()}
                    </Text>
                  </Box>
                </Box>

                <Box display="flex" alignItems="center" gap={3}>
                  {canAdmin && !isSpaceOwner ? (
                    <select
                      value={m.role}
                      onChange={(e) => void onChangeRole(m.username, e.target.value as SpaceRole)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-default)",
                        color: roleColor.fg,
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      <option value="lead_engineer">Lead Engineer</option>
                      <option value="approver">PLM Approver</option>
                      <option value="contributor">Contributor</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "999px",
                        fontSize: "11.5px",
                        fontWeight: 700,
                        background: roleColor.bg,
                        color: roleColor.fg,
                      }}
                    >
                      {ROLE_TITLES[m.role] || m.role}
                    </span>
                  )}

                  {canAdmin && !isSpaceOwner && (
                    <Button size="small" variant="danger" onClick={() => void onRemoveMember(m.user_id, m.username)}>
                      Remove
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })
        )}
      </StyledBox>
    </Box>

    {/* Role Permissions Matrix Reference Card */}
    <Box>
      <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
        Role Permissions & Governance Matrix
      </Heading>
      <StyledBox p={3}>
        <Box display="grid" style={{ gridTemplateColumns: "140px 1fr", gap: "12px", fontSize: "12.5px" }}>
          <Text style={{ fontWeight: 700, color: "#a78bfa" }}>Owner</Text>
          <Text color="var(--color-fg-muted)">
            Full administrative control, transfer container, manage members, delete Space.
          </Text>

          <Text style={{ fontWeight: 700, color: "#22d3ee" }}>Lead Engineer</Text>
          <Text color="var(--color-fg-muted)">
            Approve model architectures, merge pull requests, configure simulation solvers.
          </Text>

          <Text style={{ fontWeight: 700, color: "#fbbf24" }}>PLM Approver</Text>
          <Text color="var(--color-fg-muted)">
            Designated signoff authority for Engineering Change Orders (ECOs) and release gating.
          </Text>

          <Text style={{ fontWeight: 700, color: "#34d399" }}>Contributor</Text>
          <Text color="var(--color-fg-muted)">
            Push model commits, author living architecture docs, participate in Slack-speed channels.
          </Text>

          <Text style={{ fontWeight: 700, color: "#60a5fa" }}>Reviewer</Text>
          <Text color="var(--color-fg-muted)">
            Review 3D CAD/DAE diffs, comment on ECO proposals, verify simulation traces.
          </Text>

          <Text style={{ fontWeight: 700, color: "#94a3b8" }}>Viewer</Text>
          <Text color="var(--color-fg-muted)">
            Read-only observer with access to public/internal models and documentation.
          </Text>
        </Box>
      </StyledBox>
    </Box>
  </Box>
);

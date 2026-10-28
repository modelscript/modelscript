// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  OrganizationIcon,
  PeopleIcon,
  PersonIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import {
  addOrganizationMember,
  createOrganization,
  getMyOrganizations,
  getOrganizationMembers,
  removeOrganizationMember,
  type Organization,
  type OrganizationMember,
  type OrgRole,
} from "../../../api";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { DetailSubtitle, DetailTitle, Header } from "../settingsStyles";

const OrgCard = styled.div`
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%);
  border: 1px solid rgba(6, 182, 212, 0.25);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
`;

const RoleBadge = styled.span<{ $role: OrgRole }>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  background: ${(props) =>
    props.$role === "owner"
      ? "rgba(168, 85, 247, 0.2)"
      : props.$role === "maintainer"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(16, 185, 129, 0.15)"};
  color: ${(props) =>
    props.$role === "owner" ? "#c084fc" : props.$role === "maintainer" ? "#22d3ee" : "var(--ms-success)"};
  border: 1px solid
    ${(props) =>
      props.$role === "owner"
        ? "rgba(168, 85, 247, 0.3)"
        : props.$role === "maintainer"
          ? "rgba(6, 182, 212, 0.3)"
          : "rgba(16, 185, 129, 0.3)"};
`;

const PrimaryButton = styled.button`
  background: var(--gradient-cta, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%));
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const StyledInput = styled.input`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

const StyledSelect = styled.select`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

const MembersTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 10px 12px;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 600;
  }

  td {
    padding: 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
  }

  tr:hover td {
    background-color: var(--color-canvas-subtle);
  }
`;

export interface OrganizationTabProps {
  onBack: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const OrganizationTab: React.FC<OrganizationTabProps> = ({ onBack, onNavigateTab }) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Creation form state
  const [isCreating, setIsCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgDesc, setNewOrgDesc] = useState("");

  // Member invite form state
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("contributor");

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getMyOrganizations()
      .then((orgs) => {
        if (cancelled) return;
        setOrganizations(orgs);
        if (orgs.length > 0) {
          setSelectedOrg((prev) => prev ?? orgs[0] ?? null);
        }
      })
      .catch(() => {
        // Fallback
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedOrg) {
      getOrganizationMembers(selectedOrg.slug)
        .then(setMembers)
        .catch(() => setMembers([]));
    } else {
      setMembers([]);
    }
  }, [selectedOrg]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !newOrgSlug.trim()) {
      setFeedback({ type: "error", text: "Organization name and slug are required." });
      return;
    }
    try {
      const created = await createOrganization({
        name: newOrgName.trim(),
        slug: newOrgSlug.trim().toLowerCase(),
        description: newOrgDesc.trim() || undefined,
      });
      setOrganizations((prev) => [...prev, created]);
      setSelectedOrg(created);
      setIsCreating(false);
      setNewOrgName("");
      setNewOrgSlug("");
      setNewOrgDesc("");
      setFeedback({ type: "success", text: `Successfully created organization '${created.name}'.` });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create organization. Slug may be taken.",
      });
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !inviteUsername.trim()) return;
    try {
      await addOrganizationMember(selectedOrg.slug, inviteUsername.trim(), inviteRole);
      setInviteUsername("");
      const updated = await getOrganizationMembers(selectedOrg.slug);
      setMembers(updated);
      setFeedback({
        type: "success",
        text: `Successfully added ${inviteUsername.trim()} as ${inviteRole}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to add member. Check username and permissions.",
      });
    }
  };

  const handleRemoveMember = async (userId: number, username: string) => {
    if (!selectedOrg) return;
    if (!window.confirm(`Are you sure you want to remove ${username} from ${selectedOrg.name}?`)) return;
    try {
      await removeOrganizationMember(selectedOrg.slug, userId);
      setMembers((prev) => prev.filter((m) => (m.userId || m.user_id) !== userId));
      setFeedback({ type: "success", text: `Removed ${username} from the organization.` });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to remove member.",
      });
    }
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Team &amp; Organizations
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Manage engineering teams, collaborator seat allocations, role permissions, and shared package namespaces.
        </DetailSubtitle>

        {feedback && (
          <Box
            mb={3}
            p={3}
            style={{
              background: feedback.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
              color: feedback.type === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              {feedback.type === "success" ? <CheckCircleIcon size={16} /> : <AlertIcon size={16} />}
              <Text fontSize="14px">{feedback.text}</Text>
            </Box>
            <button
              onClick={() => setFeedback(null)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              Dismiss
            </button>
          </Box>
        )}

        {/* Organization Switcher Bar */}
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={3} mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <OrganizationIcon size={18} style={{ color: "var(--color-accent-cyan, #06b6d4)" }} />
            {organizations.length > 0 ? (
              <StyledSelect
                value={selectedOrg?.slug || ""}
                onChange={(e) => {
                  const org = organizations.find((o) => o.slug === e.target.value);
                  if (org) setSelectedOrg(org);
                }}
                style={{ fontWeight: 600, fontSize: "14px" }}
              >
                {organizations.map((org) => (
                  <option key={org.slug} value={org.slug}>
                    {org.name} (@{org.slug})
                  </option>
                ))}
              </StyledSelect>
            ) : (
              <Text style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>No organizations found</Text>
            )}
          </Box>

          <PrimaryButton onClick={() => setIsCreating((prev) => !prev)}>
            <PlusIcon size={14} />
            <span>{isCreating ? "Cancel" : "New Organization"}</span>
          </PrimaryButton>
        </Box>

        {/* New Organization Form Modal / Collapsible */}
        {isCreating && (
          <OrgCard style={{ borderStyle: "dashed" }}>
            <DetailTitle style={{ fontWeight: 700 }}>Create an Engineering Organization</DetailTitle>
            <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              Organizations unlock shared package namespaces (e.g. <code>@{newOrgSlug || "team"}/model</code>),
              team-wide compute quota pooling, and role-based permissions.
            </Text>
            <form onSubmit={handleCreateOrg} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <Box display="flex" gap={2} flexWrap="wrap">
                <Box flex={1} minWidth={200}>
                  <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                    Organization Name
                  </label>
                  <StyledInput
                    style={{ width: "100%" }}
                    placeholder="e.g. Acme Propulsion Systems"
                    value={newOrgName}
                    onChange={(e) => {
                      setNewOrgName(e.target.value);
                      if (!newOrgSlug) {
                        setNewOrgSlug(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, "-")
                            .replace(/-+/g, "-")
                            .slice(0, 30),
                        );
                      }
                    }}
                    required
                  />
                </Box>
                <Box flex={1} minWidth={200}>
                  <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                    Namespace Slug (@slug)
                  </label>
                  <StyledInput
                    style={{ width: "100%" }}
                    placeholder="e.g. acme-propulsion"
                    value={newOrgSlug}
                    onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase())}
                    required
                  />
                </Box>
              </Box>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Description (Optional)
                </label>
                <StyledInput
                  style={{ width: "100%" }}
                  placeholder="e.g. Propulsion modeling and battery pack simulation team"
                  value={newOrgDesc}
                  onChange={(e) => setNewOrgDesc(e.target.value)}
                />
              </div>

              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <SecondaryButton type="button" onClick={() => setIsCreating(false)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit">Create Organization</PrimaryButton>
              </Box>
            </form>
          </OrgCard>
        )}

        {/* Selected Org Management Content */}
        {selectedOrg ? (
          <>
            {/* Org HUD Card */}
            <OrgCard>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
                <Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Text style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-primary)" }}>
                      {selectedOrg.name}
                    </Text>
                    <RoleBadge $role={(selectedOrg.role as OrgRole) || "owner"}>
                      <ShieldCheckIcon size={12} />
                      {selectedOrg.role || "Owner"}
                    </RoleBadge>
                  </Box>
                  <Text
                    style={{
                      fontSize: "13px",
                      color: "var(--color-accent-cyan, #06b6d4)",
                      fontFamily: "var(--font-mono)",
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    Namespace: @{selectedOrg.slug}
                  </Text>
                  {selectedOrg.description && (
                    <Text
                      style={{ fontSize: "13px", color: "var(--color-text-muted)", marginTop: "4px", display: "block" }}
                    >
                      {selectedOrg.description}
                    </Text>
                  )}
                </Box>

                <Box display="flex" flexDirection="column" alignItems="flex-end" gap={1}>
                  <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Seat Allocation</Text>
                  <Text style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {members.length} {members.length === 1 ? "Active Seat" : "Active Seats"}
                  </Text>
                  <SecondaryButton
                    style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }}
                    onClick={() => onNavigateTab?.("billing")}
                  >
                    Manage Compute Quotas
                  </SecondaryButton>
                </Box>
              </Box>
            </OrgCard>

            {/* Invite Form */}
            <Box mb={4}>
              <DetailTitle style={{ fontWeight: 700, display: "block", marginBottom: "12px" }}>
                Add Team Member
              </DetailTitle>
              <form onSubmit={handleInviteMember}>
                <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
                  <StyledInput
                    placeholder="Enter teammate username"
                    value={inviteUsername}
                    onChange={(e) => setInviteUsername(e.target.value)}
                    style={{ minWidth: 220, flex: 1 }}
                    required
                  />
                  <StyledSelect
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                    style={{ minWidth: 140 }}
                  >
                    <option value="contributor">Contributor (Modeling)</option>
                    <option value="maintainer">Maintainer (Publishing)</option>
                    <option value="owner">Owner (Full Admin)</option>
                  </StyledSelect>
                  <PrimaryButton type="submit">
                    <PlusIcon size={14} />
                    <span>Add Member</span>
                  </PrimaryButton>
                </Box>
              </form>
            </Box>

            {/* Members Table */}
            <Box mb={4}>
              <DetailTitle style={{ fontWeight: 700, display: "block", marginBottom: "12px" }}>
                Team Members ({members.length})
              </DetailTitle>
              <Box
                style={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  backgroundColor: "var(--color-canvas-default)",
                }}
              >
                <MembersTable>
                  <thead>
                    <tr>
                      <th>Teammate</th>
                      <th>Role</th>
                      <th>Joined</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}
                        >
                          No team members found.
                        </td>
                      </tr>
                    ) : (
                      members.map((member) => {
                        const mId = member.userId || member.user_id;
                        return (
                          <tr key={mId}>
                            <td>
                              <Box display="flex" alignItems="center" gap={2}>
                                <PersonIcon size={16} style={{ color: "var(--color-text-muted)" }} />
                                <div>
                                  <div style={{ fontWeight: 600 }}>{member.username}</div>
                                  {member.email && (
                                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                                      {member.email}
                                    </div>
                                  )}
                                </div>
                              </Box>
                            </td>
                            <td>
                              <RoleBadge $role={member.role}>{member.role}</RoleBadge>
                            </td>
                            <td style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                              {member.created_at ? new Date(member.created_at).toLocaleDateString() : "Active"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {member.role !== "owner" && (
                                <button
                                  onClick={() => handleRemoveMember(mId, member.username)}
                                  title="Remove member"
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--color-danger-fg, #f87171)",
                                    cursor: "pointer",
                                    padding: "4px",
                                    borderRadius: "4px",
                                  }}
                                >
                                  <TrashIcon size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </MembersTable>
              </Box>
            </Box>
          </>
        ) : (
          !isLoading && (
            <OrgCard style={{ textAlign: "center", padding: "40px 24px", alignItems: "center" }}>
              <PeopleIcon size={36} style={{ color: "var(--color-accent-purple, #a855f7)", marginBottom: 8 }} />
              <DetailTitle style={{ fontWeight: 700 }}>Collaborate as an Engineering Team</DetailTitle>
              <Text style={{ fontSize: "14px", color: "var(--color-text-muted)", maxWidth: 480, lineHeight: 1.5 }}>
                Organizations let you invite teammates, allocate seats, share proprietary models in scoped namespaces (
                <code>@org/model</code>), and pool high-performance compute resources.
              </Text>
              <PrimaryButton onClick={() => setIsCreating(true)} style={{ marginTop: 16 }}>
                <PlusIcon size={14} />
                <span>Create Your First Organization</span>
              </PrimaryButton>
            </OrgCard>
          )
        )}
      </Box>
    </>
  );
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  OrganizationIcon,
  PencilIcon,
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
  updateOrganization,
  updateOrgMemberRole,
  type Organization,
  type OrganizationMember,
  type OrgRole,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import Spinner from "../../../components/Spinner";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { getApiErrorMessage } from "../../../util/error";
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
      : props.$role === "admin" || props.$role === "maintainer"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(16, 185, 129, 0.15)"};
  color: ${(props) =>
    props.$role === "owner"
      ? "#c084fc"
      : props.$role === "admin" || props.$role === "maintainer"
        ? "#22d3ee"
        : "var(--ms-success)"};
  border: 1px solid
    ${(props) =>
      props.$role === "owner"
        ? "rgba(168, 85, 247, 0.3)"
        : props.$role === "admin" || props.$role === "maintainer"
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
  setActiveTab?: (tab: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  maintainer: "Maintainer",
  contributor: "Contributor",
  member: "Member",
};

function formatRoleLabel(role?: string | null): string {
  if (!role) return "Member";
  return ROLE_LABELS[role.toLowerCase()] || role;
}

export const OrganizationTab: React.FC<OrganizationTabProps> = ({
  onBack,
  onNavigateTab,
  setActiveTab: setActiveTabProp,
}) => {
  const { user } = useAuth();
  const setActiveTab = setActiveTabProp ?? onNavigateTab;
  const hasBilling = useFeatureFlag(["billing", "billing_stripe_live"]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Creation form state
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newOrgDesc, setNewOrgDesc] = useState("");

  // Member invite form state
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("contributor");
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Edit organization profile form state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editBillingEmail, setEditBillingEmail] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<number | null>(null);
  const [confirmOwnerPromotion, setConfirmOwnerPromotion] = useState<{ userId: number; username: string } | null>(null);
  const [updatingMemberUserId, setUpdatingMemberUserId] = useState<number | null>(null);
  const [removingMemberUserId, setRemovingMemberUserId] = useState<number | null>(null);

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
      .catch((err: unknown) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            text: getApiErrorMessage(err, "Failed to load organizations."),
          });
        }
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
      setEditDisplayName(selectedOrg.display_name || selectedOrg.name || "");
      setEditDescription(selectedOrg.description || "");
      setEditWebsite(selectedOrg.website || "");
      setEditBillingEmail(selectedOrg.billing_email || "");
    }
  }, [selectedOrg]);

  const selectedOrgSlug = selectedOrg?.slug;
  useEffect(() => {
    if (!selectedOrgSlug) {
      setMembers([]);
      setConfirmRemoveUserId(null);
      setConfirmOwnerPromotion(null);
      return;
    }
    let cancelled = false;
    setConfirmRemoveUserId(null);
    setConfirmOwnerPromotion(null);
    getOrganizationMembers(selectedOrgSlug)
      .then((data) => {
        if (!cancelled) {
          setMembers(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMembers([]);
          setFeedback({
            type: "error",
            text: getApiErrorMessage(err, "Failed to load organization members."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOrgSlug]);

  const canManageOrg =
    selectedOrg?.role === "owner" || selectedOrg?.role === "maintainer" || (selectedOrg?.role as string) === "admin";
  const isOrgOwner = selectedOrg?.role === "owner";
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const handleUpdateOrgProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || isSavingProfile) return;
    if (!editDisplayName.trim()) {
      setFeedback({ type: "error", text: "Organization display name is required." });
      return;
    }
    setIsSavingProfile(true);
    try {
      const updated = await updateOrganization(selectedOrg.slug, {
        display_name: editDisplayName.trim(),
        name: editDisplayName.trim(),
        description: editDescription.trim() || null,
        website: editWebsite.trim() || null,
        billing_email: editBillingEmail.trim() || null,
      });
      const merged: Organization = {
        ...selectedOrg,
        ...updated,
        role: updated?.role || selectedOrg.role,
        name: updated?.name || updated?.display_name || editDisplayName.trim(),
        display_name: updated?.display_name || editDisplayName.trim(),
        description: updated?.description !== undefined ? updated.description : editDescription.trim() || null,
        website: updated?.website !== undefined ? updated.website : editWebsite.trim() || null,
        billing_email: updated?.billing_email !== undefined ? updated.billing_email : editBillingEmail.trim() || null,
      };
      setSelectedOrg(merged);
      setOrganizations((prev) => prev.map((o) => (o.slug === selectedOrg.slug ? merged : o)));
      setIsEditingProfile(false);
      setFeedback({ type: "success", text: `Updated profile for '${merged.name}'.` });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(err, "Failed to update organization profile."),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdateMemberRole = async (userId: number, username: string, newRole: OrgRole) => {
    if (!selectedOrg || updatingMemberUserId === userId) return;
    const orgSlug = selectedOrg.slug;
    setUpdatingMemberUserId(userId);
    try {
      await updateOrgMemberRole(orgSlug, username, newRole);
      setMembers((prev) => prev.map((m) => (m.username === username ? { ...m, role: newRole } : m)));
      if (user?.id === userId) {
        setSelectedOrg((prev) => (prev && prev.slug === orgSlug ? { ...prev, role: newRole } : prev));
        setOrganizations((prev) => prev.map((o) => (o.slug === orgSlug ? { ...o, role: newRole } : o)));
        if (newRole !== "owner" && newRole !== "maintainer" && (newRole as string) !== "admin") {
          setIsEditingProfile(false);
        }
      }
      setConfirmOwnerPromotion((prev) => (prev?.userId === userId ? null : prev));
      setFeedback({
        type: "success",
        text: `Updated ${username}'s role to ${formatRoleLabel(newRole)}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(err, "Failed to update member role."),
      });
    } finally {
      setUpdatingMemberUserId(null);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingOrg) return;
    if (!newOrgName.trim() || !newOrgSlug.trim()) {
      setFeedback({ type: "error", text: "Organization name and slug are required." });
      return;
    }
    setIsCreatingOrg(true);
    try {
      const created = await createOrganization({
        name: newOrgName.trim(),
        slug: newOrgSlug.trim().toLowerCase(),
        description: newOrgDesc.trim() || undefined,
      });
      const createdWithRole: Organization = {
        ...created,
        role: created.role || "owner",
      };
      setOrganizations((prev) => [...prev, createdWithRole]);
      setSelectedOrg(createdWithRole);
      setIsCreating(false);
      setNewOrgName("");
      setNewOrgSlug("");
      setSlugManuallyEdited(false);
      setNewOrgDesc("");
      setFeedback({ type: "success", text: `Successfully created organization '${createdWithRole.name}'.` });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(err, "Failed to create organization. Slug may be taken."),
      });
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = inviteUsername.trim();
    if (!selectedOrg || !trimmedUsername || isAddingMember) return;
    setIsAddingMember(true);
    try {
      await addOrganizationMember(selectedOrg.slug, trimmedUsername, inviteRole);
      setInviteUsername("");
      const updated = await getOrganizationMembers(selectedOrg.slug);
      setMembers(updated);
      setFeedback({
        type: "success",
        text: `Successfully added ${trimmedUsername} as ${formatRoleLabel(inviteRole)}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(err, "Failed to add member. Check username and permissions."),
      });
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number, username: string) => {
    if (!selectedOrg || removingMemberUserId === userId) return;
    const orgSlug = selectedOrg.slug;
    setRemovingMemberUserId(userId);
    try {
      await removeOrganizationMember(orgSlug, userId);
      if (user?.id === userId) {
        const remaining = organizations.filter((o) => o.slug !== orgSlug);
        setOrganizations(remaining);
        setSelectedOrg(remaining[0] ?? null);
        setMembers([]);
        setIsEditingProfile(false);
      } else {
        setMembers((prev) => prev.filter((m) => (m.userId || m.user_id) !== userId));
      }
      setFeedback({ type: "success", text: `Removed ${username} from the organization.` });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: getApiErrorMessage(err, "Failed to remove member."),
      });
    } finally {
      setRemovingMemberUserId(null);
      setConfirmRemoveUserId(null);
    }
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} aria-label="Go back" style={{ marginRight: "8px" }}>
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
            role={feedback.type === "error" ? "alert" : "status"}
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
              type="button"
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
                aria-label="Select organization"
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

          <PrimaryButton type="button" onClick={() => setIsCreating((prev) => !prev)}>
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
                    aria-label="Organization name"
                    style={{ width: "100%" }}
                    placeholder="e.g. Acme Propulsion Systems"
                    value={newOrgName}
                    disabled={isCreatingOrg}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewOrgName(val);
                      if (!slugManuallyEdited) {
                        setNewOrgSlug(
                          val
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, "-")
                            .replace(/-+/g, "-")
                            .replace(/^-|-$/g, "")
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
                    aria-label="Namespace slug"
                    style={{ width: "100%" }}
                    placeholder="e.g. acme-propulsion"
                    value={newOrgSlug}
                    disabled={isCreatingOrg}
                    onChange={(e) => {
                      const val = e.target.value.toLowerCase();
                      setNewOrgSlug(val);
                      setSlugManuallyEdited(val.length > 0);
                    }}
                    required
                  />
                </Box>
              </Box>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Description (Optional)
                </label>
                <StyledInput
                  aria-label="Organization description"
                  style={{ width: "100%" }}
                  placeholder="e.g. Propulsion modeling and battery pack simulation team"
                  value={newOrgDesc}
                  disabled={isCreatingOrg}
                  onChange={(e) => setNewOrgDesc(e.target.value)}
                />
              </div>

              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <SecondaryButton type="button" disabled={isCreatingOrg} onClick={() => setIsCreating(false)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit" disabled={isCreatingOrg}>
                  {isCreatingOrg ? "Creating…" : "Create Organization"}
                </PrimaryButton>
              </Box>
            </form>
          </OrgCard>
        )}

        {isLoading && !selectedOrg && (
          <Box display="flex" justifyContent="center" alignItems="center" py={6}>
            <Spinner size="medium" />
          </Box>
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
                      {selectedOrg.display_name || selectedOrg.name}
                    </Text>
                    <RoleBadge $role={(selectedOrg.role as OrgRole) || "member"}>
                      <ShieldCheckIcon size={12} />
                      {formatRoleLabel(selectedOrg.role || "member")}
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
                  {(selectedOrg.website || selectedOrg.billing_email) && (
                    <Box display="flex" gap={3} flexWrap="wrap" mt={1}>
                      {selectedOrg.website && (
                        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                          Website: {selectedOrg.website}
                        </Text>
                      )}
                      {selectedOrg.billing_email && (
                        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                          Billing: {selectedOrg.billing_email}
                        </Text>
                      )}
                    </Box>
                  )}
                </Box>

                <Box display="flex" flexDirection="column" alignItems="flex-end" gap={1}>
                  <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Seat Allocation</Text>
                  <Text style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {members.length} {members.length === 1 ? "Active Seat" : "Active Seats"}
                  </Text>
                  <Box display="flex" gap={2} flexWrap="wrap" mt={1}>
                    {canManageOrg && (
                      <SecondaryButton
                        type="button"
                        style={{ fontSize: "12px", padding: "4px 10px" }}
                        onClick={() => setIsEditingProfile((prev) => !prev)}
                      >
                        <PencilIcon size={12} />
                        <span>{isEditingProfile ? "Cancel Edit" : "Edit Organization Profile"}</span>
                      </SecondaryButton>
                    )}
                    {hasBilling && (
                      <SecondaryButton
                        type="button"
                        style={{ fontSize: "12px", padding: "4px 10px" }}
                        onClick={() => {
                          try {
                            sessionStorage.setItem("ms_billing_org_id", String(selectedOrg.id));
                          } catch {
                            // Ignore storage quota or private-mode restrictions
                          }
                          setActiveTab?.("billing");
                        }}
                      >
                        Manage Org Billing &amp; Credits
                      </SecondaryButton>
                    )}
                  </Box>
                </Box>
              </Box>

              {isEditingProfile && canManageOrg && (
                <form
                  onSubmit={handleUpdateOrgProfile}
                  style={{
                    borderTop: "1px solid var(--color-border-default)",
                    paddingTop: "16px",
                    marginTop: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <DetailTitle style={{ fontWeight: 700, fontSize: "14px" }}>Edit Organization Profile</DetailTitle>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <Box flex={1} minWidth={200}>
                      <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Display Name
                      </label>
                      <StyledInput
                        aria-label="Display name"
                        style={{ width: "100%" }}
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder="Organization display name"
                        required
                      />
                    </Box>
                    <Box flex={1} minWidth={200}>
                      <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Website URL
                      </label>
                      <StyledInput
                        aria-label="Website URL"
                        type="url"
                        style={{ width: "100%" }}
                        value={editWebsite}
                        onChange={(e) => setEditWebsite(e.target.value)}
                        placeholder="https://example.org"
                      />
                    </Box>
                  </Box>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <Box flex={1} minWidth={200}>
                      <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Description
                      </label>
                      <StyledInput
                        aria-label="Edit organization description"
                        style={{ width: "100%" }}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Organization description"
                      />
                    </Box>
                    <Box flex={1} minWidth={200}>
                      <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Billing Email
                      </label>
                      <StyledInput
                        aria-label="Billing email"
                        style={{ width: "100%" }}
                        type="email"
                        value={editBillingEmail}
                        onChange={(e) => setEditBillingEmail(e.target.value)}
                        placeholder="billing@example.org"
                      />
                    </Box>
                  </Box>
                  <Box display="flex" justifyContent="flex-end" gap={2}>
                    <SecondaryButton
                      type="button"
                      disabled={isSavingProfile}
                      onClick={() => setIsEditingProfile(false)}
                    >
                      Cancel
                    </SecondaryButton>
                    <PrimaryButton type="submit" disabled={isSavingProfile}>
                      {isSavingProfile ? "Saving…" : "Save Organization Profile"}
                    </PrimaryButton>
                  </Box>
                </form>
              )}
            </OrgCard>

            {/* Invite Form */}
            {canManageOrg && (
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: 700, display: "block", marginBottom: "12px" }}>
                  Add Team Member
                </DetailTitle>
                <form onSubmit={handleAddMember}>
                  <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
                    <StyledInput
                      aria-label="Teammate username"
                      placeholder="Enter teammate username"
                      value={inviteUsername}
                      disabled={isAddingMember}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      style={{ minWidth: 220, flex: 1 }}
                      required
                    />
                    <StyledSelect
                      aria-label="Member role"
                      value={inviteRole}
                      disabled={isAddingMember}
                      onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                      style={{ minWidth: 140 }}
                    >
                      <option value="contributor">Contributor</option>
                      <option value="maintainer">Maintainer</option>
                      <option value="owner" disabled={!isOrgOwner}>
                        Owner
                      </option>
                    </StyledSelect>
                    <PrimaryButton type="submit" disabled={isAddingMember}>
                      <PlusIcon size={14} />
                      <span>{isAddingMember ? "Adding…" : "Add Member"}</span>
                    </PrimaryButton>
                  </Box>
                </form>
              </Box>
            )}

            {/* Members Table */}
            <Box mb={4}>
              <DetailTitle style={{ fontWeight: 700, display: "block", marginBottom: "12px" }}>
                Team Members ({members.length})
              </DetailTitle>
              <Box
                style={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "8px",
                  overflowX: "auto",
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
                        const isLastOwner = member.role === "owner" && ownerCount <= 1;
                        const isUpdatingMember = updatingMemberUserId === mId;
                        const isRemovingMember = removingMemberUserId === mId;
                        const isConfirmingOwner = confirmOwnerPromotion?.userId === mId;
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
                              {canManageOrg ? (
                                <Box display="flex" flexDirection="column" gap={1}>
                                  <Box display="inline-flex" alignItems="center" gap={2}>
                                    <RoleBadge $role={member.role}>{formatRoleLabel(member.role)}</RoleBadge>
                                    <StyledSelect
                                      aria-label={`Change role for ${member.username}`}
                                      value={member.role}
                                      disabled={
                                        isLastOwner ||
                                        (!isOrgOwner && member.role === "owner") ||
                                        isUpdatingMember ||
                                        isRemovingMember
                                      }
                                      onChange={(e) => {
                                        const nextRole = e.target.value as OrgRole;
                                        if (nextRole === "owner" && member.role !== "owner") {
                                          setConfirmOwnerPromotion({ userId: mId, username: member.username });
                                          return;
                                        }
                                        if (isConfirmingOwner) {
                                          setConfirmOwnerPromotion(null);
                                        }
                                        void handleUpdateMemberRole(mId, member.username, nextRole);
                                      }}
                                      style={{ padding: "4px 8px", fontSize: "12px" }}
                                    >
                                      <option value="owner" disabled={!isOrgOwner}>
                                        Owner
                                      </option>
                                      <option value="maintainer">Maintainer</option>
                                      <option value="contributor">Contributor</option>
                                    </StyledSelect>
                                  </Box>
                                  {isConfirmingOwner && (
                                    <Box
                                      display="flex"
                                      alignItems="center"
                                      flexWrap="wrap"
                                      gap={2}
                                      mt={1}
                                      style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
                                    >
                                      <span>Grant full owner &amp; billing control to {member.username}?</span>
                                      <SecondaryButton
                                        type="button"
                                        disabled={isUpdatingMember}
                                        style={{ padding: "3px 8px", fontSize: "11px" }}
                                        onClick={() => setConfirmOwnerPromotion(null)}
                                      >
                                        Cancel
                                      </SecondaryButton>
                                      <PrimaryButton
                                        type="button"
                                        disabled={isUpdatingMember}
                                        style={{ padding: "3px 8px", fontSize: "11px" }}
                                        onClick={() => void handleUpdateMemberRole(mId, member.username, "owner")}
                                      >
                                        {isUpdatingMember ? "Promoting…" : "Confirm Owner"}
                                      </PrimaryButton>
                                    </Box>
                                  )}
                                </Box>
                              ) : (
                                <RoleBadge $role={member.role}>{formatRoleLabel(member.role)}</RoleBadge>
                              )}
                            </td>
                            <td style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                              {member.created_at ? new Date(member.created_at).toLocaleDateString() : "Active"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {isOrgOwner &&
                                (confirmRemoveUserId === mId ? (
                                  <Box display="inline-flex" alignItems="center" gap={2}>
                                    <SecondaryButton
                                      type="button"
                                      disabled={isRemovingMember}
                                      style={{ padding: "4px 10px", fontSize: "12px" }}
                                      onClick={() => setConfirmRemoveUserId(null)}
                                    >
                                      Cancel
                                    </SecondaryButton>
                                    <button
                                      type="button"
                                      disabled={isRemovingMember}
                                      onClick={() => void handleRemoveMember(mId, member.username)}
                                      style={{
                                        background: "var(--color-danger-fg, #cf222e)",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "4px 10px",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        cursor: isRemovingMember ? "not-allowed" : "pointer",
                                        opacity: isRemovingMember ? 0.6 : 1,
                                      }}
                                    >
                                      {isRemovingMember ? "Removing…" : "Confirm Remove?"}
                                    </button>
                                  </Box>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${member.username}`}
                                    disabled={isLastOwner || removingMemberUserId !== null}
                                    onClick={() => setConfirmRemoveUserId(mId)}
                                    title={isLastOwner ? "Cannot remove the last remaining owner" : "Remove member"}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "var(--color-danger-fg, #f87171)",
                                      cursor: isLastOwner || removingMemberUserId !== null ? "not-allowed" : "pointer",
                                      opacity: isLastOwner || removingMemberUserId !== null ? 0.4 : 1,
                                      padding: "4px",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    <TrashIcon size={14} />
                                  </button>
                                ))}
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

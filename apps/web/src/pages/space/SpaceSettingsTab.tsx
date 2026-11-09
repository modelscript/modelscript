// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  GearIcon,
  GitBranchIcon,
  LawIcon,
  PeopleIcon,
  SearchIcon,
  SlidersIcon,
} from "@primer/octicons-react";
import { ActionList, Button, Dialog, Flash, Heading, Label, Text, TextInput, Textarea } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import {
  addSpaceMember,
  deleteSpace,
  getSpaceDomainPresets,
  removeSpaceMember,
  transferSpace,
  updateSpace,
  type Organization,
  type SpaceDetailResponse,
  type SpaceDomainPreset,
  type SpaceMemberRecord,
  type SpaceOwnerType,
  type SpaceRecord,
  type SpaceRole,
  type SpaceVisibility,
} from "../../api";
import { useAuth } from "../../AuthContext";
import Box from "../../components/Box";
import { useToast } from "../../components/ToastContext";
import { StyledBox } from "../workspace/styles";

export interface SpaceSettingsTabProps {
  detail: SpaceDetailResponse;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: SpaceRole | null;
  };
  myOrgs: Organization[];
  onSpaceUpdated?: ((updated: SpaceRecord) => void) | undefined;
  onMembersUpdated?: ((members: SpaceMemberRecord[]) => void) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
}

type SettingsSection = "general" | "access" | "git" | "plm" | "features" | "danger";

const SettingsLayout = styled.div`
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 32px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const SidebarCard = styled.div`
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-canvas-default, #0d1117);
  position: sticky;
  top: 24px;
`;

const FormRow = styled(Box)`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FieldLabel = styled(Text)`
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
  display: block;
`;

const FieldDescription = styled(Text)`
  font-size: 12.5px;
  color: var(--color-fg-muted);
  line-height: 1.4;
  margin-top: -4px;
  display: block;
`;

const DangerCard = styled(StyledBox)`
  border-color: var(--color-danger-muted, rgba(248, 81, 73, 0.4));
  background: rgba(248, 81, 73, 0.03);
`;

const DangerRow = styled(Box)`
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--color-danger-muted, rgba(248, 81, 73, 0.2));

  &:last-child {
    border-bottom: none;
  }

  @media (max-width: 700px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const ROLE_COLORS: Record<SpaceRole, { bg: string; fg: string }> = {
  owner: { bg: "rgba(139, 92, 246, 0.16)", fg: "#a78bfa" },
  lead_engineer: { bg: "rgba(6, 182, 212, 0.16)", fg: "#22d3ee" },
  approver: { bg: "rgba(245, 158, 11, 0.16)", fg: "#fbbf24" },
  contributor: { bg: "rgba(16, 185, 129, 0.16)", fg: "#34d399" },
  reviewer: { bg: "rgba(59, 130, 246, 0.16)", fg: "#60a5fa" },
  viewer: { bg: "rgba(148, 163, 184, 0.16)", fg: "#94a3b8" },
};

const ROLE_TITLES: Record<SpaceRole, string> = {
  owner: "Owner",
  lead_engineer: "Lead Engineer",
  approver: "PLM Approver",
  contributor: "Contributor",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export const SpaceSettingsTab: React.FC<SpaceSettingsTabProps> = ({
  detail,
  viewerState,
  myOrgs,
  onSpaceUpdated,
  onMembersUpdated,
  onRefresh,
}) => {
  const { space, preset, members } = detail;
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // General Settings State
  const [name, setName] = useState(space.name || "");
  const [tagline, setTagline] = useState(space.tagline || "");
  const [description, setDescription] = useState(space.description || "");
  const [domainPreset, setDomainPreset] = useState(space.domain_preset || preset.id);
  const [avatarUrl, setAvatarUrl] = useState(space.avatar_url || "");
  const [bannerUrl, setBannerUrl] = useState(space.banner_url || "");
  const [availablePresets, setAvailablePresets] = useState<SpaceDomainPreset[]>([preset]);

  // Access & Members State
  const [memberFilter, setMemberFilter] = useState("");
  const [newMemberUsername, setNewMemberUsername] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<SpaceRole>("contributor");
  const [addingMember, setAddingMember] = useState(false);

  // Git Vault & PDM State
  const [defaultBranch, setDefaultBranch] = useState(space.default_branch || "main");
  const [requireEcoSignoff, setRequireEcoSignoff] = useState(true);
  const [requireSimCheck, setRequireSimCheck] = useState(true);
  const [requireSignedCommits, setRequireSignedCommits] = useState(true);
  const [cadDiffing, setCadDiffing] = useState(true);
  const [daeDiffing, setDaeDiffing] = useState(true);
  const [autoIndexOnPush, setAutoIndexOnPush] = useState(true);
  const [copiedCloneUrl, setCopiedCloneUrl] = useState(false);

  // PLM & Governance State
  const [minApprovers, setMinApprovers] = useState<"1" | "2" | "consensus">("1");
  const [requireEd25519, setRequireEd25519] = useState(true);
  const [enforceSimulationTolerance, setEnforceSimulationTolerance] = useState(true);
  const [emergencyBypassAllowed, setEmergencyBypassAllowed] = useState(false);
  const [immutableGitNotesAudit, setImmutableGitNotesAudit] = useState(true);

  // Modules & Features State
  const enabledTabsList =
    Array.isArray(space.enabled_tabs) && space.enabled_tabs.length > 0
      ? space.enabled_tabs
      : ["overview", "chat", "docs", "plm", "repos"];
  const [enableChat, setEnableChat] = useState(enabledTabsList.includes("chat"));
  const [enableDocs, setEnableDocs] = useState(enabledTabsList.includes("docs"));
  const [enablePlm, setEnablePlm] = useState(enabledTabsList.includes("plm"));
  const [enableRepos, setEnableRepos] = useState(enabledTabsList.includes("repos"));
  const [landingTab, setLandingTab] = useState<string>("overview");

  // Danger Zone Modals State
  const [visibility, setVisibility] = useState<SpaceVisibility>(space.visibility || "public");
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [selectedNewVisibility, setSelectedNewVisibility] = useState<SpaceVisibility>(space.visibility || "public");
  const [transferTargetType, setTransferTargetType] = useState<SpaceOwnerType>("organization");
  const [transferTargetSlug, setTransferTargetSlug] = useState(myOrgs[0]?.slug || (user ? user.username : ""));
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState("");

  const gitCloneUrl = `${
    typeof window !== "undefined" ? window.location.origin : "https://ansatz.social"
  }/git/${space.owner_namespace}/${space.slug}.git`;

  // Fetch all domain presets for selection
  useEffect(() => {
    void getSpaceDomainPresets()
      .then((presets) => {
        if (presets && presets.length > 0) {
          setAvailablePresets(presets);
        }
      })
      .catch(() => {});
  }, []);

  // Sync state if space prop changes
  useEffect(() => {
    setName(space.name || "");
    setTagline(space.tagline || "");
    setDescription(space.description || "");
    setDomainPreset(space.domain_preset || preset.id);
    setAvatarUrl(space.avatar_url || "");
    setBannerUrl(space.banner_url || "");
    setDefaultBranch(space.default_branch || "main");
    setVisibility(space.visibility || "public");
    setSelectedNewVisibility(space.visibility || "public");
  }, [space, preset]);

  const showSuccess = (msg: string) => {
    setSaveError(null);
    setSavedMessage(msg);
    toast.success(msg);
    setTimeout(() => setSavedMessage(null), 4000);
  };

  const showError = (msg: string) => {
    setSavedMessage(null);
    setSaveError(msg);
    toast.error(msg);
  };

  const handleSaveSpacePatch = async (patch: Parameters<typeof updateSpace>[2], successMessage: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSpace(space.owner_namespace, space.slug, patch);
      onSpaceUpdated?.(updated);
      showSuccess(successMessage);
      if (onRefresh) {
        void onRefresh();
      }
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to update Space settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCloneUrl = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(`git clone ${gitCloneUrl}`);
      setCopiedCloneUrl(true);
      toast.success("Git clone command copied to clipboard!");
      setTimeout(() => setCopiedCloneUrl(false), 2500);
    }
  };

  // Add or update member role
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const usernameTrimmed = newMemberUsername.trim().replace(/^@/, "");
    if (!usernameTrimmed) return;
    setAddingMember(true);
    try {
      const updated = await addSpaceMember(space.owner_namespace, space.slug, usernameTrimmed, newMemberRole);
      onMembersUpdated?.(updated);
      setNewMemberUsername("");
      showSuccess(`Added @${usernameTrimmed} as ${ROLE_TITLES[newMemberRole]}.`);
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to add member.");
    } finally {
      setAddingMember(false);
    }
  };

  // Remove member
  const handleRemoveMember = async (userId: number, username: string) => {
    if (!window.confirm(`Are you sure you want to remove @${username} from this Space?`)) {
      return;
    }
    try {
      const updated = await removeSpaceMember(space.owner_namespace, space.slug, userId);
      onMembersUpdated?.(updated);
      showSuccess(`Removed @${username} from Space members.`);
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to remove member.");
    }
  };

  // Quick role change
  const handleChangeRole = async (username: string, newRole: SpaceRole) => {
    try {
      const updated = await addSpaceMember(space.owner_namespace, space.slug, username, newRole);
      onMembersUpdated?.(updated);
      showSuccess(`Updated @${username}'s role to ${ROLE_TITLES[newRole]}.`);
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to update member role.");
    }
  };

  // Save Modules & Tabs
  const handleSaveModules = async () => {
    const tabs = ["overview"];
    if (enableChat) tabs.push("chat");
    if (enableDocs) tabs.push("docs");
    if (enablePlm) tabs.push("plm");
    if (enableRepos) tabs.push("repos");
    await handleSaveSpacePatch({ enabledTabs: tabs }, "Space modules and navigation updated.");
  };

  // Change Visibility
  const handleConfirmVisibilityChange = async () => {
    try {
      await handleSaveSpacePatch(
        { visibility: selectedNewVisibility },
        `Space visibility changed to ${selectedNewVisibility}.`,
      );
      setVisibility(selectedNewVisibility);
      setShowVisibilityModal(false);
    } catch {
      // Handled in handleSaveSpacePatch
    }
  };

  // Transfer Ownership
  const handleConfirmTransfer = async () => {
    const target = transferTargetSlug.trim().replace(/^@/, "");
    if (!target) return;
    try {
      const updated = await transferSpace(space.owner_namespace, space.slug, {
        targetOwnerType: transferTargetType,
        targetSlug: target,
      });
      setShowTransferModal(false);
      toast.success(`Space successfully transferred to @${updated.owner_namespace}. Redirecting...`);
      setTimeout(() => {
        navigate(`/@${updated.owner_namespace}/${updated.slug}?tab=settings`);
      }, 1000);
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to transfer Space container.");
    }
  };

  // Delete Space
  const handleConfirmDelete = async () => {
    if (deleteConfirmSlug.trim().toLowerCase() !== space.slug.toLowerCase()) {
      showError("Please type the exact Space slug to confirm deletion.");
      return;
    }
    try {
      await deleteSpace(space.owner_namespace, space.slug);
      setShowDeleteModal(false);
      toast.success(`Space '${space.name}' has been permanently deleted.`);
      navigate(`/@${space.owner_namespace}`);
    } catch (err: any) {
      showError(err?.response?.data?.error || err?.message || "Failed to delete Space.");
    }
  };

  const filteredMembers = useMemo(() => {
    if (!memberFilter.trim()) return members;
    const query = memberFilter.toLowerCase();
    return members.filter(
      (m) =>
        m.username.toLowerCase().includes(query) ||
        (m.display_name && m.display_name.toLowerCase().includes(query)) ||
        m.role.toLowerCase().includes(query),
    );
  }, [members, memberFilter]);

  const activePresetObj = availablePresets.find((p) => p.id === domainPreset) || preset;

  return (
    <SettingsLayout>
      {/* ── Left Column: Navigation Sidebar ── */}
      <Box>
        <SidebarCard>
          <ActionList>
            <ActionList.Item selected={activeSection === "general"} onClick={() => setActiveSection("general")}>
              <ActionList.LeadingVisual>
                <GearIcon />
              </ActionList.LeadingVisual>
              General
            </ActionList.Item>

            <ActionList.Item selected={activeSection === "access"} onClick={() => setActiveSection("access")}>
              <ActionList.LeadingVisual>
                <PeopleIcon />
              </ActionList.LeadingVisual>
              Members & Roles
              <ActionList.TrailingVisual>
                <Label variant="accent" style={{ fontSize: "11px" }}>
                  {members.length}
                </Label>
              </ActionList.TrailingVisual>
            </ActionList.Item>

            <ActionList.Item selected={activeSection === "git"} onClick={() => setActiveSection("git")}>
              <ActionList.LeadingVisual>
                <GitBranchIcon />
              </ActionList.LeadingVisual>
              Git Vault & PDM
            </ActionList.Item>

            <ActionList.Item selected={activeSection === "plm"} onClick={() => setActiveSection("plm")}>
              <ActionList.LeadingVisual>
                <LawIcon />
              </ActionList.LeadingVisual>
              Change Control & Governance
            </ActionList.Item>

            <ActionList.Item selected={activeSection === "features"} onClick={() => setActiveSection("features")}>
              <ActionList.LeadingVisual>
                <SlidersIcon />
              </ActionList.LeadingVisual>
              Modules & Tabs
            </ActionList.Item>

            <ActionList.Divider />

            <ActionList.Item
              variant="danger"
              selected={activeSection === "danger"}
              onClick={() => setActiveSection("danger")}
            >
              <ActionList.LeadingVisual>
                <AlertIcon />
              </ActionList.LeadingVisual>
              Danger Zone
            </ActionList.Item>
          </ActionList>
        </SidebarCard>
      </Box>

      {/* ── Right Column: Settings Sections ── */}
      <Box display="flex" flexDirection="column" gap={5}>
        {/* Flash Notifications */}
        {savedMessage && (
          <Flash variant="success" style={{ marginBottom: "8px" }}>
            {savedMessage}
          </Flash>
        )}
        {saveError && (
          <Flash variant="danger" style={{ marginBottom: "8px" }}>
            {saveError}
          </Flash>
        )}

        {/* ── 1. General Section ── */}
        {activeSection === "general" && (
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
                General Settings
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
                Configure Space profile identity, engineering domain classification, and branding metadata.
              </Text>

              <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
                <FormRow>
                  <FieldLabel>Space Name</FieldLabel>
                  <FieldDescription>
                    The human-readable engineering title of this collaborative cyber-physical Space.
                  </FieldDescription>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <TextInput
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. eVTOL 6-DOF Flight Dynamics & Flight Control"
                      block
                      disabled={!viewerState.canAdmin}
                    />
                    {viewerState.canAdmin && (
                      <Button
                        variant="primary"
                        disabled={saving || !name.trim() || name === space.name}
                        onClick={() => handleSaveSpacePatch({ name: name.trim() }, "Space name updated.")}
                      >
                        Update Name
                      </Button>
                    )}
                  </Box>
                </FormRow>

                <FormRow>
                  <FieldLabel>Tagline / Mission Summary</FieldLabel>
                  <FieldDescription>
                    A concise one-line summary displayed beneath the Space title and across search results.
                  </FieldDescription>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <TextInput
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="e.g. Full-envelope 6-DOF rigid body flight dynamics and battery thermal runaway protection loop."
                      block
                      disabled={!viewerState.canAdmin}
                    />
                    {viewerState.canAdmin && (
                      <Button
                        disabled={saving || tagline === (space.tagline || "")}
                        onClick={() => handleSaveSpacePatch({ tagline: tagline.trim() || null }, "Tagline updated.")}
                      >
                        Update Tagline
                      </Button>
                    )}
                  </Box>
                </FormRow>

                <FormRow>
                  <FieldLabel>Engineering Scope & Extended Description</FieldLabel>
                  <FieldDescription>
                    Detailed engineering scope, requirements overview, and mission architecture parameters.
                  </FieldDescription>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Provide a comprehensive technical overview of this Space..."
                    rows={4}
                    block
                    disabled={!viewerState.canAdmin}
                  />
                  {viewerState.canAdmin && (
                    <Box alignSelf="flex-start" mt={1}>
                      <Button
                        size="small"
                        disabled={saving || description === (space.description || "")}
                        onClick={() =>
                          handleSaveSpacePatch(
                            { description: description.trim() || null },
                            "Extended description updated.",
                          )
                        }
                      >
                        Update Description
                      </Button>
                    </Box>
                  )}
                </FormRow>

                <FormRow>
                  <FieldLabel>Space Avatar & Icon URL</FieldLabel>
                  <FieldDescription>Custom graphic image URL representing this Space.</FieldDescription>
                  <Box display="flex" gap={2} alignItems="center">
                    <TextInput
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/space-avatar.png"
                      block
                      disabled={!viewerState.canAdmin}
                    />
                    {viewerState.canAdmin && (
                      <Button
                        size="small"
                        disabled={saving || avatarUrl === (space.avatar_url || "")}
                        onClick={() => handleSaveSpacePatch({ avatarUrl: avatarUrl.trim() || null }, "Avatar updated.")}
                      >
                        Save
                      </Button>
                    )}
                  </Box>
                </FormRow>

                <FormRow>
                  <FieldLabel>Banner Graphic URL</FieldLabel>
                  <FieldDescription>Header banner image displayed on the Space overview page.</FieldDescription>
                  <Box display="flex" gap={2} alignItems="center">
                    <TextInput
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      placeholder="https://example.com/space-banner.png"
                      block
                      disabled={!viewerState.canAdmin}
                    />
                    {viewerState.canAdmin && (
                      <Button
                        size="small"
                        disabled={saving || bannerUrl === (space.banner_url || "")}
                        onClick={() => handleSaveSpacePatch({ bannerUrl: bannerUrl.trim() || null }, "Banner updated.")}
                      >
                        Save
                      </Button>
                    )}
                  </Box>
                </FormRow>
              </StyledBox>
            </Box>

            {/* Domain Taxonomy Card */}
            <Box>
              <Heading as="h3" style={{ fontSize: "18px", marginBottom: "12px" }}>
                Domain Taxonomy & Solvers
              </Heading>
              <StyledBox p={4} display="flex" flexDirection="column" gap={3}>
                <FormRow>
                  <FieldLabel>Domain Preset</FieldLabel>
                  <FieldDescription>
                    Determines the default simulation solvers, polyglot compiler frontends, diagram themes, and
                    compliance rulepacks.
                  </FieldDescription>
                  <select
                    value={domainPreset}
                    onChange={(e) => setDomainPreset(e.target.value)}
                    disabled={!viewerState.canAdmin}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                  >
                    {availablePresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon} {p.name}
                      </option>
                    ))}
                  </select>
                </FormRow>

                {activePresetObj && (
                  <Box
                    p={3}
                    borderRadius={2}
                    style={{
                      background: "var(--color-canvas-subtle)",
                      border: `1px solid ${activePresetObj.accentColor}33`,
                    }}
                    display="flex"
                    flexDirection="column"
                    gap={2}
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: activePresetObj.accentColor,
                          display: "inline-block",
                        }}
                      />
                      <Text style={{ fontWeight: 700, fontSize: "14px", color: activePresetObj.accentColor }}>
                        {activePresetObj.name}
                      </Text>
                      <Label variant="accent" style={{ fontSize: "10px" }}>
                        {activePresetObj.shortLabel}
                      </Label>
                    </Box>
                    <Text style={{ fontSize: "13px", color: "var(--color-fg-muted)" }}>
                      {activePresetObj.description}
                    </Text>
                    {activePresetObj.replacesTools && activePresetObj.replacesTools.length > 0 && (
                      <Box display="flex" gap={1} flexWrap="wrap" alignItems="center" mt={1}>
                        <Text style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-fg-muted)" }}>
                          Replaces Legacy Toolchains:
                        </Text>
                        {activePresetObj.replacesTools.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid var(--color-border-muted)",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}

                {viewerState.canAdmin && (
                  <Box alignSelf="flex-start" mt={1}>
                    <Button
                      disabled={saving || domainPreset === space.domain_preset}
                      onClick={() =>
                        handleSaveSpacePatch({ domainPreset }, `Domain taxonomy changed to ${activePresetObj.name}.`)
                      }
                    >
                      Update Domain Preset
                    </Button>
                  </Box>
                )}
              </StyledBox>
            </Box>

            {/* Container Identity Card */}
            <Box>
              <Heading as="h3" style={{ fontSize: "18px", marginBottom: "12px" }}>
                Container Identity & Architecture
              </Heading>
              <StyledBox p={3}>
                <Box
                  display="grid"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}
                >
                  <Box>
                    <Text
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "var(--color-fg-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Owner Namespace
                    </Text>
                    <Text style={{ fontSize: "14px", fontWeight: 600, display: "block", marginTop: "2px" }}>
                      {space.owner_type === "organization" ? "🏢 @" : "👤 @"}
                      {space.owner_namespace}
                    </Text>
                  </Box>
                  <Box>
                    <Text
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "var(--color-fg-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Container Slug
                    </Text>
                    <Text
                      style={{
                        fontSize: "14px",
                        fontFamily: "var(--ms-font-mono, monospace)",
                        display: "block",
                        marginTop: "2px",
                      }}
                    >
                      {space.slug}
                    </Text>
                  </Box>
                  <Box>
                    <Text
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "var(--color-fg-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Visibility
                    </Text>
                    <Box mt={1}>
                      <Label variant={space.visibility === "public" ? "success" : "secondary"}>
                        {space.visibility.toUpperCase()}
                      </Label>
                    </Box>
                  </Box>
                  <Box>
                    <Text
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "var(--color-fg-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Backing Git Vault
                    </Text>
                    <Text
                      style={{
                        fontSize: "12.5px",
                        fontFamily: "var(--ms-font-mono, monospace)",
                        color: "var(--color-fg-muted)",
                        marginTop: "2px",
                      }}
                    >
                      {space.default_branch || "main"}
                    </Text>
                  </Box>
                </Box>
              </StyledBox>
            </Box>
          </Box>
        )}

        {/* ── 2. Members & Access Section ── */}
        {activeSection === "access" && (
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
              {viewerState.canAdmin && (
                <StyledBox p={3} mb={3}>
                  <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
                    Add or Update Team Member
                  </Text>
                  <form onSubmit={handleAddMember}>
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
                  <Label variant="accent">{members.length}</Label>
                </Box>
                {members.length > 3 && (
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
                          borderBottom:
                            idx < filteredMembers.length - 1 ? "1px solid var(--color-border-muted)" : undefined,
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
                                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                  ({m.display_name})
                                </Text>
                              )}
                            </Box>
                            <Text style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", marginTop: "2px" }}>
                              Joined {new Date(m.created_at).toLocaleDateString()}
                            </Text>
                          </Box>
                        </Box>

                        <Box display="flex" alignItems="center" gap={3}>
                          {viewerState.canAdmin && !isSpaceOwner ? (
                            <select
                              value={m.role}
                              onChange={(e) => handleChangeRole(m.username, e.target.value as SpaceRole)}
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

                          {viewerState.canAdmin && !isSpaceOwner && (
                            <Button
                              size="small"
                              variant="danger"
                              onClick={() => handleRemoveMember(m.user_id, m.username)}
                            >
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
        )}

        {/* ── 3. Git Vault & PDM Section ── */}
        {activeSection === "git" && (
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
                Backing Git Vault & PDM Storage
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
                Configure the backing multi-model Git repository, LFS storage, CAD diffing, and branch protection.
              </Text>

              {/* Git Clone Box */}
              <StyledBox p={3} mb={3}>
                <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "6px" }}>
                  Git Remote Clone URL
                </Text>
                <Text
                  color="var(--color-fg-muted)"
                  style={{ fontSize: "12.5px", display: "block", marginBottom: "10px" }}
                >
                  Clone this Space directly using standard Git CLI or VS Code to sync CAD STEP/STL files,
                  Modelica/SysML2 code, and living docs.
                </Text>
                <Box
                  p={2}
                  borderRadius={2}
                  style={{
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                    fontFamily: "var(--ms-font-mono, monospace)",
                    fontSize: "13px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <code>git clone {gitCloneUrl}</code>
                  <Button size="small" onClick={handleCopyCloneUrl}>
                    {copiedCloneUrl ? <CheckIcon /> : <CopyIcon />} {copiedCloneUrl ? "Copied" : "Copy"}
                  </Button>
                </Box>
              </StyledBox>

              {/* Default Branch */}
              <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
                <FormRow>
                  <FieldLabel>Default Branch</FieldLabel>
                  <FieldDescription>
                    The base branch used for multi-model merging, simulation baselines, and Living Docs rendering.
                  </FieldDescription>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <TextInput
                      value={defaultBranch}
                      onChange={(e) => setDefaultBranch(e.target.value)}
                      disabled={!viewerState.canAdmin}
                    />
                    {viewerState.canAdmin && (
                      <Button
                        variant="primary"
                        disabled={saving || defaultBranch === space.default_branch}
                        onClick={() =>
                          handleSaveSpacePatch({ defaultBranch }, `Default branch set to '${defaultBranch}'.`)
                        }
                      >
                        Update Default Branch
                      </Button>
                    )}
                  </Box>
                </FormRow>

                {/* Branch Protection Rules */}
                <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
                  <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
                    Branch Protection & Release Gates ({defaultBranch})
                  </Text>
                  <Box display="flex" flexDirection="column" gap={3}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={requireEcoSignoff}
                        onChange={(e) => setRequireEcoSignoff(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Require an approved <strong>Engineering Change Order (ECO)</strong> before merging into{" "}
                        {defaultBranch}
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={requireSimCheck}
                        onChange={(e) => setRequireSimCheck(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Require ModelScript polyglot compiler & simulation regression checks to pass
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={requireSignedCommits}
                        onChange={(e) => setRequireSignedCommits(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Require signed cryptographic commits (GPG / SSH Ed25519)
                      </Text>
                    </label>
                  </Box>
                </Box>

                {/* CAD & DAE Semantic Diffing */}
                <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
                  <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
                    Cyber-Physical & CAD Semantic Diffing
                  </Text>
                  <Box display="flex" flexDirection="column" gap={3}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={cadDiffing}
                        onChange={(e) => setCadDiffing(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Enable 3D CAD STEP/STL geometric semantic diffing in merge requests and ECO reviews
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={daeDiffing}
                        onChange={(e) => setDaeDiffing(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Enable DAE linear equation AST algebraic diffing and BLT dependency analysis
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={autoIndexOnPush}
                        onChange={(e) => setAutoIndexOnPush(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Automatically index polyglot packages ({preset.languages.join(", ")}) into package registry on
                        git push
                      </Text>
                    </label>
                  </Box>
                </Box>
              </StyledBox>
            </Box>
          </Box>
        )}

        {/* ── 4. PLM & Governance Section ── */}
        {activeSection === "plm" && (
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
                PLM & Change Control Governance Policy
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
                Define release governance, sign-off thresholds, and compliance verification standards for Engineering
                Change Orders.
              </Text>

              <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
                <FormRow>
                  <FieldLabel>Minimum Required Approvals for ECO Sign-Off</FieldLabel>
                  <FieldDescription>
                    Specifies how many designated PLM approvers must review and sign off before an Engineering Change
                    Order can be merged.
                  </FieldDescription>
                  <select
                    value={minApprovers}
                    onChange={(e) => setMinApprovers(e.target.value as any)}
                    disabled={!viewerState.canAdmin}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "14px",
                      maxWidth: "320px",
                    }}
                  >
                    <option value="1">1 Designated PLM Approver</option>
                    <option value="2">2 Independent Approvers (Four-Eyes Principle)</option>
                    <option value="consensus">Consensus (All Designated Approvers)</option>
                  </select>
                </FormRow>

                <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
                  <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
                    Sign-Off Cryptography & Audit Trail
                  </Text>
                  <Box display="flex" flexDirection="column" gap={3}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={requireEd25519}
                        onChange={(e) => setRequireEd25519(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Require Ed25519 cryptographic digital signatures on all formal ECO sign-off decisions
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={enforceSimulationTolerance}
                        onChange={(e) => setEnforceSimulationTolerance(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Enforce digital twin numerical simulation regression tolerance threshold (relative error &lt;
                        1e-4) before approval
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={immutableGitNotesAudit}
                        onChange={(e) => setImmutableGitNotesAudit(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Record all approval decisions as signed Git Notes in the backing vault for immutable
                        auditability
                      </Text>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={emergencyBypassAllowed}
                        onChange={(e) => setEmergencyBypassAllowed(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                      />
                      <Text style={{ fontSize: "13.5px" }}>
                        Allow Lead Engineer emergency hotfix sign-off bypass (generates mandatory audit alert)
                      </Text>
                    </label>
                  </Box>
                </Box>

                {viewerState.canAdmin && (
                  <Box alignSelf="flex-start" mt={2}>
                    <Button
                      variant="primary"
                      onClick={() => showSuccess("Governance and PLM sign-off policies updated.")}
                    >
                      Save Governance Policy
                    </Button>
                  </Box>
                )}
              </StyledBox>
            </Box>
          </Box>
        )}

        {/* ── 5. Modules & Tabs Section ── */}
        {activeSection === "features" && (
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
                Space Modules & Navigation Tabs
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
                Enable or disable collaborative cyber-physical engineering modules for this Space.
              </Text>

              <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
                <Box display="flex" flexDirection="column" gap={3}>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={3}
                    borderRadius={2}
                    style={{
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                    }}
                  >
                    <Box>
                      <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                        💬 Channels & Real-Time Chat
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                        Persistent Slack-speed topic channels, bot telemetry feeds, and mathematical entity previews.
                      </Text>
                    </Box>
                    <label style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={enableChat}
                        onChange={(e) => setEnableChat(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                        style={{ width: 18, height: 18 }}
                      />
                    </label>
                  </Box>

                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={3}
                    borderRadius={2}
                    style={{
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                    }}
                  >
                    <Box>
                      <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                        📄 Living Architecture Docs
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                        System requirements, architecture specs, and live Modelica/SysML2 code snippets.
                      </Text>
                    </Box>
                    <label style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={enableDocs}
                        onChange={(e) => setEnableDocs(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                        style={{ width: 18, height: 18 }}
                      />
                    </label>
                  </Box>

                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={3}
                    borderRadius={2}
                    style={{
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                    }}
                  >
                    <Box>
                      <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                        🔗 PLM & Change Orders (ECO)
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                        Formal Engineering Change Orders, multi-signature release gating, and compliance verification.
                      </Text>
                    </Box>
                    <label style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={enablePlm}
                        onChange={(e) => setEnablePlm(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                        style={{ width: 18, height: 18 }}
                      />
                    </label>
                  </Box>

                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={3}
                    borderRadius={2}
                    style={{
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                    }}
                  >
                    <Box>
                      <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                        📦 Packages & Multi-Model PDM Registry
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                        Backing Git Vault, polyglot package distribution, and FMI 2.0/3.0 FMU simulation binaries.
                      </Text>
                    </Box>
                    <label style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={enableRepos}
                        onChange={(e) => setEnableRepos(e.target.checked)}
                        disabled={!viewerState.canAdmin}
                        style={{ width: 18, height: 18 }}
                      />
                    </label>
                  </Box>
                </Box>

                <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
                  <FormRow>
                    <FieldLabel>Default Landing Tab</FieldLabel>
                    <FieldDescription>The default module displayed when users navigate to this Space.</FieldDescription>
                    <select
                      value={landingTab}
                      onChange={(e) => setLandingTab(e.target.value)}
                      disabled={!viewerState.canAdmin}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-default)",
                        color: "var(--color-fg-default)",
                        fontSize: "14px",
                        maxWidth: "260px",
                      }}
                    >
                      <option value="overview">🧭 Overview & Cockpit</option>
                      <option value="chat">💬 Channels & Chat</option>
                      <option value="docs">📄 Living Architecture Docs</option>
                      <option value="changes">⚡ Change Control (ECOs)</option>
                      <option value="repos">📦 Packages & PDM</option>
                    </select>
                  </FormRow>
                </Box>

                {viewerState.canAdmin && (
                  <Box alignSelf="flex-start" mt={1}>
                    <Button variant="primary" disabled={saving} onClick={handleSaveModules}>
                      Save Module Settings
                    </Button>
                  </Box>
                )}
              </StyledBox>
            </Box>
          </Box>
        )}

        {/* ── 6. Danger Zone Section ── */}
        {activeSection === "danger" && (
          <Box display="flex" flexDirection="column" gap={4}>
            <Box>
              <Heading
                as="h2"
                style={{
                  fontSize: "24px",
                  color: "var(--color-danger-fg)",
                  borderBottom: "1px solid var(--color-danger-muted)",
                  paddingBottom: "8px",
                  marginBottom: "8px",
                }}
              >
                Danger Zone
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
                Irreversible administrative actions for Space container governance, ownership, and deletion.
              </Text>

              <DangerCard>
                {/* 1. Change Visibility */}
                <DangerRow>
                  <Box>
                    <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>Change Space Visibility</Text>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                      This Space is currently <strong>{visibility.toUpperCase()}</strong>.
                    </Text>
                  </Box>
                  <Button
                    variant="danger"
                    disabled={!viewerState.canAdmin}
                    onClick={() => {
                      setSelectedNewVisibility(visibility);
                      setShowVisibilityModal(true);
                    }}
                  >
                    Change visibility
                  </Button>
                </DangerRow>

                {/* 2. Transfer Ownership */}
                <DangerRow>
                  <Box>
                    <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                      Transfer Container Ownership
                    </Text>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                      Graduate a personal Space into an Organization container, or relocate between namespaces.
                    </Text>
                  </Box>
                  <Button variant="danger" disabled={!viewerState.canAdmin} onClick={() => setShowTransferModal(true)}>
                    Transfer ownership
                  </Button>
                </DangerRow>

                {/* 3. Delete Space */}
                <DangerRow>
                  <Box>
                    <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>Delete this Space</Text>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", marginTop: "2px" }}>
                      Once you delete a Space, there is no going back. All living docs, ECO proposals, chat channels,
                      and the backing Git repository will be permanently deleted.
                    </Text>
                  </Box>
                  <Button
                    variant="danger"
                    disabled={!viewerState.canAdmin}
                    onClick={() => {
                      setDeleteConfirmSlug("");
                      setShowDeleteModal(true);
                    }}
                  >
                    Delete this space
                  </Button>
                </DangerRow>
              </DangerCard>
            </Box>
          </Box>
        )}
      </Box>

      {/* ── Dialog: Change Space Visibility ── */}
      {showVisibilityModal && (
        <Dialog onClose={() => setShowVisibilityModal(false)} title="Change Space Visibility">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: "13.5px" }}>
              Select the new visibility level for <strong>{space.name}</strong>:
            </Text>
            <Box display="flex" flexDirection="column" gap={2}>
              {(
                [
                  {
                    id: "public",
                    label: "Public",
                    desc: "Anyone on the internet can view models, docs, and channels.",
                  },
                  {
                    id: "unlisted",
                    label: "Unlisted",
                    desc: "Accessible only via direct URL. Hidden from public explore feeds.",
                  },
                  { id: "internal", label: "Internal", desc: "Any authenticated member of the organization can view." },
                  { id: "private", label: "Private", desc: "Restricted strictly to explicitly added Space members." },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: selectedNewVisibility === opt.id ? "rgba(59, 130, 246, 0.08)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="space-visibility"
                    value={opt.id}
                    checked={selectedNewVisibility === opt.id}
                    onChange={() => setSelectedNewVisibility(opt.id)}
                    style={{ marginTop: "3px" }}
                  />
                  <Box>
                    <Text style={{ fontWeight: 700, fontSize: "13.5px", display: "block" }}>{opt.label}</Text>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                      {opt.desc}
                    </Text>
                  </Box>
                </label>
              ))}
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
              <Button onClick={() => setShowVisibilityModal(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={selectedNewVisibility === visibility}
                onClick={handleConfirmVisibilityChange}
              >
                Confirm Visibility Change
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {/* ── Dialog: Transfer Ownership ── */}
      {showTransferModal && (
        <Dialog onClose={() => setShowTransferModal(false)} title="Transfer Container Ownership">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: "13.5px" }}>
              Relocate <strong>{space.name}</strong> to an Organization container or your personal profile. The backing
              Git Vault and all references will be transferred automatically.
            </Text>
            <FormRow>
              <FieldLabel>Target Container Type</FieldLabel>
              <select
                value={transferTargetType}
                onChange={(e) => {
                  const nextType = e.target.value as SpaceOwnerType;
                  setTransferTargetType(nextType);
                  if (nextType === "user" && user) {
                    setTransferTargetSlug(user.username);
                  } else if (nextType === "organization" && myOrgs[0]) {
                    setTransferTargetSlug(myOrgs[0].slug);
                  }
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                  fontSize: "13.5px",
                }}
              >
                <option value="organization">🏢 Organization Container</option>
                <option value="user">👤 Personal Profile</option>
              </select>
            </FormRow>
            <FormRow>
              <FieldLabel>Target Namespace @slug</FieldLabel>
              <TextInput
                placeholder="e.g. aether-dynamics or username"
                value={transferTargetSlug}
                onChange={(e) => setTransferTargetSlug(e.target.value)}
                block
              />
            </FormRow>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
              <Button onClick={() => setShowTransferModal(false)}>Cancel</Button>
              <Button variant="danger" disabled={!transferTargetSlug.trim()} onClick={handleConfirmTransfer}>
                Transfer Space →
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {/* ── Dialog: Delete Space ── */}
      {showDeleteModal && (
        <Dialog onClose={() => setShowDeleteModal(false)} title="Delete Space Container">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text color="var(--color-danger-fg)" style={{ fontSize: "13.5px", lineHeight: 1.4 }}>
              This action <strong>cannot</strong> be undone. This will permanently delete the{" "}
              <strong>{space.name}</strong> Space (@{space.owner_namespace}/{space.slug}), along with all Living
              Architecture Docs, ECO approval history, channel messages, and the backing Git repository.
            </Text>
            <Text style={{ fontSize: "13px" }}>
              Please type <strong>{space.slug}</strong> to confirm:
            </Text>
            <TextInput
              value={deleteConfirmSlug}
              onChange={(e) => setDeleteConfirmSlug(e.target.value)}
              placeholder={space.slug}
              block
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
              <Button onClick={() => setShowDeleteModal(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={handleConfirmDelete}
                disabled={deleteConfirmSlug.trim().toLowerCase() !== space.slug.toLowerCase()}
              >
                I understand the consequences, delete this space
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </SettingsLayout>
  );
};

export default SpaceSettingsTab;

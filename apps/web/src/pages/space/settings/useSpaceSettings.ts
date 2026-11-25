// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addSpaceMember,
  deleteSpace,
  getSpaceDomainPresets,
  removeSpaceMember,
  transferSpace,
  updateSpace,
  updateSpaceJiraIntegration,
  type SpaceDomainPreset,
  type SpaceOwnerType,
  type SpaceRole,
  type SpaceVisibility,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import { useToast } from "../../../components/ToastContext";
import { getApiErrorMessage } from "../../../util/error";
import {
  ROLE_TITLES,
  type MinApproversOption,
  type SettingsSection,
  type SpacePatch,
  type SpaceSettingsTabProps,
} from "./types";

export function useSpaceSettings({
  detail,
  myOrgs,
  onSpaceUpdated,
  onMembersUpdated,
  onRefresh,
}: Pick<SpaceSettingsTabProps, "detail" | "myOrgs" | "onSpaceUpdated" | "onMembersUpdated" | "onRefresh">) {
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
  const [minApprovers, setMinApprovers] = useState<MinApproversOption>("1");
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

  // Integrations & Jira State
  const savedJira = (space.settings?.["jira"] as Record<string, unknown> | undefined) || {};
  const [jiraBaseUrl, setJiraBaseUrl] = useState(String(savedJira["baseUrl"] ?? savedJira["jiraBaseUrl"] ?? ""));
  const [jiraEmail, setJiraEmail] = useState(String(savedJira["email"] ?? ""));
  const [jiraApiToken, setJiraApiToken] = useState(String(savedJira["apiToken"] ?? ""));
  const [jiraJql, setJiraJql] = useState(String(savedJira["jql"] ?? ""));
  const [jiraModelField, setJiraModelField] = useState(String(savedJira["modelCustomField"] ?? ""));
  const [jiraAutoComment, setJiraAutoComment] = useState(savedJira["autoCommentOnSimulation"] !== false);
  const [testingJira, setTestingJira] = useState(false);
  const [savingJira, setSavingJira] = useState(false);

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
      .catch(() => undefined);
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

  const handleSaveSpacePatch = async (patch: SpacePatch, successMessage: string): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSpace(space.owner_namespace, space.slug, patch);
      onSpaceUpdated?.(updated);
      showSuccess(successMessage);
      if (onRefresh) {
        void onRefresh();
      }
      return true;
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to update Space settings."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveJiraIntegration = async (testConnection: boolean = false) => {
    if (testConnection) setTestingJira(true);
    else setSavingJira(true);

    try {
      const res = await updateSpaceJiraIntegration(space.owner_namespace, space.slug, {
        baseUrl: jiraBaseUrl.trim(),
        email: jiraEmail.trim(),
        apiToken: jiraApiToken.trim(),
        jql: jiraJql.trim(),
        modelCustomField: jiraModelField.trim(),
        autoCommentOnSimulation: jiraAutoComment,
        testConnection,
      });

      if (res.success) {
        showSuccess(
          testConnection
            ? "Jira connection verified and settings saved successfully!"
            : "Jira integration configuration updated.",
        );
        onRefresh?.();
      }
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to update Jira integration."));
    } finally {
      setTestingJira(false);
      setSavingJira(false);
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
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to add member."));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number, username: string) => {
    if (!window.confirm(`Are you sure you want to remove @${username} from this Space?`)) {
      return;
    }
    try {
      const updated = await removeSpaceMember(space.owner_namespace, space.slug, userId);
      onMembersUpdated?.(updated);
      showSuccess(`Removed @${username} from Space members.`);
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to remove member."));
    }
  };

  const handleChangeRole = async (username: string, newRole: SpaceRole) => {
    try {
      const updated = await addSpaceMember(space.owner_namespace, space.slug, username, newRole);
      onMembersUpdated?.(updated);
      showSuccess(`Updated @${username}'s role to ${ROLE_TITLES[newRole]}.`);
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to update member role."));
    }
  };

  const handleSaveModules = async () => {
    const tabs = ["overview"];
    if (enableChat) tabs.push("chat");
    if (enableDocs) tabs.push("docs");
    if (enablePlm) tabs.push("plm");
    if (enableRepos) tabs.push("repos");
    await handleSaveSpacePatch({ enabledTabs: tabs }, "Space modules and navigation updated.");
  };

  const handleConfirmVisibilityChange = async () => {
    const saved = await handleSaveSpacePatch(
      { visibility: selectedNewVisibility },
      `Space visibility changed to ${selectedNewVisibility}.`,
    );
    if (saved) {
      setVisibility(selectedNewVisibility);
      setShowVisibilityModal(false);
    }
  };

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
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to transfer Space container."));
    }
  };

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
    } catch (err: unknown) {
      showError(getApiErrorMessage(err, "Failed to delete Space."));
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

  return {
    activeSection,
    setActiveSection,
    savedMessage,
    saveError,
    saving,
    showSuccess,
    handleSaveSpacePatch,
    user,
    general: {
      name,
      setName,
      tagline,
      setTagline,
      description,
      setDescription,
      domainPreset,
      setDomainPreset,
      avatarUrl,
      setAvatarUrl,
      bannerUrl,
      setBannerUrl,
      availablePresets,
      activePresetObj,
    },
    access: {
      memberFilter,
      setMemberFilter,
      newMemberUsername,
      setNewMemberUsername,
      newMemberRole,
      setNewMemberRole,
      addingMember,
      filteredMembers,
      handleAddMember,
      handleRemoveMember,
      handleChangeRole,
    },
    git: {
      defaultBranch,
      setDefaultBranch,
      requireEcoSignoff,
      setRequireEcoSignoff,
      requireSimCheck,
      setRequireSimCheck,
      requireSignedCommits,
      setRequireSignedCommits,
      cadDiffing,
      setCadDiffing,
      daeDiffing,
      setDaeDiffing,
      autoIndexOnPush,
      setAutoIndexOnPush,
      copiedCloneUrl,
      gitCloneUrl,
      handleCopyCloneUrl,
    },
    plm: {
      minApprovers,
      setMinApprovers,
      requireEd25519,
      setRequireEd25519,
      enforceSimulationTolerance,
      setEnforceSimulationTolerance,
      emergencyBypassAllowed,
      setEmergencyBypassAllowed,
      immutableGitNotesAudit,
      setImmutableGitNotesAudit,
    },
    modules: {
      enableChat,
      setEnableChat,
      enableDocs,
      setEnableDocs,
      enablePlm,
      setEnablePlm,
      enableRepos,
      setEnableRepos,
      landingTab,
      setLandingTab,
      handleSaveModules,
    },
    integrations: {
      savedJira,
      jiraBaseUrl,
      setJiraBaseUrl,
      jiraEmail,
      setJiraEmail,
      jiraApiToken,
      setJiraApiToken,
      jiraJql,
      setJiraJql,
      jiraModelField,
      setJiraModelField,
      jiraAutoComment,
      setJiraAutoComment,
      testingJira,
      savingJira,
      handleSaveJiraIntegration,
    },
    danger: {
      visibility,
      showVisibilityModal,
      setShowVisibilityModal,
      selectedNewVisibility,
      setSelectedNewVisibility,
      transferTargetType,
      setTransferTargetType,
      transferTargetSlug,
      setTransferTargetSlug,
      showTransferModal,
      setShowTransferModal,
      showDeleteModal,
      setShowDeleteModal,
      deleteConfirmSlug,
      setDeleteConfirmSlug,
      handleConfirmVisibilityChange,
      handleConfirmTransfer,
      handleConfirmDelete,
    },
  };
}

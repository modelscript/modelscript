// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  PersonIcon,
  ShieldCheckIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import {
  acceptFollowRequest,
  deleteAccount,
  exportSocialGraph,
  getBlockedUsers,
  getFollowRequests,
  getMutedUsers,
  getPrivacySettings,
  importSocialGraph,
  migrateAccountToActor,
  rejectFollowRequest,
  updateAccountAliases,
  updatePrivacySettings,
  verifyProfileFields,
  type BlockedOrMutedUser,
  type FollowRequestUser,
  type PrivacyFederationSettings,
  type ProfileFieldItem,
} from "../../../api/account";
import { unblockUser, unmuteUser } from "../../../api/social";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import {
  DangerButton,
  DetailSubtitle,
  DetailTitle,
  FormInput,
  FormLabel,
  Header,
  PrimaryButton,
  SaveButton,
  SecondaryButton,
} from "../settingsStyles";

export interface PrivacyTabProps {
  subView?: "privacy" | "deleteAccount" | undefined;
  onNavigate?: ((tab: any) => void) | undefined;
  setActiveTab?: ((tab: any) => void) | undefined;
  onBack?: (() => void) | undefined;
}

const DEFAULT_PRIVACY: PrivacyFederationSettings = {
  discoverable: true,
  indexable: true,
  locked: false,
  default_post_visibility: "public",
  profile_fields: [],
  also_known_as: [],
  moved_to_actor_url: null,
  actor_url: null,
};

const VISIBILITY_OPTIONS: {
  id: PrivacyFederationSettings["default_post_visibility"];
  label: string;
  description: string;
}[] = [
  {
    id: "public",
    label: "Public",
    description: "Visible to everyone, listed in public timelines, and federated across connected ActivityPub servers.",
  },
  {
    id: "unlisted",
    label: "Unlisted",
    description: "Visible on your public profile and to followers, but excluded from public discovery timelines.",
  },
  {
    id: "followers",
    label: "Followers Only",
    description: "Restricted exclusively to approved followers on your home instance and federated servers.",
  },
  {
    id: "direct",
    label: "Direct / Mentioned Only",
    description: "Delivered only to accounts explicitly @mentioned in the post.",
  },
];

const METADATA_PRESETS: { name: string; placeholder: string }[] = [
  { name: "ORCID", placeholder: "0000-0002-1825-0097" },
  { name: "GitHub", placeholder: "https://github.com/username" },
  { name: "Website", placeholder: "https://lab.university.edu/~researcher" },
  { name: "Institution", placeholder: "MIT Department of Mechanical Engineering" },
];

function stripTrailingSlashes(str: string): string {
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return str.slice(0, end);
}

function isHubModelscriptUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === "hub.modelscript.org";
  } catch {
    return false;
  }
}

export function resolveLocalActorUrl(username: string, rawActorUrl?: string | null, currentOrigin?: string): string {
  const origin = stripTrailingSlashes(
    currentOrigin || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"),
  );
  const cleanUser = (username || "username").replace(/^@/, "");
  if (!rawActorUrl || !rawActorUrl.trim()) {
    return `${origin}/users/${cleanUser}`;
  }
  if (isHubModelscriptUrl(rawActorUrl) && !isHubModelscriptUrl(origin)) {
    return `${origin}/users/${cleanUser}`;
  }
  return rawActorUrl;
}

export const PrivacyTab: React.FC<PrivacyTabProps> = ({ subView = "privacy", onNavigate, setActiveTab, onBack }) => {
  const { user, logout, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const toast = useToast();

  const navigateTab = useCallback(
    (tab: string) => {
      if (onNavigate) onNavigate(tab);
      else if (setActiveTab) setActiveTab(tab);
    },
    [onNavigate, setActiveTab],
  );

  // Privacy & Federation Settings state
  const [privacy, setPrivacy] = useState<PrivacyFederationSettings>(DEFAULT_PRIVACY);
  const [loadingPrivacy, setLoadingPrivacy] = useState(true);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Follow requests queue state
  const [followRequests, setFollowRequests] = useState<FollowRequestUser[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(null);

  // Verified profile metadata state
  const [profileFields, setProfileFields] = useState<ProfileFieldItem[]>([]);
  const [verifyingFields, setVerifyingFields] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copiedBacklink, setCopiedBacklink] = useState(false);

  // Blocked & Muted accounts state
  const [blockedUsers, setBlockedUsers] = useState<BlockedOrMutedUser[]>([]);
  const [mutedUsers, setMutedUsers] = useState<BlockedOrMutedUser[]>([]);
  const [loadingSafetyLists, setLoadingSafetyLists] = useState(false);
  const [unblockingUsername, setUnblockingUsername] = useState<string | null>(null);
  const [unmutingUsername, setUnmutingUsername] = useState<string | null>(null);

  // Social graph portability state
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [importType, setImportType] = useState<"following" | "blocks" | "mutes">("following");
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [importCsvText, setImportCsvText] = useState("");
  const [importingGraph, setImportingGraph] = useState(false);
  const [importResult, setImportResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Federated Account Aliases & Migration state
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAliasInput, setNewAliasInput] = useState("");
  const [savingAliases, setSavingAliases] = useState(false);
  const [targetActorUrl, setTargetActorUrl] = useState("");
  const [confirmMoveUnderstand, setConfirmMoveUnderstand] = useState(false);
  const [migratingActor, setMigratingActor] = useState(false);
  const [federationStatus, setFederationStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Account Deletion state
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");
  const [deleteConsentUnderstood, setDeleteConsentUnderstood] = useState(false);
  const [deleteConsentBackedUp, setDeleteConsentBackedUp] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAllPrivacyData = useCallback(async () => {
    setLoadingPrivacy(true);
    setLoadingRequests(true);
    setLoadingSafetyLists(true);

    const [privRes, reqRes, blockedRes, mutedRes] = await Promise.allSettled([
      getPrivacySettings(),
      getFollowRequests(),
      getBlockedUsers(),
      getMutedUsers(),
    ]);

    if (privRes.status === "fulfilled" && privRes.value) {
      const data = privRes.value;
      setPrivacy({
        discoverable: data.discoverable ?? true,
        indexable: data.indexable ?? true,
        locked: data.locked ?? false,
        default_post_visibility: data.default_post_visibility || "public",
        profile_fields: Array.isArray(data.profile_fields) ? data.profile_fields : [],
        also_known_as: Array.isArray(data.also_known_as) ? data.also_known_as : [],
        moved_to_actor_url: data.moved_to_actor_url ?? null,
        actor_url: data.actor_url ?? null,
      });
      const initialFields =
        Array.isArray(data.profile_fields) && data.profile_fields.length > 0
          ? data.profile_fields
          : [
              { name: "ORCID", value: "", verified_at: null },
              { name: "GitHub", value: "", verified_at: null },
              { name: "Website", value: "", verified_at: null },
            ];
      setProfileFields(initialFields);
      setAliases(Array.isArray(data.also_known_as) ? data.also_known_as : []);
    } else {
      setProfileFields([
        { name: "ORCID", value: "", verified_at: null },
        { name: "GitHub", value: "", verified_at: null },
        { name: "Website", value: "", verified_at: null },
      ]);
    }
    setLoadingPrivacy(false);

    if (reqRes.status === "fulfilled") {
      setFollowRequests(Array.isArray(reqRes.value) ? reqRes.value : []);
    }
    setLoadingRequests(false);

    if (blockedRes.status === "fulfilled") {
      setBlockedUsers(Array.isArray(blockedRes.value) ? blockedRes.value : []);
    }
    if (mutedRes.status === "fulfilled") {
      setMutedUsers(Array.isArray(mutedRes.value) ? mutedRes.value : []);
    }
    setLoadingSafetyLists(false);
  }, []);

  useEffect(() => {
    if (subView === "privacy") {
      void loadAllPrivacyData();
    }
  }, [subView, loadAllPrivacyData]);

  const handleSavePrivacySettings = async (nextOverride?: Partial<PrivacyFederationSettings>) => {
    const merged = { ...privacy, ...nextOverride };
    setPrivacy(merged);
    setSavingPrivacy(true);
    setPrivacyStatus(null);
    try {
      await updatePrivacySettings({
        locked: merged.locked,
        discoverable: merged.discoverable,
        indexable: merged.indexable,
        default_post_visibility: merged.default_post_visibility,
      });
      await refreshUser?.();
      setPrivacyStatus({ type: "success", text: "Privacy and discovery preferences saved." });
      toast.success("Privacy settings saved.");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to update privacy settings.";
      setPrivacyStatus({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleAcceptFollowRequest = async (req: FollowRequestUser) => {
    setProcessingRequestId(req.id);
    try {
      await acceptFollowRequest(req.id);
      setFollowRequests((prev) => prev.filter((item) => item.id !== req.id));
      toast.success(`Approved follow request from @${req.username}.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to accept follow request.");
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleRejectFollowRequest = async (req: FollowRequestUser) => {
    setProcessingRequestId(req.id);
    try {
      await rejectFollowRequest(req.id);
      setFollowRequests((prev) => prev.filter((item) => item.id !== req.id));
      toast.info(`Declined follow request from @${req.username}.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to reject follow request.");
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleSaveAndVerifyFields = async () => {
    setVerifyingFields(true);
    setVerifyStatus(null);
    try {
      const cleaned = profileFields
        .map((f) => ({
          name: f.name.trim(),
          value: f.value.trim(),
          verified_at: f.verified_at ?? null,
        }))
        .filter((f) => f.name.length > 0 && f.value.length > 0)
        .slice(0, 8);
      await updatePrivacySettings({ profile_fields: cleaned });
      const res = await verifyProfileFields(cleaned);
      const updatedFields = Array.isArray(res.profile_fields) ? res.profile_fields : cleaned;
      setProfileFields(
        updatedFields.length > 0
          ? updatedFields
          : [
              { name: "ORCID", value: "", verified_at: null },
              { name: "GitHub", value: "", verified_at: null },
              { name: "Website", value: "", verified_at: null },
            ],
      );
      setPrivacy((prev) => ({ ...prev, profile_fields: updatedFields }));
      const verifiedCount = updatedFields.filter((f) => Boolean(f.verified_at)).length;
      setVerifyStatus({
        type: "success",
        text: `Saved ${updatedFields.length} metadata ${updatedFields.length === 1 ? "field" : "fields"} (${verifiedCount} verified).`,
      });
      toast.success(`Profile links saved (${verifiedCount} verified).`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to verify profile metadata fields.";
      setVerifyStatus({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setVerifyingFields(false);
    }
  };

  const handleUnblockUser = async (username: string) => {
    setUnblockingUsername(username);
    try {
      await unblockUser(username);
      setBlockedUsers((prev) => prev.filter((u) => u.username !== username));
      toast.success(`Unblocked @${username}.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `Failed to unblock @${username}.`);
    } finally {
      setUnblockingUsername(null);
    }
  };

  const handleUnmuteUser = async (username: string) => {
    setUnmutingUsername(username);
    try {
      await unmuteUser(username);
      setMutedUsers((prev) => prev.filter((u) => u.username !== username));
      toast.success(`Unmuted @${username}.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `Failed to unmute @${username}.`);
    } finally {
      setUnmutingUsername(null);
    }
  };

  const handleExportGraph = async (format: "csv" | "json", type: "following" | "blocks" | "mutes") => {
    const key = `${format}-${type}`;
    setExportingKey(key);
    try {
      const res = await exportSocialGraph(format, type);
      let blob: Blob;
      if (res instanceof Blob) {
        blob = res;
      } else {
        blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelscript-${type}-${user?.username || "account"}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`Exported ${type} list as ${format.toUpperCase()}.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to export social graph.");
    } finally {
      setExportingKey(null);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImportCsvText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleImportGraph = async () => {
    const raw = importCsvText.trim();
    if (!raw) {
      setImportResult({ type: "error", text: "Please upload a CSV/JSON file or paste account handles/URIs first." });
      return;
    }
    setImportingGraph(true);
    setImportResult(null);
    try {
      let payload: Parameters<typeof importSocialGraph>[0] = {
        csv: raw,
        type: importType,
        mode: importMode,
      };
      if (raw.startsWith("{") || raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            payload = { [importType]: parsed.map(String), type: importType, mode: importMode };
          } else if (parsed && typeof parsed === "object") {
            payload = {
              following: Array.isArray(parsed.following) ? parsed.following : undefined,
              blocks: Array.isArray(parsed.blocks) ? parsed.blocks : undefined,
              mutes: Array.isArray(parsed.mutes) ? parsed.mutes : undefined,
              type: importType,
              mode: importMode,
            };
          }
        } catch {
          // Fall back to CSV parsing on backend
        }
      }
      const res = await importSocialGraph(payload);
      setImportResult({
        type: "success",
        text: `Imported ${res.importedFollowing ?? 0} following, ${res.importedBlocks ?? 0} blocks, and ${res.importedMutes ?? 0} mutes (${importMode} mode).`,
      });
      toast.success("Social graph imported successfully.");
      const [blockedRes, mutedRes] = await Promise.allSettled([getBlockedUsers(), getMutedUsers()]);
      if (blockedRes.status === "fulfilled") setBlockedUsers(blockedRes.value);
      if (mutedRes.status === "fulfilled") setMutedUsers(mutedRes.value);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to import social graph.";
      setImportResult({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setImportingGraph(false);
    }
  };

  const handleAddAlias = () => {
    const trimmed = newAliasInput.trim();
    if (!trimmed) return;
    if (aliases.includes(trimmed)) {
      setNewAliasInput("");
      return;
    }
    setAliases((prev) => [...prev, trimmed].slice(0, 10));
    setNewAliasInput("");
  };

  const handleSaveAliases = async (nextAliases?: string[]) => {
    const list = nextAliases ?? aliases;
    setSavingAliases(true);
    setFederationStatus(null);
    try {
      const res = await updateAccountAliases(list);
      const updated = Array.isArray(res.alsoKnownAs) ? res.alsoKnownAs : list;
      setAliases(updated);
      setPrivacy((prev) => ({ ...prev, also_known_as: updated }));
      setFederationStatus({
        type: "success",
        text: `Saved ${updated.length} federated account ${updated.length === 1 ? "alias" : "aliases"} (alsoKnownAs).`,
      });
      toast.success("Federated account aliases updated.");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to update account aliases.";
      setFederationStatus({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setSavingAliases(false);
    }
  };

  const handleMigrateAccount = async () => {
    const target = targetActorUrl.trim();
    if (!target) {
      setFederationStatus({ type: "error", text: "Please enter a valid target ActivityPub Actor URI." });
      return;
    }
    if (!confirmMoveUnderstand) {
      setFederationStatus({
        type: "error",
        text: "Please confirm the ActivityPub Move acknowledgment checkbox before broadcasting migration.",
      });
      return;
    }
    setMigratingActor(true);
    setFederationStatus(null);
    try {
      const res = await migrateAccountToActor(target);
      setPrivacy((prev) => ({ ...prev, moved_to_actor_url: res.movedToActorUrl || target }));
      setFederationStatus({
        type: "success",
        text: `Account migration broadcast to ${res.movedToActorUrl || target}. Migrated ${res.migratedLocalFollowers ?? 0} local followers.`,
      });
      toast.success("ActivityPub Move broadcast completed.");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to broadcast account migration.";
      setFederationStatus({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setMigratingActor(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (deleteConfirmUsername.trim() !== user.username) {
      setDeleteError(`Please type your exact username ("${user.username}") to confirm.`);
      return;
    }
    if (!deleteConsentUnderstood || !deleteConsentBackedUp) {
      setDeleteError("Please confirm both acknowledgment checkboxes before proceeding.");
      return;
    }
    setIsDeletingAccount(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      toast.info("Your account and associated personal data have been permanently erased.");
      logout({ redirect: false });
      window.location.href = "/";
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || "Failed to delete account. Please try again or contact support.");
      setIsDeletingAccount(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const profileUrl = `${origin}/${user?.username || "username"}`;
  const actorUrl = resolveLocalActorUrl(user?.username || "username", privacy.actor_url, origin);
  const relMeSnippet = `<a rel="me" href="${profileUrl}">@${user?.username || "username"} on ${brandName}</a>`;

  if (subView === "deleteAccount") {
    return (
      <>
        <Header>
          <CircleIconButton
            className="subtab-back"
            onClick={() => navigateTab("privacy")}
            style={{ marginRight: "8px" }}
          >
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
          Deactivate or Delete Account
        </Header>
        <Box px={4} pb={4} style={{ overflowY: "auto" }}>
          <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
            Permanently erase your account and personal data pursuant to GDPR Article 17 (Right to Erasure) and CCPA §
            1798.105.
          </DetailSubtitle>

          <Box
            mb={4}
            p={4}
            bg="rgba(218, 54, 51, 0.08)"
            border="1px solid var(--color-danger-fg, #cf222e)"
            borderRadius="12px"
          >
            <Box display="flex" alignItems="center" gap={2} mb={2} color="var(--color-danger-fg, #cf222e)">
              <AlertIcon size={22} />
              <Text fontWeight="bold" fontSize="17px">
                Warning: Irreversible Action
              </Text>
            </Box>
            <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.6", display: "block", marginBottom: "16px" }}>
              Deleting your account permanently anonymizes and erases your profile, email, authentication tokens,
              published posts, comments, models, and personal records. This action cannot be reversed.
            </DetailSubtitle>

            <Box
              p={3}
              bg="var(--color-canvas-default)"
              borderRadius="8px"
              border="1px solid var(--color-border-subtle)"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Text fontWeight="600" fontSize="13px" display="block">
                  Have you backed up your data?
                </Text>
                <DetailSubtitle style={{ fontSize: "12px" }}>
                  You can download a complete ZIP archive with an offline HTML viewer before deleting.
                </DetailSubtitle>
              </Box>
              <SecondaryButton
                type="button"
                onClick={() => navigateTab("dataArchive")}
                style={{ padding: "6px 14px", fontSize: "13px" }}
              >
                <DownloadIcon size={14} />
                Download Archive First
              </SecondaryButton>
            </Box>
          </Box>

          {deleteError && (
            <Box
              mb={4}
              p={3}
              bg="var(--color-danger-subtle)"
              color="var(--color-danger-fg)"
              borderRadius="8px"
              display="flex"
              gap={2}
              alignItems="center"
            >
              <AlertIcon size={18} />
              <Text fontSize="14px">{deleteError}</Text>
            </Box>
          )}

          <Box p={4} bg="var(--color-canvas-subtle)" border="1px solid var(--color-border-default)" borderRadius="12px">
            <Text fontWeight="bold" fontSize="16px" display="block" mb={3}>
              Confirm Permanent Erasure
            </Text>

            <Box display="flex" flexDirection="column" gap={3} mb={4}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={deleteConsentUnderstood}
                  onChange={(e) => setDeleteConsentUnderstood(e.target.checked)}
                  style={{ marginTop: "3px", width: "18px", height: "18px", cursor: "pointer" }}
                />
                <Text fontSize="14px" style={{ lineHeight: "1.4" }}>
                  I understand that this action is permanent and my account, posts, models, and credits will be
                  permanently destroyed.
                </Text>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={deleteConsentBackedUp}
                  onChange={(e) => setDeleteConsentBackedUp(e.target.checked)}
                  style={{ marginTop: "3px", width: "18px", height: "18px", cursor: "pointer" }}
                />
                <Text fontSize="14px" style={{ lineHeight: "1.4" }}>
                  I have exported any data archives I wish to keep or confirm that I do not need them.
                </Text>
              </label>
            </Box>

            <Box mb={4}>
              <FormLabel style={{ display: "block", marginBottom: "6px" }}>
                Type your username{" "}
                <span style={{ fontFamily: "monospace", color: "var(--color-danger-fg)" }}>"{user?.username}"</span> to
                confirm:
              </FormLabel>
              <FormInput
                placeholder={user?.username || "username"}
                value={deleteConfirmUsername}
                onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                style={{ marginTop: 0 }}
              />
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={3}>
              <SecondaryButton type="button" onClick={() => navigateTab("privacy")}>
                Cancel
              </SecondaryButton>
              <DangerButton
                type="button"
                onClick={handleDeleteAccount}
                disabled={
                  isDeletingAccount ||
                  deleteConfirmUsername.trim() !== user?.username ||
                  !deleteConsentUnderstood ||
                  !deleteConsentBackedUp
                }
              >
                <TrashIcon size={16} />
                {isDeletingAccount ? "Erasing Account..." : "Permanently Delete My Account"}
              </DangerButton>
            </Box>
          </Box>
        </Box>
      </>
    );
  }

  return (
    <>
      <Header>
        <CircleIconButton onClick={() => (onBack ? onBack() : navigateTab("account"))} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Privacy, Safety &amp; Federation Control Center
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
          Configure account discovery, follower approval, cryptographic profile verification (<code>rel="me"</code>{" "}
          &amp; ORCID), blocked/muted accounts, ActivityPub social graph portability, and GDPR data rights on{" "}
          {brandName}.
        </DetailSubtitle>

        {/* SECTION 1: Profile Discovery & Post Privacy */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
            <Box display="flex" alignItems="center" gap={2}>
              <LockIcon size={20} />
              <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
                Profile Discovery &amp; Post Privacy
              </DetailTitle>
            </Box>
            {loadingPrivacy && (
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Loading settings...</span>
            )}
          </Box>

          {privacyStatus && (
            <Box
              mb={3}
              p={3}
              borderRadius="8px"
              style={{
                background:
                  privacyStatus.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
                color: privacyStatus.type === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)",
                fontSize: "13px",
              }}
            >
              {privacyStatus.text}
            </Box>
          )}

          <Box display="flex" flexDirection="column" gap={3} mb={4}>
            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="8px"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={3}
            >
              <Box>
                <FormLabel style={{ margin: 0 }}>Require Follow Approval (Locked Account)</FormLabel>
                <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                  Manually review and approve new followers before they can receive your followers-only posts.
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={privacy.locked}
                aria-label="Require Follow Approval (Locked Account)"
                disabled={loadingPrivacy || savingPrivacy}
                checked={privacy.locked}
                onChange={(e) => {
                  const locked = e.target.checked;
                  void handleSavePrivacySettings({ locked });
                }}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="8px"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={3}
            >
              <Box>
                <FormLabel style={{ margin: 0 }}>Include in Directory &amp; Recommendations</FormLabel>
                <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                  Allow your profile to appear in &ldquo;Who to follow&rdquo; suggestions and the engineering directory.
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={privacy.discoverable}
                aria-label="Include in Directory & Recommendations"
                disabled={loadingPrivacy || savingPrivacy}
                checked={privacy.discoverable}
                onChange={(e) => {
                  const discoverable = e.target.checked;
                  void handleSavePrivacySettings({ discoverable });
                }}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="8px"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={3}
            >
              <Box>
                <FormLabel style={{ margin: 0 }}>Search Engine Indexing</FormLabel>
                <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                  Allow public search engines and scientific crawlers to index your profile and public posts (emits{" "}
                  <code>noindex</code> when off).
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={privacy.indexable}
                aria-label="Search Engine Indexing"
                disabled={loadingPrivacy || savingPrivacy}
                checked={privacy.indexable}
                onChange={(e) => {
                  const indexable = e.target.checked;
                  void handleSavePrivacySettings({ indexable });
                }}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>
          </Box>

          <Box mb={3}>
            <FormLabel style={{ display: "block", marginBottom: "8px" }}>Default Post Visibility</FormLabel>
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={2}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const selected = privacy.default_post_visibility === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={loadingPrivacy || savingPrivacy}
                    onClick={() => void handleSavePrivacySettings({ default_post_visibility: opt.id })}
                    style={{
                      textAlign: "left",
                      padding: "12px",
                      borderRadius: "8px",
                      border: selected
                        ? "2px solid var(--color-accent-purple, #a855f7)"
                        : "1px solid var(--color-border-default)",
                      background: selected ? "rgba(139, 92, 246, 0.12)" : "var(--color-canvas-default)",
                      color: "var(--color-text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                      {opt.label}
                    </span>
                    <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4", display: "block" }}>
                      {opt.description}
                    </DetailSubtitle>
                  </button>
                );
              })}
            </Box>
          </Box>

          <Box display="flex" justifyContent="flex-end">
            <SaveButton
              type="button"
              disabled={loadingPrivacy || savingPrivacy}
              onClick={() => void handleSavePrivacySettings()}
            >
              {savingPrivacy ? "Saving..." : "Save Privacy Settings"}
            </SaveButton>
          </Box>
        </Box>

        {/* SECTION 2: Pending Follow Requests Queue */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <PersonIcon size={20} />
              <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
                Pending Follow Requests ({followRequests.length})
              </DetailTitle>
            </Box>
            <SecondaryButton
              type="button"
              disabled={loadingRequests}
              onClick={async () => {
                setLoadingRequests(true);
                try {
                  const list = await getFollowRequests();
                  setFollowRequests(list);
                } catch {
                  // Ignore fetch error
                } finally {
                  setLoadingRequests(false);
                }
              }}
              style={{ padding: "5px 12px", fontSize: "12px" }}
            >
              <SyncIcon size={14} />
              {loadingRequests ? "Refreshing..." : "Refresh Queue"}
            </SecondaryButton>
          </Box>
          <DetailSubtitle style={{ display: "block", marginBottom: "14px" }}>
            When your account is locked, local and remote ActivityPub follow requests wait here for your approval.
          </DetailSubtitle>

          {followRequests.length === 0 ? (
            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="8px"
              style={{ fontSize: "13px", color: "var(--color-text-muted)", textAlign: "center" }}
            >
              No pending follow requests.
            </Box>
          ) : (
            <Box display="flex" flexDirection="column" gap={2}>
              {followRequests.map((req) => (
                <Box
                  key={req.id}
                  p={3}
                  bg="var(--color-canvas-default)"
                  border="1px solid var(--color-border-subtle)"
                  borderRadius="8px"
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={2}
                >
                  <Box>
                    <Text fontWeight="bold" fontSize="14px" display="block">
                      {req.display_name || req.username}
                    </Text>
                    <DetailSubtitle style={{ fontSize: "12px" }}>
                      @{req.username}
                      {req.remote_domain ? `@${req.remote_domain}` : ""}
                    </DetailSubtitle>
                  </Box>
                  <Box display="flex" gap={2}>
                    <PrimaryButton
                      type="button"
                      disabled={processingRequestId === req.id}
                      onClick={() => void handleAcceptFollowRequest(req)}
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                    >
                      <CheckIcon size={14} />
                      Accept
                    </PrimaryButton>
                    <SecondaryButton
                      type="button"
                      disabled={processingRequestId === req.id}
                      onClick={() => void handleRejectFollowRequest(req)}
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                    >
                      Reject
                    </SecondaryButton>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* SECTION 3: Verified Profile Metadata (rel="me" & ORCID) */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <ShieldCheckIcon size={20} />
              <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
                Verified Profile Metadata (<code>rel="me"</code> &amp; ORCID)
              </DetailTitle>
            </Box>
            <Box display="flex" gap={1} flexWrap="wrap">
              {METADATA_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  disabled={profileFields.length >= 8}
                  onClick={() => {
                    if (profileFields.length >= 8) return;
                    setProfileFields((prev) => [...prev, { name: preset.name, value: "", verified_at: null }]);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    borderRadius: "999px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-default)",
                    color: "var(--color-text-primary)",
                    cursor: profileFields.length >= 8 ? "not-allowed" : "pointer",
                  }}
                >
                  + {preset.name}
                </button>
              ))}
            </Box>
          </Box>

          <DetailSubtitle style={{ display: "block", marginBottom: "12px", lineHeight: "1.5" }}>
            Add up to 8 metadata rows (such as <strong>ORCID</strong>, <strong>GitHub</strong>, <strong>Website</strong>
            , or <strong>Institution</strong>). Enter an ORCID iD (e.g. <code>0000-0002-1825-0097</code>) or place the{" "}
            <code>rel="me"</code> backlink below on your personal website to earn a green cryptographic{" "}
            <strong>Verified</strong> badge.
          </DetailSubtitle>

          <Box
            p={2}
            mb={3}
            bg="var(--color-canvas-default)"
            border="1px solid var(--color-border-subtle)"
            borderRadius="8px"
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            gap={2}
          >
            <code
              style={{
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                overflowX: "auto",
                whiteSpace: "nowrap",
              }}
            >
              {relMeSnippet}
            </code>
            <SecondaryButton
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(relMeSnippet).catch(() => {});
                setCopiedBacklink(true);
                setTimeout(() => setCopiedBacklink(false), 1800);
              }}
              style={{ padding: "4px 10px", fontSize: "12px", flexShrink: 0 }}
            >
              {copiedBacklink ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copiedBacklink ? "Copied" : "Copy Snippet"}
            </SecondaryButton>
          </Box>

          {verifyStatus && (
            <Box
              mb={3}
              p={3}
              borderRadius="8px"
              style={{
                background:
                  verifyStatus.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
                color: verifyStatus.type === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)",
                fontSize: "13px",
              }}
            >
              {verifyStatus.text}
            </Box>
          )}

          <Box display="flex" flexDirection="column" gap={2} mb={3}>
            {profileFields.map((field, index) => {
              const isVerified = Boolean(field.verified_at);
              return (
                <Box
                  key={index}
                  display="grid"
                  style={{
                    gridTemplateColumns: "minmax(120px, 1fr) minmax(200px, 2fr) auto auto",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <FormInput
                    placeholder="Label (e.g. ORCID)"
                    aria-label={`Metadata label ${index + 1}`}
                    value={field.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProfileFields((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, name: val } : item)),
                      );
                    }}
                    style={{ margin: 0, padding: "8px 12px", fontSize: "13px" }}
                  />
                  <FormInput
                    placeholder="0000-0002-1825-0097 or https://..."
                    aria-label={`Metadata value ${index + 1}`}
                    value={field.value}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProfileFields((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, value: val, verified_at: null } : item)),
                      );
                    }}
                    style={{ margin: 0, padding: "8px 12px", fontSize: "13px" }}
                  />
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: "999px",
                      background: isVerified ? "rgba(46, 160, 67, 0.16)" : "rgba(148, 163, 184, 0.12)",
                      color: isVerified ? "var(--color-success-fg, #3fb950)" : "var(--color-text-muted)",
                    }}
                  >
                    {isVerified ? (
                      <>
                        <CheckCircleIcon size={12} /> Verified
                      </>
                    ) : (
                      "Unverified"
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove metadata row ${index + 1}`}
                    onClick={() => setProfileFields((prev) => prev.filter((_, idx) => idx !== index))}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--color-border-default)",
                      borderRadius: "6px",
                      padding: "6px 10px",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    Remove
                  </button>
                </Box>
              );
            })}
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <SecondaryButton
              type="button"
              disabled={profileFields.length >= 8}
              onClick={() => setProfileFields((prev) => [...prev, { name: "", value: "", verified_at: null }])}
              style={{ padding: "6px 14px", fontSize: "13px" }}
            >
              + Add Metadata Row ({profileFields.length}/8)
            </SecondaryButton>
            <SaveButton type="button" disabled={verifyingFields} onClick={() => void handleSaveAndVerifyFields()}>
              {verifyingFields ? "Verifying Links..." : "Save & Verify Links"}
            </SaveButton>
          </Box>
        </Box>

        {/* SECTION 4: Blocked & Muted Accounts Management */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
              Blocked &amp; Muted Accounts Management
            </DetailTitle>
            {loadingSafetyLists && (
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Loading lists...</span>
            )}
          </Box>
          <DetailSubtitle style={{ display: "block", marginBottom: "14px" }}>
            Manage accounts you have blocked or muted across {brandName} and federated instances.
          </DetailSubtitle>

          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
            {/* Blocked Accounts Card */}
            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="10px"
            >
              <Text fontWeight="bold" fontSize="15px" display="block" mb={2}>
                Blocked Accounts ({blockedUsers.length})
              </Text>
              {blockedUsers.length === 0 ? (
                <DetailSubtitle style={{ display: "block", padding: "8px 0" }}>No blocked accounts.</DetailSubtitle>
              ) : (
                <Box display="flex" flexDirection="column" gap={2}>
                  {blockedUsers.map((u) => (
                    <Box
                      key={u.id || u.username}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      p={2}
                      style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
                    >
                      <Box>
                        <Text fontWeight="600" fontSize="13.5px" display="block">
                          {u.display_name || u.username}
                        </Text>
                        <DetailSubtitle style={{ fontSize: "12px" }}>
                          @{u.username}
                          {u.remote_domain ? `@${u.remote_domain}` : ""}
                        </DetailSubtitle>
                      </Box>
                      <SecondaryButton
                        type="button"
                        disabled={unblockingUsername === u.username}
                        onClick={() => void handleUnblockUser(u.username)}
                        style={{ padding: "4px 12px", fontSize: "12px" }}
                      >
                        {unblockingUsername === u.username ? "Unblocking..." : "Unblock"}
                      </SecondaryButton>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* Muted Accounts Card */}
            <Box
              p={3}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-subtle)"
              borderRadius="10px"
            >
              <Text fontWeight="bold" fontSize="15px" display="block" mb={2}>
                Muted Accounts ({mutedUsers.length})
              </Text>
              {mutedUsers.length === 0 ? (
                <DetailSubtitle style={{ display: "block", padding: "8px 0" }}>No muted accounts.</DetailSubtitle>
              ) : (
                <Box display="flex" flexDirection="column" gap={2}>
                  {mutedUsers.map((u) => (
                    <Box
                      key={u.id || u.username}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      p={2}
                      style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
                    >
                      <Box>
                        <Text fontWeight="600" fontSize="13.5px" display="block">
                          {u.display_name || u.username}
                        </Text>
                        <DetailSubtitle style={{ fontSize: "12px" }}>
                          @{u.username}
                          {u.remote_domain ? `@${u.remote_domain}` : ""}
                        </DetailSubtitle>
                      </Box>
                      <SecondaryButton
                        type="button"
                        disabled={unmutingUsername === u.username}
                        onClick={() => void handleUnmuteUser(u.username)}
                        style={{ padding: "4px 12px", fontSize: "12px" }}
                      >
                        {unmutingUsername === u.username ? "Unmuting..." : "Unmute"}
                      </SecondaryButton>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* SECTION 5: Social Graph Portability (CSV / JSON Export & Import) */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <GlobeIcon size={20} />
            <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
              Social Graph Portability (CSV / JSON Export &amp; Import)
            </DetailTitle>
          </Box>
          <DetailSubtitle style={{ display: "block", marginBottom: "14px", lineHeight: "1.5" }}>
            Export or import your Following, Blocks, and Mutes lists in Mastodon-compatible CSV or structured JSON
            format.
          </DetailSubtitle>

          <Box mb={3}>
            <FormLabel style={{ display: "block", marginBottom: "8px" }}>Export Social Graph Lists</FormLabel>
            <Box display="flex" flexWrap="wrap" gap={2}>
              {(["following", "blocks", "mutes"] as const).map((listType) => (
                <React.Fragment key={listType}>
                  <SecondaryButton
                    type="button"
                    disabled={exportingKey === `csv-${listType}`}
                    onClick={() => void handleExportGraph("csv", listType)}
                    style={{ padding: "6px 12px", fontSize: "12.5px", textTransform: "capitalize" }}
                  >
                    <DownloadIcon size={14} />
                    Export {listType} (CSV)
                  </SecondaryButton>
                  <SecondaryButton
                    type="button"
                    disabled={exportingKey === `json-${listType}`}
                    onClick={() => void handleExportGraph("json", listType)}
                    style={{ padding: "6px 12px", fontSize: "12.5px", textTransform: "capitalize" }}
                  >
                    <DownloadIcon size={14} />
                    Export {listType} (JSON)
                  </SecondaryButton>
                </React.Fragment>
              ))}
            </Box>
          </Box>

          <Box p={3} bg="var(--color-canvas-default)" border="1px solid var(--color-border-subtle)" borderRadius="10px">
            <Text fontWeight="bold" fontSize="14px" display="block" mb={2}>
              Import Social Graph (CSV Upload or Paste)
            </Text>

            {importResult && (
              <Box
                mb={3}
                p={2}
                borderRadius="6px"
                style={{
                  background:
                    importResult.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
                  color: importResult.type === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)",
                  fontSize: "13px",
                }}
              >
                {importResult.text}
              </Box>
            )}

            <Box display="flex" flexWrap="wrap" gap={3} mb={3}>
              <Box>
                <FormLabel style={{ marginBottom: "4px" }}>Target List</FormLabel>
                <select
                  aria-label="Target Social Graph List"
                  value={importType}
                  onChange={(e) => setImportType(e.target.value as "following" | "blocks" | "mutes")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="following">Following</option>
                  <option value="blocks">Blocked Accounts</option>
                  <option value="mutes">Muted Accounts</option>
                </select>
              </Box>

              <Box>
                <FormLabel style={{ marginBottom: "4px" }}>Import Mode</FormLabel>
                <select
                  aria-label="Social Graph Import Mode"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as "merge" | "overwrite")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="merge">Merge with existing list</option>
                  <option value="overwrite">Overwrite existing list</option>
                </select>
              </Box>

              <Box>
                <FormLabel style={{ marginBottom: "4px" }}>Upload CSV / JSON File</FormLabel>
                <input
                  type="file"
                  accept=".csv,.json,.txt"
                  onChange={handleImportFileChange}
                  style={{ fontSize: "12.5px", color: "var(--color-text-primary)" }}
                />
              </Box>
            </Box>

            <textarea
              aria-label="Social Graph CSV or JSON Content"
              placeholder={"Account address,Show boosts\nalice@ansatz.social,true\nbob@mastodon.social,true"}
              value={importCsvText}
              onChange={(e) => setImportCsvText(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12.5px",
                marginBottom: "10px",
              }}
            />

            <Box display="flex" justifyContent="flex-end">
              <PrimaryButton
                type="button"
                disabled={importingGraph}
                onClick={() => void handleImportGraph()}
                style={{ padding: "8px 16px", fontSize: "13px" }}
              >
                {importingGraph ? "Importing..." : "Import Social Graph"}
              </PrimaryButton>
            </Box>
          </Box>
        </Box>

        {/* SECTION 6: Federated Account Aliases & Migration (ActivityPub Move) */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <KeyIcon size={20} />
            <DetailTitle style={{ fontSize: "17px", fontWeight: "bold" }}>
              Federated Account Aliases &amp; Migration (<code>ActivityPub Move</code>)
            </DetailTitle>
          </Box>
          <DetailSubtitle style={{ display: "block", marginBottom: "12px", lineHeight: "1.5" }}>
            Configure <code>alsoKnownAs</code> actor URI aliases for bidirectional verification and broadcast an{" "}
            <code>ActivityPub Move</code> activity to migrate followers to another instance. Your actor URI is{" "}
            <a href={actorUrl} style={{ color: "var(--color-accent-fg, #58a6ff)", textDecoration: "underline" }}>
              <code>{actorUrl}</code>
            </a>
            .
          </DetailSubtitle>

          {federationStatus && (
            <Box
              mb={3}
              p={3}
              borderRadius="8px"
              style={{
                background:
                  federationStatus.type === "success" ? "var(--color-success-subtle)" : "var(--color-danger-subtle)",
                color: federationStatus.type === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)",
                fontSize: "13px",
              }}
            >
              {federationStatus.text}
            </Box>
          )}

          {privacy.moved_to_actor_url && (
            <Box
              mb={3}
              p={3}
              borderRadius="8px"
              style={{
                background: "rgba(210, 153, 34, 0.14)",
                border: "1px solid rgba(210, 153, 34, 0.4)",
                fontSize: "13px",
              }}
            >
              This account is currently marked as migrated to <code>{privacy.moved_to_actor_url}</code>.
            </Box>
          )}

          {/* Account Aliases (also_known_as) */}
          <Box
            p={3}
            mb={3}
            bg="var(--color-canvas-default)"
            border="1px solid var(--color-border-subtle)"
            borderRadius="10px"
          >
            <FormLabel style={{ marginBottom: "6px" }}>
              Account Aliases (<code>alsoKnownAs</code> Actor URIs)
            </FormLabel>
            <Box display="flex" gap={2} mb={2}>
              <FormInput
                placeholder="https://mastodon.social/users/your_handle"
                aria-label="New Account Alias Actor URI"
                value={newAliasInput}
                onChange={(e) => setNewAliasInput(e.target.value)}
                style={{ margin: 0, padding: "8px 12px", fontSize: "13px" }}
              />
              <SecondaryButton
                type="button"
                onClick={handleAddAlias}
                style={{ padding: "8px 14px", fontSize: "13px", flexShrink: 0 }}
              >
                Add Alias
              </SecondaryButton>
            </Box>

            {aliases.length > 0 && (
              <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
                {aliases.map((alias) => (
                  <span
                    key={alias}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "12px",
                      background: "var(--color-canvas-subtle)",
                      border: "1px solid var(--color-border-default)",
                    }}
                  >
                    <code>{alias}</code>
                    <button
                      type="button"
                      aria-label={`Remove alias ${alias}`}
                      onClick={() => setAliases((prev) => prev.filter((item) => item !== alias))}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--color-danger-fg)",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </Box>
            )}

            <Box display="flex" justifyContent="flex-end">
              <SaveButton type="button" disabled={savingAliases} onClick={() => void handleSaveAliases()}>
                {savingAliases ? "Saving Aliases..." : "Save Account Aliases"}
              </SaveButton>
            </Box>
          </Box>

          {/* Outbound Account Migration */}
          <Box p={3} bg="var(--color-canvas-default)" border="1px solid var(--color-border-subtle)" borderRadius="10px">
            <FormLabel style={{ marginBottom: "6px" }}>
              Outbound Account Migration (<code>ActivityPub Move</code>)
            </FormLabel>
            <DetailSubtitle style={{ display: "block", marginBottom: "10px" }}>
              Ensure your target account already lists <code>{actorUrl}</code> in its <code>alsoKnownAs</code> aliases
              before broadcasting a Move.
            </DetailSubtitle>
            <FormInput
              placeholder="https://new-instance.org/users/your_new_handle"
              aria-label="Target Actor URI for Migration"
              value={targetActorUrl}
              onChange={(e) => setTargetActorUrl(e.target.value)}
              style={{ marginTop: 0, marginBottom: "10px", padding: "8px 12px", fontSize: "13px" }}
            />
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                cursor: "pointer",
                marginBottom: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={confirmMoveUnderstand}
                onChange={(e) => setConfirmMoveUnderstand(e.target.checked)}
                style={{ marginTop: "3px", width: "16px", height: "16px", cursor: "pointer" }}
              />
              <span style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: "1.4" }}>
                I understand that broadcasting an <code>ActivityPub Move</code> will redirect my profile and instruct
                followers to migrate to the target actor URI.
              </span>
            </label>
            <Box display="flex" justifyContent="flex-end">
              <DangerButton
                type="button"
                disabled={migratingActor || !targetActorUrl.trim() || !confirmMoveUnderstand}
                onClick={() => void handleMigrateAccount()}
                style={{ padding: "8px 16px", fontSize: "13px" }}
              >
                {migratingActor ? "Broadcasting Move..." : "Broadcast Account Move"}
              </DangerButton>
            </Box>
          </Box>
        </Box>

        {/* SECTION 7: GDPR & CCPA Subject Rights Card */}
        <Box mb={4}>
          <DetailTitle style={{ fontSize: "18px", fontWeight: "bold", display: "block", marginBottom: "12px" }}>
            Your Rights Under GDPR &amp; CCPA
          </DetailTitle>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
            <Box
              p={4}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius="12px"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box color="var(--color-accent-fg)">
                    <DownloadIcon size={20} />
                  </Box>
                  <Text fontWeight="bold" fontSize="16px">
                    Data Portability
                  </Text>
                </Box>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
                  Download a complete, offline-browsable archive (.ZIP) of your models, posts, profile, compute ledger,
                  and activity history (GDPR Art. 20 / CCPA § 1798.100).
                </DetailSubtitle>
              </Box>
              <PrimaryButton type="button" onClick={() => navigateTab("dataArchive")}>
                <DownloadIcon size={16} />
                Download Data Archive
              </PrimaryButton>
            </Box>

            <Box
              p={4}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius="12px"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box color="var(--color-danger-fg)">
                    <TrashIcon size={20} />
                  </Box>
                  <Text fontWeight="bold" fontSize="16px">
                    Right to Erasure
                  </Text>
                </Box>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
                  Permanently anonymize or delete your account, authored content, credentials, and telemetry records
                  from our active databases (GDPR Art. 17 / CCPA § 1798.105).
                </DetailSubtitle>
              </Box>
              <DangerButton type="button" onClick={() => navigateTab("deleteAccount")}>
                <TrashIcon size={16} />
                Delete Account &amp; Data
              </DangerButton>
            </Box>
          </Box>
        </Box>

        {/* Data Processing & Compliance Architecture */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Box color="var(--color-success-fg)">
              <ShieldCheckIcon size={22} />
            </Box>
            <Text fontWeight="bold" fontSize="17px">
              First-Party Privacy Architecture
            </Text>
          </Box>
          <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.6", display: "block", marginBottom: "16px" }}>
            {brandName} is built around strict data minimization and user sovereignty:
          </DetailSubtitle>

          <Box display="flex" flexDirection="column" gap={3}>
            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Zero Third-Party Trackers
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  We do not load external analytics libraries (Google Analytics, Meta Pixel, Hotjar) or sell user data
                  to advertising brokers.
                </DetailSubtitle>
              </Box>
            </Box>

            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Scrubbed &amp; Ephemeral Geo-Metrics
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  To provide post creators with aggregated viewer geographic heatmaps, client IP addresses are resolved
                  to country/region ISO codes purely in-memory. Raw IP addresses are scrubbed immediately and never
                  saved to the database.
                </DetailSubtitle>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Policy Reference */}
        <Box
          p={3}
          bg="var(--color-canvas-default)"
          border="1px solid var(--color-border-subtle)"
          borderRadius="8px"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <Text fontWeight="600" fontSize="14px" display="block">
              Full Legal Documentation
            </Text>
            <DetailSubtitle style={{ fontSize: "13px" }}>
              Read our full terms and transparent data retention policy in the repository's PRIVACY.md.
            </DetailSubtitle>
          </Box>
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--color-accent-emphasis)",
              fontWeight: 600,
              fontSize: "14px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            View Privacy Policy &rarr;
          </a>
        </Box>
      </Box>
    </>
  );
};

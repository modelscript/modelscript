// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CodeIcon,
  CpuIcon,
  CreditCardIcon,
  DownloadIcon,
  FileCodeIcon,
  FilterIcon,
  GlobeIcon,
  HubotIcon,
  KeyIcon,
  PackageIcon,
  PaintbrushIcon,
  PersonIcon,
  PlusIcon,
  RepoIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
  SyncIcon,
  TrashIcon,
  UnmuteIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  addPublicKey,
  createBot,
  DEFAULT_NOTIFICATION_PREFERENCES,
  deleteAccount,
  deleteBot,
  downloadUserDataArchiveJob,
  exportUserDataArchive,
  getBots,
  getConnectedAccounts,
  getNotificationSettings,
  getPublicKeys,
  getUserBillingSummary,
  getUserDataArchiveStatus,
  getUserTopics,
  requestUserDataArchiveJob,
  revokeAllSessions,
  revokePublicKey,
  topUpCredits,
  unlinkConnectedAccount,
  updateAccount,
  updateNotificationSettings,
  updatePassword,
  updateUserTopic,
  type ArchiveJobInfo,
  type ConnectedAccount,
  type NotificationPreferences,
  type PublicKeyInfo,
  type UserBillingSummary,
} from "../api";
import { useAuth } from "../AuthContext";
import TwoFactorModal from "../components/auth/TwoFactorModal";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { useToast } from "../components/ToastContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useModelingPreferences } from "../ModelingPreferencesContext";
import { useTheme } from "../theme";
import { deletePrivateKey, getAllPrivateKeyIds, migrateLegacyKeys, savePrivateKey } from "../util/keystore";
import { usePageTitle } from "../util/title";

const SettingsContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - var(--dev-header-height, 0px));
`;

const MenuColumn = styled.div`
  flex: 0 0 350px;
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    flex: 1;
    display: ${(props: { $hideOnMobile: boolean }) => (props.$hideOnMobile ? "none" : "flex")};
    border-right: none;
  }
`;

const DetailColumn = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    display: ${(props: { $hideOnMobile: boolean }) => (props.$hideOnMobile ? "none" : "flex")};
  }
`;

const Header = styled.div`
  padding: 16px;
  font-size: 20px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky;
  top: 0;
  background-color: transparent;
  backdrop-filter: blur(12px);
  z-index: 10;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  font-size: 15px;

  &:focus {
    border-color: var(--color-accent-emphasis);
    background-color: var(--color-bg-primary);
  }
`;

const MenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.08)" : "transparent")};
  border: none;
  border-right: ${(props) => (props.$active ? "3px solid var(--color-accent-purple)" : "3px solid transparent")};
  cursor: pointer;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-secondary)")};

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
  }

  span {
    font-size: 15px;
    font-weight: ${(props) => (props.$active ? "600" : "500")};
  }
`;

const DetailItem = styled.div<{ $clickable?: boolean }>`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 16px;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  transition: background-color 0.2s;
  color: var(--color-text-primary);

  &:hover {
    background-color: ${(props) => (props.$clickable ? "var(--color-canvas-subtle)" : "transparent")};
  }
`;

const DetailIcon = styled.div`
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
`;

const DetailText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`;

const DetailTitle = styled.span`
  font-size: 15px;
  color: var(--color-text-primary);
`;

const DetailSubtitle = styled.span`
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: 2px;
`;

const SaveButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 16px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  align-self: flex-end;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.25);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PrimaryButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.25);
  transition: all 0.15s ease-in-out;
  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  background-color: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s ease-in-out;
  &:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: var(--color-border-hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DangerButton = styled.button`
  background-color: var(--color-danger-fg, #cf222e);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.15s ease-in-out;
  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const FormInput = styled.input`
  width: 100%;
  padding: 12px 16px;
  border-radius: 4px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-canvas-default);
  color: var(--color-text-primary);
  outline: none;
  font-size: 15px;
  margin-top: 8px;
  margin-bottom: 16px;
  &:focus {
    border-color: var(--color-accent-emphasis);
  }
`;

const FormLabel = styled.label`
  font-size: 15px;
  color: var(--color-text-primary);
  font-weight: bold;
`;

const Text = styled.span<{
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  display?: string;
  mb?: number | string;
}>`
  color: ${(props) => props.color || "inherit"};
  font-size: ${(props) => props.fontSize || "inherit"};
  font-weight: ${(props) => props.fontWeight || "inherit"};
  display: ${(props) => props.display || "inline"};
  margin-bottom: ${(props) => (typeof props.mb === "number" ? `${props.mb * 4}px` : props.mb || "0")};
`;

const BillingWalletCard = styled.div`
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(6, 182, 212, 0.1) 100%);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  margin-bottom: 24px;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const StatItem = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TopUpPillButton = styled.button`
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    background: var(--gradient-cta);
    color: #ffffff;
    border-color: transparent;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LedgerTable = styled.table`
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

const TxBadge = styled.span<{ $type: string }>`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  background: ${(props) =>
    props.$type === "initial_grant"
      ? "rgba(35, 134, 54, 0.2)"
      : props.$type === "topup"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(218, 54, 51, 0.2)"};
  color: ${(props) =>
    props.$type === "initial_grant" ? "#3fb950" : props.$type === "topup" ? "var(--color-accent-cyan)" : "#f85149"};
`;

type TabType =
  | "account"
  | "notifications"
  | "display"
  | "contentPreferences"
  | "other"
  | "accountInfo"
  | "changePassword"
  | "connectedAccounts"
  | "security"
  | "billing"
  | "bots"
  | "privacy"
  | "dataArchive"
  | "deleteAccount"
  | "notificationFilters"
  | "modelingPreferences";

const SettingsPage: React.FC = () => {
  const toast = useToast();
  const { tab: pathTab } = useParams<{ tab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const effectiveTab = (pathTab || searchParams.get("tab")) as TabType | null;
  const [activeTab, setActiveTab] = useState<TabType>(effectiveTab || "account");

  React.useEffect(() => {
    if (effectiveTab && effectiveTab !== activeTab) {
      setActiveTab(effectiveTab);
    }
  }, [effectiveTab, activeTab]);
  const [searchQuery, setSearchQuery] = useState("");
  const hasBilling = useFeatureFlag("billing_stripe_live");
  const hasBots = useFeatureFlag("bot_accounts");
  const [accountInfoMode, setAccountInfoMode] = useState<"password" | "form">("password");
  const [topics, setTopics] = useState<{ concept: string; is_active: boolean }[]>([]);
  const [publicKeys, setPublicKeys] = useState<PublicKeyInfo[]>([]);
  const [localKeyIds, setLocalKeyIds] = useState<Set<string>>(new Set());
  const [bots, setBots] = useState<any[]>([]);

  // Modeling Preferences Context
  const {
    preferences: modelingPrefs,
    updatePreferences: updateModelingPrefs,
    resetPreferences: resetModelingPrefs,
  } = useModelingPreferences();

  // Granular Notification Preferences state
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState<string | null>(null);

  // Connected Accounts state
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoadingConnected, setIsLoadingConnected] = useState(false);
  const [connectedSuccess, setConnectedSuccess] = useState<string | null>(null);
  const [connectedError, setConnectedError] = useState<string | null>(null);

  // Active session revocation state
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);

  // Billing states
  const [billingSummary, setBillingSummary] = useState<UserBillingSummary | null>(null);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);

  // Data Archive states
  const [archiveJob, setArchiveJob] = useState<ArchiveJobInfo | null>(null);
  const [isSubmittingArchiveJob, setIsSubmittingArchiveJob] = useState(false);
  const [isDownloadingFinishedArchive, setIsDownloadingFinishedArchive] = useState(false);
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Account Erasure states
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");
  const [deleteConsentUnderstood, setDeleteConsentUnderstood] = useState(false);
  const [deleteConsentBackedUp, setDeleteConsentBackedUp] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bot forms
  const [botUsername, setBotUsername] = useState("");
  const [botDisplayName, setBotDisplayName] = useState("");
  const [botBio, setBotBio] = useState("");
  const [botAvatarUrl, setBotAvatarUrl] = useState("");
  const [newBotToken, setNewBotToken] = useState<string | null>(null);

  // Form states
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { user, token, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  usePageTitle("Settings");

  const [qualityFilter, setQualityFilter] = useState(true);
  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [is2FAEnabled, setIs2FAEnabled] = useState(Boolean(user?.totp_enabled));
  const [sessionRevokeSuccess, setSessionRevokeSuccess] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(false);

  React.useEffect(() => {
    if (user) {
      setIs2FAEnabled(Boolean(user.totp_enabled));
    }
  }, [user]);

  // Fetch notification settings when opening that tab
  React.useEffect(() => {
    if (activeTab === "notificationFilters") {
      getNotificationSettings()
        .then((data) => {
          if (data) {
            setNotificationPrefs((prev) => ({
              ...prev,
              ...data,
              channels: { ...prev.channels, ...(data.channels || {}) },
              events: {
                social: { ...prev.events?.social, ...(data.events?.social || {}) },
                engineering: { ...prev.events?.engineering, ...(data.events?.engineering || {}) },
                computeHpc: { ...prev.events?.computeHpc, ...(data.events?.computeHpc || {}) },
              },
            }));
            if (typeof data.qualityFilter === "boolean") {
              setQualityFilter(data.qualityFilter);
            }
          }
        })
        .catch(() => {});
    }
    if (activeTab === "connectedAccounts") {
      setIsLoadingConnected(true);
      getConnectedAccounts()
        .then((res) => {
          if (res && Array.isArray(res.providers)) {
            setConnectedAccounts(res.providers);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingConnected(false));
    }
    if (activeTab === "contentPreferences") {
      getUserTopics()
        .then((data) => setTopics(data))
        .catch(() => {});
    }
    if (activeTab === "security") {
      getPublicKeys()
        .then((data) => setPublicKeys(data))
        .catch(() => {});
      migrateLegacyKeys()
        .then(() => getAllPrivateKeyIds())
        .then((ids) => setLocalKeyIds(new Set(ids)))
        .catch(() => {});
    }
    if (activeTab === "bots") {
      getBots()
        .then((data) => setBots(data))
        .catch(() => {});
    }
    if (activeTab === "billing") {
      getUserBillingSummary()
        .then((data) => setBillingSummary(data))
        .catch(() => {});
    }
    if (activeTab === "dataArchive") {
      getUserDataArchiveStatus()
        .then((job) => {
          if (job) setArchiveJob(job);
        })
        .catch(() => {});
    }
  }, [activeTab]);

  // Polling effect while archive job is queued or processing
  React.useEffect(() => {
    if (activeTab !== "dataArchive") return;
    if (!archiveJob || (archiveJob.status !== "queued" && archiveJob.status !== "processing")) return;

    const timer = setInterval(async () => {
      try {
        const updated = await getUserDataArchiveStatus(archiveJob.id);
        if (updated) {
          setArchiveJob(updated);
          if (updated.status === "completed") {
            setArchiveSuccess(
              `Your archive (${updated.format.toUpperCase()}) has been compiled and is ready for download!`,
            );
          } else if (updated.status === "failed") {
            setArchiveError(updated.error || "Archive compilation failed in worker pool.");
          }
        }
      } catch {}
    }, 2000);

    return () => clearInterval(timer);
  }, [activeTab, archiveJob]);

  // Reset states when changing tabs
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setError(null);
    setSuccess(null);
    if (tab === "accountInfo") {
      setAccountInfoMode(user?.has_password === false ? "form" : "password");
      setPasswordConfirm("");
      setUsername(user?.username || "");
      setEmail(user?.email || "");
      setDisplayName(user?.display_name || "");
      setAvatarUrl(user?.avatar_url || "");
      setBannerUrl(user?.banner_url || "");
    }
    if (tab === "changePassword") {
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    }
    if (tab === "billing") {
      getUserBillingSummary()
        .then((data) => setBillingSummary(data))
        .catch(() => {});
    }
    if (tab === "dataArchive") {
      setArchiveError(null);
      setArchiveSuccess(null);
      getUserDataArchiveStatus()
        .then((job) => {
          if (job) setArchiveJob(job);
        })
        .catch(() => {});
    }
    if (tab === "deleteAccount") {
      setDeleteConfirmUsername("");
      setDeleteConsentUnderstood(false);
      setDeleteConsentBackedUp(false);
      setDeleteError(null);
    }
  };

  const handleRequestArchiveJob = async (format: "zip" | "json" = "zip") => {
    setIsSubmittingArchiveJob(true);
    setArchiveError(null);
    setArchiveSuccess(null);
    try {
      const job = await requestUserDataArchiveJob(format);
      setArchiveJob(job);
      setArchiveSuccess(
        job.status === "completed"
          ? "Your archive is ready for download!"
          : `Archive request queued (Position #${job.queuePosition || 1}). Processing asynchronously in worker queue...`,
      );
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to enqueue archive job. Please try again.");
    } finally {
      setIsSubmittingArchiveJob(false);
    }
  };

  const handleDownloadCompletedArchive = async () => {
    if (!archiveJob) return;
    setIsDownloadingFinishedArchive(true);
    setArchiveError(null);
    try {
      const blob = await downloadUserDataArchiveJob(archiveJob.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelscript-archive-${user?.username || "user"}.${archiveJob.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to download completed archive.");
    } finally {
      setIsDownloadingFinishedArchive(false);
    }
  };

  const handleDownloadArchive = async (format: "zip" | "json" = "zip") => {
    setIsDownloadingArchive(true);
    setArchiveError(null);
    setArchiveSuccess(null);
    try {
      const blob = await exportUserDataArchive(format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        format === "zip"
          ? `modelscript-archive-${user?.username || "user"}.zip`
          : `modelscript-data-${user?.username || "user"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setArchiveSuccess(
        format === "zip"
          ? "Your archive has been downloaded successfully. Extract the ZIP and open index.html in any browser to inspect your data offline."
          : "Your data has been exported as JSON successfully.",
      );
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to download data archive. Please try again.");
    } finally {
      setIsDownloadingArchive(false);
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
      logout();
      window.location.href = "/";
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || "Failed to delete account. Please try again or contact support.");
      setIsDeletingAccount(false);
    }
  };

  const handleTopUp = async (amount: number) => {
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const res = await topUpCredits(amount);
      setTopUpSuccess(`Successfully topped up ${amount} credits! New balance: ${res.new_balance.toFixed(2)} cr`);
      const updated = await getUserBillingSummary();
      setBillingSummary(updated);
    } catch (err: any) {
      setError(err.response?.data?.error || "Top-up failed");
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const handlePasswordConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      // We do a dummy update without changing anything just to verify the password
      await updateAccount({ password: passwordConfirm });
      setAccountInfoMode("form");
    } catch (err: any) {
      setError(err.response?.data?.error || "Incorrect password");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAccount = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await updateAccount({
        password: passwordConfirm,
        username,
        email,
        display_name: displayName || undefined,
        avatar_url: avatarUrl || undefined,
        banner_url: bannerUrl || undefined,
      });
      setSuccess("Account updated successfully! Please refresh to see all changes.");
    } catch (err: any) {
      setError(err.response?.data?.error || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await updatePassword({
        oldPassword: user?.has_password === false ? undefined : oldPassword,
        newPassword,
      });
      if (res?.token) {
        localStorage.setItem("modelscript-auth-token", res.token);
      }
      setSuccess(
        user?.has_password === false
          ? "Password established successfully! You can now sign in with your email directly."
          : "Password changed successfully! All other active sessions have been invalidated.",
      );
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Password update failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    setIsRevokingSessions(true);
    try {
      const res = await revokeAllSessions();
      if (res?.token) {
        localStorage.setItem("modelscript-auth-token", res.token);
      }
      toast.success("All other active sessions have been revoked.");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to revoke sessions.");
    } finally {
      setIsRevokingSessions(false);
    }
  };

  return (
    <SettingsContainer>
      <MenuColumn
        $hideOnMobile={
          activeTab !== "account" &&
          activeTab !== "notifications" &&
          activeTab !== "display" &&
          activeTab !== "contentPreferences" &&
          activeTab !== "modelingPreferences" &&
          activeTab !== "other"
        }
      >
        <Header>Settings</Header>
        <Box p={3}>
          <SearchInput
            placeholder="Search Settings"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Box>
        {(() => {
          const menuList = [
            {
              id: "account",
              label: "Your account",
              tab: "account" as TabType,
              keywords: "username email password profile credentials",
              isActive: activeTab === "account" || activeTab === "accountInfo" || activeTab === "changePassword",
            },
            {
              id: "security",
              label: "Security and account access",
              tab: "security" as TabType,
              keywords: "2fa security access keys ssh token sessions",
              isActive: activeTab === "security",
            },
            ...(hasBilling
              ? [
                  {
                    id: "billing",
                    label: "Billing & Compute Quotas",
                    tab: "billing" as TabType,
                    keywords: "billing quota compute invoice payment usage",
                    isActive: activeTab === "billing",
                  },
                ]
              : []),
            ...(hasBots
              ? [
                  {
                    id: "bots",
                    label: "Developer / Bots",
                    tab: "bots" as TabType,
                    keywords: "bots developer tokens webhook agents",
                    isActive: activeTab === "bots",
                  },
                ]
              : []),
            {
              id: "privacy",
              label: "Privacy & Data Protection",
              tab: "privacy" as TabType,
              keywords: "privacy safety gdpr ccpa data export archive delete erasure protection tracking cookies",
              isActive: activeTab === "privacy" || activeTab === "dataArchive" || activeTab === "deleteAccount",
            },
            {
              id: "notifications",
              label: "Notifications",
              tab: "notifications" as TabType,
              keywords: "notifications alerts email push filters mentions frequency digest",
              isActive: activeTab === "notifications" || activeTab === "notificationFilters",
            },
            {
              id: "contentPreferences",
              label: "Content preferences",
              tab: "contentPreferences" as TabType,
              keywords: "content preferences topics feed interests recommendations",
              isActive: activeTab === "contentPreferences",
            },
            {
              id: "modelingPreferences",
              label: "Modeling & Simulation",
              tab: "modelingPreferences" as TabType,
              keywords: "modeling simulation monaco editor compiler flattener solver cvode wasm tolerance",
              isActive: activeTab === "modelingPreferences",
            },
            {
              id: "display",
              label: "Accessibility, display, and languages",
              tab: "display" as TabType,
              keywords: "display accessibility theme dark light language font",
              isActive: activeTab === "display",
            },
            ...(isAdmin
              ? [
                  {
                    id: "admin",
                    label: "Instance Administration",
                    tab: "account" as TabType,
                    keywords: "admin instance moderation federation dmca audit database migrations",
                    isActive: false,
                    onClick: () => navigate("/admin"),
                  },
                ]
              : []),
            {
              id: "resources",
              label: "Help & Resources",
              tab: "other" as TabType,
              keywords: "resources help support docs terms shortcuts keyboard guide",
              isActive: activeTab === "other",
            },
          ];

          const filtered = menuList.filter((item) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return item.label.toLowerCase().includes(q) || item.keywords.includes(q);
          });

          if (filtered.length === 0) {
            return (
              <Box p={3} textAlign="center" color="var(--color-fg-muted)">
                No settings found matching &ldquo;{searchQuery}&rdquo;
              </Box>
            );
          }

          return filtered.map((item) => (
            <MenuItem
              key={item.id}
              $active={item.isActive}
              onClick={() => (item.onClick ? item.onClick() : handleTabChange(item.tab))}
            >
              <span>{item.label}</span>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </MenuItem>
          ));
        })()}
      </MenuColumn>

      <DetailColumn
        $hideOnMobile={
          activeTab === "account" ||
          activeTab === "notifications" ||
          activeTab === "display" ||
          activeTab === "contentPreferences" ||
          activeTab === "modelingPreferences" ||
          activeTab === "other" ||
          activeTab === "notificationFilters"
        }
      >
        {activeTab === "account" && (
          <>
            <Header>Your Account</Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
                See information about your account, download an archive of your data, or learn about your account
                deactivation options.
              </DetailSubtitle>
            </Box>
            <DetailItem $clickable onClick={() => handleTabChange("accountInfo")}>
              <DetailIcon>
                <PersonIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Account information</DetailTitle>
                <DetailSubtitle>See your account information like your email address and username.</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            <DetailItem $clickable onClick={() => handleTabChange("changePassword")}>
              <DetailIcon>
                <KeyIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Change your password</DetailTitle>
                <DetailSubtitle>Change your password at any time.</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            <DetailItem $clickable onClick={() => handleTabChange("connectedAccounts")}>
              <DetailIcon>
                <GlobeIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Connected accounts</DetailTitle>
                <DetailSubtitle>Manage the external accounts connected to ModelScript.</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            <DetailItem $clickable onClick={() => handleTabChange("dataArchive")}>
              <DetailIcon>
                <DownloadIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Download an archive of your data</DetailTitle>
                <DetailSubtitle>
                  Get an interactive ZIP archive and offline HTML viewer of your personal data.
                </DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            <DetailItem $clickable onClick={() => handleTabChange("deleteAccount")}>
              <DetailIcon>
                <TrashIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Deactivate or delete your account</DetailTitle>
                <DetailSubtitle>
                  Permanently erase your account and personal data (GDPR Art. 17 / CCPA § 1798.105).
                </DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            {isAdmin && (
              <DetailItem $clickable onClick={() => navigate("/admin")}>
                <DetailIcon>
                  <ShieldLockIcon size={20} fill="var(--color-accent-purple)" />
                </DetailIcon>
                <DetailText>
                  <DetailTitle>Instance Administration Console</DetailTitle>
                  <DetailSubtitle>
                    Manage moderation queue, federation domains, DMCA takedowns, audit logs, and database migrations.
                  </DetailSubtitle>
                </DetailText>
                <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
              </DetailItem>
            )}
          </>
        )}

        {activeTab === "notifications" && (
          <>
            <Header>Notifications</Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
                Select the kinds of notifications you get about your activities, interests, and recommendations.
              </DetailSubtitle>
            </Box>
            <DetailItem $clickable onClick={() => handleTabChange("notificationFilters")}>
              <DetailIcon>
                <FilterIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Filters</DetailTitle>
                <DetailSubtitle>Choose the notifications you'd like to see — and those you don't.</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
          </>
        )}

        {activeTab === "display" && (
          <>
            <Header>Accessibility, display, and languages</Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
                Manage how ModelScript content is displayed to you and select your preferred language.
              </DetailSubtitle>
            </Box>
            <DetailItem $clickable onClick={toggleTheme}>
              <DetailIcon>
                <PaintbrushIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Theme</DetailTitle>
                <DetailSubtitle>Toggle light or dark mode. Current: {theme}</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
            <DetailItem $clickable>
              <DetailIcon>
                <GlobeIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Language</DetailTitle>
                <DetailSubtitle>English (Only English is supported for now)</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
          </>
        )}

        {activeTab === "contentPreferences" && (
          <>
            <Header>Content preferences</Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
                We dynamically discover topics you might be interested in. Uncheck the ones you no longer want to see.
                This helps us personalize your feed.
              </DetailSubtitle>
            </Box>
            <Box p={4}>
              {topics.length === 0 ? (
                <DetailSubtitle>
                  No topics discovered yet. Keep interacting with posts to get recommendations!
                </DetailSubtitle>
              ) : (
                topics.map((t) => (
                  <Box key={t.concept} display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Box>
                      <FormLabel style={{ display: "block", textTransform: "capitalize" }}>{t.concept}</FormLabel>
                      <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                        Derived from your interactions and network.
                      </DetailSubtitle>
                    </Box>
                    <input
                      type="checkbox"
                      checked={t.is_active}
                      onChange={async (e) => {
                        const val = e.target.checked;
                        setTopics(topics.map((top) => (top.concept === t.concept ? { ...top, is_active: val } : top)));
                        try {
                          await updateUserTopic(t.concept, val);
                        } catch (err) {}
                      }}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </Box>
                ))
              )}
            </Box>
          </>
        )}

        {activeTab === "accountInfo" && (
          <>
            <Header>
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                sx={{ cursor: "pointer" }}
                onClick={() => handleTabChange("account")}
              >
                <ArrowLeftIcon size={20} />
                <span>Account information</span>
              </Box>
            </Header>
            {accountInfoMode === "password" ? (
              <Box p={4}>
                <h2 style={{ margin: "0 0 16px 0", fontSize: "24px" }}>Confirm your password</h2>
                <p style={{ color: "var(--color-text-muted)", marginBottom: "24px" }}>
                  Please enter your password in order to get this.
                </p>
                {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}
                <FormInput
                  type="password"
                  placeholder="Password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
                <Box display="flex" justifyContent="flex-end" mt={2}>
                  <SaveButton onClick={handlePasswordConfirm} disabled={loading || !passwordConfirm}>
                    {loading ? "Confirming..." : "Confirm"}
                  </SaveButton>
                </Box>
              </Box>
            ) : (
              <Box p={4}>
                {success && (
                  <p style={{ color: "var(--color-success)", marginBottom: "16px", fontWeight: "bold" }}>{success}</p>
                )}
                {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}

                <FormLabel>Username</FormLabel>
                <FormInput value={username} onChange={(e) => setUsername(e.target.value)} />

                <FormLabel>Display Name</FormLabel>
                <FormInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

                <FormLabel>Email</FormLabel>
                <FormInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

                <FormLabel>Avatar URL</FormLabel>
                <FormInput
                  type="url"
                  placeholder="https://example.com/avatar.png"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                />

                <FormLabel>Banner URL</FormLabel>
                <FormInput
                  type="url"
                  placeholder="https://example.com/banner.png"
                  value={bannerUrl}
                  onChange={(e) => setBannerUrl(e.target.value)}
                />

                <Box display="flex" justifyContent="flex-end" mt={2}>
                  <SaveButton onClick={handleUpdateAccount} disabled={loading}>
                    {loading ? "Saving..." : "Save"}
                  </SaveButton>
                </Box>
              </Box>
            )}
          </>
        )}

        {activeTab === "changePassword" && (
          <>
            <Header>
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                sx={{ cursor: "pointer" }}
                onClick={() => handleTabChange("account")}
              >
                <ArrowLeftIcon size={20} />
                <span>{user?.has_password === false ? "Set account password" : "Change your password"}</span>
              </Box>
            </Header>
            <Box p={4}>
              {user?.has_password === false && (
                <div
                  style={{
                    background: "rgba(6, 182, 212, 0.12)",
                    border: "1px solid rgba(6, 182, 212, 0.35)",
                    color: "var(--color-accent-cyan)",
                    padding: "12px 16px",
                    borderRadius: "var(--radius-md, 8px)",
                    fontSize: "13px",
                    marginBottom: "20px",
                    lineHeight: "1.4",
                  }}
                >
                  You signed in with an external identity provider (OAuth / Single Sign-On). Creating a password allows
                  you to log in directly with your email address as well as your social provider.
                </div>
              )}

              {success && (
                <p style={{ color: "var(--color-success)", marginBottom: "16px", fontWeight: "bold" }}>{success}</p>
              )}
              {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}

              {user?.has_password !== false && (
                <>
                  <FormLabel>Current Password</FormLabel>
                  <FormInput type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
                </>
              )}

              <FormLabel>New Password (min. 8 characters)</FormLabel>
              <FormInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />

              <FormLabel>Confirm New Password</FormLabel>
              <FormInput
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
              />

              <Box display="flex" justifyContent="flex-end" mt={2}>
                <SaveButton
                  onClick={handleChangePassword}
                  disabled={
                    loading || (user?.has_password !== false && !oldPassword) || !newPassword || !newPasswordConfirm
                  }
                >
                  {loading ? "Saving..." : user?.has_password === false ? "Set Password" : "Change Password"}
                </SaveButton>
              </Box>

              <Box
                mt={5}
                pt={4}
                style={{ borderTop: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))" }}
              >
                <h3 style={{ fontSize: "16px", margin: "0 0 6px 0", color: "var(--color-text-heading)" }}>
                  Active Sessions & Devices
                </h3>
                <p
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                    marginBottom: "16px",
                    lineHeight: "1.4",
                  }}
                >
                  Revoking all sessions immediately invalidates all JWT tokens across other browsers and mobile devices.
                  Your current session will remain active.
                </p>
                <DangerButton
                  type="button"
                  onClick={handleRevokeAllSessions}
                  disabled={isRevokingSessions}
                  style={{
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#ef4444",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {isRevokingSessions ? "Revoking sessions…" : "Revoke All Other Sessions"}
                </DangerButton>
              </Box>
            </Box>
          </>
        )}

        {activeTab === "connectedAccounts" && (
          <>
            <Header>
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                sx={{ cursor: "pointer" }}
                onClick={() => handleTabChange("account")}
              >
                <ArrowLeftIcon size={20} />
                <span>Connected accounts</span>
              </Box>
            </Header>
            <Box p={4}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "24px" }}>
                Manage external identities connected to your ModelScript profile for Single Sign-On (SSO) and verified
                developer badges.
              </DetailSubtitle>

              {connectedSuccess && (
                <Box mb={3} p={3} bg="var(--color-success-subtle)" color="var(--color-success-fg)" borderRadius="6px">
                  <Text fontSize="14px">{connectedSuccess}</Text>
                </Box>
              )}
              {connectedError && (
                <Box mb={3} p={3} bg="var(--color-danger-subtle)" color="var(--color-danger-fg)" borderRadius="6px">
                  <Text fontSize="14px">{connectedError}</Text>
                </Box>
              )}

              <Box display="flex" flexDirection="column" gap={3}>
                {[
                  {
                    id: "oidc",
                    name: "Enterprise Single Sign-On (OIDC)",
                    desc: "Authenticate via corporate identity providers (Keycloak, Okta, Microsoft Entra ID).",
                    icon: ShieldCheckIcon,
                    linkUrl: "/api/v1/auth/oidc/login",
                  },
                  {
                    id: "github",
                    name: "GitHub",
                    desc: "Link your GitHub developer profile to synchronize public SSH keys and git repositories.",
                    icon: RepoIcon,
                    linkUrl: "/api/v1/auth/link/github",
                  },
                  {
                    id: "gitlab",
                    name: "GitLab",
                    desc: "Link your GitLab account for enterprise git repository pipelines and webhooks.",
                    icon: CodeIcon,
                    linkUrl: "/api/v1/auth/link/gitlab",
                  },
                  {
                    id: "twitter",
                    name: "X (Twitter)",
                    desc: "Verify your public engineering identity and earn the 'Verified on X' badge on your profile.",
                    icon: GlobeIcon,
                    linkUrl: `/api/v1/auth/link/twitter?token=${token || localStorage.getItem("modelscript-auth-token") || ""}`,
                  },
                ].map((prov) => {
                  const account = connectedAccounts.find((a) => a.provider.toLowerCase() === prov.id);
                  const isConnected = Boolean(account?.connected);
                  const Icon = prov.icon;

                  return (
                    <Box
                      key={prov.id}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      p={3}
                      style={{
                        border: "1px solid var(--color-border-default)",
                        borderRadius: "10px",
                        background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                      }}
                    >
                      <Box display="flex" alignItems="center" gap={3}>
                        <Box
                          p={2}
                          borderRadius="8px"
                          style={{
                            background: "rgba(139, 92, 246, 0.12)",
                            color: "var(--color-accent-purple, #a855f7)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon size={20} />
                        </Box>
                        <Box>
                          <Box display="flex" alignItems="center" gap={2}>
                            <FormLabel style={{ display: "inline-block", margin: 0 }}>{prov.name}</FormLabel>
                            {isConnected && (
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: "700",
                                  background: "rgba(16, 185, 129, 0.15)",
                                  color: "var(--color-status-verified, #10b981)",
                                  padding: "2px 8px",
                                  borderRadius: "12px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <CheckCircleIcon size={12} /> Connected
                              </span>
                            )}
                          </Box>
                          <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                            {isConnected && account?.identifier ? `Linked as: ${account.identifier}` : prov.desc}
                          </DetailSubtitle>
                        </Box>
                      </Box>

                      {isConnected ? (
                        <SecondaryButton
                          type="button"
                          style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "var(--color-danger-fg, #ef4444)" }}
                          onClick={async () => {
                            if (
                              confirm(
                                `Unlink ${prov.name}? You may need to reconnect it later to access linked features.`,
                              )
                            ) {
                              try {
                                await unlinkConnectedAccount(prov.id);
                                setConnectedAccounts((prev) =>
                                  prev.map((a) => (a.provider === prov.id ? { ...a, connected: false } : a)),
                                );
                                setConnectedSuccess(`Unlinked ${prov.name} successfully.`);
                              } catch {
                                setConnectedError(`Failed to unlink ${prov.name}.`);
                              }
                            }
                          }}
                        >
                          Disconnect
                        </SecondaryButton>
                      ) : (
                        <SaveButton
                          type="button"
                          onClick={() => {
                            window.location.href = prov.linkUrl;
                          }}
                        >
                          Connect Account
                        </SaveButton>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </>
        )}

        {activeTab === "security" && (
          <>
            <Header>Security and account access</Header>
            <Box px={3} pb={3}>
              {/* Two-Factor Authentication Section */}
              <Box
                p={3}
                mb={4}
                style={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "12px",
                  background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
                  <Box>
                    <Box display="flex" alignItems="center" gap={2} mb={1}>
                      <ShieldCheckIcon
                        size={20}
                        fill={is2FAEnabled ? "var(--color-success, #3fb950)" : "var(--color-text-muted)"}
                      />
                      <FormLabel style={{ fontSize: "16px", fontWeight: 700 }}>
                        Two-Factor Authentication (2FA)
                      </FormLabel>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "12px",
                          backgroundColor: is2FAEnabled ? "rgba(63, 185, 80, 0.15)" : "rgba(255, 255, 255, 0.08)",
                          color: is2FAEnabled ? "var(--color-success, #3fb950)" : "var(--color-text-muted)",
                          border: `1px solid ${is2FAEnabled ? "rgba(63, 185, 80, 0.4)" : "var(--color-border-default)"}`,
                        }}
                      >
                        {is2FAEnabled ? "Active & Protected" : "Not Configured"}
                      </span>
                    </Box>
                    <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block" }}>
                      Protect your ModelScript account with time-based one-time passwords (TOTP). Compatible with Google
                      Authenticator, 1Password, Authy, Apple Keychain, and hardware tokens.
                    </DetailSubtitle>
                  </Box>

                  <SaveButton
                    style={{
                      whiteSpace: "nowrap",
                      backgroundColor: is2FAEnabled
                        ? "var(--color-danger-emphasis, #cf222e)"
                        : "var(--color-accent-cyan, #06b6d4)",
                    }}
                    onClick={() => setIs2FAModalOpen(true)}
                  >
                    {is2FAEnabled ? "Disable 2FA" : "Enable 2FA"}
                  </SaveButton>
                </Box>
              </Box>

              {/* Active Sessions & Revocation Section */}
              <Box
                p={3}
                mb={4}
                style={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "12px",
                  background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
                  <Box>
                    <FormLabel style={{ fontSize: "16px", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                      Session Revocation & Device Invalidation
                    </FormLabel>
                    <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block" }}>
                      If you suspect unauthorized access or lost a signed-in device, invalidate all existing
                      authentication tokens across all browsers and devices immediately.
                    </DetailSubtitle>
                    {sessionRevokeSuccess && (
                      <DetailSubtitle
                        style={{
                          color: "var(--color-success, #3fb950)",
                          marginTop: "8px",
                          fontWeight: 600,
                          display: "block",
                        }}
                      >
                        ✓ All other active sessions have been successfully revoked.
                      </DetailSubtitle>
                    )}
                  </Box>

                  <SaveButton
                    style={{ whiteSpace: "nowrap", backgroundColor: "var(--color-danger-emphasis, #cf222e)" }}
                    disabled={sessionRevoking}
                    onClick={async () => {
                      if (
                        confirm(
                          "Are you sure you want to sign out of all other sessions? Other devices will be immediately logged out.",
                        )
                      ) {
                        setSessionRevoking(true);
                        try {
                          await revokeAllSessions();
                          setSessionRevokeSuccess(true);
                          toast.notify({
                            title: "Sessions Revoked",
                            message: "All other active sessions have been signed out.",
                            type: "success",
                          });
                          setTimeout(() => setSessionRevokeSuccess(false), 5000);
                        } catch (e) {
                          toast.notify({
                            title: "Revocation Failed",
                            message: (e as Error).message || "Failed to revoke sessions",
                            type: "error",
                          });
                        } finally {
                          setSessionRevoking(false);
                        }
                      }
                    }}
                  >
                    {sessionRevoking ? "Revoking…" : "Revoke All Other Sessions"}
                  </SaveButton>
                </Box>
              </Box>

              <FormLabel style={{ fontSize: "16px", fontWeight: 700, display: "block", marginBottom: "8px" }}>
                Authorized ActivityPub Federation Keys
              </FormLabel>
              <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.4", display: "block", marginBottom: "20px" }}>
                Manage your authorized devices and keys for ActivityPub federation. Private keys are securely generated
                and stored locally in this browser.
              </DetailSubtitle>

              <SaveButton
                onClick={async () => {
                  setLoading(true);
                  try {
                    const keyPair = await window.crypto.subtle.generateKey(
                      {
                        name: "RSASSA-PKCS1-v1_5",
                        modulusLength: 2048,
                        publicExponent: new Uint8Array([1, 0, 1]),
                        hash: "SHA-256",
                      },
                      true,
                      ["sign", "verify"],
                    );

                    // Export public key to PEM
                    const spki = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
                    const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

                    const deviceName = prompt("Enter a name for this device (e.g. Work Laptop):");
                    if (!deviceName) return;
                    const keyIdString = `key-${Date.now()}`;

                    await addPublicKey(keyIdString, pem, deviceName);

                    // Store non-extractable private key securely in IndexedDB keystore
                    await savePrivateKey(keyIdString, keyPair.privateKey);
                    const currentLocalIds = await getAllPrivateKeyIds();
                    setLocalKeyIds(new Set(currentLocalIds));

                    setPublicKeys(await getPublicKeys());
                  } catch (e) {
                    console.error(e);
                    setError("Failed to generate key");
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
              >
                {loading ? "Generating..." : "Generate New Device Key"}
              </SaveButton>

              <Box mt={4}>
                {publicKeys.map((k) => (
                  <Box
                    key={k.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={3}
                    mb={3}
                    style={{ border: "1px solid var(--color-border-default)", borderRadius: "8px" }}
                  >
                    <Box>
                      <FormLabel style={{ display: "block" }}>{k.device_name || "Unnamed Device"}</FormLabel>
                      <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                        Key ID: {k.key_id_string}
                      </DetailSubtitle>
                      <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                        Created: {new Date(k.created_at).toLocaleDateString()}
                      </DetailSubtitle>
                      {localKeyIds.has(k.key_id_string) && (
                        <DetailSubtitle style={{ display: "block", marginTop: "4px", color: "var(--color-success)" }}>
                          ✓ Private key present on this device
                        </DetailSubtitle>
                      )}
                    </Box>
                    <SaveButton
                      style={{ backgroundColor: "var(--color-danger-emphasis)" }}
                      onClick={async () => {
                        if (confirm("Revoke this key? It will be permanently removed from your authorized devices.")) {
                          await revokePublicKey(k.id);
                          await deletePrivateKey(k.key_id_string);
                          const currentLocalIds = await getAllPrivateKeyIds();
                          setLocalKeyIds(new Set(currentLocalIds));
                          setPublicKeys(await getPublicKeys());
                        }
                      }}
                    >
                      Revoke
                    </SaveButton>
                  </Box>
                ))}
              </Box>
            </Box>
          </>
        )}

        {activeTab === "notificationFilters" && (
          <>
            <Header>
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                sx={{ cursor: "pointer" }}
                onClick={() => handleTabChange("notifications")}
              >
                <ArrowLeftIcon size={20} />
                <span>Notification Preferences</span>
              </Box>
            </Header>
            <Box p={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
                Configure delivery channels, email digest frequency, and granular event filters for engineering models,
                social mentions, and high-performance computing solver jobs.
              </DetailSubtitle>

              {notificationSuccess && (
                <Box mb={3} p={3} bg="var(--color-success-subtle)" color="var(--color-success-fg)" borderRadius="6px">
                  <Text fontSize="14px">{notificationSuccess}</Text>
                </Box>
              )}

              {/* Quality Filter Card */}
              <Box
                p={3}
                mb={4}
                style={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "10px",
                  background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                }}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
              >
                <Box>
                  <FormLabel style={{ display: "block", margin: 0 }}>Quality filter</FormLabel>
                  <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                    Filter out lower-quality content and suspected bot interactions from your notifications stream.
                  </DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  checked={Boolean(notificationPrefs.qualityFilter)}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNotificationPrefs((p) => ({ ...p, qualityFilter: val }));
                  }}
                  style={{ width: "20px", height: "20px", cursor: "pointer" }}
                />
              </Box>

              {/* Delivery Channels */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Delivery Channels
                </DetailTitle>
                <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={3}>
                  <Box
                    p={3}
                    style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <MailIcon size={16} />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>Email Notifications</span>
                    </Box>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationPrefs.channels?.email)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setNotificationPrefs((p) => ({
                          ...p,
                          channels: { ...p.channels, email: val } as any,
                        }));
                      }}
                      style={{ width: "18px", height: "18px", cursor: "pointer" }}
                    />
                  </Box>

                  <Box
                    p={3}
                    style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <BroadcastIcon size={16} />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>Browser Push</span>
                    </Box>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationPrefs.channels?.browserPush)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setNotificationPrefs((p) => ({
                          ...p,
                          channels: { ...p.channels, browserPush: val } as any,
                        }));
                      }}
                      style={{ width: "18px", height: "18px", cursor: "pointer" }}
                    />
                  </Box>

                  <Box
                    p={3}
                    style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <UnmuteIcon size={16} />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>In-App Audio Alerts</span>
                    </Box>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationPrefs.inAppSounds)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setNotificationPrefs((p) => ({ ...p, inAppSounds: val }));
                      }}
                      style={{ width: "18px", height: "18px", cursor: "pointer" }}
                    />
                  </Box>
                </Box>
              </Box>

              {/* Social Events */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Social Events
                </DetailTitle>
                <Box
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {[
                    {
                      key: "mentions",
                      label: "Mentions",
                      desc: "Notify when someone @mentions you in a post or reply",
                    },
                    {
                      key: "replies",
                      label: "Replies",
                      desc: "Notify when someone replies to your authored models or posts",
                    },
                    { key: "follows", label: "Followers", desc: "Notify when a new engineer follows your profile" },
                    { key: "reposts", label: "Reposts", desc: "Notify when someone reposts or quotes your model" },
                  ].map((evt) => (
                    <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                      <Box>
                        <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                        <DetailSubtitle>{evt.desc}</DetailSubtitle>
                      </Box>
                      <input
                        type="checkbox"
                        checked={Boolean((notificationPrefs.events?.social as any)?.[evt.key])}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setNotificationPrefs((p) => ({
                            ...p,
                            events: {
                              ...p.events,
                              social: { ...p.events?.social, [evt.key]: val } as any,
                            } as any,
                          }));
                        }}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Engineering Artifacts & HPC Events */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Engineering Packages &amp; HPC Solver Alerts
                </DetailTitle>
                <Box
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {[
                    {
                      key: "packageUpdates",
                      category: "engineering",
                      label: "Package Releases",
                      desc: "Notify when subscribed @modelscript packages publish new versions",
                    },
                    {
                      key: "starredRepoCommits",
                      category: "engineering",
                      label: "Repository Activity",
                      desc: "Notify on new git commits and releases in starred repositories",
                    },
                    {
                      key: "federatedMentions",
                      category: "engineering",
                      label: "Fediverse Mentions",
                      desc: "Notify when remote ActivityPub actors mention your handle",
                    },
                    {
                      key: "jobCompleted",
                      category: "computeHpc",
                      label: "HPC Job Finished",
                      desc: "Alert when cloud SLURM / Local solver simulations finish execution",
                    },
                    {
                      key: "jobFailed",
                      category: "computeHpc",
                      label: "Solver Failure / Divergence",
                      desc: "Immediate alert if a differential-algebraic solver step fails",
                    },
                    {
                      key: "quotaThresholdAlert",
                      category: "computeHpc",
                      label: "Low Balance Warning",
                      desc: "Alert when compute wallet balance falls below 20 credits",
                    },
                  ].map((evt) => (
                    <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                      <Box>
                        <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                        <DetailSubtitle>{evt.desc}</DetailSubtitle>
                      </Box>
                      <input
                        type="checkbox"
                        checked={Boolean(((notificationPrefs.events as any)?.[evt.category] as any)?.[evt.key])}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setNotificationPrefs((p) => ({
                            ...p,
                            events: {
                              ...p.events,
                              [evt.category]: {
                                ...((p.events as any)?.[evt.category] || {}),
                                [evt.key]: val,
                              },
                            } as any,
                          }));
                        }}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Email Digest Frequency */}
              <Box mb={4}>
                <FormLabel style={{ display: "block", marginBottom: "6px" }}>Email Digest Frequency</FormLabel>
                <select
                  value={notificationPrefs.emailDigestFrequency || "daily"}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setNotificationPrefs((p) => ({ ...p, emailDigestFrequency: val }));
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-default)",
                    color: "var(--color-text-primary)",
                    fontSize: "14px",
                    width: "100%",
                    maxWidth: "320px",
                  }}
                >
                  <option value="instant">Instant Delivery (As events occur)</option>
                  <option value="daily">Daily Digest (Morning rollup)</option>
                  <option value="weekly">Weekly Summary (Mondays)</option>
                  <option value="never">Never (Mute email notifications)</option>
                </select>
              </Box>

              <Box display="flex" justifyContent="flex-end" mt={4}>
                <SaveButton
                  disabled={isSavingNotifications}
                  onClick={async () => {
                    setIsSavingNotifications(true);
                    setNotificationSuccess(null);
                    try {
                      await updateNotificationSettings(notificationPrefs);
                      setNotificationSuccess("Notification preferences saved successfully!");
                    } catch {
                      // Handled
                    } finally {
                      setIsSavingNotifications(false);
                    }
                  }}
                >
                  {isSavingNotifications ? "Saving..." : "Save Preferences"}
                </SaveButton>
              </Box>
            </Box>
          </>
        )}

        {activeTab === "other" && (
          <>
            <Header>Help &amp; Additional Resources</Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
                Explore comprehensive documentation, learn editor keyboard shortcuts, check federation status, and view
                open-source licensing terms.
              </DetailSubtitle>

              {/* Shortcuts Banner */}
              <Box
                mb={4}
                p={4}
                style={{
                  background: "var(--gradient-cta, linear-gradient(135deg, #8b5cf6, #06b6d4))",
                  borderRadius: "12px",
                  color: "white",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "16px",
                }}
              >
                <Box>
                  <span style={{ fontSize: "18px", fontWeight: "800", display: "block" }}>
                    ⌨️ Boost Productivity with Keyboard Shortcuts
                  </span>
                  <span style={{ fontSize: "13px", opacity: 0.9, marginTop: "4px", display: "block" }}>
                    Navigate feeds, publish simulations, and format code with speed. Press{" "}
                    <kbd style={{ background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>?</kbd>{" "}
                    anytime to open the cheat sheet.
                  </span>
                </Box>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-shortcuts-modal"))}
                  style={{
                    background: "white",
                    color: "#6b21a8",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontWeight: "700",
                    fontSize: "14px",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  }}
                >
                  View Shortcuts (Press ?)
                </button>
              </Box>

              {/* Documentation & Specifications Grid */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Engineering Documentation &amp; Standards
                </DetailTitle>
                <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
                  {[
                    {
                      title: "ModelScript Language Reference",
                      desc: "Complete syntax guide for .msx and .mo Modelica models, physical connectors, and equation systems.",
                      link: "/packages",
                    },
                    {
                      title: "Modelica 3.5 Specification",
                      desc: "Official language specification for multi-domain equation-based physical modeling.",
                      link: "https://modelica.org/documents/ModelicaSpec35.pdf",
                      external: true,
                    },
                    {
                      title: "KerML & SysML v2 Interoperability",
                      desc: "Systems engineering ontology querying, KerML snapshot library, and metamodel verification.",
                      link: "/packages",
                    },
                    {
                      title: "FMI 2.0 & 3.0 Co-Simulation Toolkit",
                      desc: "Functional Mock-up Interface export, master algorithm orchestration, and SSP container tooling.",
                      link: "/packages",
                    },
                  ].map((doc, idx) => (
                    <Box
                      key={idx}
                      p={3}
                      style={{
                        border: "1px solid var(--color-border-default)",
                        borderRadius: "10px",
                        background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: "700",
                          display: "block",
                          color: "var(--color-accent-purple, #a855f7)",
                        }}
                      >
                        {doc.title}
                      </span>
                      <DetailSubtitle style={{ display: "block", margin: "6px 0 12px 0", lineHeight: "1.4" }}>
                        {doc.desc}
                      </DetailSubtitle>
                      <a
                        href={doc.link}
                        target={doc.external ? "_blank" : undefined}
                        rel="noreferrer"
                        style={{
                          fontSize: "13px",
                          fontWeight: "600",
                          color: "var(--color-accent-cyan, #06b6d4)",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        Read Documentation &rarr;
                      </a>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* System & Federation Status */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Instance Telemetry &amp; Protocol Compliance
                </DetailTitle>
                <Box
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                  }}
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <Box display="flex" justifyContent="space-between" py={1}>
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Hub Instance Node</span>
                    <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: "600" }}>
                      hub.modelscript.org
                    </span>
                  </Box>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    py={1}
                    style={{ borderTop: "1px solid var(--color-border-subtle)" }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>ActivityPub Protocol</span>
                    <span style={{ fontSize: "13px", color: "#3fb950", fontWeight: "600" }}>
                      RFC 9421 &amp; FEP-521a Ed25519 Active
                    </span>
                  </Box>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    py={1}
                    style={{ borderTop: "1px solid var(--color-border-subtle)" }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>HPC / SLURM Gateway</span>
                    <span style={{ fontSize: "13px", color: "#3fb950", fontWeight: "600" }}>
                      Connected &amp; Metered
                    </span>
                  </Box>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    py={1}
                    style={{ borderTop: "1px solid var(--color-border-subtle)" }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Software License</span>
                    <span style={{ fontSize: "13px", fontWeight: "600" }}>GNU AGPL-3.0 (Copyleft)</span>
                  </Box>
                </Box>
              </Box>
            </Box>
          </>
        )}

        {activeTab === "privacy" && (
          <>
            <Header>
              <CircleIconButton onClick={() => handleTabChange("account")} style={{ marginRight: "8px" }}>
                <ArrowLeftIcon size={20} />
              </CircleIconButton>
              Privacy &amp; Data Protection
            </Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
                Manage your personal data, exercise your privacy rights under GDPR and CCPA, and review how ModelScript
                safeguards your data with zero third-party tracking.
              </DetailSubtitle>

              {/* GDPR & CCPA Subject Rights Card */}
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
                      <DetailSubtitle
                        style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}
                      >
                        Download a complete, offline-browsable archive (.ZIP) of your models, posts, profile, compute
                        ledger, and activity history (GDPR Art. 20 / CCPA § 1798.100).
                      </DetailSubtitle>
                    </Box>
                    <PrimaryButton type="button" onClick={() => handleTabChange("dataArchive")}>
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
                      <DetailSubtitle
                        style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}
                      >
                        Permanently anonymize or delete your account, authored content, credentials, and telemetry
                        records from our active databases (GDPR Art. 17 / CCPA § 1798.105).
                      </DetailSubtitle>
                    </Box>
                    <DangerButton type="button" onClick={() => handleTabChange("deleteAccount")}>
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
                  ModelScript is built around strict data minimization and user sovereignty:
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
                        We do not load external analytics libraries (Google Analytics, Meta Pixel, Hotjar) or sell user
                        data to advertising brokers.
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
                        To provide post creators with aggregated viewer geographic heatmaps, client IP addresses are
                        resolved to country/region ISO codes purely in-memory. Raw IP addresses are scrubbed immediately
                        and never saved to the database.
                      </DetailSubtitle>
                    </Box>
                  </Box>

                  <Box display="flex" gap={3}>
                    <Box color="var(--color-accent-fg)" mt={1}>
                      <CheckCircleIcon size={18} />
                    </Box>
                    <Box>
                      <Text fontWeight="600" fontSize="14px" display="block">
                        Automated 30-Day Log Rotation
                      </Text>
                      <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                        Security audit events, authentication attempts, and operational server logs are kept for a
                        maximum of 30 days, after which they are systematically purged by automated background routines.
                      </DetailSubtitle>
                    </Box>
                  </Box>

                  <Box display="flex" gap={3}>
                    <Box color="var(--color-accent-fg)" mt={1}>
                      <CheckCircleIcon size={18} />
                    </Box>
                    <Box>
                      <Text fontWeight="600" fontSize="14px" display="block">
                        Self-Contained Data Archives
                      </Text>
                      <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                        Exported archives contain a standalone HTML viewer with zero external CDN dependencies, ensuring
                        your historical data can be inspected completely offline for decades.
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
                  href="/PRIVACY.md"
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
        )}

        {activeTab === "dataArchive" && (
          <>
            <Header>
              <CircleIconButton onClick={() => handleTabChange("privacy")} style={{ marginRight: "8px" }}>
                <ArrowLeftIcon size={20} />
              </CircleIconButton>
              Download Your Data Archive
            </Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
                Request an archive of your ModelScript data under GDPR Article 20 (Right to Data Portability) and CCPA §
                1798.100. Your archive is compiled directly in real-time.
              </DetailSubtitle>

              {archiveSuccess && (
                <Box
                  mb={4}
                  p={3}
                  bg="var(--color-success-subtle)"
                  color="var(--color-success-fg)"
                  borderRadius="8px"
                  display="flex"
                  gap={2}
                  alignItems="flex-start"
                >
                  <CheckCircleIcon size={20} style={{ marginTop: "2px", flexShrink: 0 }} />
                  <Box>
                    <Text fontWeight="bold" display="block" mb={1}>
                      Download Complete!
                    </Text>
                    <Text fontSize="14px" display="block">
                      {archiveSuccess}
                    </Text>
                  </Box>
                </Box>
              )}

              {archiveError && (
                <Box
                  mb={4}
                  p={3}
                  bg="var(--color-danger-subtle)"
                  color="var(--color-danger-fg)"
                  borderRadius="8px"
                  display="flex"
                  gap={2}
                  alignItems="flex-start"
                >
                  <AlertIcon size={20} style={{ marginTop: "2px", flexShrink: 0 }} />
                  <Text fontSize="14px">{archiveError}</Text>
                </Box>
              )}

              {/* What's in the Archive Card */}
              <Box
                mb={4}
                p={4}
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-default)"
                borderRadius="12px"
              >
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <PackageIcon size={20} />
                  <Text fontWeight="bold" fontSize="16px">
                    What's Included in Your Archive
                  </Text>
                </Box>
                <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
                  Similar to Twitter/X, your data is packaged with both a self-contained local viewer and raw JSON
                  files:
                </DetailSubtitle>

                <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={3}>
                  <Box
                    p={3}
                    bg="var(--color-canvas-default)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="8px"
                  >
                    <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                      index.html (Local Viewer)
                    </Text>
                    <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                      Open in any browser offline. View your profile, social posts, models, compute billing ledger, and
                      security logs with search &amp; dark mode.
                    </DetailSubtitle>
                  </Box>

                  <Box
                    p={3}
                    bg="var(--color-canvas-default)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="8px"
                  >
                    <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                      profile.json &amp; manifest.json
                    </Text>
                    <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                      Account credentials summary, public SSH keys, verification status, SHA-256 archive checksums, and
                      export timestamps.
                    </DetailSubtitle>
                  </Box>

                  <Box
                    p={3}
                    bg="var(--color-canvas-default)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="8px"
                  >
                    <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                      posts.json &amp; libraries.json
                    </Text>
                    <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                      Authored social posts, comments, models, packages, and simulation scripts.
                    </DetailSubtitle>
                  </Box>

                  <Box
                    p={3}
                    bg="var(--color-canvas-default)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="8px"
                  >
                    <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                      billing.json &amp; compliance.json
                    </Text>
                    <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                      Transaction receipts, credit top-ups, compute consumption, and GDPR Art. 20 legal compliance
                      certificates.
                    </DetailSubtitle>
                  </Box>
                </Box>
              </Box>

              {/* Active / In-Progress Job Card */}
              {archiveJob && (archiveJob.status === "queued" || archiveJob.status === "processing") && (
                <Box
                  mb={4}
                  p={4}
                  bg="rgba(139, 92, 246, 0.08)"
                  border="1px solid rgba(139, 92, 246, 0.3)"
                  borderRadius="12px"
                  display="flex"
                  gap={3}
                  alignItems="flex-start"
                >
                  <Box mt={1} color="var(--color-accent-cyan)">
                    <SyncIcon size={24} style={{ animation: "rotate 1.5s linear infinite" }} />
                  </Box>
                  <Box flex={1}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Text fontWeight="bold" fontSize="16px">
                        {archiveJob.status === "queued"
                          ? `Archive Queued (Position #${archiveJob.queuePosition || 1}${archiveJob.concurrency ? ` • Concurrency: ${archiveJob.concurrency}` : ""})`
                          : `Compiling Data Archive in Background Worker...`}
                      </Text>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          backgroundColor: "rgba(6, 182, 212, 0.15)",
                          color: "var(--color-accent-cyan)",
                        }}
                      >
                        {archiveJob.status}
                      </span>
                    </Box>
                    <DetailSubtitle
                      style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "12px" }}
                    >
                      {archiveJob.status === "queued"
                        ? `Your archive request has been placed in the worker queue. It will begin compiling automatically once a worker slot opens up (pool concurrency limit: ${archiveJob.concurrency || 2} jobs to prevent server memory pressure).`
                        : `Background worker is compiling your models, posts, and compute ledger into a self-contained offline package (processing in concurrency-controlled worker pool of ${archiveJob.concurrency || 2}). You can stay on this page or leave and return anytime.`}
                    </DetailSubtitle>
                    <Box display="flex" gap={3} flexWrap="wrap" fontSize="12px" color="var(--color-text-muted)">
                      <span>
                        Format: <strong>{archiveJob.format.toUpperCase()}</strong>
                      </span>
                      <span>
                        Job ID: <code style={{ fontSize: "11px" }}>{archiveJob.id}</code>
                      </span>
                      <span>
                        Concurrency Limit: <strong>{archiveJob.concurrency || 2} jobs</strong>
                      </span>
                      <span>Enqueued: {new Date(archiveJob.createdAt).toLocaleTimeString()}</span>
                    </Box>
                  </Box>
                </Box>
              )}

              {/* Completed Ready for Download Card */}
              {archiveJob && archiveJob.status === "completed" && (
                <Box
                  mb={4}
                  p={4}
                  bg="rgba(46, 160, 67, 0.1)"
                  border="1px solid var(--color-success-fg)"
                  borderRadius="12px"
                >
                  <Box display="flex" alignItems="center" gap={2} mb={2} color="var(--color-success-fg)">
                    <CheckCircleIcon size={22} />
                    <Text fontWeight="bold" fontSize="17px">
                      Archive Ready for Download
                    </Text>
                  </Box>
                  <DetailSubtitle
                    style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}
                  >
                    Your {archiveJob.format.toUpperCase()} data archive was generated successfully on{" "}
                    {new Date(archiveJob.completedAt || "").toLocaleString()}
                    {archiveJob.fileSizeBytes ? ` (${(archiveJob.fileSizeBytes / 1024).toFixed(1)} KB)` : ""}. Staged
                    securely on our server for 24 hours.
                  </DetailSubtitle>
                  <Box display="flex" gap={3} flexWrap="wrap">
                    <PrimaryButton
                      type="button"
                      onClick={handleDownloadCompletedArchive}
                      disabled={isDownloadingFinishedArchive}
                    >
                      <DownloadIcon size={16} />
                      {isDownloadingFinishedArchive
                        ? "Downloading..."
                        : `Download Ready Archive (.${archiveJob.format.toUpperCase()})`}
                    </PrimaryButton>
                    <SecondaryButton type="button" onClick={() => setArchiveJob(null)}>
                      Request New Archive
                    </SecondaryButton>
                  </Box>
                </Box>
              )}

              {/* Actions / Enqueue Options */}
              <Box
                p={4}
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-default)"
                borderRadius="12px"
                display="flex"
                flexDirection="column"
                gap={3}
              >
                <Text fontWeight="bold" fontSize="16px">
                  Request Archive (Asynchronous Worker Queue)
                </Text>
                <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5" }}>
                  To guarantee system availability and prevent DoS memory spikes, archives are generated in a background
                  worker pool with controlled concurrency. Select your format to queue a job:
                </DetailSubtitle>

                <Box display="flex" flexWrap="wrap" gap={3} mt={2}>
                  <PrimaryButton
                    type="button"
                    onClick={() => handleRequestArchiveJob("zip")}
                    disabled={
                      isSubmittingArchiveJob ||
                      (archiveJob && (archiveJob.status === "queued" || archiveJob.status === "processing"))
                    }
                  >
                    <DownloadIcon size={16} />
                    {isSubmittingArchiveJob ? "Queueing..." : "Queue Complete Archive (.ZIP with HTML Viewer)"}
                  </PrimaryButton>

                  <SecondaryButton
                    type="button"
                    onClick={() => handleRequestArchiveJob("json")}
                    disabled={
                      isSubmittingArchiveJob ||
                      (archiveJob && (archiveJob.status === "queued" || archiveJob.status === "processing"))
                    }
                  >
                    <FileCodeIcon size={16} />
                    Queue Raw Data (.JSON)
                  </SecondaryButton>

                  <SecondaryButton
                    type="button"
                    onClick={() => handleDownloadArchive("zip")}
                    disabled={isDownloadingArchive}
                    style={{ fontSize: "12px", opacity: 0.8 }}
                    title="Direct synchronous export for testing"
                  >
                    Direct Download (.ZIP)
                  </SecondaryButton>
                </Box>
              </Box>
            </Box>
          </>
        )}

        {activeTab === "deleteAccount" && (
          <>
            <Header>
              <CircleIconButton onClick={() => handleTabChange("privacy")} style={{ marginRight: "8px" }}>
                <ArrowLeftIcon size={20} />
              </CircleIconButton>
              Deactivate or Delete Account
            </Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
                Permanently erase your account and personal data pursuant to GDPR Article 17 (Right to Erasure) and CCPA
                § 1798.105.
              </DetailSubtitle>

              {/* Danger Warning Box */}
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
                    onClick={() => handleTabChange("dataArchive")}
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

              {/* Confirmation Form */}
              <Box
                p={4}
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-default)"
                borderRadius="12px"
              >
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
                    <span style={{ fontFamily: "monospace", color: "var(--color-danger-fg)" }}>"{user?.username}"</span>{" "}
                    to confirm:
                  </FormLabel>
                  <FormInput
                    placeholder={user?.username || "username"}
                    value={deleteConfirmUsername}
                    onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                    style={{ marginTop: 0 }}
                  />
                </Box>

                <Box display="flex" justifyContent="flex-end" gap={3}>
                  <SecondaryButton type="button" onClick={() => handleTabChange("privacy")}>
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
        )}
        {activeTab === "billing" && (
          <>
            <Header>
              <CircleIconButton onClick={() => handleTabChange("account")} style={{ marginRight: "8px" }}>
                <ArrowLeftIcon size={20} />
              </CircleIconButton>
              Billing &amp; Compute Quotas
            </Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
                Monitor high-performance computing quotas, credit balances, and metered usage across SLURM and local
                solver clusters.
              </DetailSubtitle>

              {error && (
                <Box
                  mb={3}
                  p={3}
                  bg="var(--color-danger-subtle)"
                  color="var(--color-danger-fg)"
                  borderRadius="6px"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <AlertIcon size={16} />
                  <Text fontSize="14px">{error}</Text>
                </Box>
              )}

              {topUpSuccess && (
                <Box
                  mb={3}
                  p={3}
                  bg="var(--color-success-subtle)"
                  color="var(--color-success-fg)"
                  borderRadius="6px"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <CheckCircleIcon size={16} />
                  <Text fontSize="14px">{topUpSuccess}</Text>
                </Box>
              )}

              {/* Wallet Card */}
              <BillingWalletCard>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
                  <Box>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Current Credit Balance
                    </span>
                    <div
                      style={{
                        fontSize: "36px",
                        fontWeight: "800",
                        color: "var(--color-text-primary)",
                        marginTop: "4px",
                      }}
                    >
                      {billingSummary ? `${billingSummary.wallet.balance.toFixed(2)} cr` : "..."}
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "#3fb950",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        marginTop: "4px",
                      }}
                    >
                      <CheckCircleIcon size={12} /> Active &amp; Pre-flight Authorized
                    </span>
                  </Box>

                  <Box display="flex" flexDirection="column" alignItems="flex-end" gap={2}>
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Quick Top-Up</span>
                    <Box display="flex" gap={2} flexWrap="wrap">
                      <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(50)}>
                        <PlusIcon size={14} /> +50 cr
                      </TopUpPillButton>
                      <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(200)}>
                        <PlusIcon size={14} /> +200 cr
                      </TopUpPillButton>
                      <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(500)}>
                        <ZapIcon size={14} /> +500 cr
                      </TopUpPillButton>
                    </Box>
                  </Box>
                </Box>
              </BillingWalletCard>

              {/* Metric Strip */}
              <StatGrid>
                <StatItem>
                  <Box display="flex" alignItems="center" gap={2} color="var(--color-text-muted)">
                    <CreditCardIcon size={16} />
                    <span style={{ fontSize: "12px", fontWeight: "600" }}>Total Spent</span>
                  </Box>
                  <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                    {billingSummary ? `${billingSummary.wallet.total_spent.toFixed(2)} cr` : "0.00 cr"}
                  </span>
                </StatItem>

                <StatItem>
                  <Box display="flex" alignItems="center" gap={2} color="var(--color-text-muted)">
                    <ServerIcon size={16} />
                    <span style={{ fontSize: "12px", fontWeight: "600" }}>HPC Jobs Run</span>
                  </Box>
                  <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                    {billingSummary ? billingSummary.wallet.total_jobs_dispatched : 0}
                  </span>
                </StatItem>

                <StatItem>
                  <Box display="flex" alignItems="center" gap={2} color="var(--color-text-muted)">
                    <CpuIcon size={16} />
                    <span style={{ fontSize: "12px", fontWeight: "600" }}>CPU Core-Hours</span>
                  </Box>
                  <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                    {billingSummary ? `${billingSummary.wallet.total_cpu_core_hours.toFixed(3)} hrs` : "0.000 hrs"}
                  </span>
                </StatItem>

                <StatItem>
                  <Box display="flex" alignItems="center" gap={2} color="var(--color-text-muted)">
                    <ZapIcon size={16} />
                    <span style={{ fontSize: "12px", fontWeight: "600" }}>GPU Hours</span>
                  </Box>
                  <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
                    {billingSummary ? `${billingSummary.wallet.total_gpu_hours.toFixed(3)} hrs` : "0.000 hrs"}
                  </span>
                </StatItem>
              </StatGrid>

              {/* Compute Profiles Reference */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Compute Profiles &amp; Quota Rates
                </DetailTitle>
                <Box
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "8px",
                    overflow: "hidden",
                    backgroundColor: "var(--color-canvas-default)",
                  }}
                >
                  <LedgerTable>
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Cores</th>
                        <th>Memory</th>
                        <th>GPU</th>
                        <th>Hourly Rate</th>
                        <th>Min Pre-Flight Reserve</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: "600" }}>Standard</td>
                        <td>4 Cores</td>
                        <td>16 GB</td>
                        <td>None</td>
                        <td>1.00 cr / hr</td>
                        <td>0.05 cr (3 min)</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "600" }}>High Memory</td>
                        <td>16 Cores</td>
                        <td>128 GB</td>
                        <td>None</td>
                        <td>4.50 cr / hr</td>
                        <td>0.22 cr (3 min)</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "600" }}>GPU A100</td>
                        <td>16 Cores</td>
                        <td>80 GB</td>
                        <td>1x NVIDIA A100</td>
                        <td>12.00 cr / hr</td>
                        <td>0.60 cr (3 min)</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "600" }}>MPI Supercluster</td>
                        <td>64 Cores</td>
                        <td>256 GB</td>
                        <td>InfiniBand</td>
                        <td>18.00 cr / hr</td>
                        <td>0.90 cr (3 min)</td>
                      </tr>
                    </tbody>
                  </LedgerTable>
                </Box>
              </Box>

              {/* Immutable Transaction Ledger */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Immutable Audit Ledger ({billingSummary?.recent_transactions.length || 0} Transactions)
                </DetailTitle>
                <Box
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "8px",
                    overflow: "hidden",
                    backgroundColor: "var(--color-canvas-default)",
                  }}
                >
                  <LedgerTable>
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Job ID</th>
                        <th>Amount</th>
                        <th>Balance After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!billingSummary || billingSummary.recent_transactions.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}
                          >
                            No billing transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        billingSummary.recent_transactions.map((tx) => (
                          <tr key={tx.id}>
                            <td style={{ color: "var(--color-text-muted)" }}>
                              {new Date(tx.created_at).toLocaleString()}
                            </td>
                            <td>
                              <TxBadge $type={tx.transaction_type}>{tx.transaction_type.replace("_", " ")}</TxBadge>
                            </td>
                            <td>{tx.description}</td>
                            <td style={{ fontFamily: "monospace" }}>{tx.job_id || "—"}</td>
                            <td
                              style={{
                                fontWeight: "700",
                                color: tx.amount >= 0 ? "#3fb950" : "#f85149",
                              }}
                            >
                              {tx.amount >= 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2)} cr
                            </td>
                            <td style={{ fontWeight: "600" }}>{tx.balance_after.toFixed(2)} cr</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </LedgerTable>
                </Box>
              </Box>
            </Box>
          </>
        )}
        {activeTab === "bots" && (
          <>
            <Header>
              <CircleIconButton onClick={() => handleTabChange("account")} style={{ marginRight: "8px" }}>
                <ArrowLeftIcon size={20} />
              </CircleIconButton>
              Developer / Bots
            </Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
                Manage your third-party bots and API applications. Bots can interact with the API on your behalf.
              </DetailSubtitle>

              <Box mt={4} mb={4}>
                <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                  Your Registered Bots
                </DetailTitle>
                {bots.length === 0 ? (
                  <Text color="var(--color-fg-muted)">You haven't registered any bots yet.</Text>
                ) : (
                  <Box display="flex" flexDirection="column" gap={2}>
                    {bots.map((bot) => (
                      <Box
                        key={bot.id}
                        p={3}
                        border="1px solid var(--color-border-default)"
                        borderRadius="8px"
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Box display="flex" alignItems="center" gap={3}>
                          <Box
                            width="40px"
                            height="40px"
                            borderRadius="50%"
                            bg="var(--color-canvas-subtle)"
                            style={{ backgroundImage: `url(${bot.avatar_url})`, backgroundSize: "cover" }}
                          />
                          <Box display="flex" flexDirection="column">
                            <Text fontWeight="bold">
                              {bot.display_name} <HubotIcon size={14} color="var(--color-fg-muted)" />
                            </Text>
                            <Text color="var(--color-fg-muted)" fontSize="13px">
                              @{bot.username}
                            </Text>
                          </Box>
                        </Box>
                        <CircleIconButton
                          onClick={async () => {
                            if (confirm("Are you sure you want to delete this bot?")) {
                              await deleteBot(bot.id);
                              setBots(bots.filter((b) => b.id !== bot.id));
                            }
                          }}
                        >
                          <TrashIcon size={16} color="var(--color-danger-fg)" />
                        </CircleIconButton>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <Box mt={4} borderTop="1px solid var(--color-border-default)" pt={4}>
                <DetailTitle style={{ fontWeight: "bold", display: "block", marginBottom: "16px" }}>
                  Register a New Bot
                </DetailTitle>

                {error && (
                  <Box
                    mb={3}
                    p={3}
                    bg="var(--color-danger-subtle)"
                    color="var(--color-danger-fg)"
                    borderRadius="6px"
                    display="flex"
                    alignItems="center"
                    gap={2}
                  >
                    <AlertIcon size={16} />
                    <Text fontSize="14px">{error}</Text>
                  </Box>
                )}

                {newBotToken && (
                  <Box mb={3} p={3} bg="var(--color-success-subtle)" color="var(--color-success-fg)" borderRadius="6px">
                    <Text fontWeight="bold" display="block" mb={2}>
                      Bot created successfully!
                    </Text>
                    <Text fontSize="14px" display="block" mb={2}>
                      Save this API token now. You will not be able to see it again:
                    </Text>
                    <Box
                      p={2}
                      bg="var(--color-bg-primary)"
                      border="1px solid var(--color-border-subtle)"
                      borderRadius="4px"
                      style={{ fontFamily: "monospace", wordBreak: "break-all" }}
                    >
                      {newBotToken}
                    </Box>
                  </Box>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError(null);
                    setNewBotToken(null);
                    try {
                      const res = await createBot({
                        username: botUsername,
                        display_name: botDisplayName,
                        bio: botBio,
                        avatar_url: botAvatarUrl,
                      });
                      setBots([res.bot, ...bots]);
                      setNewBotToken(res.token);
                      setBotUsername("");
                      setBotDisplayName("");
                      setBotBio("");
                      setBotAvatarUrl("");
                    } catch (err: any) {
                      setError(err.response?.data?.error || "Failed to create bot");
                    }
                  }}
                >
                  <FormLabel>Bot Handle (Username)</FormLabel>
                  <FormInput
                    placeholder="e.g. weather_bot"
                    value={botUsername}
                    onChange={(e) => setBotUsername(e.target.value)}
                    required
                    pattern="^[a-zA-Z0-9_]+$"
                    title="Only letters, numbers, and underscores"
                  />

                  <FormLabel>Display Name</FormLabel>
                  <FormInput
                    placeholder="e.g. Daily Weather Tracker"
                    value={botDisplayName}
                    onChange={(e) => setBotDisplayName(e.target.value)}
                    required
                  />

                  <FormLabel>Bio (Optional)</FormLabel>
                  <FormInput
                    placeholder="What does this bot do?"
                    value={botBio}
                    onChange={(e) => setBotBio(e.target.value)}
                  />

                  <FormLabel>Avatar URL (Optional)</FormLabel>
                  <FormInput
                    placeholder="https://..."
                    value={botAvatarUrl}
                    onChange={(e) => setBotAvatarUrl(e.target.value)}
                    type="url"
                  />

                  <Box mt={3} display="flex" justifyContent="flex-end">
                    <SaveButton type="submit">Create Bot</SaveButton>
                  </Box>
                </form>
              </Box>
            </Box>
          </>
        )}
        {activeTab === "modelingPreferences" && (
          <>
            <Header>Modeling &amp; Simulation Preferences</Header>
            <Box px={4} pb={4} style={{ overflowY: "auto" }}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
                Configure the Monaco code editor, select the default ModelScript compiler flattener backend, and tune
                numerical simulation solver tolerances across the Playground and Web IDE.
              </DetailSubtitle>

              {/* Monaco Editor Preferences */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Code Editor (Monaco)
                </DetailTitle>
                <Box
                  p={4}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Font Size</FormLabel>
                      <DetailSubtitle>Editor text size in pixels</DetailSubtitle>
                    </Box>
                    <Box display="flex" gap={2}>
                      {[12, 14, 16, 18].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => updateModelingPrefs({ fontSize: size })}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border:
                              modelingPrefs.fontSize === size
                                ? "2px solid var(--color-accent-purple, #a855f7)"
                                : "1px solid var(--color-border-default)",
                            background:
                              modelingPrefs.fontSize === size
                                ? "rgba(139, 92, 246, 0.15)"
                                : "var(--color-canvas-default)",
                            color: "var(--color-text-primary)",
                            fontWeight: modelingPrefs.fontSize === size ? "700" : "500",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          {size}px
                        </button>
                      ))}
                    </Box>
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Tab Indentation</FormLabel>
                      <DetailSubtitle>Spaces per indentation level</DetailSubtitle>
                    </Box>
                    <Box display="flex" gap={2}>
                      {[2, 4].map((spaces) => (
                        <button
                          key={spaces}
                          type="button"
                          onClick={() => updateModelingPrefs({ tabSize: spaces })}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border:
                              modelingPrefs.tabSize === spaces
                                ? "2px solid var(--color-accent-purple, #a855f7)"
                                : "1px solid var(--color-border-default)",
                            background:
                              modelingPrefs.tabSize === spaces
                                ? "rgba(139, 92, 246, 0.15)"
                                : "var(--color-canvas-default)",
                            color: "var(--color-text-primary)",
                            fontWeight: modelingPrefs.tabSize === spaces ? "700" : "500",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          {spaces} Spaces
                        </button>
                      ))}
                    </Box>
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Word Wrapping</FormLabel>
                      <DetailSubtitle>Wrap long equation lines automatically</DetailSubtitle>
                    </Box>
                    <input
                      type="checkbox"
                      checked={modelingPrefs.wordWrap === "on"}
                      onChange={(e) => updateModelingPrefs({ wordWrap: e.target.checked ? "on" : "off" })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Code Minimap</FormLabel>
                      <DetailSubtitle>Show high-level code structure scroll preview</DetailSubtitle>
                    </Box>
                    <input
                      type="checkbox"
                      checked={modelingPrefs.minimapEnabled}
                      onChange={(e) => updateModelingPrefs({ minimapEnabled: e.target.checked })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Bracket Pair Colorization</FormLabel>
                      <DetailSubtitle>Colorize matching parentheses and curly braces</DetailSubtitle>
                    </Box>
                    <input
                      type="checkbox"
                      checked={modelingPrefs.bracketPairColorization}
                      onChange={(e) => updateModelingPrefs({ bracketPairColorization: e.target.checked })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </Box>
                </Box>
              </Box>

              {/* ModelScript Compiler & Flattener */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Compiler &amp; Flattener Architecture
                </DetailTitle>
                <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={3}>
                  {[
                    {
                      backend: "hybrid" as const,
                      title: "Hybrid (Recommended)",
                      desc: "AssemblyScript WASM Kernel + TS AST Bridge with Salsa query caching.",
                    },
                    {
                      backend: "wasm" as const,
                      title: "Pure WASM Arena",
                      desc: "Zero-allocation data-oriented struct-of-arrays in WebAssembly linear memory.",
                    },
                    {
                      backend: "ts" as const,
                      title: "TypeScript AST",
                      desc: "Complete TypeScript flattener pipeline for maximum debugging transparency.",
                    },
                  ].map((b) => (
                    <Box
                      key={b.backend}
                      p={3}
                      onClick={() => updateModelingPrefs({ flattenerBackend: b.backend })}
                      style={{
                        border:
                          modelingPrefs.flattenerBackend === b.backend
                            ? "2px solid var(--color-accent-purple, #a855f7)"
                            : "1px solid var(--color-border-default)",
                        borderRadius: "10px",
                        background:
                          modelingPrefs.flattenerBackend === b.backend
                            ? "rgba(139, 92, 246, 0.12)"
                            : "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: "700",
                          display: "block",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {b.title}
                      </span>
                      <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>{b.desc}</DetailSubtitle>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Numerical Solvers & Integrators */}
              <Box mb={4}>
                <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
                  Numerical Simulation Solvers
                </DetailTitle>
                <Box
                  p={4}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Default Integrator</FormLabel>
                      <DetailSubtitle>Algorithm used for initial value simulation runs</DetailSubtitle>
                    </Box>
                    <select
                      value={modelingPrefs.defaultSolver}
                      onChange={(e) => updateModelingPrefs({ defaultSolver: e.target.value as any })}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                      }}
                    >
                      <option value="cvode">SUNDIALS CVODE (Stiff &amp; Non-Stiff ODEs)</option>
                      <option value="ida">SUNDIALS IDA (Differential-Algebraic Equations)</option>
                      <option value="dopri5">Dormand-Prince 5(4) (Adaptive Step Runge-Kutta)</option>
                      <option value="rk4">Classical Runge-Kutta (Fixed Step 4th Order)</option>
                    </select>
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Relative Tolerance</FormLabel>
                      <DetailSubtitle>Local error tolerance for adaptive step integrators</DetailSubtitle>
                    </Box>
                    <Box display="flex" gap={2}>
                      {[1e-4, 1e-6, 1e-8].map((tol) => (
                        <button
                          key={tol}
                          type="button"
                          onClick={() => updateModelingPrefs({ defaultRelativeTolerance: tol })}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border:
                              modelingPrefs.defaultRelativeTolerance === tol
                                ? "2px solid var(--color-accent-purple, #a855f7)"
                                : "1px solid var(--color-border-default)",
                            background:
                              modelingPrefs.defaultRelativeTolerance === tol
                                ? "rgba(139, 92, 246, 0.15)"
                                : "var(--color-canvas-default)",
                            color: "var(--color-text-primary)",
                            fontWeight: modelingPrefs.defaultRelativeTolerance === tol ? "700" : "500",
                            cursor: "pointer",
                            fontSize: "13px",
                          }}
                        >
                          {tol.toExponential()}
                        </button>
                      ))}
                    </Box>
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                      <FormLabel style={{ margin: 0, display: "block" }}>Diagram Auto-Layout</FormLabel>
                      <DetailSubtitle>Automatically route schematic connector lines</DetailSubtitle>
                    </Box>
                    <input
                      type="checkbox"
                      checked={modelingPrefs.diagramAutoLayout}
                      onChange={(e) => updateModelingPrefs({ diagramAutoLayout: e.target.checked })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </Box>
                </Box>
              </Box>

              <Box display="flex" justifyContent="space-between" alignItems="center" mt={4}>
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  ✓ Preferences are automatically persisted to this browser.
                </span>
                <SecondaryButton type="button" onClick={resetModelingPrefs}>
                  Reset to Defaults
                </SecondaryButton>
              </Box>
            </Box>
          </>
        )}
      </DetailColumn>

      <TwoFactorModal
        isOpen={is2FAModalOpen}
        onClose={() => setIs2FAModalOpen(false)}
        isEnabled={is2FAEnabled}
        onStatusChange={(enabled) => setIs2FAEnabled(enabled)}
        hasPassword={user?.has_password ?? true}
      />
    </SettingsContainer>
  );
};

export default SettingsPage;

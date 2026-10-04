// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
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
  ServerIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
  SyncIcon,
  TrashIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import {
  addPublicKey,
  createBot,
  deleteAccount,
  deleteBot,
  downloadUserDataArchiveJob,
  exportUserDataArchive,
  getBots,
  getNotificationSettings,
  getPublicKeys,
  getUserBillingSummary,
  getUserDataArchiveStatus,
  getUserTopics,
  requestUserDataArchiveJob,
  revokePublicKey,
  topUpCredits,
  updateAccount,
  updateNotificationSettings,
  updatePassword,
  updateUserTopic,
  type ArchiveJobInfo,
  type PublicKeyInfo,
  type UserBillingSummary,
} from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { useTheme } from "../theme";

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
  | "notificationFilters";

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("account");
  const [searchQuery, setSearchQuery] = useState("");
  const [accountInfoMode, setAccountInfoMode] = useState<"password" | "form">("password");
  const [topics, setTopics] = useState<{ concept: string; is_active: boolean }[]>([]);
  const [publicKeys, setPublicKeys] = useState<PublicKeyInfo[]>([]);
  const [bots, setBots] = useState<any[]>([]);

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

  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [qualityFilter, setQualityFilter] = useState(true);

  // Fetch notification settings when opening that tab
  React.useEffect(() => {
    if (activeTab === "notificationFilters") {
      getNotificationSettings()
        .then((data) => {
          if (data && typeof data.qualityFilter === "boolean") {
            setQualityFilter(data.qualityFilter);
          }
        })
        .catch(() => {});
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
    setError(null);
    setSuccess(null);
    if (tab === "accountInfo") {
      setAccountInfoMode("password");
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
      alert(
        "Your account and associated personal data have been permanently erased. You will now be redirected to the home page.",
      );
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
    if (newPassword !== newPasswordConfirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await updatePassword({ oldPassword, newPassword });
      setSuccess("Password changed successfully!");
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Password change failed");
    } finally {
      setLoading(false);
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
            {
              id: "billing",
              label: "Billing & Compute Quotas",
              tab: "billing" as TabType,
              keywords: "billing quota compute invoice payment usage",
              isActive: activeTab === "billing",
            },
            {
              id: "bots",
              label: "Developer / Bots",
              tab: "bots" as TabType,
              keywords: "bots developer tokens webhook agents",
              isActive: activeTab === "bots",
            },
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
              keywords: "notifications alerts email push filters mentions",
              isActive: activeTab === "notifications",
            },
            {
              id: "contentPreferences",
              label: "Content preferences",
              tab: "contentPreferences" as TabType,
              keywords: "content preferences topics feed interests recommendations",
              isActive: activeTab === "contentPreferences",
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
              label: "Additional resources",
              tab: "other" as TabType,
              keywords: "resources help support docs terms",
              isActive: false,
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
                <span>Change your password</span>
              </Box>
            </Header>
            <Box p={4}>
              {success && (
                <p style={{ color: "var(--color-success)", marginBottom: "16px", fontWeight: "bold" }}>{success}</p>
              )}
              {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}

              <FormLabel>Current Password</FormLabel>
              <FormInput type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />

              <FormLabel>New Password</FormLabel>
              <FormInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />

              <FormLabel>Confirm New Password</FormLabel>
              <FormInput
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
              />

              <Box display="flex" justifyContent="flex-end" mt={2}>
                <SaveButton onClick={handleChangePassword} disabled={loading || !oldPassword || !newPassword}>
                  {loading ? "Saving..." : "Save"}
                </SaveButton>
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
                Connect your external accounts to ModelScript to enable features like "Verified on X".
              </DetailSubtitle>

              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                p={3}
                style={{ border: "1px solid var(--color-border-default)", borderRadius: "8px" }}
              >
                <Box>
                  <FormLabel style={{ display: "block" }}>X (Twitter)</FormLabel>
                  <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                    Connect to get the "Verified on X" badge on your profile.
                  </DetailSubtitle>
                </Box>
                <SaveButton
                  onClick={() =>
                    (window.location.href = `/api/v1/auth/link/twitter?token=${localStorage.getItem("token") || ""}`)
                  }
                >
                  Connect Account
                </SaveButton>
              </Box>
            </Box>
          </>
        )}

        {activeTab === "security" && (
          <>
            <Header>Security and account access</Header>
            <Box px={3} pb={3}>
              <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "24px" }}>
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

                    // Export private key to PEM for local storage
                    const pkcs8 = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
                    const privBase64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
                    const privPem = `-----BEGIN PRIVATE KEY-----\n${privBase64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
                    localStorage.setItem(`ap_priv_key_${keyIdString}`, privPem);

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
                      {localStorage.getItem(`ap_priv_key_${k.key_id_string}`) && (
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
                          setPublicKeys(await getPublicKeys());
                          localStorage.removeItem(`ap_priv_key_${k.key_id_string}`);
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
                <span>Filters</span>
              </Box>
            </Header>
            <Box p={4}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box>
                  <FormLabel style={{ display: "block" }}>Quality filter</FormLabel>
                  <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                    Choose to filter out lower-quality content from your notifications.
                  </DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  checked={qualityFilter}
                  onChange={async (e) => {
                    const val = e.target.checked;
                    setQualityFilter(val);
                    try {
                      await updateNotificationSettings({ qualityFilter: val });
                    } catch (err) {}
                  }}
                  style={{ width: "20px", height: "20px", cursor: "pointer" }}
                />
              </Box>
            </Box>
          </>
        )}

        {activeTab === "other" && (
          <>
            <Header>Settings</Header>
            <Box p={3} display="flex" justifyContent="center">
              <DetailSubtitle>This setting section is under development.</DetailSubtitle>
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
      </DetailColumn>
    </SettingsContainer>
  );
};

export default SettingsPage;

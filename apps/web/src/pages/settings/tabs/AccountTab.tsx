// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  GlobeIcon,
  KeyIcon,
  PersonIcon,
  ShieldLockIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changeAccountCredentials, revokeAllSessions, updateAccount } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import {
  DangerButton,
  DetailIcon,
  DetailItem,
  DetailSubtitle,
  DetailText,
  DetailTitle,
  FormInput,
  FormLabel,
  Header,
  SaveButton,
} from "../settingsStyles";

export interface AccountTabProps {
  subView: "account" | "accountInfo" | "changePassword";
  onNavigate: (tab: any) => void;
  onBack?: (() => void) | undefined;
}

export const AccountTab: React.FC<AccountTabProps> = ({ subView, onNavigate, onBack }) => {
  const { user, isAdmin, updateToken, refreshUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  // Account Info states
  const [accountInfoMode, setAccountInfoMode] = useState<"password" | "form">("form");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [username, setUsername] = useState(user?.username || "");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [bannerUrl, setBannerUrl] = useState(user?.banner_url || "");

  // Change Password states
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);

  // Status states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setDisplayName(user.display_name || "");
      setEmail(user.email || "");
      setAvatarUrl(user.avatar_url || "");
      setBannerUrl(user.banner_url || "");
    }
  }, [user]);

  useEffect(() => {
    setError(null);
    setSuccess(null);
    if (subView === "accountInfo") {
      setAccountInfoMode(user?.has_password === false ? "form" : "password");
      setPasswordConfirm("");
    }
    if (subView === "changePassword") {
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    }
  }, [subView, user]);

  const handlePasswordConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
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
      await refreshUser();
      setSuccess("Account updated successfully!");
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
      const res = await changeAccountCredentials({
        oldPassword: user?.has_password === false ? undefined : oldPassword,
        newPassword,
      });
      if (res?.token) {
        updateToken(res.token);
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
        updateToken(res.token);
      }
      toast.success("All other active sessions have been revoked.");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to revoke sessions.");
    } finally {
      setIsRevokingSessions(false);
    }
  };

  if (subView === "accountInfo") {
    return (
      <>
        <Header>
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            sx={{ cursor: "pointer" }}
            onClick={() => onNavigate("account")}
          >
            <ArrowLeftIcon size={20} />
            <span>Account information</span>
          </Box>
        </Header>
        <DetailItem $clickable onClick={() => navigate("/settings/profile")}>
          <DetailIcon>
            <PersonIcon size={20} />
          </DetailIcon>
          <DetailText>
            <DetailTitle>Edit Public Profile (Bio, Avatar, Banner)</DetailTitle>
            <DetailSubtitle>
              Update your public display name, bio, location, website, avatar, and banner.
            </DetailSubtitle>
          </DetailText>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </DetailItem>
        {accountInfoMode === "password" ? (
          <Box p={4}>
            <h2 style={{ margin: "0 0 16px 0", fontSize: "24px" }}>Confirm your password</h2>
            <p style={{ color: "var(--color-text-muted)", marginBottom: "24px" }}>
              Please enter your password in order to access this section.
            </p>
            {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}
            <FormInput
              type="password"
              placeholder="Password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && passwordConfirm && !loading) {
                  handlePasswordConfirm();
                }
              }}
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
    );
  }

  if (subView === "changePassword") {
    return (
      <>
        <Header>
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            sx={{ cursor: "pointer" }}
            onClick={() => onNavigate("account")}
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
              You signed in with an external identity provider (OAuth / Single Sign-On). Creating a password allows you
              to log in directly with your email address as well as your social provider.
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

          <Box mt={5} pt={4} style={{ borderTop: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))" }}>
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
    );
  }

  return (
    <>
      <Header>
        {onBack && (
          <Box
            display="flex"
            alignItems="center"
            sx={{ cursor: "pointer", "@media (min-width: 901px)": { display: "none" } }}
            onClick={onBack}
          >
            <ArrowLeftIcon size={20} />
          </Box>
        )}
        <span>Your Account</span>
      </Header>
      <Box px={3} pb={3}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
          See information about your account, download an archive of your data, or learn about your account deactivation
          options.
        </DetailSubtitle>
      </Box>
      <DetailItem $clickable onClick={() => navigate("/settings/profile")}>
        <DetailIcon>
          <PersonIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Edit Public Profile (Bio, Avatar, Banner)</DetailTitle>
          <DetailSubtitle>Update your public display name, bio, location, website, avatar, and banner.</DetailSubtitle>
        </DetailText>
        <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
      </DetailItem>
      <DetailItem $clickable onClick={() => onNavigate("accountInfo")}>
        <DetailIcon>
          <PersonIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Account information</DetailTitle>
          <DetailSubtitle>See your account information like your email address and username.</DetailSubtitle>
        </DetailText>
        <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
      </DetailItem>
      <DetailItem $clickable onClick={() => onNavigate("changePassword")}>
        <DetailIcon>
          <KeyIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Change your password</DetailTitle>
          <DetailSubtitle>Change your password at any time.</DetailSubtitle>
        </DetailText>
        <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
      </DetailItem>
      <DetailItem $clickable onClick={() => onNavigate("connectedAccounts")}>
        <DetailIcon>
          <GlobeIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Connected accounts</DetailTitle>
          <DetailSubtitle>Manage the external accounts connected to ModelScript.</DetailSubtitle>
        </DetailText>
        <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
      </DetailItem>
      <DetailItem $clickable onClick={() => onNavigate("dataArchive")}>
        <DetailIcon>
          <DownloadIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Download an archive of your data</DetailTitle>
          <DetailSubtitle>Get an interactive ZIP archive and offline HTML viewer of your personal data.</DetailSubtitle>
        </DetailText>
        <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
      </DetailItem>
      <DetailItem $clickable onClick={() => onNavigate("deleteAccount")}>
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
  );
};

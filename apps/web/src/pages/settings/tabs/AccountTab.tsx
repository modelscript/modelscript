// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckCircleIcon,
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
import { resendVerificationEmail, revokeAllSessions, updateAccount, updatePassword } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { safeCssImageUrl } from "../../../util/url";
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
  SecondaryButton,
} from "../settingsStyles";

export interface AccountTabProps {
  subView: "account" | "accountInfo" | "changePassword" | "main";
  onNavigate: (tab: any) => void;
  onBack?: (() => void) | undefined;
}

function getPasswordStrength(pw: string): {
  label: "Weak" | "Fair" | "Strong";
  percent: number;
  color: string;
} | null {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;

  if (pw.length < 8 || score <= 2) {
    return { label: "Weak", percent: 33, color: "var(--color-danger-fg, #ef4444)" };
  }
  if (score <= 3) {
    return { label: "Fair", percent: 66, color: "#d29922" };
  }
  return { label: "Strong", percent: 100, color: "var(--color-success, #3fb950)" };
}

export const AccountTab: React.FC<AccountTabProps> = ({ subView, onNavigate, onBack }) => {
  const { user, isAdmin, updateToken, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const navigate = useNavigate();
  const toast = useToast();
  const setSubView = onNavigate;

  // Account Info states
  const [accountInfoMode, setAccountInfoMode] = useState<"gate" | "form">("gate");
  const [password, setPassword] = useState("");
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
  const [resendingVerification, setResendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isEmailVerified = user?.email_verified !== 0 && user?.email_verified !== false;

  // Only reset mode and password gate when subView changes (NOT when user refreshes)
  useEffect(() => {
    setError(null);
    setSuccess(null);
    if (subView === "accountInfo") {
      setAccountInfoMode(user?.has_password === false ? "form" : "gate");
      setPassword("");
      if (user) {
        setUsername(user.username || "");
        setDisplayName(user.display_name || "");
        setEmail(user.email || "");
        setAvatarUrl(user.avatar_url || "");
        setBannerUrl(user.banner_url || "");
      }
    }
    if (subView === "changePassword") {
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView]);

  // Sync profile fields from user only when entering accountInfo or while in gate mode
  useEffect(() => {
    if (user && accountInfoMode === "gate") {
      setUsername(user.username || "");
      setDisplayName(user.display_name || "");
      setEmail(user.email || "");
      setAvatarUrl(user.avatar_url || "");
      setBannerUrl(user.banner_url || "");
    }
  }, [user, accountInfoMode]);

  const handlePasswordConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await updateAccount({ password });
      setAccountInfoMode("form");
    } catch (err: any) {
      setError(err.response?.data?.error || "Incorrect password");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!user?.email) return;
    setResendingVerification(true);
    try {
      const res = await resendVerificationEmail(user.email);
      toast.success(res?.message || `Verification link sent to ${user.email}.`);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string } } };
      toast.error(errObj.response?.data?.error || "Failed to resend verification email.");
    } finally {
      setResendingVerification(false);
    }
  };

  const handleSaveAccount = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await updateAccount({
        password,
        username: username.trim(),
        email: email.trim(),
        display_name: displayName.trim(),
        avatar_url: avatarUrl.trim(),
        banner_url: bannerUrl.trim(),
      });
      await refreshUser();
      setSuccess(
        res?.verificationRequired
          ? "Account updated! A verification link has been sent to your new email address."
          : "Account updated successfully!",
      );
    } catch (err: any) {
      setError(err.response?.data?.error || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (user?.has_password !== false && !oldPassword) {
      setError("Current password is required");
      return;
    }
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
        updateToken(res.token);
      }
      await refreshUser();
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

  const passwordStrength = getPasswordStrength(newPassword);

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
        {accountInfoMode === "gate" ? (
          <Box p={4}>
            <h2 style={{ margin: "0 0 16px 0", fontSize: "24px" }}>Confirm your password</h2>
            <p style={{ color: "var(--color-text-muted)", marginBottom: "24px" }}>
              Please enter your password in order to access this section.
            </p>
            {error && <p style={{ color: "var(--color-error)", marginBottom: "16px" }}>{error}</p>}
            <FormInput
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password && !loading) {
                  handlePasswordConfirm();
                }
              }}
            />
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <SaveButton onClick={handlePasswordConfirm} disabled={loading || !password}>
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

            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
              <FormLabel style={{ marginBottom: 0 }}>Email</FormLabel>
              <Box display="flex" alignItems="center" gap={2}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    backgroundColor: isEmailVerified ? "rgba(63, 185, 80, 0.15)" : "rgba(210, 153, 34, 0.15)",
                    color: isEmailVerified ? "var(--color-success, #3fb950)" : "#d29922",
                    border: `1px solid ${isEmailVerified ? "rgba(63, 185, 80, 0.4)" : "rgba(210, 153, 34, 0.4)"}`,
                  }}
                >
                  {isEmailVerified ? "Verified" : "Unverified"}
                </span>
                {!isEmailVerified && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendingVerification}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--color-accent-cyan, #06b6d4)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: resendingVerification ? "not-allowed" : "pointer",
                      padding: 0,
                    }}
                  >
                    {resendingVerification ? "Sending…" : "Resend verification email"}
                  </button>
                )}
              </Box>
            </Box>
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
              <SaveButton onClick={handleSaveAccount} disabled={loading}>
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
          <FormInput
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ marginBottom: passwordStrength ? "8px" : "16px" }}
          />
          {passwordStrength && (
            <Box mb={3}>
              <Box
                style={{
                  width: "100%",
                  height: "6px",
                  borderRadius: "999px",
                  background: "var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${passwordStrength.percent}%`,
                    height: "100%",
                    background: passwordStrength.color,
                    transition: "width 0.2s ease, background-color 0.2s ease",
                  }}
                />
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mt={1}>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Password strength</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: passwordStrength.color }}>
                  {passwordStrength.label}
                </span>
              </Box>
            </Box>
          )}

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
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block" }}>
          See information about your account, download an archive of your data, or learn about your account deactivation
          options.
        </DetailSubtitle>

        {user && (
          <Box
            mt={3}
            p={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "12px",
              background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <Box display="flex" alignItems="center" gap={3}>
              <Box
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "50%",
                  background: "var(--color-canvas-default)",
                  border: "1px solid var(--color-border-default)",
                  backgroundImage: safeCssImageUrl(user.avatar_url),
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  flexShrink: 0,
                }}
              >
                {!user.avatar_url && (user.display_name || user.username || "?").charAt(0).toUpperCase()}
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {user.display_name || user.username}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "999px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      backgroundColor: isEmailVerified ? "rgba(63, 185, 80, 0.15)" : "rgba(210, 153, 34, 0.15)",
                      color: isEmailVerified ? "var(--color-success, #3fb950)" : "#d29922",
                      border: `1px solid ${isEmailVerified ? "rgba(63, 185, 80, 0.4)" : "rgba(210, 153, 34, 0.4)"}`,
                    }}
                  >
                    {isEmailVerified && <CheckCircleIcon size={12} />}
                    {isEmailVerified ? "Email Verified" : "Email Unverified"}
                  </span>
                </Box>
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  @{user.username}
                  {user.email ? ` · ${user.email}` : ""}
                </span>
              </Box>
            </Box>

            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <SecondaryButton
                type="button"
                style={{ padding: "6px 14px", fontSize: "13px" }}
                onClick={() => setSubView("accountInfo")}
              >
                Account information
              </SecondaryButton>
              <SecondaryButton
                type="button"
                style={{ padding: "6px 14px", fontSize: "13px" }}
                onClick={() => navigate(`/${user.username}`)}
              >
                View Public Profile
              </SecondaryButton>
              <SecondaryButton
                type="button"
                style={{ padding: "6px 14px", fontSize: "13px" }}
                onClick={() => navigate("/settings/profile")}
              >
                Edit Public Profile
              </SecondaryButton>
            </Box>
          </Box>
        )}

        {!isEmailVerified && user?.email && (
          <div
            style={{
              marginTop: "12px",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "rgba(210, 153, 34, 0.12)",
              border: "1px solid rgba(210, 153, 34, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <span style={{ fontSize: "13px", color: "var(--color-text-primary)", lineHeight: "1.4" }}>
              Your email address (<strong>{user.email}</strong>) is not verified yet. Verify your email to activate full
              account features.
            </span>
            <SaveButton
              type="button"
              onClick={handleResendVerification}
              disabled={resendingVerification}
              style={{ padding: "6px 14px", fontSize: "12px" }}
            >
              {resendingVerification ? "Sending…" : "Resend Verification Email"}
            </SaveButton>
          </div>
        )}
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
          <DetailSubtitle>Manage the external accounts connected to {brandName}.</DetailSubtitle>
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

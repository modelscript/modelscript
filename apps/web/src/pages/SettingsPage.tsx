/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
import {
  AlertIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  GlobeIcon,
  KeyIcon,
  PaintbrushIcon,
  PersonIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import styled from "styled-components";
import { getNotificationSettings, updateAccount, updateNotificationSettings, updatePassword } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
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
  background-color: var(--color-canvas-subtle);
  color: var(--color-text-primary);
  outline: none;
  font-size: 15px;

  &:focus {
    border-color: var(--color-accent-emphasis);
    background-color: var(--color-canvas-default);
  }
`;

const MenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: ${(props) => (props.$active ? "var(--color-canvas-subtle)" : "transparent")};
  border: none;
  border-right: ${(props) => (props.$active ? "2px solid var(--color-accent-emphasis)" : "2px solid transparent")};
  cursor: pointer;
  text-align: left;
  transition: background-color 0.2s;
  color: var(--color-text-primary);

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  span {
    font-size: 15px;
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
  background-color: var(--color-accent-emphasis);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 16px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  align-self: flex-end;
  &:hover {
    background-color: var(--color-accent-fg);
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

type TabType = "account" | "notifications" | "display" | "other" | "accountInfo" | "changePassword";

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("account");
  const [accountInfoMode, setAccountInfoMode] = useState<"password" | "form">("password");

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

  const { user } = useAuth();
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
  }, [activeTab]);

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
          activeTab !== "account" && activeTab !== "notifications" && activeTab !== "display" && activeTab !== "other"
        }
      >
        <Header>Settings</Header>
        <Box p={3}>
          <SearchInput placeholder="Search Settings" />
        </Box>
        <MenuItem
          $active={activeTab === "account" || activeTab === "accountInfo" || activeTab === "changePassword"}
          onClick={() => handleTabChange("account")}
        >
          <span>Your account</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem onClick={() => handleTabChange("other")}>
          <span>Security and account access</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem onClick={() => handleTabChange("other")}>
          <span>Privacy and safety</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem $active={activeTab === "notifications"} onClick={() => handleTabChange("notifications")}>
          <span>Notifications</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem $active={activeTab === "display"} onClick={() => handleTabChange("display")}>
          <span>Accessibility, display, and languages</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem onClick={() => handleTabChange("other")}>
          <span>Additional resources</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
      </MenuColumn>

      <DetailColumn
        $hideOnMobile={
          activeTab === "account" ||
          activeTab === "notifications" ||
          activeTab === "display" ||
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
            <DetailItem $clickable>
              <DetailIcon>
                <AlertIcon size={20} />
              </DetailIcon>
              <DetailText>
                <DetailTitle>Deactivate your account</DetailTitle>
                <DetailSubtitle>Find out how you can deactivate your account.</DetailSubtitle>
              </DetailText>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </DetailItem>
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
      </DetailColumn>
    </SettingsContainer>
  );
};

export default SettingsPage;

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
import {
  AlertIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  GlobeIcon,
  HubotIcon,
  KeyIcon,
  PaintbrushIcon,
  PersonIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import styled from "styled-components";
import {
  addPublicKey,
  createBot,
  deleteBot,
  getBots,
  getNotificationSettings,
  getPublicKeys,
  getUserTopics,
  revokePublicKey,
  updateAccount,
  updateNotificationSettings,
  updatePassword,
  updateUserTopic,
  type PublicKeyInfo,
} from "../api";
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
  | "bots";

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("account");
  const [accountInfoMode, setAccountInfoMode] = useState<"password" | "form">("password");
  const [topics, setTopics] = useState<{ concept: string; is_active: boolean }[]>([]);
  const [publicKeys, setPublicKeys] = useState<PublicKeyInfo[]>([]);
  const [bots, setBots] = useState<any[]>([]);

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
          activeTab !== "account" &&
          activeTab !== "notifications" &&
          activeTab !== "display" &&
          activeTab !== "contentPreferences" &&
          activeTab !== "other"
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
        <MenuItem $active={activeTab === "security"} onClick={() => handleTabChange("security")}>
          <span>Security and account access</span>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </MenuItem>
        <MenuItem $active={activeTab === "bots"} onClick={() => handleTabChange("bots")}>
          <span>Developer / Bots</span>
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
        <MenuItem $active={activeTab === "contentPreferences"} onClick={() => handleTabChange("contentPreferences")}>
          <span>Content preferences</span>
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

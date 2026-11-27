// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, CheckCircleIcon, CodeIcon, GlobeIcon, RepoIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { getConnectedAccounts, initiateOAuthLink, unlinkConnectedAccount, type ConnectedAccount } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { getApiErrorMessage } from "../../../util/error";
import { DangerButton, DetailSubtitle, FormLabel, Header, SaveButton, SecondaryButton } from "../settingsStyles";

// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_STATUS_MESSAGES: {
  readonly success: Readonly<Record<string, string>>;
  readonly error: Readonly<Record<string, string>>;
} = {
  success: {
    linkedgithub: "Successfully linked your GitHub account.",
    linkedgitlab: "Successfully linked your GitLab account.",
    linkedoidc: "Successfully linked your Enterprise SSO (OIDC) account.",
    linkedtwitter: "Successfully linked your X (Twitter) account.",
    linkedfediverse: "Successfully linked your Fediverse account.",
    linkedgoogle: "Successfully linked your Google account.",
    linkedorcid: "Successfully linked your ORCID account.",
    account_linked: "Successfully linked your external account.",
    account_unlinked: "Successfully disconnected your external account.",
    billing_updated: "Your billing settings have been updated.",
    checkout_success: "Your payment completed successfully.",
    email_verified: "Your email address has been verified.",
    password_updated: "Your password has been updated.",
  },
  error: {
    missingtoken: "Authentication token was missing. Please try again.",
    invalidtoken: "Your authentication session is invalid or expired. Please try again.",
    invalidstate: "The sign-in or linking request could not be verified. Please try again.",
    oauthnotconfigured: "This OAuth provider is not configured on this instance.",
    usernotfound: "Your user account could not be found. Please sign in again.",
    oauthexchangefailed: "Failed to complete authentication with the external provider. Please try again.",
    oauthfailed: "External account authentication failed. Please try again.",
    missingoauthcode: "Authorization code was missing from the OAuth callback. Please try again.",
    disallowedfediversedomain: "That Fediverse instance domain is not permitted on this server.",
    accountalreadyexists: "An account with this identity already exists.",
    accountexistswithpassword: "An account with this email already exists. Please sign in with your password.",
    registrationrestricted: "Account registration is currently restricted on this instance.",
  },
};

export const GENERIC_SETTINGS_ERROR_MESSAGE = "An error occurred while updating your settings.";

// eslint-disable-next-line react-refresh/only-export-components
export function resolveSettingsBannerMessage(
  kind: "success" | "error",
  rawValue: string | null | undefined,
): string | null {
  if (!rawValue) return null;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return null;

  if (kind === "success") {
    return Object.prototype.hasOwnProperty.call(SETTINGS_STATUS_MESSAGES.success, normalized)
      ? SETTINGS_STATUS_MESSAGES.success[normalized]!
      : null;
  }

  return Object.prototype.hasOwnProperty.call(SETTINGS_STATUS_MESSAGES.error, normalized)
    ? SETTINGS_STATUS_MESSAGES.error[normalized]!
    : GENERIC_SETTINGS_ERROR_MESSAGE;
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateOAuthRedirectUrl(redirectUrl: string, baseOrigin: string): string | null {
  try {
    const parsed = new URL(redirectUrl, baseOrigin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export interface ConnectedAccountsTabProps {
  onBack: () => void;
}

export const ConnectedAccountsTab: React.FC<ConnectedAccountsTabProps> = ({ onBack }) => {
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<string[]>(["github", "gitlab"]);
  const [confirmingDisconnectId, setConfirmingDisconnectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const successParam = params.get("success");
      const errorParam = params.get("error");
      const resolvedSuccess = resolveSettingsBannerMessage("success", successParam);
      const resolvedError = resolvedSuccess ? null : resolveSettingsBannerMessage("error", errorParam);
      if (resolvedSuccess) {
        setSuccess(resolvedSuccess);
      }
      if (resolvedError) {
        setError(resolvedError);
      }
      if (params.has("success") || params.has("error")) {
        params.delete("success");
        params.delete("error");
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    }

    setIsLoading(true);
    getConnectedAccounts()
      .then((res) => {
        const payload = res as { providers?: ConnectedAccount[]; supportedProviders?: string[] } | null;
        if (payload && Array.isArray(payload.providers)) {
          setAccounts(payload.providers);
        }
        if (payload && Array.isArray(payload.supportedProviders)) {
          setSupportedProviders(payload.supportedProviders.map((p) => p.toLowerCase()));
        } else {
          setSupportedProviders(["github", "gitlab"]);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const connectedAccounts = accounts.filter((a) => a.connected);
  const isLastLoginMethod = !user?.has_password && connectedAccounts.length <= 1;
  const lockoutHelperText = "Set a password in Your Account settings before disconnecting your only sign-in method.";

  const providers = [
    {
      id: "oidc",
      name: "Enterprise Single Sign-On (OIDC)",
      desc: "Authenticate via corporate identity providers (Keycloak, Okta, Microsoft Entra ID).",
      icon: ShieldCheckIcon,
    },
    {
      id: "github",
      name: "GitHub",
      desc: "Link your GitHub developer profile to synchronize public SSH keys and git repositories.",
      icon: RepoIcon,
    },
    {
      id: "gitlab",
      name: "GitLab",
      desc: "Link your GitLab account for enterprise git repository pipelines and webhooks.",
      icon: CodeIcon,
    },
    {
      id: "twitter",
      name: "X (Twitter)",
      desc: "Verify your public engineering identity and earn the 'Verified on X' badge on your profile.",
      icon: GlobeIcon,
    },
  ];

  return (
    <>
      <Header>
        <Box display="flex" alignItems="center" gap={3} style={{ cursor: "pointer" }} onClick={onBack}>
          <ArrowLeftIcon size={20} />
          <span>Connected accounts</span>
        </Box>
      </Header>
      <Box p={4}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "24px" }}>
          Manage external identities connected to your {brandName} profile for Single Sign-On (SSO) and verified
          developer badges.
        </DetailSubtitle>

        {success && (
          <Box
            role="status"
            mb={3}
            p={3}
            style={{ background: "var(--color-success-subtle)", color: "var(--color-success-fg)", borderRadius: "6px" }}
          >
            <Text fontSize="14px">{success}</Text>
          </Box>
        )}
        {error && (
          <Box
            role="alert"
            mb={3}
            p={3}
            style={{ background: "var(--color-danger-subtle)", color: "var(--color-danger-fg)", borderRadius: "6px" }}
          >
            <Text fontSize="14px">{error}</Text>
          </Box>
        )}

        <Box display="flex" flexDirection="column" gap={3}>
          {providers.map((prov) => {
            const account = accounts.find((a) => a.provider.toLowerCase() === prov.id.toLowerCase());
            const isConnected = Boolean(account?.connected);
            const isSupported = supportedProviders.includes(prov.id.toLowerCase());
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
                    style={{
                      borderRadius: "8px",
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
                    {isConnected && isLastLoginMethod && (
                      <DetailSubtitle style={{ display: "block", marginTop: "4px", fontSize: "12px" }}>
                        {lockoutHelperText}
                      </DetailSubtitle>
                    )}
                  </Box>
                </Box>

                {isConnected ? (
                  confirmingDisconnectId === prov.id && !isLastLoginMethod ? (
                    <Box display="flex" alignItems="center" gap={2}>
                      <SecondaryButton
                        type="button"
                        style={{ padding: "6px 12px", fontSize: "13px" }}
                        onClick={() => setConfirmingDisconnectId(null)}
                      >
                        Cancel
                      </SecondaryButton>
                      <DangerButton
                        type="button"
                        style={{ padding: "6px 14px", fontSize: "13px" }}
                        onClick={async () => {
                          setConfirmingDisconnectId(null);
                          setError(null);
                          setSuccess(null);
                          try {
                            await unlinkConnectedAccount(prov.id);
                            setAccounts((prev) =>
                              prev.map((a) =>
                                a.provider.toLowerCase() === prov.id.toLowerCase() ? { ...a, connected: false } : a,
                              ),
                            );
                            setSuccess(`Unlinked ${prov.name} successfully.`);
                          } catch (err: unknown) {
                            setError(getApiErrorMessage(err, `Failed to unlink ${prov.name}.`));
                          }
                        }}
                      >
                        Confirm Disconnect?
                      </DangerButton>
                    </Box>
                  ) : (
                    <SecondaryButton
                      type="button"
                      disabled={isLastLoginMethod}
                      title={isLastLoginMethod ? lockoutHelperText : undefined}
                      style={{
                        borderColor: "rgba(239, 68, 68, 0.4)",
                        color: "var(--color-danger-fg, #ef4444)",
                        opacity: isLastLoginMethod ? 0.5 : 1,
                        cursor: isLastLoginMethod ? "not-allowed" : "pointer",
                      }}
                      onClick={() => {
                        if (isLastLoginMethod) return;
                        setConfirmingDisconnectId(prov.id);
                      }}
                    >
                      Disconnect
                    </SecondaryButton>
                  )
                ) : !isSupported ? (
                  <SecondaryButton type="button" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
                    Coming Soon (Not Enabled)
                  </SecondaryButton>
                ) : (
                  <SaveButton
                    type="button"
                    disabled={isLoading}
                    onClick={async () => {
                      setError(null);
                      setSuccess(null);
                      try {
                        const redirectUrl = await initiateOAuthLink(prov.id);
                        const safeRedirectUrl = validateOAuthRedirectUrl(redirectUrl, window.location.origin);
                        if (!safeRedirectUrl) {
                          setError(`Refused to redirect to unsupported URL for ${prov.name}.`);
                          return;
                        }
                        window.location.href = safeRedirectUrl;
                      } catch (err: unknown) {
                        setError(
                          getApiErrorMessage(
                            err,
                            `Failed to initiate ${prov.name} linking. Ensure ${prov.name} is configured on this instance.`,
                          ),
                        );
                      }
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
  );
};

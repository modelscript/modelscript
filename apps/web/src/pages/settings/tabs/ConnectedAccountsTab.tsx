// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, CheckCircleIcon, CodeIcon, GlobeIcon, RepoIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { getConnectedAccounts, initiateOAuthLink, unlinkConnectedAccount, type ConnectedAccount } from "../../../api";
import Box from "../../../components/Box";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { DangerButton, DetailSubtitle, FormLabel, Header, SaveButton, SecondaryButton } from "../settingsStyles";

export interface ConnectedAccountsTabProps {
  onBack: () => void;
}

export const ConnectedAccountsTab: React.FC<ConnectedAccountsTabProps> = ({ onBack }) => {
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [confirmingDisconnectId, setConfirmingDisconnectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    getConnectedAccounts()
      .then((res) => {
        if (res && Array.isArray(res.providers)) {
          setConnectedAccounts(res.providers);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

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
            mb={3}
            p={3}
            style={{ background: "var(--color-success-subtle)", color: "var(--color-success-fg)", borderRadius: "6px" }}
          >
            <Text fontSize="14px">{success}</Text>
          </Box>
        )}
        {error && (
          <Box
            mb={3}
            p={3}
            style={{ background: "var(--color-danger-subtle)", color: "var(--color-danger-fg)", borderRadius: "6px" }}
          >
            <Text fontSize="14px">{error}</Text>
          </Box>
        )}

        <Box display="flex" flexDirection="column" gap={3}>
          {providers.map((prov) => {
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
                  </Box>
                </Box>

                {isConnected ? (
                  confirmingDisconnectId === prov.id ? (
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
                          try {
                            await unlinkConnectedAccount(prov.id);
                            setConnectedAccounts((prev) =>
                              prev.map((a) => (a.provider === prov.id ? { ...a, connected: false } : a)),
                            );
                            setSuccess(`Unlinked ${prov.name} successfully.`);
                          } catch {
                            setError(`Failed to unlink ${prov.name}.`);
                          }
                        }}
                      >
                        Confirm Disconnect?
                      </DangerButton>
                    </Box>
                  ) : (
                    <SecondaryButton
                      type="button"
                      style={{ borderColor: "rgba(239, 68, 68, 0.4)", color: "var(--color-danger-fg, #ef4444)" }}
                      onClick={() => setConfirmingDisconnectId(prov.id)}
                    >
                      Disconnect
                    </SecondaryButton>
                  )
                ) : (
                  <SaveButton
                    type="button"
                    disabled={isLoading}
                    onClick={async () => {
                      if (prov.id === "oidc") {
                        window.location.href = "/api/v1/auth/oidc/login";
                        return;
                      }
                      try {
                        const redirectUrl = await initiateOAuthLink(prov.id);
                        window.location.href = redirectUrl;
                      } catch {
                        setError(`Failed to initiate ${prov.name} linking. Please try again.`);
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

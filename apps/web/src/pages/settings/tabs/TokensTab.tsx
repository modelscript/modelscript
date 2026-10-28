// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, ArrowLeftIcon, CheckCircleIcon, KeyIcon, TrashIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { createApiToken, getApiTokens, revokeApiToken, type ApiTokenDto } from "../../../api";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import {
  DangerButton,
  DetailSubtitle,
  DetailTitle,
  FormInput,
  FormLabel,
  Header,
  SaveButton,
  SecondaryButton,
} from "../settingsStyles";

export interface TokensTabProps {
  onBack: () => void;
}

export const TokensTab: React.FC<TokensTabProps> = ({ onBack }) => {
  const toast = useToast();
  const [apiTokens, setApiTokens] = useState<ApiTokenDto[]>([]);
  const [confirmingRevokeTokenId, setConfirmingRevokeTokenId] = useState<number | null>(null);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState<string[]>(["packages:publish"]);
  const [tokenPackagePattern, setTokenPackagePattern] = useState("*");
  const [tokenExpiresInDays, setTokenExpiresInDays] = useState<number>(90);
  const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isCreatingToken, setIsCreatingToken] = useState(false);

  useEffect(() => {
    setIsLoadingTokens(true);
    getApiTokens()
      .then((data) => setApiTokens(data))
      .catch(() => {})
      .finally(() => setIsLoadingTokens(false));
  }, []);

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Personal Access Tokens (PAT)
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Personal access tokens function like API keys. You can use them to authenticate against the ModelScript
          Registry, CI/CD automated runners, and the <code>msx</code> CLI.
        </DetailSubtitle>

        {/* Newly Created Secret Banner */}
        {createdTokenSecret && (
          <Box
            mb={4}
            p={4}
            style={{
              background: "var(--color-success-subtle)",
              border: "1px solid var(--color-success-fg)",
              borderRadius: "10px",
              color: "var(--color-success-fg)",
            }}
          >
            <Box display="flex" alignItems="center" gap={2} mb={2}>
              <CheckCircleIcon size={20} />
              <Text fontWeight="bold" fontSize="16px">
                New Token Generated Successfully
              </Text>
            </Box>
            <Text fontSize="14px" display="block" mb={2}>
              Make sure to copy your personal access token now. You will not be able to see it again!
            </Text>
            <Box
              p={3}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <code
                style={{
                  fontSize: "14px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-primary)",
                  wordBreak: "break-all",
                }}
              >
                {createdTokenSecret}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(createdTokenSecret);
                  toast.success("Token copied to clipboard!");
                }}
                style={{
                  background: "var(--color-accent-emphasis)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "13px",
                  flexShrink: 0,
                }}
              >
                Copy
              </button>
            </Box>
          </Box>
        )}

        {/* Active Tokens List */}
        <Box mb={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <DetailTitle style={{ fontWeight: "bold", fontSize: "16px" }}>
              Active Tokens ({apiTokens.length})
            </DetailTitle>
          </Box>

          {isLoadingTokens ? (
            <Text color="var(--color-fg-muted)">Loading your tokens...</Text>
          ) : apiTokens.length === 0 ? (
            <Box
              p={4}
              textAlign="center"
              style={{ border: "1px dashed var(--color-border-default)", borderRadius: "8px" }}
            >
              <Text color="var(--color-fg-muted)">No active personal access tokens found.</Text>
            </Box>
          ) : (
            <Box display="flex" flexDirection="column" gap={2}>
              {apiTokens.map((tok) => (
                <Box
                  key={tok.id}
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "var(--color-canvas-subtle)",
                  }}
                >
                  <Box display="flex" flexDirection="column" gap={1}>
                    <Box display="flex" alignItems="center" gap={2}>
                      <KeyIcon size={16} fill="var(--color-accent-purple)" />
                      <Text fontWeight="bold" fontSize="15px">
                        {tok.name}
                      </Text>
                      <span
                        style={{
                          fontSize: "12px",
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        {tok.token_prefix}...
                      </span>
                    </Box>
                    <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Scopes: {Array.isArray(tok.scopes) ? tok.scopes.join(", ") : tok.scopes}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>•</span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Pattern: <code>{tok.package_pattern}</code>
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>•</span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Expires: {tok.expires_at ? new Date(tok.expires_at).toLocaleDateString() : "Never"}
                      </span>
                    </Box>
                  </Box>

                  {confirmingRevokeTokenId === tok.id ? (
                    <Box display="flex" alignItems="center" gap={2}>
                      <SecondaryButton
                        type="button"
                        style={{ padding: "6px 12px", fontSize: "13px" }}
                        onClick={() => setConfirmingRevokeTokenId(null)}
                      >
                        Cancel
                      </SecondaryButton>
                      <DangerButton
                        type="button"
                        style={{ padding: "6px 14px", fontSize: "13px" }}
                        onClick={async () => {
                          setConfirmingRevokeTokenId(null);
                          try {
                            await revokeApiToken(tok.id);
                            setApiTokens((prev) => prev.filter((t) => t.id !== tok.id));
                            toast.success("Token revoked successfully.");
                          } catch (err: any) {
                            toast.error(err.response?.data?.error || "Failed to revoke token.");
                          }
                        }}
                      >
                        Confirm Revoke?
                      </DangerButton>
                    </Box>
                  ) : (
                    <CircleIconButton title="Revoke Token" onClick={() => setConfirmingRevokeTokenId(tok.id)}>
                      <TrashIcon size={16} color="var(--color-danger-fg)" />
                    </CircleIconButton>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Generate New Token Form */}
        <Box mt={4} style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <DetailTitle style={{ fontWeight: "bold", fontSize: "16px", display: "block", marginBottom: "16px" }}>
            Generate New Token
          </DetailTitle>

          {tokenError && (
            <Box
              mb={3}
              p={3}
              style={{
                background: "var(--color-danger-subtle)",
                color: "var(--color-danger-fg)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertIcon size={16} />
              <Text fontSize="14px">{tokenError}</Text>
            </Box>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setTokenError(null);
              setCreatedTokenSecret(null);
              setIsCreatingToken(true);
              try {
                const res = await createApiToken({
                  name: tokenName.trim(),
                  scopes: tokenScopes,
                  packagePattern: tokenPackagePattern.trim() || "*",
                  expiresInDays: tokenExpiresInDays > 0 ? tokenExpiresInDays : undefined,
                });
                setCreatedTokenSecret(res.token);
                setApiTokens([res, ...apiTokens]);
                setTokenName("");
                toast.success("Token generated successfully!");
              } catch (err: any) {
                setTokenError(err.response?.data?.error || "Failed to generate token.");
              } finally {
                setIsCreatingToken(false);
              }
            }}
          >
            <Box mb={3}>
              <FormLabel>Token Name / Description</FormLabel>
              <FormInput
                placeholder="e.g. GitHub Actions CI (Publish Release)"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                required
              />
            </Box>

            <Box mb={3}>
              <FormLabel>Package Pattern Restriction (Namespace or Wildcard)</FormLabel>
              <FormInput
                placeholder="e.g. @myorg/* or Modelica* or *"
                value={tokenPackagePattern}
                onChange={(e) => setTokenPackagePattern(e.target.value)}
                required
              />
              <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                Limits the packages this token can publish or access (use <code>*</code> for all).
              </DetailSubtitle>
            </Box>

            <Box mb={3}>
              <FormLabel>Expiration</FormLabel>
              <select
                value={tokenExpiresInDays}
                onChange={(e) => setTokenExpiresInDays(Number(e.target.value))}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-text-primary)",
                  fontSize: "14px",
                  width: "100%",
                  maxWidth: "240px",
                }}
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
                <option value={0}>No expiration</option>
              </select>
            </Box>

            <Box mb={4}>
              <FormLabel style={{ marginBottom: "8px", display: "block" }}>Select Scopes</FormLabel>
              <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px" }}>
                {[
                  {
                    scope: "packages:publish",
                    label: "packages:publish",
                    desc: "Upload and publish new package versions",
                  },
                  {
                    scope: "packages:read",
                    label: "packages:read",
                    desc: "Download private packages and packuments",
                  },
                  {
                    scope: "packages:yank",
                    label: "packages:yank",
                    desc: "Yank or deprecate published releases",
                  },
                  {
                    scope: "packages:manage",
                    label: "packages:manage",
                    desc: "Manage collaborators and access policies",
                  },
                ].map((s) => {
                  const checked = tokenScopes.includes(s.scope);
                  return (
                    <label
                      key={s.scope}
                      style={{
                        padding: "8px",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        cursor: "pointer",
                        background: checked ? "var(--color-accent-subtle, rgba(139,92,246,0.05))" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTokenScopes([...tokenScopes, s.scope]);
                          } else {
                            setTokenScopes(tokenScopes.filter((sc) => sc !== s.scope));
                          }
                        }}
                        style={{ marginTop: "3px", cursor: "pointer" }}
                      />
                      <Box>
                        <Text fontWeight="600" fontSize="13px" display="block">
                          {s.label}
                        </Text>
                        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{s.desc}</span>
                      </Box>
                    </label>
                  );
                })}
              </Box>
            </Box>

            <Box display="flex" justifyContent="flex-end">
              <SaveButton type="submit" disabled={isCreatingToken || !tokenName.trim() || tokenScopes.length === 0}>
                {isCreatingToken ? "Generating..." : "Generate Token"}
              </SaveButton>
            </Box>
          </form>
        </Box>
      </Box>
    </>
  );
};

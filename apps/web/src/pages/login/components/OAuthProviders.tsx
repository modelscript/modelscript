// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon, ShieldLockIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { GitLabIcon, GoogleIcon, MastodonIcon, XIcon } from "../icons";
import { Button, GhostButton, Input, ProviderButton } from "../styles";

export interface OAuthProvidersProps {
  oidcEnabled?: boolean | undefined;
  airgapEnforced?: boolean | undefined;
  oauthProviders?: string[] | undefined;
}

export const OAuthProviders: React.FC<OAuthProvidersProps> = ({
  oidcEnabled = false,
  airgapEnforced = false,
  oauthProviders,
}) => {
  const [isFediverseOpen, setIsFediverseOpen] = useState(false);
  const [fediverseInput, setFediverseInput] = useState("");
  const [fediverseError, setFediverseError] = useState("");

  if (airgapEnforced && !oidcEnabled) {
    return null;
  }

  const showGithub = !airgapEnforced && Boolean(oauthProviders?.includes("github"));
  const showGitlab = !airgapEnforced && Boolean(oauthProviders?.includes("gitlab"));
  const showTwitter = !airgapEnforced && Boolean(oauthProviders?.includes("twitter"));
  const showGoogle = !airgapEnforced && Boolean(oauthProviders?.includes("google"));
  const showFediverse = !airgapEnforced && Boolean(oauthProviders?.includes("fediverse"));

  if (!showGithub && !showGitlab && !showTwitter && !showGoogle && !showFediverse && !oidcEnabled) {
    return null;
  }

  const handleFediverseSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = fediverseInput.trim();
    if (!trimmed) {
      setFediverseError("Please enter your Fediverse handle or domain.");
      return;
    }
    window.location.href = `/api/v1/auth/login/fediverse?handle=${encodeURIComponent(trimmed)}`;
  };

  const quickServers = ["mastodon.social", "fosstodon.org", "techhub.social", "mathstodon.xyz"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
      {oidcEnabled && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/oidc/login")}>
          <ShieldLockIcon size={16} />
          Continue with Enterprise SSO (OIDC)
        </ProviderButton>
      )}
      {showFediverse && (
        <ProviderButton
          onClick={() => {
            setIsFediverseOpen(!isFediverseOpen);
            setFediverseError("");
          }}
          style={{ borderColor: isFediverseOpen ? "var(--color-accent-cyan, #06b6d4)" : undefined }}
        >
          <MastodonIcon />
          Continue with Fediverse
        </ProviderButton>
      )}
      {isFediverseOpen && (
        <form
          onSubmit={handleFediverseSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "12px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md, 8px)",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            Enter your handle (e.g. <code>@alice@mastodon.social</code>) or server domain:
          </div>
          <Input
            type="text"
            placeholder="@you@instance.social or instance.social"
            value={fediverseInput}
            onChange={(e) => {
              setFediverseInput(e.target.value);
              setFediverseError("");
            }}
            autoFocus
          />
          {fediverseError && (
            <div style={{ fontSize: "12px", color: "var(--color-danger, #ef4444)" }}>{fediverseError}</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {quickServers.map((srv) => (
              <button
                type="button"
                key={srv}
                onClick={() => {
                  window.location.href = `/api/v1/auth/login/fediverse?domain=${encodeURIComponent(srv)}`;
                }}
                style={{
                  fontSize: "11px",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  background: "var(--surface-overlay, rgba(255, 255, 255, 0.06))",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
              >
                {srv}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <Button type="submit" style={{ flex: 1, height: "36px", fontSize: "13px" }}>
              Connect
            </Button>
            <GhostButton
              type="button"
              onClick={() => setIsFediverseOpen(false)}
              style={{ flex: 1, height: "36px", fontSize: "13px" }}
            >
              Cancel
            </GhostButton>
          </div>
        </form>
      )}
      {showGithub && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
          <MarkGithubIcon size={16} />
          Continue with GitHub
        </ProviderButton>
      )}
      {showGitlab && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
          <GitLabIcon />
          Continue with GitLab
        </ProviderButton>
      )}
      {showTwitter && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/twitter")}>
          <XIcon />
          Continue with X
        </ProviderButton>
      )}
      {showGoogle && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/google")}>
          <GoogleIcon />
          Continue with Google
        </ProviderButton>
      )}
    </div>
  );
};

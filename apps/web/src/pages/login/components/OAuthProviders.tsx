// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon, ShieldLockIcon } from "@primer/octicons-react";
import React from "react";
import { GitLabIcon, GoogleIcon, XIcon } from "../icons";
import { ProviderButton } from "../styles";

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
  if (airgapEnforced && !oidcEnabled) {
    return null;
  }

  const showGithub = !airgapEnforced && (!oauthProviders || oauthProviders.includes("github"));
  const showGitlab = !airgapEnforced && (!oauthProviders || oauthProviders.includes("gitlab"));
  const showTwitter = !airgapEnforced && (!oauthProviders || oauthProviders.includes("twitter"));
  const showGoogle = !airgapEnforced && (!oauthProviders || oauthProviders.includes("google"));

  if (!showGithub && !showGitlab && !showTwitter && !showGoogle && !oidcEnabled) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
      {oidcEnabled && (
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/oidc/login")}>
          <ShieldLockIcon size={16} />
          Continue with Enterprise SSO (OIDC)
        </ProviderButton>
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

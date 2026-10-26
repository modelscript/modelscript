// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon } from "@primer/octicons-react";
import React from "react";
import { GitLabIcon, GoogleIcon, XIcon } from "../icons";
import { ProviderButton } from "../styles";

export const OAuthProviders: React.FC = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
        <MarkGithubIcon size={16} />
        Continue with GitHub
      </ProviderButton>
      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
        <GitLabIcon />
        Continue with GitLab
      </ProviderButton>
      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/twitter")}>
        <XIcon />
        Continue with X
      </ProviderButton>
      <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/google")}>
        <GoogleIcon />
        Continue with Google
      </ProviderButton>
    </div>
  );
};

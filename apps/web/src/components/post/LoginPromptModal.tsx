// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon, XIcon } from "@primer/octicons-react";
import { Heading, IconButton, Text } from "@primer/react";
import React from "react";
import styled from "styled-components";
import Box from "../Box";

const AnalyticsModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AnalyticsModalContainer = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
`;

const GitLabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
  </svg>
);

const TwitterXIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  background-color: var(--color-bg-primary);
  color: var(--color-fg-default);
  border: 1px solid var(--color-border-default);
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-bg-hover);
  }
`;

export interface LoginPromptModalProps {
  onClose: () => void;
}

export const LoginPromptModal: React.FC<LoginPromptModalProps> = ({ onClose }) => {
  const handleOAuthLogin = (provider: string) => {
    window.location.href = `/api/v1/auth/login/${provider}`;
  };

  return (
    <AnalyticsModalOverlay
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <AnalyticsModalContainer onClick={(e) => e.stopPropagation()} style={{ maxWidth: "400px", padding: "32px" }}>
        <Box display="flex" justifyContent="flex-end" mb={2}>
          <IconButton icon={XIcon} variant="invisible" onClick={onClose} aria-label="Close" />
        </Box>
        <Box display="flex" flexDirection="column" alignItems="center" textAlign="center" mb={4}>
          <Heading as="h2" style={{ fontSize: "24px", marginBottom: "8px" }}>
            Sign in to ModelScript
          </Heading>
          <Text style={{ color: "var(--color-fg-muted)" }}>
            Join the conversation to like, repost, reply, and bookmark posts.
          </Text>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          <ProviderButton onClick={() => handleOAuthLogin("github")}>
            <MarkGithubIcon size={20} />
            Continue with GitHub
          </ProviderButton>
          <ProviderButton onClick={() => handleOAuthLogin("gitlab")}>
            <GitLabIcon />
            Continue with GitLab
          </ProviderButton>
          <ProviderButton onClick={() => handleOAuthLogin("twitter")}>
            <TwitterXIcon />
            Continue with X
          </ProviderButton>
        </Box>
      </AnalyticsModalContainer>
    </AnalyticsModalOverlay>
  );
};

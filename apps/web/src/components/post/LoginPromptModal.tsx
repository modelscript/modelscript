// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import { Heading, IconButton, Text } from "@primer/react";
import React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useInstanceBranding } from "../../InstanceBrandingContext";
import Box from "../Box";

const AnalyticsModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
`;

const AnalyticsModalContainer = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
`;

const PrimaryButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
  color: #ffffff;
  border: none;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.92;
  }
`;

const SecondaryButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  font-size: 15px;
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
  const branding = useInstanceBranding();
  const brandName =
    !branding.instanceName || branding.instanceName === "Ansatz" ? "Ansatz Network" : branding.instanceName;
  const navigate = useNavigate();

  const modal = (
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
            Sign in to {brandName}
          </Heading>
          <Text style={{ color: "var(--color-fg-muted)" }}>
            Join the conversation to like, repost, reply, and bookmark posts.
          </Text>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          <PrimaryButton
            onClick={() => {
              onClose();
              navigate("/login");
            }}
          >
            Sign In
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              onClose();
              navigate("/signup");
            }}
          >
            Create an Account
          </SecondaryButton>
        </Box>
      </AnalyticsModalContainer>
    </AnalyticsModalOverlay>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
};

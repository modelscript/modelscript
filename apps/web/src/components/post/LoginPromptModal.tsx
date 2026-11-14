// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useInstanceBranding } from "../../InstanceBrandingContext";
import Box from "../Box";

export interface LoginPromptModalProps {
  onClose: () => void;
}

export const LoginPromptModal: React.FC<LoginPromptModalProps> = ({ onClose }) => {
  const branding = useInstanceBranding();
  const brandName =
    !branding.instanceName || branding.instanceName === "Ansatz" ? "Ansatz Network" : branding.instanceName;
  const navigate = useNavigate();

  return (
    <Dialog title={`Sign in to ${brandName}`} width="small" onClose={onClose}>
      <Box display="flex" flexDirection="column" gap={3} p={1}>
        <Text style={{ color: "var(--ms-text-2, var(--color-fg-muted))", fontSize: "14px", lineHeight: 1.5 }}>
          Join the conversation to like, repost, reply, and bookmark posts.
        </Text>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <Button
            variant="primary"
            size="large"
            block
            onClick={() => {
              onClose();
              navigate("/login");
            }}
          >
            Sign In
          </Button>
          <Button
            variant="default"
            size="large"
            block
            onClick={() => {
              onClose();
              navigate("/signup");
            }}
          >
            Create an Account
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

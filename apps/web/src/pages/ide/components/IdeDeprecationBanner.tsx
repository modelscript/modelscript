// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { DeprecationBanner } from "../styles";

export interface IdeDeprecationBannerProps {
  displayTitle: string;
  onSwitchToBlank: () => void;
  onDismiss: () => void;
}

export const IdeDeprecationBanner: React.FC<IdeDeprecationBannerProps> = ({
  displayTitle,
  onSwitchToBlank,
  onDismiss,
}) => {
  return (
    <DeprecationBanner>
      <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0 }}>
        <AlertIcon size={14} style={{ color: "#d29922", flexShrink: 0 }} />
        <Text style={{ fontSize: "12px", color: "var(--color-fg-default)" }}>
          <strong>Notice:</strong> Example workspace &ldquo;{displayTitle}&rdquo; is deprecated. For new modeling
          projects, we recommend starting in the Blank Workspace.
        </Text>
      </Box>
      <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
        <Button
          size="small"
          variant="primary"
          onClick={onSwitchToBlank}
          style={{
            fontSize: "11px",
            height: "24px",
            padding: "0 8px",
          }}
        >
          Switch to Blank Workspace
        </Button>
        <IconButton
          aria-label="Dismiss banner"
          icon={XIcon}
          size="small"
          variant="invisible"
          onClick={onDismiss}
          sx={{ color: "var(--color-fg-muted)", height: "24px", width: "24px" }}
        />
      </Box>
    </DeprecationBanner>
  );
};

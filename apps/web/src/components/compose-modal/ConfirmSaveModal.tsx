// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading } from "@primer/react";
import React from "react";
import Box from "../Box";
import { ModalPanel, Overlay } from "./styles";

interface ConfirmSaveModalProps {
  onCancel: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export const ConfirmSaveModal: React.FC<ConfirmSaveModalProps> = ({ onCancel, onSave, onDiscard }) => {
  return (
    <Overlay style={{ zIndex: 1100, background: "rgba(0,0,0,0.6)" }} onClick={onCancel}>
      <ModalPanel onClick={(e) => e.stopPropagation()} style={{ maxWidth: "320px", minHeight: "auto", margin: "auto" }}>
        <Box p={4} pb={5} display="flex" flexDirection="column" alignItems="flex-start" gap={2}>
          <Heading
            as="h3"
            style={{
              margin: "4px 0 0 0",
              fontSize: "20px",
              fontWeight: "bold",
              color: "var(--color-text-heading)",
            }}
          >
            Save post?
          </Heading>
          <span style={{ color: "var(--color-text-muted)", fontSize: "15px", lineHeight: "1.4", marginBottom: "8px" }}>
            You can save this to send later from your drafts.
          </span>
          <Box display="flex" flexDirection="column" gap={3} width="100%" mt={2}>
            <button
              style={{
                background: "var(--gradient-cta)",
                color: "#ffffff",
                border: "none",
                borderRadius: "9999px",
                padding: "12px",
                fontWeight: "bold",
                fontSize: "15px",
                cursor: "pointer",
                boxShadow: "var(--glow-ai-sm)",
              }}
              onClick={onSave}
            >
              Save
            </button>
            <button
              style={{
                background: "transparent",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: "9999px",
                padding: "12px",
                fontWeight: "bold",
                fontSize: "15px",
                cursor: "pointer",
              }}
              onClick={onDiscard}
            >
              Discard
            </button>
          </Box>
        </Box>
      </ModalPanel>
    </Overlay>
  );
};

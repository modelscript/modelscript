// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading } from "@primer/react";
import React, { useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import Box from "../Box";
import { ConfirmModalPanel, NestedOverlay } from "./styles";

interface ConfirmSaveModalProps {
  onCancel: () => void;
  onSave: () => void;
  onDiscard: () => void;
  isEditing?: boolean | undefined;
}

export const ConfirmSaveModal: React.FC<ConfirmSaveModalProps> = ({ onCancel, onSave, onDiscard, isEditing }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true, { onEscape: onCancel });

  return (
    <NestedOverlay onClick={onCancel}>
      <ConfirmModalPanel
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <Box p={4} pb={5} display="flex" flexDirection="column" alignItems="flex-start" gap={2}>
          <Heading
            as="h3"
            id="confirm-save-title"
            style={{
              margin: "4px 0 0 0",
              fontSize: "20px",
              fontWeight: "bold",
              color: "var(--color-text-heading)",
            }}
          >
            {isEditing ? "Discard changes?" : "Save post?"}
          </Heading>
          <span style={{ color: "var(--color-text-muted)", fontSize: "15px", lineHeight: "1.4", marginBottom: "8px" }}>
            {isEditing
              ? "Your edits to this post have not been saved."
              : "You can save this to send later from your drafts."}
          </span>
          <Box display="flex" flexDirection="column" gap={3} width="100%" mt={2}>
            {!isEditing && (
              <button
                type="button"
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
            )}
            <button
              type="button"
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
            {isEditing && (
              <button
                type="button"
                style={{
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 12px",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
                onClick={onCancel}
              >
                Keep editing
              </button>
            )}
          </Box>
        </Box>
      </ConfirmModalPanel>
    </NestedOverlay>
  );
};

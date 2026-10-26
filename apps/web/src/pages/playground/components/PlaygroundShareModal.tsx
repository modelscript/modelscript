// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon } from "@primer/octicons-react";
import { Dialog, IconButton } from "@primer/react";
import React from "react";

export interface PlaygroundShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  copyStatus: string | null;
  shareUrl: string;
  embedCode: string;
  markdownBadge: string;
  onCopy: (text: string, label: string) => void;
}

export const PlaygroundShareModal: React.FC<PlaygroundShareModalProps> = ({
  isOpen,
  onClose,
  copyStatus,
  shareUrl,
  embedCode,
  markdownBadge,
  onCopy,
}) => {
  if (!isOpen) return null;

  return (
    <Dialog
      title="Share Interactive Model"
      onClose={onClose}
      footerButtons={[
        {
          buttonType: "primary",
          content: copyStatus ? `✓ Copied ${copyStatus}!` : "Copy Direct Link",
          onClick: () => onCopy(shareUrl, "Link"),
        },
        {
          buttonType: "normal",
          content: "Done",
          onClick: onClose,
        },
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p style={{ fontSize: "13px", color: "var(--color-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          Share this self-contained cyber-physical model. The entire code, diagram layout, and simulation settings are
          encoded directly into the URL—anyone with the link can run and edit it immediately without creating an
          account.
        </p>

        <div>
          <p style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}>
            Direct Shareable Link
          </p>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              background: "var(--color-canvas-subtle)",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
            }}
          >
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {shareUrl}
            </div>
            <IconButton aria-label="Copy Link" icon={CopyIcon} size="small" onClick={() => onCopy(shareUrl, "Link")} />
          </div>
        </div>

        <div>
          <p style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}>
            Embed Widget (for Substack, Notion, blogs, docs)
          </p>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              background: "var(--color-canvas-subtle)",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
            }}
          >
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {embedCode}
            </div>
            <IconButton
              aria-label="Copy Embed Code"
              icon={CopyIcon}
              size="small"
              onClick={() => onCopy(embedCode, "Embed Code")}
            />
          </div>
        </div>

        <div>
          <p style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}>
            Markdown Badge (for GitHub READMEs)
          </p>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              background: "var(--color-canvas-subtle)",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
            }}
          >
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {markdownBadge}
            </div>
            <IconButton
              aria-label="Copy Markdown Badge"
              icon={CopyIcon}
              size="small"
              onClick={() => onCopy(markdownBadge, "Markdown Badge")}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon } from "@primer/octicons-react";
import { Dialog, IconButton } from "@primer/react";
import React, { useState } from "react";

export interface PlaygroundShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  copyStatus: string | null;
  shareUrl: string;
  embedCode: string;
  getEmbedCode?: (format: "iframe" | "custom-tag" | "morsel-tag") => string;
  markdownBadge: string;
  onCopy: (text: string, label: string) => void;
}

export const PlaygroundShareModal: React.FC<PlaygroundShareModalProps> = ({
  isOpen,
  onClose,
  copyStatus,
  shareUrl,
  embedCode,
  getEmbedCode,
  markdownBadge,
  onCopy,
}) => {
  const [embedFormat, setEmbedFormat] = useState<"iframe" | "custom-tag" | "morsel-tag">("iframe");

  if (!isOpen) return null;

  const embedSrc = shareUrl.replace("/playground", "/embed/playground");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
  const defaultMorselTag = `<script src="${origin}/static/embed.js" defer></script>\n<modelscript-morsel src="${embedSrc}" height="480px"></modelscript-morsel>`;
  const defaultCustomTag = `<script src="${origin}/static/embed.js" defer></script>\n<modelscript-viewer src="${embedSrc}" height="480px"></modelscript-viewer>`;
  const activeEmbedCode = getEmbedCode
    ? getEmbedCode(embedFormat)
    : embedFormat === "morsel-tag"
      ? defaultMorselTag
      : embedFormat === "custom-tag"
        ? defaultCustomTag
        : embedCode;

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
                userSelect: "all",
              }}
            >
              {shareUrl}
            </div>
            <IconButton aria-label="Copy Link" icon={CopyIcon} size="small" onClick={() => onCopy(shareUrl, "Link")} />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginBottom: "6px",
            }}
          >
            <p style={{ fontSize: "12px", fontWeight: "bold", margin: 0, color: "var(--color-fg-default)" }}>
              Embed Widget (for Intranet, Confluence, Notion, docs)
            </p>
            <div
              role="group"
              aria-label="Embed format"
              style={{
                display: "inline-flex",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                overflow: "hidden",
                background: "var(--color-canvas-subtle)",
              }}
            >
              <button
                type="button"
                onClick={() => setEmbedFormat("iframe")}
                style={{
                  border: "none",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: embedFormat === "iframe" ? 600 : 400,
                  cursor: "pointer",
                  background: embedFormat === "iframe" ? "var(--color-accent-fg, #0969da)" : "transparent",
                  color: embedFormat === "iframe" ? "#ffffff" : "var(--color-fg-muted)",
                }}
              >
                Iframe
              </button>
              <button
                type="button"
                onClick={() => setEmbedFormat("morsel-tag")}
                style={{
                  border: "none",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: embedFormat === "morsel-tag" ? 600 : 400,
                  cursor: "pointer",
                  background: embedFormat === "morsel-tag" ? "var(--color-accent-fg, #0969da)" : "transparent",
                  color: embedFormat === "morsel-tag" ? "#ffffff" : "var(--color-fg-muted)",
                }}
              >
                &lt;modelscript-morsel&gt;
              </button>
              <button
                type="button"
                onClick={() => setEmbedFormat("custom-tag")}
                style={{
                  border: "none",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: embedFormat === "custom-tag" ? 600 : 400,
                  cursor: "pointer",
                  background: embedFormat === "custom-tag" ? "var(--color-accent-fg, #0969da)" : "transparent",
                  color: embedFormat === "custom-tag" ? "#ffffff" : "var(--color-fg-muted)",
                }}
              >
                &lt;modelscript-viewer&gt;
              </button>
            </div>
          </div>
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
                userSelect: "all",
              }}
            >
              {activeEmbedCode}
            </div>
            <IconButton
              aria-label="Copy Embed Code"
              icon={CopyIcon}
              size="small"
              onClick={() => onCopy(activeEmbedCode, "Embed Code")}
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
                userSelect: "all",
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

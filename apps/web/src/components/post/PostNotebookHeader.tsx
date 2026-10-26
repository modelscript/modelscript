// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import { formatRelativeTime } from "./styles";

export interface PostNotebookHeaderProps {
  notebookData: {
    series?: string | undefined;
    seriesPart?: number | undefined;
    difficulty?: string | undefined;
    dialect?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
  };
  readTimeMinutes: number;
  wasUpdated: boolean;
  updatedAt: string;
  canEditPost: boolean;
  onOpenEditModal: () => void;
  isDetailView: boolean;
  notebookHeadings: { slug: string; level: number; text: string }[];
  onHeadingClick: (slug: string) => void;
}

export const PostNotebookHeader: React.FC<PostNotebookHeaderProps> = ({
  notebookData,
  readTimeMinutes,
  wasUpdated,
  updatedAt,
  canEditPost,
  onOpenEditModal,
  isDetailView,
  notebookHeadings,
  onHeadingClick,
}) => {
  const [showInlineToc, setShowInlineToc] = useState(false);

  const diffStyle = (() => {
    switch (notebookData.difficulty?.toLowerCase()) {
      case "beginner":
        return {
          bg: "rgba(16, 185, 129, 0.15)",
          fg: "var(--color-status-verified, #10b981)",
          border: "rgba(16, 185, 129, 0.35)",
        };
      case "intermediate":
        return {
          bg: "rgba(245, 158, 11, 0.15)",
          fg: "var(--color-accent-amber, #f59e0b)",
          border: "rgba(245, 158, 11, 0.35)",
        };
      case "advanced":
        return {
          bg: "rgba(239, 68, 68, 0.15)",
          fg: "var(--color-error, #ef4444)",
          border: "rgba(239, 68, 68, 0.35)",
        };
      default:
        return undefined;
    }
  })();

  return (
    <div
      style={{
        marginTop: "6px",
        padding: isDetailView ? "16px 18px" : "12px 14px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, rgba(6, 182, 212, 0.07), rgba(139, 92, 246, 0.06))",
        border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
          {notebookData.series && (
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: "rgba(6, 182, 212, 0.15)",
                color: "var(--color-accent-cyan)",
                border: "1px solid rgba(6, 182, 212, 0.32)",
              }}
            >
              📚 {notebookData.series}
              {notebookData.seriesPart ? ` · Part ${notebookData.seriesPart}` : ""}
            </span>
          )}
          {notebookData.difficulty && diffStyle && (
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: diffStyle.bg,
                color: diffStyle.fg,
                border: `1px solid ${diffStyle.border}`,
              }}
            >
              ● {notebookData.difficulty}
            </span>
          )}
          {notebookData.dialect && (
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 600,
                fontFamily: "var(--font-mono, monospace)",
                padding: "2px 8px",
                borderRadius: "9999px",
                background: "rgba(255, 255, 255, 0.05)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border-subtle)",
              }}
            >
              ⚙️ {notebookData.dialect}
            </span>
          )}
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            ⏱ {readTimeMinutes} min read
          </span>
          {wasUpdated && (
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-accent-cyan)",
              }}
            >
              · Updated {formatRelativeTime(updatedAt)}
            </span>
          )}
        </div>

        {canEditPost && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onOpenEditModal();
            }}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            ✏️ Edit Tutorial
          </button>
        )}
      </div>

      {notebookData.title && (
        <div
          style={{
            fontSize: isDetailView ? "23px" : "18.5px",
            fontWeight: 800,
            color: "var(--color-text-heading, var(--color-fg-default))",
            lineHeight: 1.28,
            letterSpacing: "-0.015em",
          }}
        >
          {notebookData.title}
        </div>
      )}

      {notebookData.summary && (
        <div
          style={{
            fontSize: isDetailView ? "14.5px" : "13.5px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {notebookData.summary}
        </div>
      )}

      {/* Collapsible In-Article Table of Contents */}
      {notebookHeadings.length > 0 && (
        <div style={{ marginTop: "2px" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowInlineToc(!showInlineToc);
            }}
            style={{
              background: "rgba(0, 0, 0, 0.2)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "8px",
              padding: "5px 10px",
              fontSize: "11.5px",
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 600,
              color: "var(--color-accent-cyan)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>📑 Table of Contents ({notebookHeadings.length} sections)</span>
            <span>{showInlineToc ? "▲" : "▼"}</span>
          </button>
          {showInlineToc && (
            <div
              style={{
                marginTop: "8px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(0, 0, 0, 0.25)",
                border: "1px solid var(--color-border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {notebookHeadings.map((h, i) => (
                <a
                  key={`${h.slug}-${i}`}
                  href={`#${h.slug}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onHeadingClick(h.slug);
                  }}
                  style={{
                    paddingLeft: h.level === 3 ? "14px" : "0px",
                    fontSize: h.level === 3 ? "12px" : "12.5px",
                    fontWeight: h.level === 3 ? 500 : 600,
                    color: h.level === 3 ? "var(--color-text-muted)" : "var(--color-text-primary)",
                    textDecoration: "none",
                  }}
                >
                  {h.text}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

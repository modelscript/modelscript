// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, TagIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoMergeResult, SpaceEcoProposalRecord } from "../../../api";
import { getEcoStatusBadge, getSeverityBadge, QUICK_JUMP_SECTIONS } from "./badges";

export interface EcoDetailHeaderProps {
  eco: SpaceEcoProposalRecord;
  isMerged: boolean;
  mergeResult: SpaceEcoMergeResult | null;
  activeSection: string;
  onBackToList: () => void;
  onScrollToSection: (sectionId: string) => void;
  backLabel?: string;
}

export const EcoDetailHeader: React.FC<EcoDetailHeaderProps> = ({
  eco,
  isMerged,
  mergeResult,
  activeSection,
  onBackToList,
  onScrollToSection,
  backLabel = "All Change Requests",
}) => {
  const severityBadge = getSeverityBadge(eco.severity);
  const statusBadge = getEcoStatusBadge(eco.status);

  return (
    <>
      {/* Back to All Change Requests Breadcrumb */}
      <div>
        <button
          type="button"
          onClick={onBackToList}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
            borderRadius: "6px",
            border: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-default)",
            color: "var(--color-fg-default)",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.12s ease",
          }}
        >
          <ArrowLeftIcon size={14} />
          <span>{backLabel}</span>
        </button>
      </div>

      {/* GitHub PR Title Block */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          paddingBottom: "20px",
          borderBottom: "1px solid var(--color-border-default)",
        }}
      >
        {/* Title Line */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "26px",
                fontWeight: 600,
                color: "var(--color-fg-default)",
                letterSpacing: "-0.015em",
              }}
            >
              {eco.title}
            </h1>
            <span style={{ fontSize: "24px", fontWeight: 300, color: "var(--color-fg-muted)" }}>#{eco.eco_number}</span>
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "4px",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-fg-muted)",
                border: "1px solid var(--color-border-default)",
              }}
            >
              ECO-{eco.eco_number}
            </span>
          </div>

          {isMerged && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                borderRadius: "6px",
                background: "color-mix(in srgb, #8250df 15%, transparent)",
                color: "#8250df",
                fontSize: "12.5px",
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <TagIcon size={14} />
              {mergeResult?.releaseTag || `v1.0.${eco.eco_number}-eco`}
            </span>
          )}
        </div>

        {/* Subtitle / StateLabel Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "14px" }}>
          <span
            style={{
              padding: "5px 14px",
              borderRadius: "2em",
              fontSize: "14px",
              fontWeight: 600,
              background: statusBadge.bg,
              color: statusBadge.fg,
              border: `1px solid ${statusBadge.border}`,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {statusBadge.icon}
            <span>{statusBadge.label}</span>
          </span>

          <span style={{ color: "var(--color-fg-muted)" }}>
            <strong style={{ color: "var(--color-fg-default)" }}>@{eco.author_username || "engineer"}</strong> wants to
            merge into{" "}
            <code
              style={{
                fontFamily: "var(--font-mono, monospace)",
                background: "var(--color-canvas-subtle)",
                padding: "2px 6px",
                borderRadius: "6px",
                color: "var(--ms-brand)",
                border: "1px solid var(--color-border-default)",
                fontSize: "12.5px",
              }}
            >
              {eco.target_branch}
            </code>{" "}
            from{" "}
            <code
              style={{
                fontFamily: "var(--font-mono, monospace)",
                background: "var(--color-canvas-subtle)",
                padding: "2px 6px",
                borderRadius: "6px",
                color: "var(--ms-brand)",
                border: "1px solid var(--color-border-default)",
                fontSize: "12.5px",
              }}
            >
              {eco.source_branch}
            </code>
          </span>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 9px",
              borderRadius: "2em",
              fontSize: "12px",
              fontWeight: 600,
              background: severityBadge.bg,
              color: severityBadge.fg,
              border: `1px solid ${severityBadge.border}`,
            }}
            title={severityBadge.sublabel}
          >
            <span>{severityBadge.icon}</span>
            <span>{severityBadge.label}</span>
          </span>
        </div>
      </div>

      {/* Quick Jump Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          padding: "8px 12px",
          borderRadius: "6px",
          background: "var(--color-canvas-subtle)",
          border: "1px solid var(--color-border-default)",
          fontSize: "12.5px",
        }}
      >
        <span style={{ color: "var(--color-fg-muted)", fontWeight: 600, marginRight: "4px" }}>Jump to:</span>
        {QUICK_JUMP_SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => onScrollToSection(sec.id)}
            style={{
              padding: "4px 10px",
              borderRadius: "2em",
              border: "1px solid var(--color-border-default)",
              background:
                activeSection === sec.id
                  ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))"
                  : "var(--color-canvas-default)",
              color: activeSection === sec.id ? "var(--ms-brand)" : "var(--color-fg-muted)",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {sec.label}
          </button>
        ))}
      </div>
    </>
  );
};

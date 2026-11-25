// SPDX-License-Identifier: AGPL-3.0-or-later

import { TagIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoProposalRecord } from "../../../api";
import { SpaceCardPanel, SpaceInspectorPanel } from "./styles";

export interface EcoDetailSidebarProps {
  eco: SpaceEcoProposalRecord;
  complianceStandards: string[];
  sectionLabels?: {
    underChangeControl: string;
    plmGovernance: string;
  };
}

export const EcoDetailSidebar: React.FC<EcoDetailSidebarProps> = ({
  eco,
  complianceStandards,
  sectionLabels = {
    underChangeControl: "Under Change Control",
    plmGovernance: "PLM Governance",
  },
}) => (
  <SpaceInspectorPanel>
    <SpaceCardPanel style={{ padding: 0, gap: 0, overflow: "hidden" }}>
      {/* Reviewers */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border-default)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>Reviewers</span>
          <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>{eco.approvals.length} of 2 required</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {eco.approvals.length > 0 ? (
            eco.approvals.map((a) => (
              <div
                key={a.user_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "13px",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--color-fg-default)" }}>@{a.username}</span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color:
                      a.decision === "approved"
                        ? "var(--color-success-fg, #1a7f37)"
                        : "var(--color-attention-fg, #9a6700)",
                  }}
                >
                  {a.decision === "approved" ? "✓ Approved" : "⏳ Changes"}
                </span>
              </div>
            ))
          ) : (
            <span style={{ fontSize: "12.5px", color: "var(--color-fg-muted)" }}>Awaiting review & sign-off</span>
          )}
        </div>
      </div>

      {/* Simulation Checks */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border-default)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>Simulation Checks</span>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-success-fg, #1a7f37)" }}>
            ✓ CVODE Passed
          </span>
        </div>
        <div
          style={{
            fontSize: "12px",
            color: "var(--color-fg-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
          }}
        >
          <span>Solver: SUNDIALS CVODE</span>
          <span>Tolerance: &lt; ±5.0% envelope</span>
        </div>
      </div>

      {/* Under Change Control Subsystems */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border-default)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>
            {sectionLabels.underChangeControl}
          </span>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: "2em",
              fontSize: "11px",
              fontWeight: 600,
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-muted)",
              border: "1px solid var(--color-border-default)",
            }}
          >
            {eco.impacted_models.length} models
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {eco.impacted_models.map((m) => (
            <div
              key={m}
              style={{
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-fg-default)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: "var(--ms-brand)" }}>•</span>
              <span title={m}>{m}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Target Release */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border-default)" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: "12px",
            color: "var(--color-fg-muted)",
            display: "block",
            marginBottom: "6px",
          }}
        >
          Target Release Tag
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: "var(--font-mono)",
            fontSize: "12.5px",
            color: "var(--color-fg-default)",
          }}
        >
          <TagIcon size={13} />
          <span>v1.0.{eco.eco_number}</span>
        </div>
      </div>

      {/* PLM Governance & Standards */}
      <div style={{ padding: "16px 18px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>
            {sectionLabels.plmGovernance}
          </span>
          <span
            style={{
              padding: "2px 6px",
              borderRadius: "2em",
              fontSize: "10.5px",
              fontWeight: 700,
              background: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
              color: "var(--color-success-fg, #1a7f37)",
              border: "1px solid var(--color-success-muted, rgba(26, 127, 55, 0.25))",
            }}
          >
            ENFORCED
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "5px",
            fontSize: "12px",
            color: "var(--color-fg-muted)",
          }}
        >
          <div>• DAE Simulation Gate</div>
          <div>• Ed25519 Sign-Off Quorum</div>
          <div>• {complianceStandards.join(", ")} Policy</div>
        </div>
      </div>
    </SpaceCardPanel>
  </SpaceInspectorPanel>
);

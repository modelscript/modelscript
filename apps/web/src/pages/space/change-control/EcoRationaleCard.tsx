// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import { Link } from "react-router-dom";
import type { SpaceEcoProposalRecord } from "../../../api";
import { PrSectionCard, PrSectionHeader } from "./styles";

export interface EcoRationaleCardProps {
  eco: SpaceEcoProposalRecord;
}

export const EcoRationaleCard: React.FC<EcoRationaleCardProps> = ({ eco }) => (
  <PrSectionCard id="section-rationale">
    <PrSectionHeader>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))",
            color: "var(--ms-brand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          {(eco.author_username || "e").slice(0, 1).toUpperCase()}
        </div>
        <span style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
          <strong>@{eco.author_username || "engineer"}</strong> commented
        </span>
      </div>
      <span
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--color-fg-muted)",
          padding: "2px 8px",
          borderRadius: "2em",
          border: "1px solid var(--color-border-default)",
          background: "var(--color-canvas-default)",
        }}
      >
        Author
      </span>
    </PrSectionHeader>

    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <div
        style={{
          fontSize: "14px",
          color: "var(--color-fg-default)",
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
        }}
      >
        {eco.description || "No detailed engineering rationale provided."}
      </div>

      {/* Directly Modified Domain Models Tags */}
      <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border-default)" }}>
        <div
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--color-fg-muted)",
            marginBottom: "8px",
            letterSpacing: "0.03em",
          }}
        >
          Directly Modified Subsystem Models ({eco.impacted_models.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {eco.impacted_models.map((model) => (
            <Link
              key={model}
              to={`/editor?code=${encodeURIComponent(`// Modelica model: ${model}\nmodel ImpactedModel\n  // DAE verification gate\nend ImpactedModel;\n`)}`}
              title={`Simulate ${model} in Ansatz`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                color: "var(--color-fg-default)",
                textDecoration: "none",
              }}
            >
              <span>📦</span>
              <span>{model}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  </PrSectionCard>
);

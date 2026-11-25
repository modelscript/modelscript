// SPDX-License-Identifier: AGPL-3.0-or-later

import { WorkflowIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoImpactResult } from "../../../api";
import Spinner from "../../../components/Spinner";
import { DEFAULT_ALLOCATED_REQUIREMENTS, DEFAULT_DOWNSTREAM_DEPENDENCIES } from "./badges";
import { PrSectionCard, PrSectionHeader } from "./styles";

export interface EcoBlastRadiusCardProps {
  impactResult: SpaceEcoImpactResult | null;
  loading: boolean;
  title?: string;
}

export const EcoBlastRadiusCard: React.FC<EcoBlastRadiusCardProps> = ({
  impactResult,
  loading,
  title = "Salsa Computable Blast Radius & Traceability",
}) => (
  <PrSectionCard id="section-blast-radius">
    <PrSectionHeader>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <WorkflowIcon size={16} fill="var(--ms-brand)" />
        <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>{title}</strong>
      </div>
      {impactResult && (
        <span
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: "2em",
            background: "var(--color-canvas-default)",
            color: "var(--ms-brand)",
            border: "1px solid var(--color-border-default)",
          }}
        >
          Risk Score: {impactResult.riskScore.toUpperCase()}
        </span>
      )}
    </PrSectionHeader>

    <div style={{ padding: "24px" }}>
      {loading ? (
        <div style={{ padding: "24px", display: "flex", justifyContent: "center" }}>
          <Spinner />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Downstream Subsystems */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-fg-muted)",
                letterSpacing: "0.03em",
              }}
            >
              Downstream Assemblies & Interfaces
            </span>
            {(impactResult?.downstreamDependencies || DEFAULT_DOWNSTREAM_DEPENDENCIES).map((dep) => (
              <div
                key={dep.model}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 12px",
                  borderRadius: "6px",
                  background: "var(--color-canvas-subtle)",
                  border: "1px solid var(--color-border-default)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <span>{dep.model}</span>
                <span
                  style={{
                    fontSize: "10.5px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "var(--color-canvas-default)",
                    color: "var(--color-fg-muted)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  {dep.dependencyType}
                </span>
              </div>
            ))}
          </div>

          {/* Allocated Requirements */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-fg-muted)",
                letterSpacing: "0.03em",
              }}
            >
              Allocated Requirements Traceability
            </span>
            {(impactResult?.allocatedRequirements || DEFAULT_ALLOCATED_REQUIREMENTS).map((req) => (
              <div
                key={req.reqId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 12px",
                  borderRadius: "6px",
                  background: "var(--color-canvas-subtle)",
                  border: "1px solid var(--color-border-default)",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11.5px" }}>{req.reqId}</strong>
                  <span style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>{req.title}</span>
                </div>
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
                    color: "var(--color-success-fg, #1a7f37)",
                    border: "1px solid var(--color-success-muted, rgba(26, 127, 55, 0.25))",
                  }}
                >
                  SATISFIED
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </PrSectionCard>
);

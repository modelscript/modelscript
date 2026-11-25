// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoBomResult } from "../../../api";
import { DEFAULT_BOM_PARTS } from "./badges";
import { PrSectionCard, PrSectionHeader } from "./styles";

export interface EcoBomCardProps {
  bomResult: SpaceEcoBomResult | null;
  title?: string;
  metricLabels?: {
    parts: string;
    mass: string;
    cost: string;
    carbon: string;
  };
}

export const EcoBomCard: React.FC<EcoBomCardProps> = ({
  bomResult,
  title = "Declarative BOM Redline & Parameter Overrides",
  metricLabels = {
    parts: "Net Part Delta",
    mass: "Net Mass Delta",
    cost: "Unit Cost Delta",
    carbon: "Net Carbon Impact",
  },
}) => (
  <PrSectionCard id="section-bom">
    <PrSectionHeader>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <PackageIcon size={16} />
        <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>{title}</strong>
      </div>
      <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
        {bomResult?.parts.length ?? 6} parts analyzed
      </span>
    </PrSectionHeader>

    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      {/* BOM Summary Counters */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "12px",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-fg-muted)",
              textTransform: "uppercase",
            }}
          >
            {metricLabels.parts}
          </span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color:
                (bomResult?.summary.totalPartsDelta ?? 0) > 0
                  ? "var(--color-success-fg, #1a7f37)"
                  : "var(--color-fg-default)",
            }}
          >
            {(bomResult?.summary.totalPartsDelta ?? 0) > 0 ? "+" : ""}
            {bomResult?.summary.totalPartsDelta ?? 0}
          </span>
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-fg-muted)",
              textTransform: "uppercase",
            }}
          >
            {metricLabels.mass}
          </span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--color-fg-default)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {(bomResult?.summary.massDeltaKg ?? 0) > 0 ? "+" : ""}
            {bomResult?.summary.massDeltaKg ?? 0} kg
          </span>
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-fg-muted)",
              textTransform: "uppercase",
            }}
          >
            {metricLabels.cost}
          </span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--color-fg-default)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {(bomResult?.summary.costDeltaUsd ?? 0) >= 0 ? "+$" : "-$"}
            {Math.abs(bomResult?.summary.costDeltaUsd ?? 0).toFixed(2)}
          </span>
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-fg-muted)",
              textTransform: "uppercase",
            }}
          >
            {metricLabels.carbon}
          </span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--color-success-fg, #1a7f37)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {(bomResult?.summary.carbonDeltaKgCo2 ?? 0) > 0 ? "+" : ""}
            {bomResult?.summary.carbonDeltaKgCo2 ?? 0} kg CO₂e
          </span>
        </div>
      </div>

      {/* BOM Table */}
      <div
        style={{
          border: "1px solid var(--color-border-default)",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
          <thead>
            <tr
              style={{
                background: "var(--color-canvas-subtle)",
                borderBottom: "1px solid var(--color-border-default)",
              }}
            >
              <th style={{ padding: "10px 14px" }}>Status</th>
              <th style={{ padding: "10px 14px" }}>Component / Subsystem</th>
              <th style={{ padding: "10px 14px" }}>Category</th>
              <th style={{ padding: "10px 14px", textAlign: "center" }}>Qty Delta</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Unit Cost</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Mass</th>
            </tr>
          </thead>
          <tbody>
            {(bomResult?.parts || DEFAULT_BOM_PARTS).map((part) => {
              const isAdded = part.changeStatus === "added";
              return (
                <tr key={part.partNumber} style={{ borderBottom: "1px solid var(--color-border-default)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background: isAdded
                          ? "var(--color-success-subtle, rgba(26, 127, 55, 0.1))"
                          : "var(--color-attention-subtle, rgba(154, 103, 0, 0.1))",
                        color: isAdded ? "var(--color-success-fg, #1a7f37)" : "var(--color-attention-fg, #9a6700)",
                        border: `1px solid ${isAdded ? "var(--color-success-muted, rgba(26, 127, 55, 0.25))" : "var(--color-attention-muted, rgba(154, 103, 0, 0.25))"}`,
                      }}
                    >
                      {isAdded ? "+ ADDED" : "Δ MODIFIED"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <strong>{part.name}</strong>
                    <div
                      style={{
                        fontSize: "11.5px",
                        color: "var(--color-fg-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {part.partNumber}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--color-fg-muted)" }}>{part.category}</td>
                  <td
                    style={{
                      padding: "10px 14px",
                      textAlign: "center",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {part.baselineQuantity} → <strong>{part.targetQuantity}</strong>
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    ${part.unitCostUsd.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {part.massKg} kg
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </PrSectionCard>
);

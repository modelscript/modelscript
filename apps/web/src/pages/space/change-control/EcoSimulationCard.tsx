// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, SyncIcon, WorkflowIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoProposalRecord, SpaceEcoSimulationResult } from "../../../api";
import Spinner from "../../../components/Spinner";
import type { SemanticDiffItem } from "../../../util/semantic-diff-engine";
import { DEFAULT_SOLVER_CHECKS, getSimulationGateBadge } from "./badges";
import { PrSectionCard, PrSectionHeader } from "./styles";

export interface EcoSimulationCardProps {
  eco: SpaceEcoProposalRecord;
  simResult: SpaceEcoSimulationResult | null;
  loading: boolean;
  reverifying: boolean;
  canWrite: boolean;
  focusedSemanticEdit: SemanticDiffItem | null;
  onReverify: () => void;
  chartSlot: React.ReactNode;
}

export const EcoSimulationCard: React.FC<EcoSimulationCardProps> = ({
  eco,
  simResult,
  loading,
  reverifying,
  canWrite,
  focusedSemanticEdit,
  onReverify,
  chartSlot,
}) => {
  const gateBadge = getSimulationGateBadge(eco.simulation_gate_status);

  return (
    <PrSectionCard id="section-simulation">
      <PrSectionHeader>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {gateBadge.icon}
            <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
              Continuous Simulation Verification (SUNDIALS CVODE)
            </strong>
          </div>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: "2em",
              fontSize: "12px",
              fontWeight: 600,
              background: gateBadge.bg,
              color: gateBadge.fg,
              border: `1px solid ${gateBadge.border}`,
            }}
          >
            {gateBadge.fullLabel}
          </span>

          {simResult?.latestWorkflowRun && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "3px 10px",
                borderRadius: "2em",
                fontSize: "11.5px",
                fontWeight: 500,
                background: "var(--color-neutral-subtle, rgba(127,127,127,0.1))",
                color: "var(--color-fg-muted)",
                border: "1px solid var(--color-border-subtle, var(--color-border))",
              }}
            >
              <WorkflowIcon size={12} />
              <span>
                {simResult.latestWorkflowRun.provider === "gitlab" ? "GitLab CI" : "GitHub Actions"}:{" "}
                {simResult.latestWorkflowRun.workflowName} ({simResult.latestWorkflowRun.durationMs}ms)
              </span>
            </span>
          )}
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={onReverify}
            disabled={reverifying}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: reverifying ? "not-allowed" : "pointer",
              opacity: reverifying ? 0.7 : 1,
            }}
          >
            <SyncIcon size={13} className={reverifying ? "spin" : ""} />
            <span>{reverifying ? "Integrating DAE..." : "Re-Run Simulation Checks"}</span>
          </button>
        )}
      </PrSectionHeader>

      <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Trajectory Overlay Chart (Generous 320px Height) */}
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "6px",
            border: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div>
              <strong style={{ fontSize: "13px", color: "var(--color-fg-default)" }}>
                State Trajectory Comparison: x(t) Transient Response
              </strong>
              <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", marginTop: "2px" }}>
                Baseline <code style={{ fontFamily: "var(--font-mono)" }}>main</code> vs Change Request{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>{eco.source_branch}</code> with ±5% Tolerance Envelope
              </div>
              {focusedSemanticEdit && (
                <div
                  style={{
                    marginTop: "6px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "3px 10px",
                    borderRadius: "2em",
                    background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.14))",
                    color: "var(--ms-brand)",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <span>🎯 Focused AST Symbol: {focusedSemanticEdit.symbol}</span>
                  <span>·</span>
                  <span>{focusedSemanticEdit.peekBadge}</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "14px", fontSize: "12px", color: "var(--color-fg-muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "14px", height: "3px", background: "#0969da", borderRadius: "1px" }} />
                <strong style={{ color: "var(--color-fg-default)" }}>Branch x(t)</strong>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "14px", height: "2px", background: "#8c959f", borderStyle: "dashed" }} />
                <span>Baseline Target</span>
              </span>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
              <Spinner />
            </div>
          ) : (
            chartSlot
          )}
        </div>

        {/* Solver Checks Table (GitHub Check Runs List) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--color-fg-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            Deterministic Solver Checks
          </div>
          {(simResult?.checks || DEFAULT_SOLVER_CHECKS).map((chk) => (
            <div
              key={chk.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                fontSize: "12.5px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckCircleFillIcon size={14} fill="var(--color-success-fg, #1a7f37)" />
                <span style={{ fontWeight: 600 }}>{chk.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11.5px",
                    color: "var(--color-fg-muted)",
                  }}
                >
                  {chk.value} ({chk.limit})
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "4px",
                    background: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
                    color: "var(--color-success-fg, #1a7f37)",
                  }}
                >
                  {chk.margin}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PrSectionCard>
  );
};

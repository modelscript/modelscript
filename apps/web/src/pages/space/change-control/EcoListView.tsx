// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoProposalRecord } from "../../../api";
import { getEcoStatusBadge, getSeverityBadge, getSimulationGateBadge } from "./badges";
import { MasterDetailGrid, PrTableRow } from "./styles";
import type { EcoMetricsSummary, EcoStatusFilter } from "./types";

export interface EcoListViewProps {
  filteredEcos: SpaceEcoProposalRecord[];
  metrics: EcoMetricsSummary;
  canWrite: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: EcoStatusFilter;
  onStatusFilterChange: (filter: EcoStatusFilter) => void;
  severityFilter: string;
  onSeverityFilterChange: (value: string) => void;
  gateFilter: string;
  onGateFilterChange: (value: string) => void;
  onSelectEco: (ecoId: string) => void;
  onOpenNewEcoForm: () => void;
  newButtonLabel?: string;
  telemetryLabels?: {
    activeProposals: string;
    simulationGate: string;
    cryptographicSignOffs: string;
  };
}

export const EcoListView: React.FC<EcoListViewProps> = ({
  filteredEcos,
  metrics,
  canWrite,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  severityFilter,
  onSeverityFilterChange,
  gateFilter,
  onGateFilterChange,
  onSelectEco,
  onOpenNewEcoForm,
  newButtonLabel = "+ New Change Request",
  telemetryLabels = {
    activeProposals: "Active Proposals",
    simulationGate: "DAE Simulation Gate",
    cryptographicSignOffs: "Ed25519 cryptographic",
  },
}) => {
  const { totalEcos, openEcos, approvedEcos, passedGates, gatePassRate, totalApprovals } = metrics;

  return (
    <MasterDetailGrid>
      {/* Top Toolbar: Search Bar + New Pull Request Button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
          marginBottom: "4px",
        }}
      >
        {/* Search Bar */}
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: "600px" }}>
          <span
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-fg-muted)",
              display: "inline-flex",
              pointerEvents: "none",
            }}
          >
            <SearchIcon size={14} />
          </span>
          <input
            type="text"
            placeholder="is:pr is:open Filter pull requests, branches, models... (ecoSearchQuery)"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "6px 12px 6px 34px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>

        {/* Action Button: New Pull Request */}
        {canWrite && (
          <button
            type="button"
            onClick={onOpenNewEcoForm}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 16px",
              borderRadius: "6px",
              border: "1px solid rgba(27, 31, 36, 0.15)",
              background: "#1f883d",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.12s ease",
              boxShadow: "0 1px 0 rgba(27, 31, 36, 0.1)",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.92")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <PlusIcon size={14} />
            <span>{newButtonLabel}</span>
          </button>
        )}
      </div>

      {/* Single Unified GitHub-Style Pull Requests Box */}
      <div
        style={{
          border: "1px solid var(--color-border-default)",
          borderRadius: "6px",
          overflow: "hidden",
          background: "var(--color-canvas-default)",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
        }}
      >
        {/* GitHub Table Header */}
        <div
          style={{
            padding: "12px 18px",
            background: "var(--color-canvas-subtle)",
            borderBottom: "1px solid var(--color-border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          {/* Left: Open / Closed Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              type="button"
              onClick={() => onStatusFilterChange("open")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: statusFilter === "open" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                fontWeight: statusFilter === "open" ? 600 : 400,
                fontSize: "14px",
              }}
            >
              <GitPullRequestIcon
                size={16}
                fill={statusFilter === "open" ? "var(--color-fg-default)" : "var(--color-fg-muted)"}
              />
              <span>{openEcos} Open</span>
            </button>

            <button
              type="button"
              onClick={() => onStatusFilterChange("approved")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: statusFilter === "approved" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                fontWeight: statusFilter === "approved" ? 600 : 400,
                fontSize: "14px",
              }}
            >
              <CheckIcon size={16} />
              <span>{approvedEcos} Closed</span>
            </button>

            <button
              type="button"
              onClick={() => onStatusFilterChange("all")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: statusFilter === "all" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                fontWeight: statusFilter === "all" ? 600 : 400,
                fontSize: "14px",
              }}
            >
              <span>{totalEcos} All</span>
            </button>
          </div>

          {/* Center: Live Telemetry Metadata HUD */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "12px",
              color: "var(--color-fg-muted)",
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong>{telemetryLabels.activeProposals}:</strong> {openEcos}
            </span>
            <span>•</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <CheckCircleFillIcon size={13} fill="var(--color-success-fg, #1a7f37)" />
              <span>
                <strong>{telemetryLabels.simulationGate}:</strong> {passedGates}/{totalEcos} Passing ({gatePassRate}%)
              </span>
            </span>
            <span>•</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <ShieldCheckIcon size={13} fill="var(--ms-brand)" />
              <span>
                <strong>{telemetryLabels.cryptographicSignOffs}:</strong> {totalApprovals} Sign-Offs
              </span>
            </span>
          </div>

          {/* Right: Dropdown Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <select
              value={severityFilter}
              onChange={(e) => onSeverityFilterChange(e.target.value)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "12.5px",
                cursor: "pointer",
              }}
            >
              <option value="all">Severity</option>
              <option value="safety_critical">🛡️ Safety-Critical</option>
              <option value="major">⚡ Major Architecture</option>
              <option value="standard">Standard Change</option>
              <option value="minor">Minor Change</option>
            </select>

            <select
              value={gateFilter}
              onChange={(e) => onGateFilterChange(e.target.value)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "12.5px",
                cursor: "pointer",
              }}
            >
              <option value="all">Checks</option>
              <option value="passed">Gate: Passed</option>
              <option value="failed">Gate: Failed</option>
              <option value="running">Gate: Running</option>
              <option value="pending">Gate: Pending</option>
            </select>
          </div>
        </div>

        {/* Table Body: Empty State or Pull Request Rows */}
        {filteredEcos.length === 0 ? (
          <div
            style={{
              padding: "64px 24px",
              background: "var(--color-canvas-default)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-fg-muted)",
              }}
            >
              <GitPullRequestIcon size={26} />
            </div>
            <div>
              <h4 style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                {totalEcos === 0 ? "No Pull Requests Yet" : "No Matching Pull Requests"}
              </h4>
              <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-fg-muted)", maxWidth: "480px" }}>
                {totalEcos === 0
                  ? "Create your first pull request to propose model alterations gated by continuous simulation verification."
                  : "No pull requests match the active filters or search term."}
              </p>
            </div>
            {canWrite && (
              <button
                type="button"
                onClick={onOpenNewEcoForm}
                style={{
                  marginTop: "8px",
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#1f883d",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + Create First Change Request
              </button>
            )}
          </div>
        ) : (
          <div>
            {filteredEcos.map((eco) => {
              const severityBadge = getSeverityBadge(eco.severity);
              const gateBadge = getSimulationGateBadge(eco.simulation_gate_status);
              const statusBadge = getEcoStatusBadge(eco.status);

              return (
                <PrTableRow
                  key={eco.id}
                  onClick={() => onSelectEco(eco.id)}
                  title={`Click to inspect Change Request #${eco.eco_number}`}
                >
                  {/* Left: PR State Icon & Main Details */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", minWidth: 0, flex: 1 }}>
                    <div style={{ marginTop: "3px", color: statusBadge.fg, display: "flex" }}>
                      {eco.status === "merged" ? (
                        <GitMergeIcon size={16} fill="#8250df" />
                      ) : (
                        <GitPullRequestIcon size={16} fill={statusBadge.bg} />
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <strong style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                          #{eco.eco_number} {eco.title}
                        </strong>
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "var(--color-canvas-subtle)",
                            border: "1px solid var(--color-border-default)",
                            color: "var(--color-fg-muted)",
                          }}
                        >
                          ECO-{eco.eco_number}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "1px 7px",
                            borderRadius: "2em",
                            background: severityBadge.bg,
                            color: severityBadge.fg,
                            border: `1px solid ${severityBadge.border}`,
                          }}
                          title={severityBadge.sublabel}
                        >
                          {severityBadge.icon} {severityBadge.label}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: "12.5px",
                          color: "var(--color-fg-muted)",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>
                          <code
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              color: "var(--color-fg-default)",
                              background: "var(--color-canvas-subtle)",
                              padding: "1px 5px",
                              borderRadius: "4px",
                            }}
                          >
                            {eco.source_branch}
                          </code>{" "}
                          into{" "}
                          <code
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              color: "var(--color-fg-default)",
                              background: "var(--color-canvas-subtle)",
                              padding: "1px 5px",
                              borderRadius: "4px",
                            }}
                          >
                            {eco.target_branch}
                          </code>
                        </span>
                        <span>•</span>
                        <span>
                          opened by <strong>@{eco.author_username || "engineer"}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          {eco.impacted_models.length} model{eco.impacted_models.length === 1 ? "" : "s"} changed
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status Pills & Gates */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "3px 9px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: gateBadge.bg,
                        color: gateBadge.fg,
                        border: `1px solid ${gateBadge.border}`,
                      }}
                      title={gateBadge.fullLabel}
                    >
                      {gateBadge.icon}
                      <span>{gateBadge.label}</span>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "3px 9px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: eco.approvals.length > 0 ? "var(--color-canvas-subtle)" : "transparent",
                        border: "1px solid var(--color-border-default)",
                        color: eco.approvals.length > 0 ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                      }}
                      title="Ed25519 & 21 CFR Part 11 Electronic Signatures"
                    >
                      <ShieldCheckIcon size={14} fill="var(--ms-brand)" />
                      <span>{eco.approvals.length} signed</span>
                    </div>

                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: "2em",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: statusBadge.bg,
                        color: statusBadge.fg,
                        border: `1px solid ${statusBadge.border}`,
                        textTransform: "capitalize",
                        minWidth: "68px",
                        textAlign: "center",
                      }}
                    >
                      {statusBadge.label}
                    </span>
                  </div>
                </PrTableRow>
              );
            })}
          </div>
        )}
      </div>
    </MasterDetailGrid>
  );
};

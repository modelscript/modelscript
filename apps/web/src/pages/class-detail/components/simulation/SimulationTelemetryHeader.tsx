// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CloudIcon,
  LinkExternalIcon,
  PlayIcon,
  PulseIcon,
  SyncIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { Button, Label, Spinner, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import styledImport from "styled-components";
import Box from "../../../../components/Box";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const TelemetryBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.03)));
  border: 1px solid var(--ms-border, var(--color-border));
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
`;

const StatusPill = styled.div<{ $status: "idle" | "running" | "success" | "error" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  background: ${({ $status }) => {
    switch ($status) {
      case "running":
        return "var(--ms-brand-soft, rgba(6, 182, 212, 0.15))";
      case "success":
        return "rgba(16, 185, 129, 0.15)";
      case "error":
        return "rgba(239, 68, 68, 0.15)";
      default:
        return "var(--color-canvas-subtle, rgba(255, 255, 255, 0.06))";
    }
  }};
  color: ${({ $status }) => {
    switch ($status) {
      case "running":
        return "var(--ms-brand, #06b6d4)";
      case "success":
        return "#10b981";
      case "error":
        return "#ef4444";
      default:
        return "var(--color-text-muted)";
    }
  }};
  border: 1px solid
    ${({ $status }) => {
      switch ($status) {
        case "running":
          return "var(--ms-brand, #06b6d4)";
        case "success":
          return "#10b981";
        case "error":
          return "#ef4444";
        default:
          return "var(--color-border)";
      }
    }};
`;

const RunButton = styled(Button)`
  background: var(--gradient-cta, var(--ms-brand, #06b6d4));
  color: #fff !important;
  font-weight: 600;
  border: none;
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.35);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 0 18px rgba(6, 182, 212, 0.6);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export interface SimulationTelemetryHeaderProps {
  className: string;
  isSimulating: boolean;
  simulationError: string | null;
  lastSolveDurationMs: number | null;
  pointsCount: number | null;
  solver: string;
  hasOverrides: boolean;
  onRunSimulation: () => void;
  onResetParameters: () => void;
  sourceSnippet: string;
  hasCae?: boolean | undefined;
  onOpenCloudStudies?: (() => void) | undefined;
}

export const SimulationTelemetryHeader: React.FC<SimulationTelemetryHeaderProps> = ({
  className,
  isSimulating,
  simulationError,
  lastSolveDurationMs,
  pointsCount,
  solver,
  hasOverrides,
  onRunSimulation,
  onResetParameters,
  sourceSnippet,
  hasCae,
  onOpenCloudStudies,
}) => {
  const shortName = className.split(".").pop() || className;

  let statusKind: "idle" | "running" | "success" | "error" = "idle";
  let statusText = "Ready to simulate";

  if (isSimulating) {
    statusKind = "running";
    statusText = "Compiling & Simulating in WASM…";
  } else if (simulationError) {
    statusKind = "error";
    statusText = "Simulation Failed";
  } else if (pointsCount && pointsCount > 0) {
    statusKind = "success";
    statusText = `Simulated in ${lastSolveDurationMs ?? 0}ms (${pointsCount} points)`;
  }

  return (
    <TelemetryBar>
      <Box display="flex" alignItems="center" gap="12px" flexWrap="wrap">
        <Box display="flex" alignItems="center" gap="8px">
          <PulseIcon size={18} style={{ color: "var(--ms-brand, #06b6d4)" }} />
          <Text style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-heading)" }}>{shortName}</Text>
        </Box>

        <StatusPill $status={statusKind}>
          {isSimulating ? (
            <Spinner size="small" />
          ) : statusKind === "success" ? (
            <CheckIcon size={12} />
          ) : statusKind === "error" ? (
            <XCircleIcon size={12} />
          ) : (
            <PulseIcon size={12} />
          )}
          {statusText}
        </StatusPill>

        <Label variant="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {solver} solver
        </Label>

        {hasOverrides && (
          <Label variant="accent" style={{ fontSize: 11 }}>
            Parameters modified
          </Label>
        )}
      </Box>

      <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
        {hasOverrides && (
          <Button
            size="small"
            leadingVisual={SyncIcon}
            onClick={onResetParameters}
            title="Reset all parameters to default"
          >
            Reset Defaults
          </Button>
        )}

        <Button
          as={Link}
          to={`/morsel?source=${encodeURIComponent(sourceSnippet)}&title=${encodeURIComponent(className)}&view=simulation`}
          size="small"
          leadingVisual={LinkExternalIcon}
          style={{ textDecoration: "none" }}
          title="Open this model in the full Morsel visualizer and editor"
        >
          Open in Morsel
        </Button>

        {hasCae && onOpenCloudStudies && (
          <Button
            size="small"
            leadingVisual={CloudIcon}
            onClick={onOpenCloudStudies}
            title="Submit to Cloud CAE solver for distributed parameter sweeps"
          >
            Cloud Studies
          </Button>
        )}

        <RunButton
          size="small"
          leadingVisual={isSimulating ? undefined : PlayIcon}
          disabled={isSimulating}
          onClick={onRunSimulation}
        >
          {isSimulating ? "Simulating…" : "Run Simulation"}
        </RunButton>
      </Box>
    </TelemetryBar>
  );
};

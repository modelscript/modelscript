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
import { Button, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import styledImport from "styled-components";
import Box from "../../../../components/Box";
import { SimSpinner } from "./SimSpinner";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const TelemetryBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 0 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--ms-border, var(--color-border));
`;

const StatusPill = styled.div<{ $status: "idle" | "running" | "success" | "error" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: ${({ $status }) => {
    switch ($status) {
      case "running":
        return "var(--ms-brand, #06b6d4)";
      case "success":
        return "var(--color-success-fg, #10b981)";
      case "error":
        return "var(--color-danger-fg, #ef4444)";
      default:
        return "var(--color-text-muted)";
    }
  }};
`;

const RunButton = styled(Button)`
  background: var(--ms-brand, #0e7490);
  color: #fff !important;
  font-weight: 600;
  border: none;
  box-shadow: none;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
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
            <SimSpinner size={12} />
          ) : statusKind === "success" ? (
            <CheckIcon size={12} />
          ) : statusKind === "error" ? (
            <XCircleIcon size={12} />
          ) : (
            <PulseIcon size={12} />
          )}
          {statusText}
        </StatusPill>

        <Text
          style={{ fontSize: 12, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}
        >
          {solver}
          {hasOverrides ? " · modified" : ""}
        </Text>
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

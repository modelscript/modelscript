// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, ClockIcon, DownloadIcon, ServerIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React from "react";
import Box from "../Box";
import { StepItem } from "./styles";
import type { SimPhase } from "./types";

interface SimulationProgressStepsProps {
  phase: SimPhase;
  elapsedSeconds: number;
  selectedProfile: string;
  numberOfIntervals: number;
}

export const SimulationProgressSteps: React.FC<SimulationProgressStepsProps> = ({
  phase,
  elapsedSeconds,
  selectedProfile,
  numberOfIntervals,
}) => {
  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box display="flex" alignItems="center" gap={2}>
          <Spinner size="small" />
          <Text fontWeight="bold" fontSize="14px">
            {phase === "submitting" ? "Dispatching to HPC Cluster..." : "Executing OpenModelica Solver..."}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)" fontSize="13px">
          <ClockIcon size={14} />
          <span>{elapsedSeconds}s elapsed</span>
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap={2}>
        <StepItem $state="done">
          <CheckCircleIcon size={16} fill="var(--color-success-fg)" />
          <span>Validated model syntax and solver specifications</span>
        </StepItem>
        <StepItem $state={phase === "submitting" ? "active" : "done"}>
          {phase === "submitting" ? (
            <Spinner size="small" />
          ) : (
            <CheckCircleIcon size={16} fill="var(--color-success-fg)" />
          )}
          <span>Allocated SLURM partition ({selectedProfile})</span>
        </StepItem>
        <StepItem $state={phase === "running" ? "active" : "waiting"}>
          {phase === "running" ? <Spinner size="small" /> : <ServerIcon size={16} />}
          <span>Running numerical integration ({numberOfIntervals} intervals)</span>
        </StepItem>
        <StepItem $state="waiting">
          <DownloadIcon size={16} />
          <span>Exporting time-series CSV trajectory</span>
        </StepItem>
      </Box>
    </Box>
  );
};

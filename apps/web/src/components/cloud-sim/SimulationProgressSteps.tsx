// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, ClockIcon, DownloadIcon, ServerIcon, TerminalIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React from "react";
import Box from "../Box";
import type { HpcWizardTemplate } from "./hpcTemplates";
import { StepItem } from "./styles";
import type { SimPhase } from "./types";

interface SimulationProgressStepsProps {
  phase: SimPhase;
  elapsedSeconds: number;
  selectedProfile: string;
  numberOfIntervals: number;
  template?: HpcWizardTemplate | undefined;
  modelName?: string | undefined;
}

export const SimulationProgressSteps: React.FC<SimulationProgressStepsProps> = ({
  phase,
  elapsedSeconds,
  selectedProfile,
  numberOfIntervals,
  template,
  modelName,
}) => {
  const steps = template?.pipelineSteps || [
    {
      title: "Validated model syntax and solver specifications",
      detail: `Verified ${modelName || "Model"} DAE equation balance`,
    },
    {
      title: `Allocated SLURM partition (${selectedProfile})`,
      detail: "Provisioned compute node with OpenMP thread affinity",
    },
    {
      title: `Running numerical integration (${numberOfIntervals} intervals)`,
      detail: `Executing ${template?.solver || "SUNDIALS CVODE / OpenModelica"} solver`,
    },
    {
      title: "Exporting time-series CSV trajectory",
      detail: "Streaming state vectors and solver accounting telemetry",
    },
  ];

  const activeStepIdx = phase === "submitting" ? 1 : Math.min(steps.length - 2, 2);

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box
        p={3}
        borderRadius="10px"
        bg="var(--color-canvas-subtle, #161b22)"
        border="1px solid var(--color-border-default, #30363d)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Spinner size="small" />
          <div>
            <Text fontWeight="bold" fontSize="14px" display="block" color="var(--color-fg-default)">
              {phase === "submitting"
                ? "Dispatching Job to Slurm HPC Cluster..."
                : `Executing ${template?.name || "OpenModelica Solver"}...`}
            </Text>
            <Text fontSize="12px" color="var(--color-fg-muted)">
              Target: <strong>{modelName || "Model"}</strong> · Profile: <code>{selectedProfile}</code> ·{" "}
              {numberOfIntervals} intervals
            </Text>
          </div>
        </Box>
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          color="var(--color-accent-cyan, #06b6d4)"
          fontSize="13px"
          style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
        >
          <ClockIcon size={14} />
          <span>{elapsedSeconds}s elapsed</span>
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap={2}>
        {steps.map((step, idx) => {
          const state: "done" | "active" | "waiting" =
            idx < activeStepIdx ? "done" : idx === activeStepIdx ? "active" : "waiting";
          return (
            <StepItem key={idx} $state={state}>
              {state === "done" ? (
                <CheckCircleIcon size={16} fill="#10b981" />
              ) : state === "active" ? (
                <Spinner size="small" />
              ) : idx === steps.length - 1 ? (
                <DownloadIcon size={16} />
              ) : (
                <ServerIcon size={16} />
              )}
              <Box flex={1}>
                <Text fontWeight="bold" fontSize="13px" display="block" color="var(--color-fg-default)">
                  {step.title}
                </Text>
                <Text fontSize="11.5px" color="var(--color-fg-muted)">
                  {step.detail}
                </Text>
              </Box>
            </StepItem>
          );
        })}
      </Box>

      {/* Live Telemetry Console Preview */}
      <Box
        borderRadius="8px"
        border="1px solid var(--color-border-default, #30363d)"
        bg="#090d16"
        p={3}
        style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}
      >
        <Box display="flex" alignItems="center" gap={2} mb={1} color="#38bdf8">
          <TerminalIcon size={12} />
          <span style={{ fontWeight: 700 }}>SLURM LIVE WORKER STREAM</span>
        </Box>
        <div>[00:00.0] sbatch: Submitted batch job to partition &apos;{selectedProfile}&apos;</div>
        <div>[00:00.4] msx-dae: Flattened &apos;{modelName || "Model"}&apos; &rarr; verified DAE system balance</div>
        {phase === "running" && (
          <div style={{ color: "#34d399" }}>
            [00:{String(elapsedSeconds).padStart(2, "0")}.1] solver ({template?.solver || "CVODE"}): Integrating{" "}
            {numberOfIntervals} intervals (tol={template?.defaultExperiment.tolerance || "1e-6"})...
          </div>
        )}
      </Box>
    </Box>
  );
};

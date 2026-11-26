// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, ClockIcon, DownloadIcon, ServerIcon, TerminalIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import type { CloudSimulationStatus } from "../../api";
import Box from "../Box";
import Spinner from "../Spinner";
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
  jobStatus?: CloudSimulationStatus | null | undefined;
}

export const SimulationProgressSteps: React.FC<SimulationProgressStepsProps> = ({
  phase,
  elapsedSeconds,
  selectedProfile,
  numberOfIntervals,
  template,
  modelName,
  jobStatus,
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

  const normalizedStatus = String(jobStatus?.status || "").toLowerCase();
  const activeStepIdx =
    phase === "submitting"
      ? 0
      : normalizedStatus === "completed" || normalizedStatus === "success"
        ? steps.length
        : normalizedStatus === "running" || normalizedStatus === "processing"
          ? Math.min(steps.length - 1, Math.max(1, steps.length - 2))
          : normalizedStatus === "queued" || normalizedStatus === "pending"
            ? Math.min(1, steps.length - 1)
            : Math.min(1, steps.length - 1);

  const realLogs = Array.isArray(jobStatus?.logs)
    ? jobStatus.logs.filter((line) => typeof line === "string" && line.trim().length > 0)
    : [];

  const statusLabel =
    phase === "submitting" ? "Submitting" : normalizedStatus ? normalizedStatus.toUpperCase() : "PENDING";

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box
        p={3}
        borderRadius="10px"
        bg="var(--ms-bg-surface, var(--color-canvas-subtle))"
        border="1px solid var(--ms-border-default, var(--color-border-default))"
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
                ? "Dispatching Job to Compute Cluster..."
                : normalizedStatus === "queued" || normalizedStatus === "pending"
                  ? `Queued on ${selectedProfile} (${template?.name || "Cloud Solver"})...`
                  : `Executing ${template?.name || "Cloud Solver"}...`}
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

      {/* Honest Cluster Status / Real Worker Logs */}
      <Box
        borderRadius="8px"
        border="1px solid var(--ms-border-default, var(--color-border-default))"
        bg="#090d16"
        p={3}
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: "11.5px",
          color: "#94a3b8",
          lineHeight: 1.55,
          maxHeight: "160px",
          overflowY: "auto",
        }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={1} color="#38bdf8">
          <Box display="flex" alignItems="center" gap={2}>
            <TerminalIcon size={12} />
            <span style={{ fontWeight: 700 }}>{realLogs.length > 0 ? "WORKER LOGS" : "CLUSTER JOB STATUS"}</span>
          </Box>
          <span style={{ fontSize: "10.5px", color: "#cbd5e1" }}>State: {statusLabel}</span>
        </Box>
        {realLogs.length > 0 ? (
          realLogs.slice(-12).map((line, i) => <div key={i}>{line}</div>)
        ) : (
          <div>
            {phase === "submitting"
              ? `Submitting '${modelName || "Model"}' to profile '${selectedProfile}'...`
              : `Job ${jobStatus?.id ? `#${jobStatus.id} ` : ""}is currently ${statusLabel} on profile '${jobStatus?.profile || selectedProfile}'. Waiting for solver output...`}
          </div>
        )}
      </Box>
    </Box>
  );
};

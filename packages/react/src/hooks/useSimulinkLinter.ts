// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import type { LintDiagnosticItem } from "../components/LintDiagnosticsTable.js";
import type { WorkerTaskStage } from "../worker/worker-protocol.js";
import { runSandboxTask } from "../worker/worker-runner.js";

export interface SimulinkLinterState {
  isAnalyzing: boolean;
  stage: WorkerTaskStage;
  progress: number;
  statusMessage: string;
  durationMs: number | null;
  diagnostics: LintDiagnosticItem[];
  modelSummary: {
    blockCount: number;
    subsystemCount: number;
    hasAlgebraicLoops: boolean;
  } | null;
  error: string | null;
}

/**
 * Pre-flight static verification hook that analyzes Simulink models (.slx / .mdl)
 * inside an isolated Web Worker, detecting direct-feedthrough algebraic loops,
 * unconnected ports, and rate conflicts with progressive execution feedback.
 */
export function useSimulinkLinter(content: string | ArrayBuffer | null): SimulinkLinterState {
  const [state, setState] = useState<SimulinkLinterState>({
    isAnalyzing: false,
    stage: "idle",
    progress: 0,
    statusMessage: "Ready",
    durationMs: null,
    diagnostics: [],
    modelSummary: null,
    error: null,
  });

  useEffect(() => {
    if (!content) {
      setState({
        isAnalyzing: false,
        stage: "idle",
        progress: 0,
        statusMessage: "Ready",
        durationMs: null,
        diagnostics: [],
        modelSummary: null,
        error: null,
      });
      return;
    }

    let isSubscribed = true;
    const taskId = "simulink_" + Math.random().toString(36).substring(2, 8);

    setState((prev) => ({
      ...prev,
      isAnalyzing: true,
      stage: "reading",
      progress: 10,
      statusMessage: "Dispatching model to background Web Worker...",
      error: null,
    }));

    runSandboxTask<{
      diagnostics: LintDiagnosticItem[];
      summary: {
        blockCount: number;
        subsystemCount: number;
        hasErrors: boolean;
        dialect: string;
        byteLength: number;
      };
    }>(
      {
        id: taskId,
        action: "lint",
        dialect: "simulink",
        content,
      },
      (stageUpdate) => {
        if (isSubscribed) {
          setState((prev) => ({
            ...prev,
            stage: stageUpdate.stage,
            progress: stageUpdate.progress,
            statusMessage: stageUpdate.message,
          }));
        }
      },
    )
      .then(({ result, durationMs }) => {
        if (isSubscribed) {
          setState({
            isAnalyzing: false,
            stage: "ready",
            progress: 100,
            statusMessage: `Analysis completed in ${durationMs.toFixed(1)} ms`,
            durationMs,
            diagnostics: result.diagnostics,
            modelSummary: {
              blockCount: result.summary.blockCount,
              subsystemCount: result.summary.subsystemCount,
              hasAlgebraicLoops: result.diagnostics.some((d) => d.code === "M7202"),
            },
            error: null,
          });
        }
      })
      .catch((err) => {
        if (isSubscribed) {
          setState((prev) => ({
            ...prev,
            isAnalyzing: false,
            stage: "error",
            progress: 0,
            statusMessage: `Failed: ${err.message || String(err)}`,
            error: err.message || "Failed to analyze model in worker",
          }));
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [content]);

  return state;
}

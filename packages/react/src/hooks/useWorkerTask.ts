// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, useState } from "react";
import type { WorkerTaskStage } from "../worker/worker-protocol.js";
import { runSandboxTask, SandboxTaskResult, terminateSandboxWorker } from "../worker/worker-runner.js";

export interface WorkerTaskHookState<T = any> {
  stage: WorkerTaskStage;
  progress: number;
  statusMessage: string;
  isRunning: boolean;
  result: T | null;
  durationMs: number | null;
  memoryUsageBytes: number | null;
  error: string | null;
}

export interface UseWorkerTaskReturn<T = any> extends WorkerTaskHookState<T> {
  runTask: (
    action: "parse" | "lint" | "simulate",
    dialect: string,
    content: string | ArrayBuffer,
    options?: Record<string, any>,
  ) => Promise<T>;
  abort: () => void;
  reset: () => void;
}

/**
 * React hook that executes heavy engineering model parsing and linting
 * inside a sandboxed Web Worker, keeping the React UI thread at 60 FPS.
 */
export function useWorkerTask<T = any>(): UseWorkerTaskReturn<T> {
  const [state, setState] = useState<WorkerTaskHookState<T>>({
    stage: "idle",
    progress: 0,
    statusMessage: "Ready",
    isRunning: false,
    result: null,
    durationMs: null,
    memoryUsageBytes: null,
    error: null,
  });

  const currentTaskId = useRef<string | null>(null);

  const abort = useCallback(() => {
    if (currentTaskId.current) {
      terminateSandboxWorker();
      currentTaskId.current = null;
      setState((prev) => ({
        ...prev,
        stage: "idle",
        progress: 0,
        statusMessage: "Task canceled by user",
        isRunning: false,
        error: "Aborted",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      stage: "idle",
      progress: 0,
      statusMessage: "Ready",
      isRunning: false,
      result: null,
      durationMs: null,
      memoryUsageBytes: null,
      error: null,
    });
  }, []);

  const runTask = useCallback(
    async (
      action: "parse" | "lint" | "simulate",
      dialect: string,
      content: string | ArrayBuffer,
      options?: Record<string, any>,
    ): Promise<T> => {
      const taskId = "task_" + Math.random().toString(36).substring(2, 9);
      currentTaskId.current = taskId;

      setState({
        stage: "reading",
        progress: 10,
        statusMessage: "Initializing background worker sandbox...",
        isRunning: true,
        result: null,
        durationMs: null,
        memoryUsageBytes: null,
        error: null,
      });

      try {
        const { result, durationMs, memoryUsageBytes }: SandboxTaskResult<T> = await runSandboxTask<T>(
          {
            id: taskId,
            action,
            dialect,
            content,
            options,
          },
          (stageUpdate) => {
            if (currentTaskId.current === taskId) {
              setState((prev) => ({
                ...prev,
                stage: stageUpdate.stage,
                progress: stageUpdate.progress,
                statusMessage: stageUpdate.message,
              }));
            }
          },
        );

        if (currentTaskId.current === taskId) {
          setState({
            stage: "ready",
            progress: 100,
            statusMessage: `Completed in ${durationMs.toFixed(1)} ms`,
            isRunning: false,
            result,
            durationMs,
            memoryUsageBytes: memoryUsageBytes ?? null,
            error: null,
          });
        }

        return result;
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        if (currentTaskId.current === taskId) {
          setState((prev) => ({
            ...prev,
            stage: "error",
            progress: 0,
            statusMessage: `Error: ${errorMessage}`,
            isRunning: false,
            error: errorMessage,
          }));
        }
        throw err;
      } finally {
        if (currentTaskId.current === taskId) {
          currentTaskId.current = null;
        }
      }
    },
    [],
  );

  return {
    ...state,
    runTask,
    abort,
    reset,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

export type WorkerTaskStage = "idle" | "reading" | "parsing" | "linting" | "solving" | "ready" | "error";

export interface WorkerTaskRequest {
  id: string;
  action: "parse" | "lint" | "simulate";
  dialect: string;
  content: string | ArrayBuffer;
  options?: Record<string, any> | undefined;
}

export interface WorkerStageMessage {
  type: "STAGE_UPDATE";
  id: string;
  stage: WorkerTaskStage;
  progress: number; // 0 to 100
  message: string;
}

export interface WorkerSuccessMessage {
  type: "SUCCESS";
  id: string;
  result: any;
  durationMs: number;
  memoryUsageBytes?: number;
}

export interface WorkerErrorMessage {
  type: "ERROR";
  id: string;
  error: string;
  stack?: string;
}

export type WorkerOutgoingMessage = WorkerStageMessage | WorkerSuccessMessage | WorkerErrorMessage;

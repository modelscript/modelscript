// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rtds — Core Types for RTDS RSCAD Draft (.dft) Models.
 */

export type RtdsComponentType = "SOURCE" | "R" | "L" | "C" | "RLC" | "LINE" | "XFMR" | "BREAKER" | "IBR" | "LOAD";

export interface RtdsComponent {
  name: string;
  type: RtdsComponentType;
  subsystem: number;
  nodes: string[];
  params: Record<string, number | string>;
}

export interface RtdsDraft {
  name: string;
  timeStepSec: number;
  finishTimeSec: number;
  frequencyHz: number;
  subsystems: number[];
  components: RtdsComponent[];
  nodes: Set<string>;
}

export interface RtdsDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentName?: string | undefined;
}

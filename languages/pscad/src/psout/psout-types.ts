// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and interfaces for PSCAD V5+ binary *.psout files.
 */

import type { SimulationResultLike } from "../comtrade/comtrade-writer.js";

export type PscadCallType = "Root" | "Module" | "Trace" | "Unknown";

export interface PscadPsoutHeader {
  version: number;
  pageSize: number;
  pageCount: number;
  createdOn: Date;
  modifiedOn: Date;
  guid: string;
}

export interface PscadPsoutCall {
  id: number;
  parentId: number;
  callType: PscadCallType;
  name: string;
  order: number;
  dataPage?: number | undefined;
  properties: Map<string, string>;
  children?: PscadPsoutCall[] | undefined;
}

export interface PscadPsoutTrace {
  id: number;
  call: PscadPsoutCall;
  name: string;
  unit: string;
  group: string;
  description: string;
  time?: Float64Array | undefined;
  values: Float64Array;
  min: number;
  max: number;
}

export interface PscadPsoutRun {
  index: number;
  description: string;
  traces: Map<number, PscadPsoutTrace>;
  getTrace(pathOrId: string | number): PscadPsoutTrace | undefined;
  listTracePaths(): string[];
}

export interface PscadPsoutDocument {
  header: PscadPsoutHeader;
  numRuns: number;
  rootCall?: PscadPsoutCall | undefined;
  run(index?: number): PscadPsoutRun;
  getCall(path: string): PscadPsoutCall | undefined;
  toSimulationResult(runIndex?: number): SimulationResultLike;
}

export interface PscadPsoutWriteOptions {
  projectName?: string | undefined;
  pageSize?: 1024 | 2048 | 4096 | undefined;
  runDescription?: string | undefined;
  createdEpochSec?: number | undefined;
}

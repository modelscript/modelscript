// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — Domain types for OpenIGTLink (.igtl) surgical navigation messages
 * and PLUS Toolkit (.plus.xml) real-time tracking & ultrasound calibration configurations.
 */

export interface IgtlSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type IgtlDiagnosticSeverity = "error" | "warning" | "info";

export interface IgtlDiagnostic {
  code: string;
  rule?: string | undefined;
  severity: IgtlDiagnosticSeverity;
  message: string;
  range: IgtlSourceRange;
}

/**
 * Row-major 4x4 homogeneous transformation matrix:
 * [r00, r01, r02, tx,
 *  r10, r11, r12, ty,
 *  r20, r21, r22, tz,
 *  b0,  b1,  b2,  b3]
 */
export type Matrix4x4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface IgtlDataSource {
  id: string;
  type: "Tool" | "Video" | "FieldData" | string;
  portName?: string | undefined;
  bufferSize?: number | undefined;
  range: IgtlSourceRange;
}

export interface IgtlDevice {
  id: string;
  type: string;
  acquisitionRate?: number | undefined;
  toolReferenceFrame?: string | undefined;
  dataSources: IgtlDataSource[];
  outputChannelIds: string[];
  inputChannelIds: string[];
  range: IgtlSourceRange;
}

export interface IgtlTransformDefinition {
  from: string;
  to: string;
  matrix: Matrix4x4;
  errorMm?: number | undefined;
  date?: string | undefined;
  range: IgtlSourceRange;
}

export interface IgtlServerConfig {
  id: string;
  listeningPort: number;
  outputChannelId?: string | undefined;
  deviceId?: string | undefined;
  maxMessagesToSend?: number | undefined;
  messageTypes: string[];
  transformNames: Array<{ from: string; to: string; rawName: string }>;
  range: IgtlSourceRange;
}

export interface IgtlPivotPoseSample {
  matrix: Matrix4x4;
  range: IgtlSourceRange;
}

export interface IgtlFiducialConfig {
  fleMm: number;
  freMm?: number | undefined;
  treMm?: number | undefined;
  fiducials: Array<[number, number, number]>;
  targetPoint?: [number, number, number] | undefined;
  range: IgtlSourceRange;
}

export interface IgtlMessageRecord {
  deviceName: string;
  messageType: "TRANSFORM" | "POSITION" | "IMAGE" | "TDATA" | "STATUS" | "STRING";
  timestampSec?: number | undefined;
  fromFrame?: string | undefined;
  toFrame?: string | undefined;
  matrix?: Matrix4x4 | undefined;
  statusCode?: number | undefined;
  range: IgtlSourceRange;
}

export interface IgtlDocument {
  version: string;
  devices: IgtlDevice[];
  transforms: IgtlTransformDefinition[];
  servers: IgtlServerConfig[];
  pivotPoses: IgtlPivotPoseSample[];
  fiducialConfig?: IgtlFiducialConfig | undefined;
  messages: IgtlMessageRecord[];
  sourceUri?: string | undefined;
  range: IgtlSourceRange;
}

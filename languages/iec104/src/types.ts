// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iec104 — Core Types for IEC 60870-5-104 Telecontrol Profiles.
 */

export type Iec104TypeId =
  | "M_SP_NA_1"
  | "M_SP_TB_1"
  | "M_DP_NA_1"
  | "M_DP_TB_1"
  | "M_ME_NC_1"
  | "M_ME_TF_1"
  | "M_IT_NA_1"
  | "C_SC_NA_1"
  | "C_DC_NA_1"
  | "C_SE_NC_1";

export interface Iec104InformationObject {
  ioa: number;
  name: string;
  typeId: Iec104TypeId;
  units?: string | undefined;
  scale?: number | undefined;
  offset?: number | undefined;
  deadband?: number | undefined;
  initialValue?: number | undefined;
}

export interface Iec104ApciConfig {
  port: number;
  k: number;
  w: number;
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface Iec104StationProfile {
  id: string;
  stationName: string;
  commonAddress: number;
  originatorAddress: number;
  apci: Iec104ApciConfig;
  points: Iec104InformationObject[];
}

export interface Iec104Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  ioa?: number | undefined;
}

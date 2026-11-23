// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ieee-cdf — Core Data Types for IEEE Common Data Format (1973) & BPA IPF (1970s).
 */

export type IeeeCdfFormat = "ieee-cdf" | "bpa-ipf";

/**
 * IEEE CDF Bus Type codes:
 * - 0: Unregulated (load, PQ)
 * - 1: Hold MVAR generation within voltage limits (PQ)
 * - 2: Hold voltage within VAR limits (generator, PV)
 * - 3: Hold voltage and angle (swing / slack)
 */
export type IeeeCdfBusType = 0 | 1 | 2 | 3;

/**
 * IEEE CDF Branch Type codes:
 * - 0: Transmission line
 * - 1: Fixed tap transformer
 * - 2: Variable tap for voltage control (TCUL)
 * - 3: Variable tap for MVAR control
 * - 4: Variable phase angle for MW control (phase shifter)
 */
export type IeeeCdfBranchType = 0 | 1 | 2 | 3 | 4;

export interface IeeeCdfTitleCard {
  date: string;
  originator: string;
  mvaBase: number;
  year: number;
  season: string;
  caseId: string;
  rawLine: string;
  line: number;
}

export interface IeeeCdfBus {
  busNumber: number;
  name: string;
  area: number;
  lossZone: number;
  type: IeeeCdfBusType;
  /** Final/initial voltage magnitude in per-unit. */
  finalVoltagePu: number;
  /** Final/initial voltage angle in degrees. */
  finalAngleDeg: number;
  loadMw: number;
  loadMvar: number;
  genMw: number;
  genMvar: number;
  baseKv: number;
  /** Desired voltage magnitude in per-unit (0 means use finalVoltagePu). */
  desiredVoltsPu: number;
  /** Maximum MVAR (PV/slack) or voltage limit (PQ). */
  maxMvarOrVolt: number;
  /** Minimum MVAR (PV/slack) or voltage limit (PQ). */
  minMvarOrVolt: number;
  /** Shunt conductance G in per-unit on system MVA base. */
  shuntG: number;
  /** Shunt susceptance B in per-unit on system MVA base. */
  shuntB: number;
  remoteControlledBus: number;
  /** Optional BPA card subtype (e.g. "B ", "BE", "BQ", "BS"). */
  bpaCardType?: string;
  line?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface IeeeCdfBranch {
  fromBus: number;
  toBus: number;
  area: number;
  lossZone: number;
  circuit: string;
  type: IeeeCdfBranchType;
  /** Series resistance R in per-unit. */
  r: number;
  /** Series reactance X in per-unit. */
  x: number;
  /** Total line charging susceptance B in per-unit. */
  b: number;
  rateA: number;
  rateB: number;
  rateC: number;
  controlBus: number;
  side: number;
  /** Transformer off-nominal turns ratio (0 denotes nominal 1.0). */
  tapRatio: number;
  /** Transformer phase shift angle in degrees. */
  phaseShiftDeg: number;
  minTapOrShift: number;
  maxTapOrShift: number;
  stepSize: number;
  minVoltOrMw: number;
  maxVoltOrMw: number;
  /** Optional BPA card subtype (e.g. "L ", "T ", "E ", "R "). */
  bpaCardType?: string;
  line?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface IeeeCdfLossZone {
  zoneNumber: number;
  name: string;
  line?: number;
}

export interface IeeeCdfInterchange {
  areaNumber: number;
  slackBus: number;
  alternateSwingBusName: string;
  exportMw: number;
  toleranceMw: number;
  areaCode: string;
  areaName: string;
  line?: number;
}

export interface IeeeCdfTieLine {
  meteredBus: number;
  meteredArea: number;
  nonMeteredBus: number;
  nonMeteredArea: number;
  circuit: string;
  line?: number;
}

export interface IeeeCdfParseIssue {
  code: string;
  message: string;
  line: number;
  column?: number;
}

export interface IeeeCdfNetwork {
  format: IeeeCdfFormat;
  title: IeeeCdfTitleCard;
  hasTitleCard: boolean;
  hasEndOfData: boolean;
  buses: IeeeCdfBus[];
  branches: IeeeCdfBranch[];
  lossZones: IeeeCdfLossZone[];
  interchanges: IeeeCdfInterchange[];
  tieLines: IeeeCdfTieLine[];
  comments: string[];
  parseIssues: IeeeCdfParseIssue[];
}

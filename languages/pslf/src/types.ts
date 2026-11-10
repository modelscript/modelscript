// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Data structures and types for GE PSLF (.epc power flow and .dyd dynamics).
 */

export interface PslfBus {
  busNumber: number;
  name: string;
  baseKv: number;
  busType: number; // 1 = PQ, 2 = PV, 3 = Slack/Swing, 4 = Isolated
  area: number;
  zone: number;
  vmPu: number;
  vaDeg: number;
  vmax: number;
  vmin: number;
}

export interface PslfGenerator {
  busNumber: number;
  genId: string;
  status: number; // 1 = in-service, 0 = out-of-service
  pgMw: number;
  qgMvar: number;
  qmaxMvar: number;
  qminMvar: number;
  pmaxMw: number;
  pminMw: number;
  vschedPu: number;
  mbaseMva: number;
  rSource: number;
  xSource: number;
}

export interface PslfLoad {
  busNumber: number;
  loadId: string;
  status: number;
  plMw: number;
  qlMvar: number;
  ipMw: number;
  iqMvar: number;
  ypMw: number;
  yqMvar: number;
  area: number;
  zone: number;
}

export interface PslfShunt {
  busNumber: number;
  shuntId: string;
  status: number;
  gMw: number;
  bMvar: number;
}

export interface PslfBranch {
  fromBus: number;
  toBus: number;
  circuitId: string;
  status: number;
  rPu: number;
  xPu: number;
  bPu: number;
  rate1Mva: number;
  rate2Mva: number;
  rate3Mva: number;
}

export interface PslfTransformer {
  fromBus: number;
  toBus: number;
  circuitId: string;
  status: number;
  rPu: number;
  xPu: number;
  ratio: number;
  phaseDeg: number;
  rate1Mva: number;
  rate2Mva: number;
  rate3Mva: number;
}

export interface PslfArea {
  areaNumber: number;
  slackBus: number;
  desiredNetInterchangeMw: number;
  toleranceMw: number;
  name: string;
}

export interface PslfZone {
  zoneNumber: number;
  name: string;
}

export interface PslfEpcCase {
  title1: string;
  title2: string;
  mbaseMva: number;
  baseFreqHz: number;
  buses: Map<number, PslfBus>;
  generators: PslfGenerator[];
  loads: PslfLoad[];
  shunts: PslfShunt[];
  branches: PslfBranch[];
  transformers: PslfTransformer[];
  areas: PslfArea[];
  zones: PslfZone[];
}

export interface PslfDynamicModel {
  modelType: string;
  busNumber: number;
  id: string;
  baseKv: number;
  params: number[];
  comment?: string | undefined;
}

export interface PslfDydCase {
  models: PslfDynamicModel[];
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Types and data models for optical fiber outside plant (OSP) cadastre,
 * cable structures, and strand-level tracing.
 */

export type FiberNodeType =
  | "central-office"
  | "manhole"
  | "pole"
  | "splice-closure"
  | "handhole"
  | "pedestal"
  | "customer-premise";

export interface FiberStructureNode {
  id: string;
  name: string;
  nodeType: FiberNodeType;
  coordinates: [number, number]; // [longitude, latitude]
  elevationMeters?: number | undefined;
  slackStorageMeters?: number | undefined;
}

export interface FiberSplice {
  id: string;
  closureId: string;
  trayNumber: number;
  inCableId: string;
  inStrandNumber: number;
  outCableId: string;
  outStrandNumber: number;
  spliceType: "fusion" | "mechanical" | "connector";
  estimatedLossDb: number;
}

export interface FiberCableSpan {
  id: string;
  name: string;
  fromNodeId: string;
  toNodeId: string;
  strandCount: number;
  fibersPerTube: number;
  fiberType: string;
  sheathLengthMeters: number;
  slackLengthMeters: number;
  helixFactor: number;
  pathCoordinates: Array<[number, number]>;
  conduitId?: string | undefined;
}

export interface StrandTraceHop {
  cableId: string;
  strandNumber: number;
  lengthMeters: number;
  lossDb: number;
}

export interface FiberOutsidePlantNetwork {
  name: string;
  nodes: Map<string, FiberStructureNode>;
  cables: Map<string, FiberCableSpan>;
  splices: FiberSplice[];

  addNode(node: FiberStructureNode): void;
  addCable(cable: FiberCableSpan): void;
  addSplice(splice: FiberSplice): void;
  getNode(id: string): FiberStructureNode | undefined;
  getCable(id: string): FiberCableSpan | undefined;
  traceStrand(startCableId: string, startStrand: number): StrandTraceHop[];
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cyme — Core Types for Eaton CYME (.sxst / ASCII) Distribution Networks.
 */

export interface CymeNode {
  nodeId: string;
  x?: number | undefined;
  y?: number | undefined;
  nominalKv?: number | undefined;
}

export interface CymeSource {
  sourceId: string;
  nodeId: string;
  nominalKv: number;
  operatingKv: number;
}

export interface CymeSection {
  sectionId: string;
  fromNodeId: string;
  toNodeId: string;
  phase: string;
  lengthMeters: number;
  deviceType: "OverheadLine" | "UndergroundCable" | "Transformer" | "Switch" | "Fuse";
  rOhmPerKm?: number | undefined;
  xOhmPerKm?: number | undefined;
  primaryKv?: number | undefined;
  secondaryKv?: number | undefined;
  ratingKva?: number | undefined;
}

export interface CymeLoad {
  loadId: string;
  sectionId?: string | undefined;
  nodeId: string;
  phase: string;
  kw: number;
  kvar: number;
}

export interface CymeNetwork {
  networkId: string;
  frequencyHz: number;
  nodes: CymeNode[];
  nodeById: Map<string, CymeNode>;
  sources: CymeSource[];
  sections: CymeSection[];
  loads: CymeLoad[];
}

export interface CymeDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string | undefined;
}

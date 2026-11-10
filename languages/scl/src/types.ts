// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 Substation Configuration Language (SCL) Type Definitions.
 *
 * Implements the core schema and metamodel defined in IEC 61850-6 (Ed. 2.1)
 * for SCD, CID, ICD, and SSD substation automation exchange files.
 */

export type SclConductingEquipmentType =
  | "CBR" // Circuit Breaker
  | "DIS" // Disconnector / Isolator / Earth switch
  | "CTR" // Current Transformer
  | "VTR" // Voltage Transformer
  | "PTR" // Power Transformer
  | "GEN" // Generator
  | "MOT" // Motor
  | "CAP" // Capacitor Bank
  | "REA" // Reactor
  | "LIN" // Line segment
  | "IFL" // Infeeder / Grid connection
  | string;

export type LogicalNodeClass =
  | "LLN0" // Logical Node Zero (device level)
  | "LPHD" // Physical Device Information
  | "XCBR" // Circuit Breaker
  | "CSWI" // Switch Controller
  | "PTOC" // Time Overcurrent Protection
  | "PDIS" // Distance Protection
  | "PDIF" // Differential Protection
  | "PIOC" // Instantaneous Overcurrent Protection
  | "MMXU" // Measurement Unit (3-phase V, I, P, Q, f)
  | "TCTR" // Current Transformer Merging Unit
  | "TVTR" // Voltage Transformer Merging Unit
  | "RREC" // Auto-Reclosing
  | "PTRC" // Protection Trip Conditioning
  | "SVI" // Sampled Value Interface
  | string;

export interface SclFcda {
  ldInst: string;
  prefix?: string | undefined;
  lnClass: string;
  lnInst?: string | undefined;
  doName: string; // Data Object name, e.g. "Pos", "Op", "A", "PhV"
  daName?: string | undefined; // Data Attribute name, e.g. "stVal", "q", "t", "general"
  fc: string; // Functional Constraint, e.g. "ST", "MX", "CO", "SP", "CF"
}

export interface SclDataSet {
  name: string;
  desc?: string | undefined;
  fcdaList: SclFcda[];
}

export interface SclGseControl {
  name: string;
  appID: string;
  datSet: string;
  confRev: number;
  type?: "GOOSE" | "GSSE" | undefined;
  minTimeMs?: number | undefined;
  maxTimeMs?: number | undefined;
}

export interface SclSampledValueControl {
  name: string;
  smvID: string;
  datSet: string;
  confRev: number;
  smpRate: number; // e.g. 4000 or 4800 (80 samples/cycle)
  nofASDU: number;
  multicast?: boolean | undefined;
}

export interface SclExtRef {
  iedName: string;
  ldInst: string;
  prefix?: string | undefined;
  lnClass: string;
  lnInst?: string | undefined;
  doName: string;
  daName?: string | undefined;
  intAddr?: string | undefined;
  serviceType?: "GOOSE" | "SMV" | "Report" | undefined;
}

export interface SclLogicalNode {
  lnClass: LogicalNodeClass;
  inst: string;
  prefix?: string | undefined;
  lnType: string;
  desc?: string | undefined;
  dataSets: Map<string, SclDataSet>;
  gseControls: Map<string, SclGseControl>;
  smvControls: Map<string, SclSampledValueControl>;
  inputs: SclExtRef[];
}

export interface SclLogicalDevice {
  inst: string;
  desc?: string | undefined;
  logicalNodes: Map<string, SclLogicalNode>;
}

export interface SclAccessPoint {
  name: string;
  desc?: string | undefined;
  server?:
    | {
        timeout?: number | undefined;
        logicalDevices: Map<string, SclLogicalDevice>;
      }
    | undefined;
}

export interface SclIED {
  name: string;
  desc?: string | undefined;
  type?: string | undefined;
  manufacturer?: string | undefined;
  configVersion?: string | undefined;
  accessPoints: Map<string, SclAccessPoint>;
}

export interface SclConnectedAp {
  iedName: string;
  apName: string;
  address?: Record<string, string> | undefined; // IP, IP-SUBNET, etc.
  gseAddresses?:
    | Map<string, { mac: string; appId: string; vlanId?: string | undefined; vlanPriority?: number | undefined }>
    | undefined;
  smvAddresses?: Map<string, { mac: string; appId: string; vlanId?: string | undefined }> | undefined;
}

export interface SclCommunicationSubNetwork {
  name: string;
  type?: string | undefined;
  connectedAps: SclConnectedAp[];
}

export interface SclTerminal {
  name: string;
  connectivityNode: string;
  substationName?: string | undefined;
  voltageLevelName?: string | undefined;
  bayName?: string | undefined;
  cNodeName?: string | undefined;
}

export interface SclConnectivityNode {
  name: string;
  pathName: string;
  desc?: string | undefined;
}

export interface SclConductingEquipment {
  name: string;
  type: SclConductingEquipmentType;
  desc?: string | undefined;
  terminals: SclTerminal[];
  lnReferences?: string[] | undefined;
}

export interface SclBay {
  name: string;
  desc?: string | undefined;
  conductingEquipment: SclConductingEquipment[];
  connectivityNodes: SclConnectivityNode[];
}

export interface SclVoltageLevel {
  name: string;
  desc?: string | undefined;
  nominalVoltageKv?: number | undefined;
  bays: SclBay[];
}

export interface SclSubstation {
  name: string;
  desc?: string | undefined;
  voltageLevels: SclVoltageLevel[];
}

export interface SclHeader {
  id: string;
  version: string;
  revision: string;
  toolId?: string | undefined;
}

export interface SclDocument {
  header: SclHeader;
  substation?: SclSubstation | undefined;
  communication?: SclCommunicationSubNetwork[] | undefined;
  ieds: Map<string, SclIED>;
}

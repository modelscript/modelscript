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
  | "IFL"; // Infeeder / Grid connection

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
  type: "GOOSE" | "GSSE";
  minTimeMs?: number | undefined; // Minimum retransmission interval (e.g. 2-4 ms for trip)
  maxTimeMs?: number | undefined; // Maximum retransmission interval / heartbeat (e.g. 1000-2000 ms)
  macAddress?: string | undefined; // Multicast MAC address, e.g. "01-0C-CD-01-00-01"
  vlanId?: number | undefined; // VLAN ID (0-4095)
  vlanPriority?: number | undefined; // VLAN 802.1Q priority (0-7, typically 4-7 for trip)
}

export interface SclSmvControl {
  name: string;
  smvID: string;
  datSet: string;
  confRev: number;
  smpRate: number; // e.g. 4000 or 4800 Hz per 9-2LE / IEC 61869-9
  macAddress?: string | undefined;
  vlanId?: number | undefined;
}

export interface SclExtRef {
  iedName: string; // Publisher IED name
  ldInst?: string | undefined;
  prefix?: string | undefined;
  lnClass?: string | undefined;
  lnInst?: string | undefined;
  doName?: string | undefined;
  daName?: string | undefined;
  intAddr?: string | undefined;
  serviceType?: "GOOSE" | "SMV" | "Report" | undefined;
}

export interface SclLogicalNode {
  lnClass: LogicalNodeClass;
  inst: string;
  prefix?: string | undefined;
  lnType?: string | undefined;
  desc?: string | undefined;
  dataSets: SclDataSet[];
  gseControls: SclGseControl[];
  smvControls: SclSmvControl[];
  inputs: SclExtRef[];
}

export interface SclLogicalDevice {
  inst: string;
  desc?: string | undefined;
  ln0?: SclLogicalNode | undefined;
  logicalNodes: SclLogicalNode[];
}

export interface SclAccessPoint {
  name: string;
  router?: boolean | undefined;
  server?:
    | {
        logicalDevices: SclLogicalDevice[];
      }
    | undefined;
}

export interface SclIED {
  name: string;
  type?: string | undefined;
  manufacturer?: string | undefined;
  configVersion?: string | undefined;
  desc?: string | undefined;
  accessPoints: SclAccessPoint[];
}

export interface SclConductingEquipment {
  name: string;
  type: SclConductingEquipmentType;
  desc?: string | undefined;
  lNodes: {
    iedName: string;
    lnClass: string;
    lnInst: string;
    prefix?: string | undefined;
  }[];
}

export interface SclBay {
  name: string;
  desc?: string | undefined;
  conductingEquipment: SclConductingEquipment[];
  connectivityNodes: string[];
}

export interface SclVoltageLevel {
  name: string;
  nomVoltageKv: number;
  nomFreqHz: number;
  bays: SclBay[];
}

export interface SclSubstation {
  name: string;
  desc?: string | undefined;
  voltageLevels: SclVoltageLevel[];
}

export interface SclCommunicationSubNetwork {
  name: string;
  type: string; // e.g. "8-MMS"
  connectedAPs: {
    iedName: string;
    apName: string;
    ipAddress?: string | undefined;
    subnetMask?: string | undefined;
  }[];
}

export interface SclDocument {
  header: {
    id: string;
    version: string;
    revision: string;
    toolId?: string | undefined;
  };
  substation?: SclSubstation | undefined;
  communication?:
    | {
        subNetworks: SclCommunicationSubNetwork[];
      }
    | undefined;
  ieds: Map<string, SclIED>;
}

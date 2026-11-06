// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — CIM / CGMES Type Definitions.
 *
 * Implements European Network of Transmission System Operators for Electricity (ENTSO-E)
 * Common Grid Model Exchange Standard (CGMES v2.4.15 and v3.0) profile structures:
 * - EQ: Equipment Profile (IEC 61970-452)
 * - TP: Topology Profile (IEC 61970-456)
 * - SSH: Steady State Hypothesis Profile
 * - SV: State Variables Profile
 */

export interface IdentifiedObject {
  mRID: string;
  name: string;
  description?: string | undefined;
}

export interface CgmesSubstation extends IdentifiedObject {
  region?: string | undefined;
}

export interface CgmesVoltageLevel extends IdentifiedObject {
  substationId?: string | undefined;
  baseVoltageKv: number; // in kV (e.g. 400.0, 220.0, 110.0)
  lowVoltageLimit?: number | undefined;
  highVoltageLimit?: number | undefined;
}

export interface CgmesBusbarSection extends IdentifiedObject {
  voltageLevelId?: string | undefined;
}

export interface CgmesTopologicalNode extends IdentifiedObject {
  baseVoltageKv: number;
  voltageLevelId?: string | undefined;
}

export interface CgmesConnectivityNode extends IdentifiedObject {
  containerId?: string | undefined;
}

export interface CgmesTerminal extends IdentifiedObject {
  conductingEquipmentId: string;
  connectivityNodeId?: string | undefined;
  topologicalNodeId?: string | undefined;
  sequenceNumber: number; // 1 or 2
}

export interface CgmesACLineSegment extends IdentifiedObject {
  r: number; // Resistance in Ohms (or p.u.)
  x: number; // Reactance in Ohms (or p.u.)
  bch: number; // Shunt susceptance in Siemens (or p.u.)
  gch?: number | undefined; // Shunt conductance in Siemens
  lengthKm?: number | undefined;
  ratedCurrentA?: number | undefined;
}

export interface CgmesPowerTransformer extends IdentifiedObject {
  substationId?: string | undefined;
}

export interface CgmesPowerTransformerEnd extends IdentifiedObject {
  powerTransformerId: string;
  terminalId: string;
  endNumber: number; // 1 (primary) or 2 (secondary)
  r: number; // Resistance in Ohms or p.u.
  x: number; // Leakage reactance
  b: number; // Magnetizing susceptance
  g: number; // Core loss conductance
  ratedUkV: number; // Rated voltage in kV
  ratedSMva: number; // Rated MVA
}

export interface CgmesSynchronousMachine extends IdentifiedObject {
  pMw: number; // Active power generation (MW)
  qMvar: number; // Reactive power generation (MVAR)
  minPMw: number;
  maxPMw: number;
  minQMvar: number;
  maxQMvar: number;
  ratedSMva?: number | undefined;
  genType?: "generator" | "condenser" | "motor" | undefined;
}

export interface CgmesEnergyConsumer extends IdentifiedObject {
  pMw: number; // Active power demand (MW)
  qMvar: number; // Reactive power demand (MVAR)
}

export interface CgmesLinearShuntCompensator extends IdentifiedObject {
  bPerSection: number; // Susceptance per section (Siemens)
  gPerSection: number; // Conductance per section (Siemens)
  sections: number; // Number of active sections
}

export interface CgmesSvVoltage {
  topologicalNodeId: string;
  vPu: number; // Voltage magnitude (p.u.)
  angleDeg: number; // Voltage angle (degrees)
}

export interface CgmesSvPowerFlow {
  terminalId: string;
  pMw: number; // Active power flow (MW)
  qMvar: number; // Reactive power flow (MVAR)
}

/** Complete in-memory representation of parsed CGMES profiles. */
export interface CgmesModel {
  substations: Map<string, CgmesSubstation>;
  voltageLevels: Map<string, CgmesVoltageLevel>;
  busbars: Map<string, CgmesBusbarSection>;
  nodes: Map<string, CgmesTopologicalNode>;
  connectivityNodes: Map<string, CgmesConnectivityNode>;
  terminals: Map<string, CgmesTerminal>;
  lines: Map<string, CgmesACLineSegment>;
  transformers: Map<string, CgmesPowerTransformer>;
  transformerEnds: Map<string, CgmesPowerTransformerEnd>;
  generators: Map<string, CgmesSynchronousMachine>;
  loads: Map<string, CgmesEnergyConsumer>;
  shunts: Map<string, CgmesLinearShuntCompensator>;
  svVoltages: Map<string, CgmesSvVoltage>;
  svFlows: Map<string, CgmesSvPowerFlow>;
}

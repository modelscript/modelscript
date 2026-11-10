// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Representation of Schweitzer Engineering Laboratories (SEL) Relay Settings.
 * Supports SEL-300, SEL-400, SEL-700, and modern Axion/Real-Time Automation Controller series.
 */

export type CurveStandard = "U1" | "U2" | "U3" | "U4" | "U5" | "C1" | "C2" | "C3" | "C4" | "C5";

export interface PhaseOvercurrentSettings {
  /** 50P1P: Instantaneous Phase 1 Pickup (A sec or primary) */
  inst50P1P?: number | undefined;
  /** 50P2P: Instantaneous Phase 2 Pickup (A sec or primary) */
  inst50P2P?: number | undefined;
  /** 51P1P: Time-Overcurrent Phase 1 Pickup (A) */
  time51P1P?: number | undefined;
  /** 51P1C: Time-Overcurrent Curve Family */
  curve51P1C?: CurveStandard | undefined;
  /** 51P1TD: Time-Overcurrent Time Dial */
  timeDial51P1TD?: number | undefined;
}

export interface GroundOvercurrentSettings {
  /** 50G1P: Instantaneous Ground 1 Pickup (A) */
  inst50G1P?: number | undefined;
  /** 51G1P: Time-Overcurrent Ground 1 Pickup (A) */
  time51G1P?: number | undefined;
  /** 51G1C: Ground Overcurrent Curve */
  curve51G1C?: CurveStandard | undefined;
  /** 51G1TD: Ground Overcurrent Time Dial */
  timeDial51G1TD?: number | undefined;
}

export interface DistanceSettings {
  /** Z1P: Zone 1 Phase Reach (Ohms secondary) */
  zone1Reach?: number | undefined;
  /** Z2P: Zone 2 Phase Reach (Ohms secondary) */
  zone2Reach?: number | undefined;
  /** Z3P: Zone 3 Phase Reach (Ohms secondary) */
  zone3Reach?: number | undefined;
  /** Z1D: Zone 1 Time Delay (cycles) */
  zone1TimeCycles?: number | undefined;
  /** Z2D: Zone 2 Time Delay (cycles) */
  zone2TimeCycles?: number | undefined;
  /** Z3D: Zone 3 Time Delay (cycles) */
  zone3TimeCycles?: number | undefined;
  /** Directional reach mode */
  direction?: "FORWARD" | "REVERSE" | "NON_DIRECTIONAL" | undefined;
}

export interface VoltageSettings {
  /** 27P: Undervoltage Phase Pickup (V) */
  underVoltage27P?: number | undefined;
  /** 59P: Overvoltage Phase Pickup (V) */
  overVoltage59P?: number | undefined;
}

export interface FrequencySettings {
  /** 81U: Underfrequency Pickup (Hz) */
  underFreq81U?: number | undefined;
  /** 81O: Overfrequency Pickup (Hz) */
  overFreq81O?: number | undefined;
}

export interface SELogicEquation {
  target: string;
  expression: string;
  description?: string | undefined;
}

export interface SettingsGroup {
  groupId: number;
  groupName?: string | undefined;
  phaseOvercurrent?: PhaseOvercurrentSettings | undefined;
  groundOvercurrent?: GroundOvercurrentSettings | undefined;
  distance?: DistanceSettings | undefined;
  voltage?: VoltageSettings | undefined;
  frequency?: FrequencySettings | undefined;
  equations: Record<string, string>;
}

export interface TransformerRatios {
  /** CTRH: Phase CT Ratio Primary / Secondary (e.g. 1200/5 = 240) */
  ctRatioPhase: number;
  /** CTRL: Ground / Neutral CT Ratio */
  ctRatioGround: number;
  /** PTR: Potential Transformer Ratio (e.g. 138000/115 = 1200) */
  ptRatioPhase: number;
  /** PTRN: Neutral PT Ratio */
  ptRatioNeutral: number;
}

export interface SELRelaySettings {
  relayType: string;
  relayId: string; // RID
  terminalId: string; // TID
  partNumber?: string | undefined;
  firmwareVersion?: string | undefined;
  activeGroup: number;
  frequencyHz: number;
  phaseRotation: "ABC" | "ACB";
  ratios: TransformerRatios;
  groups: Map<number, SettingsGroup>;
  globalEquations: Record<string, string>;
}

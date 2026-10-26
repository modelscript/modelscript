// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — US NRC RELAP5-3D / TRACE Deck AST & Data Types.
 *
 * Conforms to RELAP5-3D card deck specifications (100 - 600 series cards).
 */

export interface Relap5Range {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface Relap5Card {
  cardNumber: number;
  words: string[];
  rawText: string;
  range?: Relap5Range | undefined;
}

export interface Relap5TimeStepControl {
  endTime: number; // seconds
  minDt: number; // minimum time step (s)
  maxDt: number; // maximum time step (s)
  majorEditFreq?: number | undefined;
  minorEditFreq?: number | undefined;
}

export type TripOperator = "lt" | "le" | "gt" | "ge" | "eq" | "ne";

export interface Relap5Trip {
  id: number;
  isLogical: boolean;
  variableName?: string | undefined;
  operator?: TripOperator | undefined;
  setpoint?: number | undefined;
  childTripIds?: number[] | undefined;
  latched: boolean;
  range?: Relap5Range | undefined;
}

export type ComponentType =
  | "pipe"
  | "branch"
  | "snglv"
  | "tmdpvol"
  | "snglj"
  | "tmdpj"
  | "valve"
  | "pump"
  | "accum"
  | "annulus";

export interface Relap5Volume {
  id: number; // 3-digit component id or full volume id
  name: string;
  type: ComponentType;
  flowArea: number; // m^2
  length: number; // m
  volume: number; // m^3
  elevationChange: number; // m (dz)
  inclinationAngle: number; // degrees
  roughness: number; // m
  hydraulicDiameter: number; // m
  initialPressure: number; // Pa
  initialTemperature: number; // K
  initialVoidFraction?: number | undefined; // 0.0 = subcooled liquid, 1.0 = superheated steam
  range?: Relap5Range | undefined;
}

export interface Relap5Junction {
  id: number;
  fromVolume: number;
  toVolume: number;
  area: number; // m^2
  forwardLoss: number; // forward form loss K_forw
  reverseLoss: number; // reverse form loss K_rev
  initialLiquidVelocity: number; // m/s
  initialVaporVelocity: number; // m/s
  chokedFlowModel?: boolean | undefined;
  range?: Relap5Range | undefined;
}

export interface Relap5HeatStructure {
  id: number;
  meshPoints: number;
  leftVolumeId?: number | undefined;
  rightVolumeId?: number | undefined;
  thermalConductivity: number; // W/(m*K)
  volumetricHeatCapacity: number; // J/(m^3*K)
  initialTemperature: number; // K
  range?: Relap5Range | undefined;
}

export interface DelayedNeutronGroup {
  group: number; // 1 to 6
  decayConstant: number; // lambda_i (1/s)
  fraction: number; // beta_i
}

export interface Relap5Kinetics {
  promptGenerationTime: number; // Lambda (s)
  totalDelayedFraction: number; // beta
  initialPower: number; // Watts (W)
  delayedGroups: DelayedNeutronGroup[]; // 6 precursor groups
  fuelTempReactivityCoeff: number; // d_rho / d_Tfuel ($/K or dk/k/K)
  moderatorTempReactivityCoeff: number; // d_rho / d_Tmod
  range?: Relap5Range | undefined;
}

export interface Relap5Deck {
  title: string;
  problemType: "transnt" | "stdy-st";
  executionType: "new" | "restart";
  timeSteps: Relap5TimeStepControl[];
  trips: Map<number, Relap5Trip>;
  volumes: Map<number, Relap5Volume>;
  junctions: Map<number, Relap5Junction>;
  heatStructures: Map<number, Relap5HeatStructure>;
  kinetics?: Relap5Kinetics | undefined;
  sourceFile?: string | undefined;
  rawCards: Relap5Card[];
}

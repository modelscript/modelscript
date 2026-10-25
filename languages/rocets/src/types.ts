// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Common propellants and working fluids in liquid rocket engine propulsion systems.
 */
export type PropellantKind =
  | "LOX"
  | "LH2"
  | "LCH4"
  | "RP1"
  | "GH2"
  | "GOX"
  | "COMBUSTION_GAS"
  | "HELIUM"
  | "NITROGEN"
  | string;

/**
 * Standard ROCETS rocket component block classifications.
 */
export type ComponentKind =
  | "CHAMBER"
  | "PUMP"
  | "TURBINE"
  | "SHAFT"
  | "GAS_GENERATOR"
  | "COOLING_JACKET"
  | "LINE"
  | "VALVE"
  | "JUNCTION"
  | "USER_ROUTINE"
  | string;

export interface RocetsPort {
  name: string;
  direction: "in" | "out" | "bidirectional";
  fluid?: PropellantKind | undefined;
  pressurePa?: number | undefined;
  temperatureK?: number | undefined;
  massFlowKgS?: number | undefined;
}

export interface RocetsComponent {
  id: string;
  type: ComponentKind;
  title?: string | undefined;
  parameters: Record<string, number | string | number[]>;
  initialStates: Record<string, number>;
  ports: Record<string, RocetsPort>;
  userCode?: string | undefined;
  location?: { x: number; y: number } | undefined;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface RocetsConnection {
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
  fluid?: PropellantKind | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

export interface RocetsPerformanceMap {
  name: string;
  speedRpm: number[];
  flowKgS: number[];
  headOrPressureRatio: number[][];
  efficiency: number[][];
}

export interface RocetsEngineConfig {
  cycle?: "expander" | "gas_generator" | "staged_combustion" | string | undefined;
  designPcPa?: number | undefined;
  designThrustN?: number | undefined;
  designMr?: number | undefined;
}

export interface RocetsEngineModel {
  name: string;
  title?: string | undefined;
  components: Map<string, RocetsComponent>;
  connections: RocetsConnection[];
  maps: Map<string, RocetsPerformanceMap>;
  config?: RocetsEngineConfig | undefined;
  sourceText?: string | undefined;
}

export interface TurbopumpPowerBalance {
  shaftId: string;
  pumpPowerWatts: number;
  turbinePowerWatts: number;
  speedRpm: number;
  netPowerWatts: number;
  marginPercent: number;
}

export interface EngineBalanceResult {
  converged: boolean;
  iterations: number;
  residualNorm: number;
  chamberPressurePa: number;
  thrustN: number;
  ispSeconds: number;
  mixtureRatio: number;
  shaftSpeedsRpm: Record<string, number>;
  flowRatesKgS: Record<string, number>;
  pressuresPa: Record<string, number>;
  temperaturesK: Record<string, number>;
  shaftBalances: TurbopumpPowerBalance[];
}

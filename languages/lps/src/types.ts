// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Core Data Structures for Emerson / ESI PipelineStudio Models.
 *
 * Covers TGNET (Transient Gas Network) and TLNET (Transient Liquid Network) components,
 * equations of state, machinery operating envelopes, batch tracking, and simulation results.
 */

export type SimulationType = "TGNET" | "TLNET" | "HYBRID";

export type LpsNodeType = "JUNCTION" | "SUPPLY" | "DELIVERY" | "STORAGE_CAVERN" | "MANIFOLD";

export interface LpsNode {
  name: string;
  type: LpsNodeType;
  elevation: number; // meters
  pressure?: number | undefined; // Pa (setpoint for supply or boundary)
  flowRate?: number | undefined; // kg/s or Sm3/s (setpoint for delivery or supply)
  temperature?: number | undefined; // Kelvin
  minDeliveryPressure?: number | undefined; // Pa (contractual minimum)
  maxAllowablePressure?: number | undefined; // Pa (MAOP limit for station)
  coordinates?: { x: number; y: number; lat?: number | undefined; lon?: number | undefined } | undefined;
}

export interface ElevationPoint {
  distance: number; // meters along pipe from inlet
  elevation: number; // meters
}

export interface LpsPipe {
  name: string;
  fromNode: string;
  toNode: string;
  length: number; // meters
  diameter: number; // inner diameter in meters
  wallThickness?: number | undefined; // meters
  roughness: number; // pipe absolute roughness in meters (e.g. 4.5e-5 for commercial steel)
  maop: number; // Maximum Allowable Operating Pressure in Pa (e.g. 100e5 for 100 bar)
  heatTransferCoefficient?: number | undefined; // W/(m2*K), defaults to ~2.0
  ambientTemperature?: number | undefined; // Kelvin (soil or atmospheric)
  elevationProfile?: ElevationPoint[] | undefined;
  draPpm?: number | undefined; // Drag Reducing Agent concentration (ppm)
}

export type CompressorType = "CENTRIFUGAL" | "RECIPROCATING";
export type CompressorControlMode = "PRESSURE_RATIO" | "DISCHARGE_PRESSURE" | "MASS_FLOW" | "POWER_LIMIT";

export interface CompressorStation {
  name: string;
  fromNode: string;
  toNode: string;
  type: CompressorType;
  maxPower: number; // Watts
  maxSpeed?: number | undefined; // rpm
  maxPressureRatio: number; // e.g. 1.8 - 2.5
  surgeFlow?: number | undefined; // kg/s (flow below which compressor surges)
  stonewallFlow?: number | undefined; // kg/s (choke limit)
  polytropicEfficiency: number; // 0.0 - 1.0 (e.g. 0.82)
  driverEfficiency?: number | undefined; // 0.0 - 1.0 (e.g. 0.38 gas turbine, 0.95 electric motor)
  fuelGasFraction?: number | undefined; // fraction of throughput used as fuel (e.g. 0.005)
  status: "RUNNING" | "STOPPED" | "BYPASSED";
  controlMode: CompressorControlMode;
  setpoint: number; // Target value corresponding to controlMode
}

export type PumpControlMode = "DISCHARGE_PRESSURE" | "HEAD" | "FLOW";

export interface PumpStation {
  name: string;
  fromNode: string;
  toNode: string;
  maxPower: number; // Watts
  ratedFlow: number; // m3/s
  ratedHead: number; // meters
  npshRequired: number; // meters
  efficiency: number; // 0.0 - 1.0 (e.g. 0.80)
  status: "RUNNING" | "STOPPED" | "BYPASSED";
  controlMode: PumpControlMode;
  setpoint: number;
}

export interface RegulatorValve {
  name: string;
  fromNode: string;
  toNode: string;
  setpointPressure: number; // Pa (controlled downstream pressure)
  maxCapacity: number; // kg/s
  cv?: number | undefined; // Flow coefficient
  allowReverseFlow?: boolean | undefined;
  preheaterInstalled: boolean;
  preheaterTargetTemp?: number | undefined; // Kelvin
}

export interface InlineValve {
  name: string;
  fromNode: string;
  toNode: string;
  opening: number; // 0.0 (closed) to 1.0 (fully open)
  closingTimeSeconds: number; // time for full stroke (e.g. 15s for ESD valves)
}

/** Gas composition specified as molar fractions (sum = 1.0). */
export interface GasComposition {
  methane: number; // CH4
  ethane: number; // C2H6
  propane: number; // C3H8
  nButane: number; // C4H10
  iButane: number; // C4H10
  pentanes: number; // C5H12
  hexanePlus: number; // C6+
  nitrogen: number; // N2
  carbonDioxide: number; // CO2
  hydrogen: number; // H2 (for hydrogen blending modeling)
  waterVapor?: number | undefined; // H2O
  grossHeatingValue?: number | undefined; // MJ/m3 at standard conditions
  standardDensity?: number | undefined; // kg/m3 at 1.01325 bar, 288.15 K
}

export interface LiquidProduct {
  id: string;
  name: string;
  densityAtRef: number; // kg/m3 at 15 deg C
  viscosityAtRef: number; // Pa*s at 15 deg C
  bulkModulus: number; // Pa (elasticity, typically 1.2e9 - 1.6e9 Pa)
  vaporPressure: number; // Pa (Reid vapor pressure at operating temp)
}

export interface BatchInjection {
  batchId: string;
  productId: string;
  volume: number; // m3
  injectionNode: string;
  deliveryNode: string;
  startTime: number; // seconds from simulation start
}

export interface BatchSchedule {
  products: LiquidProduct[];
  injections: BatchInjection[];
}

export type EquationOfState = "AGA8" | "GERG2008" | "PENG_ROBINSON" | "IDEAL";

export interface SimulationControls {
  startTime: number; // seconds
  endTime: number; // seconds
  timeStep: number; // seconds
  steadyStateFirst: boolean;
  equationOfState: EquationOfState;
  tolerance?: number | undefined;
}

export interface LpsModel {
  id: string;
  title: string;
  type: SimulationType;
  nodes: LpsNode[];
  pipes: LpsPipe[];
  compressors: CompressorStation[];
  pumps: PumpStation[];
  regulators: RegulatorValve[];
  valves: InlineValve[];
  gasComposition?: GasComposition | undefined;
  batches?: BatchSchedule | undefined;
  simulationControls: SimulationControls;
}

export interface LpsDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string | undefined;
}

export interface NodeState {
  name: string;
  pressure: number; // Pa
  temperature: number; // Kelvin
  netFlow: number; // kg/s
}

export interface PipeState {
  name: string;
  massFlow: number; // kg/s
  inletPressure: number; // Pa
  outletPressure: number; // Pa
  velocity: number; // m/s
  linePackKg: number; // kg of fluid contained in pipe
  linePackSm3: number; // Sm3 equivalent (standard conditions)
  frictionLossPa: number; // Pa
}

export interface BatchPosition {
  batchId: string;
  productId: string;
  currentPipe: string;
  startDistance: number; // meters from pipe inlet
  endDistance: number; // meters from pipe inlet
  interfaceDispersionLength: number; // meters of mixed transmix
}

export interface LpsSteadyResult {
  converged: boolean;
  iterations: number;
  nodeStates: Record<string, NodeState>;
  pipeStates: Record<string, PipeState>;
  totalLinePackKg: number;
  totalLinePackSm3: number;
}

export interface LpsTransientTrajectory {
  times: number[]; // seconds
  nodePressures: Record<string, number[]>; // Pa
  pipeFlows: Record<string, number[]>; // kg/s
  pipeVelocities?: Record<string, number[]> | undefined; // m/s
  linePackHistory: number[]; // total network line pack in kg over time
  batchSnapshots?: BatchPosition[][] | undefined;
}

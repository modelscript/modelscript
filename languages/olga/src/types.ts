// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Core Data Structures for OLGA Multiphase Models.
 */

export interface OlgaPipe {
  label: string;
  length: number; // meters [m]
  diameter: number; // inner diameter [m]
  elevation: number; // elevation delta [m]
  roughness: number; // absolute roughness [m]
  discretization: number; // number of spatial section cells
  metallurgy?: string | undefined; // e.g. "API_5L_X65", "API_5L_X65MS"
  cladding?: string | undefined; // e.g. "INCONEL_625"
}

export interface OlgaWallLayer {
  material: string;
  thickness: number; // meters [m]
  conductivity: number; // W / (m * K)
  density?: number | undefined; // kg / m^3
  heatCapacity?: number | undefined; // J / (kg * K)
}

export interface OlgaHeatTransfer {
  type: "WALL" | "AIR" | "WATER" | "BURIED";
  ambientTemperature: number; // Kelvin [K]
  ambientHeatTransferCoeff: number; // W / (m^2 * K)
  layers: OlgaWallLayer[];
}

export interface OlgaValve {
  name: string;
  position: number; // absolute position along flowpath [m]
  diameter: number; // valve throat diameter [m]
  opening: number; // stroke opening fraction [0.0 - 1.0]
  cd: number; // discharge coefficient
  timeToOpen?: number | undefined;
  timeToClose?: number | undefined;
}

export interface OlgaSource {
  name: string;
  position: number; // absolute position [m]
  totalMassRate: number; // kg / s
  gasMassFraction: number; // [0.0 - 1.0]
  waterCut: number; // fraction of water in liquid phase [0.0 - 1.0]
  temperature: number; // Kelvin [K]
  pressure?: number | undefined; // Pascal [Pa]
  h2sMoleFraction?: number | undefined;
  co2MoleFraction?: number | undefined;
}

export interface OlgaController {
  name: string;
  type: "MANUAL" | "PID" | "ON_OFF";
  setpoint: number;
  gain: number;
  ti: number; // integral time [s]
  td: number; // derivative time [s]
  transmitter: string; // measurement tag
  controlledValve: string; // target valve name
}

export type IprModelType = "LINEAR_PI" | "VOGEL" | "FETKOVICH";

export interface OlgaIpr {
  type: IprModelType;
  reservoirPressure: number; // Pascal [Pa]
  reservoirTemperature: number; // Kelvin [K]
  bubblePointPressure?: number | undefined; // Pascal [Pa]
  productivityIndex?: number | undefined; // kg / (s * Pa) or m^3 / (day * bar)
  maxLiquidRate?: number | undefined; // kg / s (q_max for Vogel)
  cFactor?: number | undefined; // kg / (s * Pa^(2n)) for Fetkovich
  nExponent?: number | undefined; // 0.5 to 1.0 (typically ~0.85)
  gasMassFraction: number; // GOR / solution gas fraction [0.0 - 1.0]
  waterCut: number; // [0.0 - 1.0]
}

export interface OlgaPump {
  name: string;
  position: number; // absolute position along flowpath [m]
  type: "CENTRIFUGAL" | "ESP" | "MULTIPHASE_TWIN_SCREW";
  ratedHead: number; // head in meters [m] or pressure boost [Pa]
  ratedFlowRate: number; // m^3 / s
  speedRpm: number; // rotational speed
  ratedPowerKw: number; // motor power rating [kW]
  gasVoidFractionLimit: number; // max allowable GVF before gassing lock (e.g., 0.15 for centrifugal, 0.45 for multiphase)
}

export interface OlgaCompressor {
  name: string;
  position: number; // absolute position along flowpath [m]
  type: "CENTRIFUGAL" | "RECIPROCATING";
  pressureRatio: number; // P_discharge / P_suction (typically 1.5 - 3.5)
  polytropicEfficiency: number; // 0.70 - 0.85
  ratedPowerKw: number;
  antiSurgeMargin: number; // fraction margin above surge line (typically 0.10)
}

export interface OlgaHeatExchanger {
  name: string;
  position: number; // absolute position along flowpath [m]
  type?: "SIMPLE" | "CROSS_FLOW" | "CO_CURRENT" | "COUNTER_CURRENT" | undefined;
  dutyKw?: number | undefined; // Heat duty in kiloWatts [kW] (positive for heating, negative for cooling)
  targetTemperature?: number | undefined; // Target outlet temperature [K]
  overallUa?: number | undefined; // Overall heat transfer coefficient * Area [W/K]
  ambientTemperature?: number | undefined; // Secondary / coolant temperature [K]
}

export interface OlgaWaxConfig {
  cloudPointTemp: number; // Wax Appearance Temperature (WAT) [K]
  molecularDiffusionCoeff?: number | undefined; // m^2 / s (default: 1.5e-9)
  waxDensity?: number | undefined; // kg / m^3 (default: 880 kg/m^3)
}

export interface OlgaSandConfig {
  sandMassRate: number; // kg / s
  particleDiameter?: number | undefined; // meters (default: 150 microns = 1.5e-4)
  sandDensity?: number | undefined; // kg / m^3 (default: 2650 kg/m^3)
}

export interface SaraFractions {
  saturatesPercent: number; // wt%
  aromaticsPercent: number; // wt%
  resinsPercent: number; // wt%
  asphaltenesPercent: number; // wt%
}

export interface OlgaAsphalteneConfig {
  sara: SaraFractions;
  bubblePointPressure?: number | undefined; // Pascal [Pa]
  exposureTimeHours?: number | undefined; // cumulative hours
  existingDepositThicknessM?: number | undefined; // meters [m]
}

export type OlgaNodeKind = "TERMINAL" | "PRESSURE" | "MASS_SOURCE" | "INTERNAL" | "SEPARATOR";

export interface OlgaNode {
  name: string;
  type: OlgaNodeKind;
  flowpath: string;
  boundaryPosition: number; // 0.0 for inlet, 1.0 for outlet
  pressure?: number | undefined; // Pa
  temperature?: number | undefined; // K
  massRate?: number | undefined; // kg/s
  gasMassFraction?: number | undefined;
  waterCut?: number | undefined;
  h2sMoleFraction?: number | undefined; // e.g. 0.005 for 0.5 mol% H2S
  co2MoleFraction?: number | undefined; // e.g. 0.03 for 3 mol% CO2
}

export interface OlgaPig {
  name: string;
  launchTime: number; // seconds [s]
  mass?: number | undefined; // kg (default: 100 kg)
  diameter?: number | undefined; // meters [m]
  bypassFraction?: number | undefined; // 0.0 - 0.2
  frictionForce?: number | undefined; // Newtons [N]
}

export interface OlgaFlowpath {
  name: string;
  pipes: OlgaPipe[];
  valves: OlgaValve[];
  sources: OlgaSource[];
  controllers: OlgaController[];
  pigs?: OlgaPig[] | undefined;
  heatTransfer?: OlgaHeatTransfer | undefined;
  ipr?: OlgaIpr | undefined;
  pumps?: OlgaPump[] | undefined;
  compressors?: OlgaCompressor[] | undefined;
  heatExchangers?: OlgaHeatExchanger[] | undefined;
  waxConfig?: OlgaWaxConfig | undefined;
  sandConfig?: OlgaSandConfig | undefined;
  asphalteneConfig?: OlgaAsphalteneConfig | undefined;
}

export interface OlgaModel {
  title: string;
  caseName?: string | undefined;
  author?: string | undefined;
  tableFile?: string | undefined;
  startTime: number; // seconds [s]
  endTime: number; // seconds [s]
  minDt: number; // seconds [s]
  maxDt: number; // seconds [s]
  flowpaths: OlgaFlowpath[];
  nodes: OlgaNode[];
  restartConfig?: { file: string; time?: number | undefined } | undefined;
  outputConfig?:
    | {
        trendInterval?: number | undefined;
        profileInterval?: number | undefined;
        variables?: string[] | undefined;
      }
    | undefined;
}

export interface OlgaCellState {
  x: number;
  pressurePa: number;
  temperatureK: number;
  liquidHoldup: number;
  gasHoldup: number;
  liquidVelocityMps: number;
  gasVelocityMps: number;
  dropletFraction?: number | undefined;
}

export interface OlgaCheckpointState {
  version: "1.0";
  timestamp: string;
  simulatedTime: number; // [s]
  modelTitle: string;
  gridCells: OlgaCellState[];
  pigStates?: { name: string; position: number; velocity: number; sweptVolume: number; isStuck: boolean }[] | undefined;
  slugStates?: { id: number; tailX: number; frontX: number; length: number; velocity: number }[] | undefined;
  controllers?: { name: string; integralState: number; lastOutput: number }[] | undefined;
  machinery?: { name: string; speedRpm: number; powerKw: number }[] | undefined;
  boundaryConditions?: Record<string, number> | undefined;
}

export interface SpatialProfileSnapshot {
  time: number; // seconds [s]
  x: number[]; // spatial distance [m]
  elevation?: number[] | undefined; // elevation profile [m]
  pressure: number[]; // Pascal [Pa]
  temperature: number[]; // Kelvin [K]
  liquidHoldup: number[]; // fraction [0.0 - 1.0]
  gasVelocity: number[]; // m/s
  liquidVelocity: number[]; // m/s
  flowRegimes?: string[] | undefined; // identified flow regime per cell
  waxThickness?: number[] | undefined; // deposited wax layer thickness [m]
  sandDropoutRisk?: boolean[] | undefined; // cells where vm < v_crit
  soundSpeed?: number[] | undefined; // multiphase acoustic sound speed [m/s]
  rawVariables?: Record<string, number[]> | undefined; // arbitrary profile variables along X
  activeSlugs?:
    | {
        id: number;
        frontPosition: number;
        tailPosition: number;
        length: number;
        holdup: number;
        velocity: number;
      }[]
    | undefined;
  pigs?:
    | {
        name: string;
        position: number;
        velocity: number;
        differentialPressure: number;
        sweptLiquidVolume: number;
        isStuck: boolean;
      }[]
    | undefined;
}

/** Represents a single trend variable/column in an OLGA .tpl output file. */
export interface OlgaTrendVariable {
  id: string; // column identifier e.g. "PT:FLOWPATH_1(1)"
  name: string; // display name e.g. "PT Inlet"
  variable: string; // physical variable code e.g. "PT", "TM", "HOL", "QLT"
  branch?: string | undefined; // branch/flowpath name e.g. "FLOWPATH_1"
  sectionIndex?: number | undefined; // section / point index
  unit: string; // unit e.g. "PA", "BAR", "C", "KG/S", "-"
  description?: string | undefined;
}

/** Complete arbitrary trend dataset extracted from an OLGA .tpl file. */
export interface OlgaTrendDataset {
  title?: string | undefined;
  caseName?: string | undefined;
  times: number[]; // time steps [s]
  variables: OlgaTrendVariable[]; // catalog of variables
  data: number[][]; // [variableIndex][timeIndex]
}

/** Represents a single profile variable in an OLGA .ppl output file. */
export interface OlgaProfileVariable {
  name: string; // physical code e.g. "PT", "TM", "HOL", "UG", "UL", "ID"
  unit: string; // unit e.g. "PA", "C", "-", "M/S"
  description?: string | undefined;
}

/** A single spatial snapshot in an OLGA .ppl file along flowline coordinate X. */
export interface OlgaProfileSnapshot {
  time: number; // time instance [s]
  x: number[]; // spatial positions along pipe [m]
  elevation?: number[] | undefined; // pipeline elevation [m]
  variables: Record<string, number[]>; // variable name -> values along x
  flowRegimes?: string[] | undefined; // decoded flow regime names if ID is present
}

/** Complete multi-snapshot spatial profile dataset extracted from an OLGA .ppl file. */
export interface OlgaProfileDataset {
  title?: string | undefined;
  branch: string;
  variables: OlgaProfileVariable[];
  snapshots: OlgaProfileSnapshot[];
}

export interface OlgaSimulationResult {
  times: number[];
  profiles: SpatialProfileSnapshot[];
  trends: {
    inletPressure: number[];
    arrivalPressure: number[];
    arrivalTemperature: number[];
    arrivalLiquidHoldup: number[];
    arrivalLiquidMassRate: number[];
    accumulatedLiquidVolume: number[];
    peakLiquidSurgeVolume: number;
    // Advanced hydrodynamic & operational metrics
    meanSlugLength?: number[] | undefined;
    slugFrequency?: number[] | undefined;
    activeSlugsCount?: number[] | undefined;
    pigPosition?: number[] | undefined;
    pigVelocity?: number[] | undefined;
    emulsionViscosity?: number[] | undefined;
    maxWaxThickness?: number[] | undefined;
    pumpHeadDeltaP?: number[] | undefined;
    compressorDischargeP?: number[] | undefined;
    chokeOpening?: number[] | undefined;
    controllerError?: number[] | undefined;
  };
  trendDataset?: OlgaTrendDataset | undefined;
  profileDataset?: OlgaProfileDataset | undefined;
}

export interface FlowAssuranceLimits {
  maop: number; // Maximum Allowable Operating Pressure [Pa]
  hydrateMarginKelvin: number; // Minimum temperature margin above hydrate curve [K]
  slugCatcherLiquidCapacity: number; // Maximum slug catcher liquid volume [m^3]
  minGasVelocity: number; // Critical velocity for liquid turndown droplet deposition [m/s]
  cloudPointTemp?: number | undefined; // Wax Appearance Temperature (WAT) [K]
  minWaxMarginKelvin?: number | undefined; // Minimum temperature above WAT [K]
  maxErosionalVelocity?: number | undefined; // API RP 14E velocity limit [m/s]
  minSandTransportVelocity?: number | undefined; // Critical sand settling velocity [m/s]
}

export interface FlowAssuranceVerificationResult {
  passed: boolean;
  checks: {
    hydrateAvoidance: {
      passed: boolean;
      minMarginObserved: number; // K
      requiredMargin: number; // K
      criticalLocation: number; // m
    };
    slugCatcherSurge: {
      passed: boolean;
      peakArrivalLiquidVolume: number; // m^3
      capacityLimit: number; // m^3
    };
    maopOverpressure: {
      passed: boolean;
      peakPressureObserved: number; // Pa
      maopLimit: number; // Pa
    };
    turndownVelocity: {
      passed: boolean;
      minVelocityObserved: number; // m/s
      requiredVelocity: number; // m/s
    };
    waxAvoidance?:
      | {
          passed: boolean;
          minMarginObserved: number; // K
          requiredMargin: number; // K
          criticalLocation: number; // m
        }
      | undefined;
    sandTransport?:
      | {
          passed: boolean;
          minVelocityObserved: number; // m/s
          maxVelocityObserved: number; // m/s
          requiredMinVelocity: number; // m/s
          erosionalLimit: number; // m/s
        }
      | undefined;
  };
}

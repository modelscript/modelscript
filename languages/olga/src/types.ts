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
}

export interface OlgaModel {
  title: string;
  author?: string | undefined;
  tableFile?: string | undefined;
  startTime: number; // seconds [s]
  endTime: number; // seconds [s]
  minDt: number; // seconds [s]
  maxDt: number; // seconds [s]
  flowpaths: OlgaFlowpath[];
  nodes: OlgaNode[];
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
  };
}

export interface FlowAssuranceLimits {
  maop: number; // Maximum Allowable Operating Pressure [Pa]
  hydrateMarginKelvin: number; // Minimum temperature margin above hydrate curve [K]
  slugCatcherLiquidCapacity: number; // Maximum slug catcher liquid volume [m^3]
  minGasVelocity: number; // Critical velocity for liquid turndown droplet deposition [m/s]
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
  };
}

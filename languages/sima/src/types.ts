// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Domain types and AST structures for SINTEF Ocean SIMO / RIFLEX / SIMA.
 */

export interface FairleadPoint {
  id: string;
  name: string;
  vesselId: string;
  position: [number, number, number]; // [x, y, z] relative to vessel reference
}

export interface LineSegment {
  id: string;
  name: string;
  length: number; // unstretched length (m)
  diameter: number; // outer diameter (m)
  dryMassPerMeter: number; // kg/m
  submergedWeightPerMeter: number; // N/m in seawater
  axialStiffnessEA: number; // N
  bendingStiffnessEI: number; // N*m^2
  torsionalStiffnessGJ?: number | undefined; // N*m^2
  mbl: number; // Minimum Breaking Load (N)
  cd: number; // transverse Morison drag coefficient
  cm: number; // transverse Morison inertia coefficient
  material?: string | undefined;
  lineType?: string | undefined;
}

export interface MooringLine {
  id: string;
  name: string;
  type: "catenary" | "taut" | "semitaut" | "riser" | "umbilical" | "power_cable";
  fairleadId: string;
  fairleadPosition?: [number, number, number] | undefined;
  anchorPosition: [number, number, number];
  segments: LineSegment[];
  totalLength: number;
  pretension?: number | undefined; // N
  minBendingRadius?: number | undefined; // m (MBR)
}

export interface HydrodynamicRaoEntry {
  dof: 1 | 2 | 3 | 4 | 5 | 6; // 1: Surge, 2: Sway, 3: Heave, 4: Roll, 5: Pitch, 6: Yaw
  amplitude: number[]; // response amplitude per frequency
  phase: number[]; // phase angle (deg or rad) per frequency
}

export interface HydrodynamicData {
  frequencies: number[]; // rad/s or Hz
  headings: number[]; // deg
  raos: Record<number, HydrodynamicRaoEntry[]>; // headingIndex -> 6 DOFs
  addedMassInfinity?: number[][]; // 6x6 matrix
  hydrostaticRestoring?: number[][]; // 6x6 C matrix
  retardationTimeSteps?: number[];
  retardationKernel?: number[][][]; // 6x6xT
}

export interface Vessel {
  id: string;
  name: string;
  mass: number; // kg
  displacement: number; // m^3
  cg: [number, number, number]; // center of gravity [x, y, z]
  radiiOfGyration: [number, number, number]; // [rxx, ryy, rzz]
  massMatrix: number[][]; // 6x6
  hydrostaticMatrix: number[][]; // 6x6 C-matrix
  linearDamping: number[][]; // 6x6
  quadraticDamping: number[][]; // 6x6
  gmTransverse: number; // GMt (m)
  gmLongitudinal: number; // GMl (m)
  fairleads: FairleadPoint[];
  hydrodynamics?: HydrodynamicData;
}

export interface EnvironmentalConditions {
  waterDepth: number; // m
  waterDensity: number; // kg/m^3 (e.g. 1025)
  seabedFriction: number; // dimensionless (e.g. 0.5)
  wave: {
    spectrum: "jonswap" | "pierson-moskowitz" | "regular" | "airy";
    hs: number; // significant wave height (m)
    tp: number; // peak period (s)
    gamma: number; // peakedness factor
    direction: number; // wave heading (deg)
  };
  wind: {
    speed: number; // 1-hour mean wind speed at 10m (m/s)
    direction: number; // wind heading (deg)
  };
  current: {
    surfaceSpeed: number; // m/s
    direction: number; // current heading (deg)
  };
}

export interface SimulationConfig {
  timeStep: number; // seconds (dt)
  duration: number; // seconds
  rampTime?: number; // seconds
  solver: "newmark" | "wilson" | "catenary_quasi_static" | "cummins_dae";
}

export interface SimaModel {
  title?: string | undefined;
  sourceFile?: string | undefined;
  vessels: Vessel[];
  lines: MooringLine[];
  environment: EnvironmentalConditions;
  simulation: SimulationConfig;
  tasks?: string[] | undefined;
  rawCards?: Record<string, string[]> | undefined;
}

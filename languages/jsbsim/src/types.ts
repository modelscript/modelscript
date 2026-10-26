// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — JSBSim 2.0 Flight Dynamics Model AST & Data Types.
 *
 * Conforms to JSBSim 2.0 XML schema specifications for 6-DOF aircraft dynamics.
 */

export interface JsbsimRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface JsbsimLocation {
  x: number; // inches or meters (positive forward or aft per frame)
  y: number; // positive right
  z: number; // positive up
}

export interface JsbsimMetrics {
  wingArea: number; // ft^2 or m^2
  wingspan: number; // ft or m
  chord: number; // ft or m
  htailArea?: number | undefined;
  htailArm?: number | undefined;
  vtailArea?: number | undefined;
  vtailArm?: number | undefined;
  aeroCenter: JsbsimLocation;
  range?: JsbsimRange | undefined;
}

export interface JsbsimInertia {
  emptyWeight: number; // lbs or kg
  cgLocation: JsbsimLocation;
  ixx: number; // slug*ft^2 or kg*m^2
  iyy: number;
  izz: number;
  ixz: number;
  ixy?: number | undefined;
  iyz?: number | undefined;
  range?: JsbsimRange | undefined;
}

export interface JsbsimLandingGear {
  name: string;
  type: "BOGEY" | "STRUCTURE" | "NOSE" | "TAIL";
  location: JsbsimLocation;
  springCoeff: number; // lbs/ft or N/m
  dampingCoeff: number;
  staticFriction: number;
  dynamicFriction: number;
  steerable: boolean;
  brakeGroup?: "NONE" | "LEFT" | "RIGHT" | "NOSE" | undefined;
  range?: JsbsimRange | undefined;
}

export interface JsbsimEngine {
  name: string;
  type: "TURBINE" | "PISTON" | "ROCKET" | "ELECTRIC";
  location: JsbsimLocation;
  maxThrust: number; // lbf or N
  range?: JsbsimRange | undefined;
}

export interface JsbsimFcsChannel {
  name: string;
  type: string; // "AILERON" | "ELEVATOR" | "RUDDER" | "FLAP" | "THROTTLE" | "PITCH_AUTOPILOT"
  inputs: string[];
  output: string;
  gain?: number | undefined;
  range?: JsbsimRange | undefined;
}

export interface JsbsimAeroCoeff {
  name: string;
  axis: "LIFT" | "DRAG" | "SIDE" | "ROLL" | "PITCH" | "YAW";
  baseValue: number;
  terms: { property: string; factor: number }[];
  range?: JsbsimRange | undefined;
}

export interface JsbsimModel {
  name: string;
  version: string;
  fileHeader?: string | undefined;
  metrics: JsbsimMetrics;
  massBalance: JsbsimInertia;
  groundReactions: JsbsimLandingGear[];
  engines: JsbsimEngine[];
  fcsChannels: JsbsimFcsChannel[];
  aeroCoefficients: JsbsimAeroCoeff[];
  range?: JsbsimRange | undefined;
}

export interface JsbsimDocument {
  model: JsbsimModel;
  sourceFile?: string | undefined;
}

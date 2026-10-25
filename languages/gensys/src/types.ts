// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Inertia3D {
  jx: number; // roll inertia (kg*m^2)
  jy: number; // pitch inertia (kg*m^2)
  jz: number; // yaw inertia (kg*m^2)
}

export interface GensysBody {
  name: string;
  mass: number; // kg
  inertia: Inertia3D;
  position: Vector3D; // nominal position [m]
  comment?: string;
}

export interface SpringDamperElement {
  name: string;
  type: "linear" | "nonlinear" | "series";
  body1: string;
  body2: string;
  attachPoint1: Vector3D;
  attachPoint2: Vector3D;
  stiffness: Vector3D; // kx, ky, kz [N/m]
  damping: Vector3D; // cx, cy, cz [N*s/m]
}

export interface WheelsetDefinition {
  name: string;
  mass: number;
  inertia: Inertia3D;
  gauge: number; // nominal track gauge, e.g. 1.435 [m]
  wheelRadius: number; // nominal rolling radius [m]
  conicity: number; // equivalent conicity lambda
  profile?: string | undefined; // profile file name or profile type (e.g. S1002)
}

export interface TrackIrregularityPoint {
  distance: number; // longitudinal distance [m]
  alignmentLeft: number; // horizontal irregularity [m]
  alignmentRight: number;
  verticalLeft: number; // vertical irregularity [m]
  verticalRight: number;
  cant: number; // crosslevel / superelevation [rad or m]
  curvature: number; // horizontal curvature 1/R [1/m]
}

export interface TrackGeometry {
  name: string;
  nominalGauge: number;
  points: TrackIrregularityPoint[];
}

export interface GensysModel {
  name: string;
  subsystems: string[];
  bodies: Map<string, GensysBody>;
  couplings: Map<string, SpringDamperElement>;
  wheelsets: Map<string, WheelsetDefinition>;
  track?: TrackGeometry;
  simulationConfig?: {
    speed: number; // vehicle forward velocity [m/s]
    tStart: number;
    tStop: number;
    dt: number;
  };
}

export interface FastsimContactInput {
  normalForce: number; // Q or N [N]
  longitudinalCreep: number; // xi_x [-]
  lateralCreep: number; // xi_y [-]
  spin: number; // phi_z [rad/m]
  ellipseSemiMajor: number; // a [m]
  ellipseSemiMinor: number; // b [m]
  shearModulus: number; // G [Pa], ~8.2e10 for steel
  poissonRatio: number; // nu [-], ~0.28 for steel
  frictionCoeff: number; // mu [-], ~0.35-0.4
}

export interface FastsimContactOutput {
  fx: number; // longitudinal creep force [N]
  fy: number; // lateral creep force [N]
  mz: number; // spin moment [N*m]
  adhesionRatio: number; // utilized friction sqrt(fx^2 + fy^2) / (mu * normalForce)
}

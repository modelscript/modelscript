// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SimpackMarker {
  id: string;
  name: string;
  bodyId: string; // parent body or "$inertial"
  position: Vector3D;
  orientation: Vector3D; // Euler angles [rad] (alpha, beta, gamma)
}

export interface SimpackBody {
  id: string;
  name: string;
  mass: number;
  inertia: {
    ixx: number;
    iyy: number;
    izz: number;
    ixy?: number;
    iyz?: number;
    izx?: number;
  };
  markerId: string; // reference marker
  isFlexible?: boolean;
}

export type JointType =
  | "revolute"
  | "prismatic"
  | "cylindrical"
  | "spherical"
  | "planar"
  | "universal"
  | "free"
  | "fixed";

export interface SimpackJoint {
  id: string;
  name: string;
  type: JointType;
  fromMarker: string;
  toMarker: string;
  dofCount: number;
  baumgarteAlpha?: number | undefined;
  baumgarteBeta?: number | undefined;
}

export interface SimpackForceElement {
  id: string;
  name: string;
  type: "spring_damper" | "bushing" | "contact";
  markerA: string;
  markerB: string;
  stiffness: Vector3D;
  damping: Vector3D;
  rotationalStiffness?: Vector3D | undefined;
  rotationalDamping?: Vector3D | undefined;
  nonlinearStiffness?: Vector3D | undefined;
}

export interface SimpackModel {
  name: string;
  bodies: Map<string, SimpackBody>;
  markers: Map<string, SimpackMarker>;
  joints: Map<string, SimpackJoint>;
  forces: Map<string, SimpackForceElement>;
}

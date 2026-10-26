// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface UrdfOrigin {
  xyz: Vector3D;
  rpy: Vector3D; // roll, pitch, yaw [rad]
}

export interface UrdfInertial {
  origin?: UrdfOrigin | undefined;
  mass: number;
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
}

export type UrdfGeometryType = "box" | "cylinder" | "sphere" | "mesh";

export interface UrdfGeometry {
  type: UrdfGeometryType;
  size?: Vector3D | undefined; // For box [m]
  radius?: number | undefined; // For cylinder, sphere [m]
  length?: number | undefined; // For cylinder [m]
  filename?: string | undefined; // For mesh (e.g. package:// or file://)
  scale?: Vector3D | undefined; // For mesh scaling
}

export interface UrdfColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface UrdfMaterial {
  name: string;
  color?: UrdfColor | undefined;
  texture?: string | undefined;
}

export interface UrdfVisual {
  name?: string | undefined;
  origin?: UrdfOrigin | undefined;
  geometry: UrdfGeometry;
  material?: UrdfMaterial | undefined;
}

export interface UrdfCollision {
  name?: string | undefined;
  origin?: UrdfOrigin | undefined;
  geometry: UrdfGeometry;
}

export interface UrdfLink {
  name: string;
  inertial?: UrdfInertial | undefined;
  visuals: UrdfVisual[];
  collisions: UrdfCollision[];
  range?: SourceRange | undefined;
}

export type UrdfJointType = "revolute" | "continuous" | "prismatic" | "fixed" | "floating" | "planar";

export interface UrdfJointLimits {
  lower?: number | undefined;
  upper?: number | undefined;
  effort: number;
  velocity: number;
}

export interface UrdfJointDynamics {
  damping?: number | undefined;
  friction?: number | undefined;
}

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parentLink: string;
  childLink: string;
  origin?: UrdfOrigin | undefined;
  axis: Vector3D;
  limits?: UrdfJointLimits | undefined;
  dynamics?: UrdfJointDynamics | undefined;
  range?: SourceRange | undefined;
}

export interface UrdfRobot {
  name: string;
  links: Map<string, UrdfLink>;
  joints: Map<string, UrdfJoint>;
  materials: Map<string, UrdfMaterial>;
}

export interface UrdfDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: SourceRange;
  quickFix?:
    | {
        title: string;
        edit: {
          text: string;
          range: SourceRange;
        };
      }
    | undefined;
}

export interface RneaResult {
  jointTorques: Map<string, number>;
}

export interface AbaResult {
  jointAccelerations: Map<string, number>;
}

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

export interface AdamsInertia {
  ixx: number;
  iyy: number;
  izz: number;
  ixy?: number | undefined;
  ixz?: number | undefined;
  iyz?: number | undefined;
}

export interface AdamsPart {
  id: number | string;
  name: string;
  isGround: boolean;
  mass: number;
  cmMarkerId?: number | string | undefined;
  inertia: AdamsInertia;
  range?: SourceRange | undefined;
}

export interface AdamsMarker {
  id: number | string;
  name: string;
  partId: number | string;
  position: Vector3D;
  orientation: Vector3D; // Euler angles (deg or rad) or orientation components
  useEuler: boolean;
  range?: SourceRange | undefined;
}

export type AdamsJointType =
  | "REVOLUTE"
  | "TRANSLATIONAL"
  | "SPHERICAL"
  | "UNIVERSAL"
  | "PLANAR"
  | "CYLINDRICAL"
  | "FIXED"
  | "SCREW";

export interface AdamsJoint {
  id: number | string;
  name: string;
  type: AdamsJointType;
  iMarkerId: number | string;
  jMarkerId: number | string;
  pitch?: number | undefined;
  dofCount: number;
  range?: SourceRange | undefined;
}

export type AdamsForceType = "SPRINGDAMPER" | "SFORCE" | "VFORCE" | "GFORCE" | "BUSHING";

export interface AdamsForce {
  id: number | string;
  name: string;
  type: AdamsForceType;
  actionType?: "TRANSLATIONAL" | "ROTATIONAL" | undefined;
  iMarkerId: number | string;
  jMarkerId: number | string;
  stiffness?: number | undefined;
  damping?: number | undefined;
  freeLength?: number | undefined;
  functionExpr?: string | undefined;
  range?: SourceRange | undefined;
}

export interface AdamsMotion {
  id: number | string;
  name: string;
  jointId?: number | string | undefined;
  markerId?: number | string | undefined;
  type: "TRANSLATIONAL" | "ROTATIONAL";
  functionExpr: string;
  range?: SourceRange | undefined;
}

export interface AdamsRequest {
  id: number | string;
  name: string;
  type: "DISPLACEMENT" | "VELOCITY" | "ACCELERATION" | "FORCE";
  iMarkerId: number | string;
  jMarkerId: number | string;
  refMarkerId?: number | string | undefined;
  range?: SourceRange | undefined;
}

export interface AdamsSimulateDirective {
  type: "DYNAMIC" | "STATICS" | "KINEMATICS" | "LINEAR";
  endTime?: number | undefined;
  dtOut?: number | undefined;
  numSteps?: number | undefined;
  range?: SourceRange | undefined;
}

export interface AdamsDataset {
  title: string;
  parts: Map<string | number, AdamsPart>;
  markers: Map<string | number, AdamsMarker>;
  joints: Map<string | number, AdamsJoint>;
  forces: Map<string | number, AdamsForce>;
  motions: Map<string | number, AdamsMotion>;
  requests: Map<string | number, AdamsRequest>;
  simulation?: AdamsSimulateDirective | undefined;
}

export interface AdamsMobilityResult {
  numBodies: number;
  numJoints: number;
  totalConstraintEquations: number;
  calculatedMobility: number;
  isOverconstrained: boolean;
}

export interface AdamsDiagnostic {
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

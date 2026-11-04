// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — OpenSim 3.x / 4.x Musculoskeletal Modeling AST & Types.
 */

export interface OpenSimSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface OpenSimBody {
  id: string;
  name: string;
  mass: number;
  massCenter: [number, number, number];
  inertia: [number, number, number, number, number, number];
  range: OpenSimSourceRange;
}

export type OpenSimCoordinateMotionType = "rotational" | "translational" | "coupled";

export interface OpenSimCoordinate {
  id: string;
  name: string;
  motionType: OpenSimCoordinateMotionType;
  defaultValue: number;
  rangeMin: number;
  rangeMax: number;
  clamped: boolean;
  locked: boolean;
  range: OpenSimSourceRange;
}

export type OpenSimJointType = "PinJoint" | "SliderJoint" | "BallJoint" | "WeldJoint" | "CustomJoint" | "FreeJoint";

export interface OpenSimJoint {
  id: string;
  name: string;
  jointType: OpenSimJointType;
  parentFrame: string;
  childFrame: string;
  locationInParent: [number, number, number];
  orientationInParent: [number, number, number];
  coordinates: OpenSimCoordinate[];
  range: OpenSimSourceRange;
}

export interface OpenSimPathPoint {
  name: string;
  bodyFrame: string;
  location: [number, number, number];
  range?: OpenSimSourceRange | undefined;
}

export type OpenSimWrapType = "WrapCylinder" | "WrapSphere" | "WrapEllipsoid";

export interface OpenSimWrapObject {
  id: string;
  name: string;
  wrapType: OpenSimWrapType;
  bodyFrame: string;
  radius: number;
  length: number;
  range: OpenSimSourceRange;
}

export type OpenSimMuscleType = "Thelen2003Muscle" | "Millard2012EquilibriumMuscle" | "Schutte1993Muscle";

export interface OpenSimMuscle {
  id: string;
  name: string;
  muscleType: OpenSimMuscleType;
  maxIsometricForce: number;
  optimalFiberLength: number;
  tendonSlackLength: number;
  pennationAngleAtOptimal: number;
  activationTimeConstant: number;
  deactivationTimeConstant: number;
  maxContractionVelocity: number;
  pathPoints: OpenSimPathPoint[];
  wrapObjects: string[];
  range: OpenSimSourceRange;
}

export interface OpenSimMarker {
  id: string;
  name: string;
  bodyFrame: string;
  location: [number, number, number];
  range: OpenSimSourceRange;
}

export type OpenSimConstraintType = "PointConstraint" | "WeldConstraint" | "CoordinateCouplerConstraint";

export interface OpenSimConstraint {
  id: string;
  name: string;
  constraintType: OpenSimConstraintType;
  body1: string;
  body2: string;
  range: OpenSimSourceRange;
}

export interface OpenSimDocument {
  modelName: string;
  version: string;
  gravity: [number, number, number];
  bodies: OpenSimBody[];
  joints: OpenSimJoint[];
  muscles: OpenSimMuscle[];
  markers: OpenSimMarker[];
  wrapObjects: OpenSimWrapObject[];
  constraints: OpenSimConstraint[];
  uri?: string | undefined;
}

export type OpenSimSeverity = "error" | "warning" | "info";

export interface OpenSimDiagnostic {
  code: string;
  rule: string;
  severity: OpenSimSeverity;
  message: string;
  range: OpenSimSourceRange;
}

// SPDX-License-Identifier: LGPL-3.0-or-later

export interface StepPart {
  id: string; // STEP entity instance ID (#N)
  name: string; // PRODUCT name
  shapeId?: string; // Reference to SHAPE_DEFINITION_REPRESENTATION
}

export interface StepAssemblyEdge {
  parentPartId: string;
  childPartId: string;
  placement: StepPlacement; // ITEM_DEFINED_TRANSFORMATION
}

export interface StepPlacement {
  location: [number, number, number];
  axis: [number, number, number];
  refDirection: [number, number, number];
}

export interface StepMassProperties {
  mass: number; // kg
  centerOfMass: [number, number, number]; // m
  inertiaTensor?: {
    // kg·m² (w.r.t. CoM, principal axes)
    I_11: number;
    I_22: number;
    I_33: number;
    I_21: number;
    I_31: number;
    I_32: number;
  };
  volume: number; // m³
}

export interface StepKinematicJoint {
  type: "revolute" | "prismatic" | "cylindrical" | "spherical" | "planar" | "fixed";
  partA: string; // Parent part ID
  partB: string; // Child part ID
  axis: [number, number, number];
  origin: [number, number, number];
  initialValue?: number; // Initial angle (rad) or displacement (m)
  limits?: { lower: number; upper: number };
}

export type StepToleranceType =
  | "flatness"
  | "roundness"
  | "cylindricity"
  | "perpendicularity"
  | "parallelism"
  | "position"
  | "surface_profile"
  | "concentricity"
  | "runout";

export interface StepGeometricTolerance {
  id: string; // Entity ID (e.g. #105)
  name?: string;
  type: StepToleranceType;
  magnitude: number; // Tolerance magnitude (e.g. 0.05)
  datumReferences: string[]; // Ordered datum identifiers (e.g. ["A", "B", "C"])
  appliedShapeAspect?: string; // Target shape aspect / face reference
}

export interface StepDatum {
  id: string; // Entity ID
  name: string; // Datum label (e.g. "A")
  featureRef?: string; // Associated feature/shape reference
}

export interface StepDatumSystem {
  id: string;
  name?: string;
  primaryDatum: string;
  secondaryDatum?: string;
  tertiaryDatum?: string;
}

export interface StepAssemblyModel {
  parts: Map<string, StepPart>;
  edges: StepAssemblyEdge[];
  joints: StepKinematicJoint[];
  massProperties: Map<string, StepMassProperties>; // partId → properties
  tolerances?: StepGeometricTolerance[];
  datums?: Map<string, StepDatum>;
  datumSystems?: StepDatumSystem[];
}

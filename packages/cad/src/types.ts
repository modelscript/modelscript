// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Core type definitions.
 *
 * All geometry in the procedural CAD system is represented as a tree of
 * {@link Solid} nodes.  Each leaf is a primitive shape; interior nodes are
 * transforms and boolean operations.  The tree is evaluated lazily when
 * compiled to STEP.
 */

// ── Vectors & Matrices ───────────────────────────────────────────────────

/** A three-component vector [x, y, z]. */
export type Vec3 = readonly [number, number, number];

/** 4×4 column-major affine transform matrix. */
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// ── Solid tree node kinds ────────────────────────────────────────────────

export enum SolidKind {
  Box = "box",
  Cylinder = "cylinder",
  Sphere = "sphere",
  Torus = "torus",
  Transform = "transform",
  Union = "union",
  Subtract = "subtract",
  Intersect = "intersect",
  TaggedPatch = "tagged_patch",
  Fillet = "fillet",
  Chamfer = "chamfer",
  Extrusion = "extrusion",
}

// ── Solid source metadata ───────────────────────────────────────────────

export interface SolidSourceMetadata {
  /** Optional parameter name associated with this solid's dimensions or position (e.g., 'arm_length'). */
  readonly parameterName?: string;
  /** Fluent transform method name (e.g., 'translate', 'rotate', 'scale'). */
  readonly transformMethod?: string;
  /** Index of the argument in the method call. */
  readonly argIndex?: number;
  /** CST start byte in source code. */
  readonly startByte?: number;
  /** CST end byte in source code. */
  readonly endByte?: number;
}

// ── Primitive option bags ────────────────────────────────────────────────

export interface BoxOptions {
  /** Full width along X. */
  width: number;
  /** Full height along Y. */
  height: number;
  /** Full depth along Z. */
  depth: number;
  /** Optional display name (propagated into STEP). */
  name?: string | undefined;
  sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface CylinderOptions {
  /** Radius of the circular cross-section. */
  radius: number;
  /** Full height along Y. */
  height: number;
  /** Number of facets for tessellation (default 24). */
  segments?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface SphereOptions {
  /** Radius of the sphere. */
  radius: number;
  /** Latitude segments (default 16). */
  widthSegments?: number | undefined;
  /** Longitude segments (default 12). */
  heightSegments?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface TorusOptions {
  /** Major (ring) radius. */
  major: number;
  /** Minor (tube) radius. */
  minor: number;
  /** Segments around the ring (default 24). */
  majorSegments?: number | undefined;
  /** Segments around the tube (default 8). */
  minorSegments?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface ExtrusionOptions {
  /** 2D closed polygon vertices [[x0, y0], [x1, y1], ...]. */
  polygon: readonly [number, number][];
  /** Extrusion height along Z. */
  height: number;
  /** Optional twist angle in degrees. */
  twist?: number | undefined;
  /** Optional scale factor for the top cap. */
  scale?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  sourceMetadata?: SolidSourceMetadata | undefined;
}

// ── Solid node types ─────────────────────────────────────────────────────

export interface BoxSolid {
  readonly kind: SolidKind.Box;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface ExtrusionSolid {
  readonly kind: SolidKind.Extrusion;
  readonly name: string;
  readonly polygon: readonly [number, number][];
  readonly height: number;
  readonly twist?: number | undefined;
  readonly scale?: number | undefined;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface CylinderSolid {
  readonly kind: SolidKind.Cylinder;
  readonly name: string;
  readonly radius: number;
  readonly height: number;
  readonly segments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface SphereSolid {
  readonly kind: SolidKind.Sphere;
  readonly name: string;
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface TorusSolid {
  readonly kind: SolidKind.Torus;
  readonly name: string;
  readonly major: number;
  readonly minor: number;
  readonly majorSegments: number;
  readonly minorSegments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface TransformSolid {
  readonly kind: SolidKind.Transform;
  readonly name: string;
  readonly child: Solid;
  readonly matrix: Mat4;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface BooleanSolid {
  readonly kind: SolidKind.Union | SolidKind.Subtract | SolidKind.Intersect;
  readonly name: string;
  readonly left: Solid;
  readonly right: Solid;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export type BoundaryPatchType =
  | "fixed_support"
  | "mechanical_flange"
  | "fluid_inlet"
  | "fluid_outlet"
  | "aerodynamic_surface"
  | "thermal_interface";

export interface BoundaryPatchTag {
  readonly portName: string;
  readonly portType: BoundaryPatchType;
  readonly normal?: Vec3;
  readonly surfaceArea?: number;
}

export interface TaggedPatchSolid {
  readonly kind: SolidKind.TaggedPatch;
  readonly name: string;
  readonly child: Solid;
  readonly tag: BoundaryPatchTag;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface FilletSolid {
  readonly kind: SolidKind.Fillet;
  readonly name: string;
  readonly child: Solid;
  readonly radius: number;
  readonly edges?: readonly string[];
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

export interface ChamferSolid {
  readonly kind: SolidKind.Chamfer;
  readonly name: string;
  readonly child: Solid;
  readonly distance: number;
  readonly edges?: readonly string[];
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** A node in the constructive solid geometry tree. */
export type Solid =
  | BoxSolid
  | CylinderSolid
  | SphereSolid
  | TorusSolid
  | ExtrusionSolid
  | TransformSolid
  | BooleanSolid
  | TaggedPatchSolid
  | FilletSolid
  | ChamferSolid;

// ── Assembly ─────────────────────────────────────────────────────────────

export interface PartEntry {
  readonly solid: Solid;
  readonly material?: string | undefined;
  readonly color?: Vec3 | undefined;
  readonly boundingBox?:
    | {
        min: [number, number, number];
        max: [number, number, number];
      }
    | undefined;
}

export interface Assembly {
  readonly name: string;
  readonly parts: readonly PartEntry[];
}

// ── Parameter metadata ───────────────────────────────────────────────────

export interface ParamOptions {
  default: number;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
}

export interface ParamMeta {
  readonly name: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly currentValue: number;
}

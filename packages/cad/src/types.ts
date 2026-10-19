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

/** Discriminant tag for nodes in the procedural CSG {@link Solid} tree. */
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
  Polyhedron = "polyhedron",
}

// ── Solid source metadata ───────────────────────────────────────────────

/** Source byte span of a transform modifier (`translate`, `rotate`, `scale`) for bidirectional CST writeback. */
export interface TransformOffsetRange {
  /** Inclusive start byte offset in source. */
  readonly startOffset: number;
  /** Exclusive end byte offset in source. */
  readonly endOffset: number;
  /** True when the transform was authored in fluent method-chaining syntax. */
  readonly isFluent?: boolean | undefined;
}

/** Source code provenance metadata attached to a {@link Solid} node for interactive gizmo writeback. */
export interface SolidSourceMetadata {
  /** Optional parameter name associated with this solid's dimensions or position (e.g., 'arm_length'). */
  readonly parameterName?: string | undefined;
  /** Optional per-axis dimension parameter names [xParam, yParam, zParam] for primitives (e.g., cube([w, h, d])). */
  readonly dimensionParams?: readonly (string | undefined)[] | undefined;
  /** Evaluated primitive dimensions [w, h, d] or [r, h, r] for scale gizmo parameter inversion. */
  readonly dimensions?: Vec3 | undefined;
  /** Fluent or prefix transform method name (e.g., 'translate', 'rotate', 'scale'). */
  readonly transformMethod?: string | undefined;
  /** Index of the argument in the method call. */
  readonly argIndex?: number | undefined;
  /** CST start byte in source code. */
  readonly startOffset?: number | undefined;
  /** CST end byte in source code. */
  readonly endOffset?: number | undefined;
  /** CST start byte of the underlying primitive call. */
  readonly primitiveStartOffset?: number | undefined;
  /** CST end byte of the underlying primitive call. */
  readonly primitiveEndOffset?: number | undefined;
  /** Specific byte span for the `translate(...)` operation wrapping this solid. */
  readonly translateRange?: TransformOffsetRange | undefined;
  /** Specific byte span for the `rotate(...)` operation wrapping this solid. */
  readonly rotateRange?: TransformOffsetRange | undefined;
  /** Specific byte span for the `scale(...)` operation wrapping this solid. */
  readonly scaleRange?: TransformOffsetRange | undefined;
  /** Explicit user-authored translation offset [tx, ty, tz] in source code. */
  readonly translation?: Vec3 | undefined;
  /** Explicit user-authored Euler rotation [rx, ry, rz] (degrees) in source code. */
  readonly rotation?: Vec3 | undefined;
  /** Explicit user-authored scale factor [sx, sy, sz] in source code. */
  readonly scale?: Vec3 | undefined;
  /** Optional RGBA color [r, g, b, a] in [0, 1] assigned via color(...). */
  readonly color?: readonly [number, number, number, number] | undefined;
}

// ── Primitive option bags ────────────────────────────────────────────────

/** Construction options for a rectangular {@link BoxSolid} primitive. */
export interface BoxOptions {
  /** Full width along X. */
  width: number;
  /** Full height along Y. */
  height: number;
  /** Full depth along Z. */
  depth: number;
  /** Optional display name (propagated into STEP). */
  name?: string | undefined;
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Construction options for a circular or frustum {@link CylinderSolid} primitive. */
export interface CylinderOptions {
  /** Radius of the circular cross-section (or average radius if frustum). */
  radius: number;
  /** Optional bottom radius (r1) for cones/frustums. Defaults to `radius`. */
  radiusBottom?: number | undefined;
  /** Optional top radius (r2) for cones/frustums. Defaults to `radius`. */
  radiusTop?: number | undefined;
  /** Full height along Y. */
  height: number;
  /** Number of facets for tessellation (default 24). */
  segments?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Construction options for an arbitrary faceted {@link PolyhedronSolid} primitive. */
export interface PolyhedronOptions {
  /** 3D vertex coordinates [[x, y, z], ...]. */
  points: readonly Vec3[];
  /** Face vertex index loops [[i0, i1, i2, ...], ...]. */
  faces: readonly (readonly number[])[];
  /** Optional display name. */
  name?: string | undefined;
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Construction options for a {@link SphereSolid} primitive. */
export interface SphereOptions {
  /** Radius of the sphere. */
  radius: number;
  /** Latitude segments (default 16). */
  widthSegments?: number | undefined;
  /** Longitude segments (default 12). */
  heightSegments?: number | undefined;
  /** Optional display name. */
  name?: string | undefined;
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Construction options for a {@link TorusSolid} primitive. */
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
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Construction options for a linear 2D-to-3D {@link ExtrusionSolid} primitive. */
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
  /** Optional source CST provenance metadata. */
  sourceMetadata?: SolidSourceMetadata | undefined;
}

// ── Solid node types ─────────────────────────────────────────────────────

/** Axis-aligned rectangular box CSG leaf node. */
export interface BoxSolid {
  readonly kind: SolidKind.Box;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Linear extrusion of a closed 2D polygon along the Z axis. */
export interface ExtrusionSolid {
  readonly kind: SolidKind.Extrusion;
  readonly name: string;
  readonly polygon: readonly [number, number][];
  readonly height: number;
  readonly twist?: number | undefined;
  readonly scale?: number | undefined;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Right circular cylinder, cone, or frustum CSG leaf node. */
export interface CylinderSolid {
  readonly kind: SolidKind.Cylinder;
  readonly name: string;
  readonly radius: number;
  readonly radiusBottom?: number | undefined;
  readonly radiusTop?: number | undefined;
  readonly height: number;
  readonly segments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Arbitrary faceted polyhedron CSG leaf node defined by 3D points and polygonal face loops. */
export interface PolyhedronSolid {
  readonly kind: SolidKind.Polyhedron;
  readonly name: string;
  readonly points: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Sphere CSG leaf node centered at the origin. */
export interface SphereSolid {
  readonly kind: SolidKind.Sphere;
  readonly name: string;
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Torus CSG leaf node defined by major (ring) and minor (tube) radii. */
export interface TorusSolid {
  readonly kind: SolidKind.Torus;
  readonly name: string;
  readonly major: number;
  readonly minor: number;
  readonly majorSegments: number;
  readonly minorSegments: number;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Affine 4x4 transformation node wrapping a child {@link Solid}. */
export interface TransformSolid {
  readonly kind: SolidKind.Transform;
  readonly name: string;
  readonly child: Solid;
  readonly matrix: Mat4;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Binary CSG boolean node (`Union`, `Subtract`, or `Intersect`). */
export interface BooleanSolid {
  readonly kind: SolidKind.Union | SolidKind.Subtract | SolidKind.Intersect;
  readonly name: string;
  readonly left: Solid;
  readonly right: Solid;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Engineering boundary condition / physical port category for tagged CAD surface patches. */
export type BoundaryPatchType =
  | "fixed_support"
  | "mechanical_flange"
  | "fluid_inlet"
  | "fluid_outlet"
  | "aerodynamic_surface"
  | "thermal_interface";

/** Metadata tag binding a named boundary surface patch to a multiphysics port. */
export interface BoundaryPatchTag {
  /** Identifier of the associated multiphysics/FEA/CFD boundary port. */
  readonly portName: string;
  /** Physical boundary condition classification. */
  readonly portType: BoundaryPatchType;
  /** Optional outward unit normal vector of the tagged patch. */
  readonly normal?: Vec3 | undefined;
  /** Optional precomputed surface area in square meters/units. */
  readonly surfaceArea?: number | undefined;
}

/** CSG decorator node attaching a {@link BoundaryPatchTag} to a child {@link Solid}. */
export interface TaggedPatchSolid {
  readonly kind: SolidKind.TaggedPatch;
  readonly name: string;
  readonly child: Solid;
  readonly tag: BoundaryPatchTag;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Edge fillet modifier node wrapping a child {@link Solid}. */
export interface FilletSolid {
  readonly kind: SolidKind.Fillet;
  readonly name: string;
  readonly child: Solid;
  readonly radius: number;
  readonly edges?: readonly string[] | undefined;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** Edge chamfer modifier node wrapping a child {@link Solid}. */
export interface ChamferSolid {
  readonly kind: SolidKind.Chamfer;
  readonly name: string;
  readonly child: Solid;
  readonly distance: number;
  readonly edges?: readonly string[] | undefined;
  readonly sourceMetadata?: SolidSourceMetadata | undefined;
}

/** A node in the constructive solid geometry tree. */
export type Solid =
  | BoxSolid
  | CylinderSolid
  | SphereSolid
  | TorusSolid
  | ExtrusionSolid
  | PolyhedronSolid
  | TransformSolid
  | BooleanSolid
  | TaggedPatchSolid
  | FilletSolid
  | ChamferSolid;

// ── Assembly ─────────────────────────────────────────────────────────────

/** A single part entry in a multi-part CAD {@link Assembly}. */
export interface PartEntry {
  /** Root CSG solid for this part. */
  readonly solid: Solid;
  /** Optional material identifier (e.g., `'Aluminum 6061'`). */
  readonly material?: string | undefined;
  /** Optional RGB display color `[r, g, b]` in `[0, 1]`. */
  readonly color?: Vec3 | undefined;
  /** Optional axis-aligned bounding box in world coordinates. */
  readonly boundingBox?:
    | {
        min: [number, number, number];
        max: [number, number, number];
      }
    | undefined;
}

/** Named collection of {@link PartEntry} solids forming a multi-part CAD assembly. */
export interface Assembly {
  /** Assembly display name. */
  readonly name: string;
  /** Ordered list of constituent parts. */
  readonly parts: readonly PartEntry[];
}

// ── Parameter metadata ───────────────────────────────────────────────────

/** Declaration options for a tunable parametric CAD dimension. */
export interface ParamOptions {
  /** Default numeric value of the parameter. */
  default: number;
  /** Optional lower bound for slider/optimization exploration. */
  min?: number | undefined;
  /** Optional upper bound for slider/optimization exploration. */
  max?: number | undefined;
  /** Optional engineering unit string (e.g., `'mm'`, `'deg'`). */
  unit?: string | undefined;
}

/** Resolved runtime metadata and current value for a parametric CAD variable. */
export interface ParamMeta {
  /** Parameter identifier name. */
  readonly name: string;
  /** Default value specified at declaration. */
  readonly defaultValue: number;
  /** Minimum allowed value. */
  readonly min: number;
  /** Maximum allowed value. */
  readonly max: number;
  /** Physical unit string. */
  readonly unit: string;
  /** Active value used during the current evaluation pass. */
  readonly currentValue: number;
}

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
}

// ── Solid node types ─────────────────────────────────────────────────────

export interface BoxSolid {
  readonly kind: SolidKind.Box;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface CylinderSolid {
  readonly kind: SolidKind.Cylinder;
  readonly name: string;
  readonly radius: number;
  readonly height: number;
  readonly segments: number;
}

export interface SphereSolid {
  readonly kind: SolidKind.Sphere;
  readonly name: string;
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
}

export interface TorusSolid {
  readonly kind: SolidKind.Torus;
  readonly name: string;
  readonly major: number;
  readonly minor: number;
  readonly majorSegments: number;
  readonly minorSegments: number;
}

export interface TransformSolid {
  readonly kind: SolidKind.Transform;
  readonly name: string;
  readonly child: Solid;
  readonly matrix: Mat4;
}

export interface BooleanSolid {
  readonly kind: SolidKind.Union | SolidKind.Subtract | SolidKind.Intersect;
  readonly name: string;
  readonly left: Solid;
  readonly right: Solid;
}

/** A node in the constructive solid geometry tree. */
export type Solid = BoxSolid | CylinderSolid | SphereSolid | TorusSolid | TransformSolid | BooleanSolid;

// ── Assembly ─────────────────────────────────────────────────────────────

export interface PartEntry {
  readonly solid: Solid;
  readonly material?: string | undefined;
  readonly color?: Vec3 | undefined;
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

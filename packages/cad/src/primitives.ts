/**
 * @modelscript/cad — Primitive shape constructors.
 *
 * Each function returns an immutable {@link Solid} node describing the
 * shape.  No geometry is tessellated at construction time; the tree is
 * evaluated lazily during STEP compilation.
 */

import type {
  BoxOptions,
  BoxSolid,
  CylinderOptions,
  CylinderSolid,
  SphereOptions,
  SphereSolid,
  TorusOptions,
  TorusSolid,
} from "./types.js";
import { SolidKind } from "./types.js";

let nameCounter = 0;
function autoName(prefix: string): string {
  return `${prefix}_${++nameCounter}`;
}

/** Reset the auto-name counter (useful in tests). */
export function resetNameCounter(): void {
  nameCounter = 0;
}

// ── Constructors ─────────────────────────────────────────────────────────

/**
 * Create an axis-aligned box centered at the origin.
 *
 * @example
 * ```ts
 * const body = box({ width: 10, height: 3, depth: 10, name: "CentralBody" });
 * ```
 */
export function box(opts: BoxOptions): BoxSolid {
  return Object.freeze({
    kind: SolidKind.Box,
    name: opts.name ?? autoName("Box"),
    width: opts.width,
    height: opts.height,
    depth: opts.depth,
  });
}

/**
 * Create a cylinder centered at the origin with its axis along Y.
 *
 * @example
 * ```ts
 * const motor = cylinder({ radius: 1.5, height: 2, name: "Motor_FR" });
 * ```
 */
export function cylinder(opts: CylinderOptions): CylinderSolid {
  return Object.freeze({
    kind: SolidKind.Cylinder,
    name: opts.name ?? autoName("Cylinder"),
    radius: opts.radius,
    height: opts.height,
    segments: opts.segments ?? 24,
  });
}

/**
 * Create a sphere centered at the origin.
 *
 * @example
 * ```ts
 * const ball = sphere({ radius: 5, name: "Joint" });
 * ```
 */
export function sphere(opts: SphereOptions): SphereSolid {
  return Object.freeze({
    kind: SolidKind.Sphere,
    name: opts.name ?? autoName("Sphere"),
    radius: opts.radius,
    widthSegments: opts.widthSegments ?? 16,
    heightSegments: opts.heightSegments ?? 12,
  });
}

/**
 * Create a torus centered at the origin with the ring in the XZ plane.
 *
 * @example
 * ```ts
 * const guard = torus({ major: 3, minor: 0.15, name: "PropGuard_FR" });
 * ```
 */
export function torus(opts: TorusOptions): TorusSolid {
  return Object.freeze({
    kind: SolidKind.Torus,
    name: opts.name ?? autoName("Torus"),
    major: opts.major,
    minor: opts.minor,
    majorSegments: opts.majorSegments ?? 24,
    minorSegments: opts.minorSegments ?? 8,
  });
}

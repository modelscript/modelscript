/**
 * @modelscript/cad — Primitive shape constructors.
 *
 * Each function returns an immutable {@link Solid} node describing the
 * shape.  No geometry is tessellated at construction time; the tree is
 * evaluated lazily during STEP compilation.
 */

import type {
  BoundaryPatchType,
  BoxOptions,
  BoxSolid,
  ChamferSolid,
  CylinderOptions,
  CylinderSolid,
  ExtrusionSolid,
  FilletSolid,
  Solid,
  SphereOptions,
  SphereSolid,
  TaggedPatchSolid,
  TorusOptions,
  TorusSolid,
  Vec3,
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

/**
 * Attach a semantic physical boundary patch / connector port to a solid geometry.
 *
 * @example
 * ```ts
 * const motorFlange = tagPatch(cylinder({ radius: 1.5, height: 2 }), {
 *   portName: "motor_flange",
 *   portType: "mechanical_flange",
 *   normal: [0, 1, 0]
 * });
 * ```
 */
export function tagPatch(
  child: Solid,
  tag: {
    portName: string;
    portType: BoundaryPatchType;
    normal?: Vec3;
    surfaceArea?: number;
    name?: string;
  },
): TaggedPatchSolid {
  return Object.freeze({
    kind: SolidKind.TaggedPatch,
    name: tag.name ?? autoName(`Port_${tag.portName}`),
    child,
    tag: {
      portName: tag.portName,
      portType: tag.portType,
      normal: tag.normal,
      surfaceArea: tag.surfaceArea,
    },
  });
}

/**
 * Apply a geometric fillet (rounded blend radius) to a solid geometry.
 * Eliminates infinite stress singularities at sharp internal re-entrant corners in FEA.
 *
 * @example
 * ```ts
 * const roundedBracket = fillet(box({ width: 10, height: 10, depth: 2 }), 1.0);
 * ```
 */
export function fillet(child: Solid, radius: number, edges?: string[], name?: string): FilletSolid {
  return Object.freeze({
    kind: SolidKind.Fillet,
    name: name ?? autoName("Fillet"),
    child,
    radius,
    edges,
  });
}

/**
 * Apply a geometric chamfer (beveled corner blend) to a solid geometry.
 *
 * @example
 * ```ts
 * const beveledPlate = chamfer(box({ width: 10, height: 10, depth: 2 }), 0.5);
 * ```
 */
export function chamfer(child: Solid, distance: number, edges?: string[], name?: string): ChamferSolid {
  return Object.freeze({
    kind: SolidKind.Chamfer,
    name: name ?? autoName("Chamfer"),
    child,
    distance,
    edges,
  });
}

/**
 * Create a linear extrusion of a 2D planar polygon.
 *
 * @example
 * ```ts
 * const bracket = linearExtrude([[0, 0], [20, 0], [15, 10], [0, 10]], 5);
 * ```
 */
export function linearExtrude(
  polygon: readonly [number, number][],
  height: number,
  opts?: { twist?: number; scale?: number; name?: string },
): ExtrusionSolid {
  return Object.freeze({
    kind: SolidKind.Extrusion,
    name: opts?.name ?? autoName("Extrusion"),
    polygon,
    height,
    twist: opts?.twist,
    scale: opts?.scale,
  });
}

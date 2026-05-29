/**
 * @modelscript/cad — Assembly builder.
 *
 * An assembly is a named collection of {@link PartEntry} records, each
 * wrapping a {@link Solid} with optional material and color metadata.
 */

import type { Assembly, PartEntry, Solid, Vec3 } from "./types.js";

/**
 * Wrap a solid as a named assembly part with optional metadata.
 *
 * @example
 * ```ts
 * part(motor, { material: "Aluminum", color: [0.7, 0.7, 0.8] })
 * ```
 */
export function part(solid: Solid, opts?: { material?: string; color?: Vec3 }): PartEntry {
  return Object.freeze({
    solid,
    material: opts?.material,
    color: opts?.color,
  });
}

/**
 * Create a named assembly from a list of parts.
 *
 * @example
 * ```ts
 * export default assembly("DroneChassisV2", [
 *   part(frame, { material: "CarbonFiber" }),
 *   part(motorFR, { material: "Aluminum" }),
 * ]);
 * ```
 */
export function assembly(name: string, parts: PartEntry[]): Assembly {
  return Object.freeze({ name, parts: Object.freeze([...parts]) });
}

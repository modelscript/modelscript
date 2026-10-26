// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Projection from URDF Visual/Collision Models to CAD Shapes.
 */

import type { UrdfRobot, Vector3D } from "../types.js";

export interface CadBoundingShape {
  linkName: string;
  type: "box" | "cylinder" | "sphere" | "mesh";
  origin: Vector3D;
  dimensions: Vector3D;
  color?: { r: number; g: number; b: number; a: number } | undefined;
}

/**
 * Extracts 3D CAD visualization shapes for each link in the URDF robot.
 */
export function urdfToCadShapes(robot: UrdfRobot): CadBoundingShape[] {
  const shapes: CadBoundingShape[] = [];

  for (const link of robot.links.values()) {
    for (const vis of link.visuals) {
      const origin: Vector3D = vis.origin ? { ...vis.origin.xyz } : { x: 0, y: 0, z: 0 };
      const geom = vis.geometry;

      let dimensions: Vector3D = { x: 0.1, y: 0.1, z: 0.1 };
      if (geom.type === "box" && geom.size) {
        dimensions = { ...geom.size };
      } else if (geom.type === "cylinder") {
        const r = geom.radius ?? 0.05;
        const l = geom.length ?? 0.1;
        dimensions = { x: 2 * r, y: 2 * r, z: l };
      } else if (geom.type === "sphere") {
        const r = geom.radius ?? 0.05;
        dimensions = { x: 2 * r, y: 2 * r, z: 2 * r };
      } else if (geom.type === "mesh" && geom.scale) {
        dimensions = { ...geom.scale };
      }

      shapes.push({
        linkName: link.name,
        type: geom.type,
        origin,
        dimensions,
        color: vis.material?.color,
      });
    }
  }

  return shapes;
}

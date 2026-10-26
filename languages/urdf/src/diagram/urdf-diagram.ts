// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildKinematicDiagram,
  renderKinematicSvg,
  type KinematicBodyLike,
  type KinematicDiagramGraph,
  type KinematicJointLike,
  type KinematicSystemLike,
} from "@modelscript/diagram/kinematic-diagram-builder";
import type { UrdfRobot } from "../types.js";

/**
 * Translates an UrdfRobot into a normalized KinematicSystemLike topology.
 */
export function urdfToKinematicSystem(robot: UrdfRobot): KinematicSystemLike {
  const bodies: KinematicBodyLike[] = [];
  const childLinks = new Set<string>();

  for (const j of robot.joints.values()) {
    childLinks.add(j.childLink);
  }

  // Add all links
  for (const link of robot.links.values()) {
    // If a link is not the child of any joint, or is named "base_link" / "world", consider it root/ground
    const isRoot = !childLinks.has(link.name) || link.name === "world" || link.name === "ground";

    bodies.push({
      id: link.name,
      name: link.name,
      mass: link.inertial?.mass,
      inertia: link.inertial ? { ixx: link.inertial.ixx, iyy: link.inertial.iyy, izz: link.inertial.izz } : undefined,
      isGround: isRoot,
    });
  }

  // Translate joints
  const joints: KinematicJointLike[] = [];
  for (const joint of robot.joints.values()) {
    joints.push({
      id: joint.name,
      name: joint.name,
      type: joint.type,
      fromBody: joint.parentLink,
      toBody: joint.childLink,
      limits: joint.limits ? { lower: joint.limits.lower, upper: joint.limits.upper } : undefined,
    });
  }

  return {
    title: robot.name || "URDF Kinematic Robot",
    bodies,
    joints,
  };
}

/**
 * Builds an interactive AntV X6 graph model for a URDF robot model.
 */
export function buildUrdfDiagram(robot: UrdfRobot): KinematicDiagramGraph {
  return buildKinematicDiagram(urdfToKinematicSystem(robot));
}

/**
 * Generates standalone SVG vector graphics for a URDF robot model.
 */
export function renderUrdfSvg(
  robot: UrdfRobot,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  return renderKinematicSvg(urdfToKinematicSystem(robot), options);
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Bidirectional ROS URDF <-> SIMPACK MBS Model Projection.
 */

import type {
  JointType,
  SimpackBody,
  SimpackForceElement,
  SimpackJoint,
  SimpackMarker,
  SimpackModel,
} from "@modelscript/simpack";
import type { UrdfJoint, UrdfJointType, UrdfLink, UrdfRobot } from "../types.js";

/**
 * Projects a URDF robot into a SIMPACK multibody model.
 */
export function urdfToSimpack(robot: UrdfRobot): SimpackModel {
  const bodies = new Map<string, SimpackBody>();
  const markers = new Map<string, SimpackMarker>();
  const joints = new Map<string, SimpackJoint>();
  const forces = new Map<string, SimpackForceElement>();

  // 1. Links -> Bodies & Markers
  for (const link of robot.links.values()) {
    const m = link.inertial?.mass ?? 1.0;
    const ixx = link.inertial?.ixx ?? m * 0.1;
    const iyy = link.inertial?.iyy ?? m * 0.1;
    const izz = link.inertial?.izz ?? m * 0.1;

    bodies.set(link.name, {
      id: link.name,
      name: link.name,
      mass: m,
      inertia: { ixx, iyy, izz },
      markerId: `m_${link.name}`,
    });

    markers.set(`m_${link.name}`, {
      id: `m_${link.name}`,
      name: `m_${link.name}`,
      bodyId: link.name,
      position: link.inertial?.origin ? { ...link.inertial.origin.xyz } : { x: 0, y: 0, z: 0 },
      orientation: link.inertial?.origin ? { ...link.inertial.origin.rpy } : { x: 0, y: 0, z: 0 },
    });
  }

  // 2. Joints -> Joints & Markers
  for (const joint of robot.joints.values()) {
    let type: JointType = "revolute";
    let dofCount = 1;

    switch (joint.type) {
      case "revolute":
      case "continuous":
        type = "revolute";
        dofCount = 1;
        break;
      case "prismatic":
        type = "prismatic";
        dofCount = 1;
        break;
      case "planar":
        type = "planar";
        dofCount = 3;
        break;
      case "floating":
        type = "free";
        dofCount = 6;
        break;
      case "fixed":
      default:
        type = "fixed";
        dofCount = 0;
        break;
    }

    const fromMarker = `m_${joint.parentLink}`;
    const toMarker = `m_${joint.childLink}`;

    joints.set(joint.name, {
      id: joint.name,
      name: joint.name,
      type,
      fromMarker,
      toMarker,
      dofCount,
    });
  }

  return {
    name: robot.name,
    bodies,
    markers,
    joints,
    forces,
  };
}

/**
 * Projects a SIMPACK model into a URDF robot definition.
 */
export function simpackToUrdf(model: SimpackModel): UrdfRobot {
  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();

  for (const b of model.bodies.values()) {
    links.set(b.id, {
      name: b.id,
      inertial: {
        mass: b.mass,
        ixx: b.inertia.ixx,
        ixy: b.inertia.ixy ?? 0,
        ixz: b.inertia.izx ?? 0,
        iyy: b.inertia.iyy,
        iyz: b.inertia.iyz ?? 0,
        izz: b.inertia.izz,
      },
      visuals: [],
      collisions: [],
    });
  }

  for (const j of model.joints.values()) {
    const parentMarker = model.markers.get(j.fromMarker);
    const childMarker = model.markers.get(j.toMarker);
    const parentLink = parentMarker?.bodyId ?? "base_link";
    const childLink = childMarker?.bodyId ?? "link";

    let type: UrdfJointType = "revolute";
    switch (j.type) {
      case "revolute":
        type = "revolute";
        break;
      case "prismatic":
        type = "prismatic";
        break;
      case "planar":
        type = "planar";
        break;
      case "fixed":
        type = "fixed";
        break;
      case "free":
        type = "floating";
        break;
    }

    joints.set(j.id, {
      name: j.id,
      type,
      parentLink,
      childLink,
      axis: { x: 0, y: 0, z: 1 },
      limits: type === "revolute" || type === "prismatic" ? { effort: 100, velocity: 10 } : undefined,
    });
  }

  return {
    name: model.name,
    links,
    joints,
    materials: new Map(),
  };
}

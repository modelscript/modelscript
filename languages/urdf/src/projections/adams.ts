// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Bidirectional ROS URDF <-> MSC Adams Model Projection.
 */

import type { AdamsDataset, AdamsJoint, AdamsJointType, AdamsMarker, AdamsPart } from "@modelscript/adams";
import type { UrdfJoint, UrdfJointType, UrdfLink, UrdfRobot } from "../types.js";

/**
 * Projects a URDF robot into an MSC Adams dataset.
 */
export function urdfToAdams(robot: UrdfRobot): AdamsDataset {
  const parts = new Map<string | number, AdamsPart>();
  const markers = new Map<string | number, AdamsMarker>();
  const joints = new Map<string | number, AdamsJoint>();

  // Determine root link to treat as ground
  const childLinks = new Set(Array.from(robot.joints.values()).map((j) => j.childLink));
  const rootLinks = Array.from(robot.links.keys()).filter((l) => !childLinks.has(l));
  const groundLinkName = rootLinks[0] ?? "";

  // 1. Links -> Parts & Markers
  let partCounter = 1;
  const linkToPartId = new Map<string, number>();

  for (const link of robot.links.values()) {
    const pId = partCounter++;
    linkToPartId.set(link.name, pId);
    const isGround = link.name === groundLinkName;
    const m = link.inertial?.mass ?? (isGround ? 0 : 1.0);
    const ixx = link.inertial?.ixx ?? (isGround ? 0 : m * 0.1);
    const iyy = link.inertial?.iyy ?? (isGround ? 0 : m * 0.1);
    const izz = link.inertial?.izz ?? (isGround ? 0 : m * 0.1);

    const cmMarkerId = pId * 100 + 1;

    parts.set(pId, {
      id: pId,
      name: link.name,
      isGround,
      mass: m,
      cmMarkerId: isGround ? undefined : cmMarkerId,
      inertia: { ixx, iyy, izz },
    });

    // CM Marker
    markers.set(cmMarkerId, {
      id: cmMarkerId,
      name: `cm_${link.name}`,
      partId: pId,
      position: link.inertial?.origin ? { ...link.inertial.origin.xyz } : { x: 0, y: 0, z: 0 },
      orientation: link.inertial?.origin ? { ...link.inertial.origin.rpy } : { x: 0, y: 0, z: 0 },
      useEuler: true,
    });
  }

  // 2. Joints -> Joints & Markers
  let jointCounter = 1;
  for (const joint of robot.joints.values()) {
    const jId = jointCounter++;
    const pPartId = linkToPartId.get(joint.parentLink) ?? 1;
    const cPartId = linkToPartId.get(joint.childLink) ?? 2;

    const mIId = jId * 1000 + 1;
    const mJId = jId * 1000 + 2;

    const jOrigin = joint.origin ? { ...joint.origin.xyz } : { x: 0, y: 0, z: 0 };
    const jRot = joint.origin ? { ...joint.origin.rpy } : { x: 0, y: 0, z: 0 };

    markers.set(mIId, {
      id: mIId,
      name: `m_i_${joint.name}`,
      partId: pPartId,
      position: jOrigin,
      orientation: jRot,
      useEuler: true,
    });

    markers.set(mJId, {
      id: mJId,
      name: `m_j_${joint.name}`,
      partId: cPartId,
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0 },
      useEuler: true,
    });

    let type: AdamsJointType = "REVOLUTE";
    let dofCount = 1;
    switch (joint.type) {
      case "revolute":
      case "continuous":
        type = "REVOLUTE";
        dofCount = 1;
        break;
      case "prismatic":
        type = "TRANSLATIONAL";
        dofCount = 1;
        break;
      case "planar":
        type = "PLANAR";
        dofCount = 3;
        break;
      case "fixed":
      default:
        type = "FIXED";
        dofCount = 0;
        break;
    }

    joints.set(jId, {
      id: jId,
      name: joint.name,
      type,
      iMarkerId: mIId,
      jMarkerId: mJId,
      dofCount,
    });
  }

  return {
    title: robot.name,
    parts,
    markers,
    joints,
    forces: new Map(),
    motions: new Map(),
    requests: new Map(),
  };
}

/**
 * Projects an MSC Adams dataset into a URDF robot.
 */
export function adamsToUrdf(dataset: AdamsDataset): UrdfRobot {
  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();

  for (const part of dataset.parts.values()) {
    const lName = part.isGround ? "base_link" : part.name;
    links.set(lName, {
      name: lName,
      inertial: part.isGround
        ? undefined
        : {
            mass: part.mass,
            ixx: part.inertia.ixx,
            ixy: part.inertia.ixy ?? 0,
            ixz: part.inertia.ixz ?? 0,
            iyy: part.inertia.iyy,
            iyz: part.inertia.iyz ?? 0,
            izz: part.inertia.izz,
          },
      visuals: [],
      collisions: [],
    });
  }

  for (const j of dataset.joints.values()) {
    const mA = dataset.markers.get(j.iMarkerId);
    const mB = dataset.markers.get(j.jMarkerId);
    const partA = mA ? dataset.parts.get(mA.partId) : undefined;
    const partB = mB ? dataset.parts.get(mB.partId) : undefined;

    const parentLink = partA?.isGround ? "base_link" : (partA?.name ?? "parent");
    const childLink = partB?.name ?? "child";

    let type: UrdfJointType = "revolute";
    switch (j.type) {
      case "REVOLUTE":
        type = "revolute";
        break;
      case "TRANSLATIONAL":
        type = "prismatic";
        break;
      case "PLANAR":
        type = "planar";
        break;
      case "FIXED":
        type = "fixed";
        break;
    }

    joints.set(j.name, {
      name: j.name,
      type,
      parentLink,
      childLink,
      axis: { x: 0, y: 0, z: 1 },
      limits: type === "revolute" || type === "prismatic" ? { effort: 100, velocity: 10 } : undefined,
    });
  }

  return {
    name: dataset.title,
    links,
    joints,
    materials: new Map(),
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Bidirectional MSC Adams <-> SIMPACK MBD Model Projection.
 */

import type {
  JointType,
  SimpackBody,
  SimpackForceElement,
  SimpackJoint,
  SimpackMarker,
  SimpackModel,
} from "@modelscript/simpack";
import type {
  AdamsDataset,
  AdamsForce,
  AdamsInertia,
  AdamsJoint,
  AdamsJointType,
  AdamsMarker,
  AdamsPart,
} from "../types.js";

/**
 * Projects an MSC Adams Dataset into a SIMPACK multibody model.
 */
export function adamsToSimpack(dataset: AdamsDataset): SimpackModel {
  const bodies = new Map<string, SimpackBody>();
  const markers = new Map<string, SimpackMarker>();
  const joints = new Map<string, SimpackJoint>();
  const forces = new Map<string, SimpackForceElement>();

  // 1. Parts -> Bodies
  for (const part of dataset.parts.values()) {
    const id = String(part.id);
    if (part.isGround) {
      bodies.set(id, {
        id,
        name: "ground",
        mass: 0,
        inertia: { ixx: 0, iyy: 0, izz: 0 },
        markerId: "$inertial",
      });
    } else {
      const inertia: SimpackBody["inertia"] = {
        ixx: part.inertia.ixx,
        iyy: part.inertia.iyy,
        izz: part.inertia.izz,
      };
      if (part.inertia.ixy !== undefined) inertia.ixy = part.inertia.ixy;
      if (part.inertia.ixz !== undefined) inertia.izx = part.inertia.ixz;
      if (part.inertia.iyz !== undefined) inertia.iyz = part.inertia.iyz;

      bodies.set(id, {
        id,
        name: part.name,
        mass: part.mass,
        inertia,
        markerId: part.cmMarkerId !== undefined ? String(part.cmMarkerId) : id,
      });
    }
  }

  // 2. Markers -> Markers
  for (const m of dataset.markers.values()) {
    const id = String(m.id);
    const bodyId = String(m.partId);
    markers.set(id, {
      id,
      name: m.name,
      bodyId,
      position: { ...m.position },
      orientation: { ...m.orientation },
    });
  }

  // 3. Joints -> Joints
  for (const j of dataset.joints.values()) {
    const id = String(j.id);
    let type: JointType = "revolute";
    switch (j.type) {
      case "REVOLUTE":
        type = "revolute";
        break;
      case "TRANSLATIONAL":
        type = "prismatic";
        break;
      case "SPHERICAL":
        type = "spherical";
        break;
      case "UNIVERSAL":
        type = "universal";
        break;
      case "PLANAR":
        type = "planar";
        break;
      case "CYLINDRICAL":
        type = "cylindrical";
        break;
      case "FIXED":
        type = "fixed";
        break;
      default:
        type = "revolute";
        break;
    }

    joints.set(id, {
      id,
      name: j.name,
      type,
      fromMarker: String(j.iMarkerId),
      toMarker: String(j.jMarkerId),
      dofCount: j.dofCount,
    });
  }

  // 4. Forces -> Force elements
  for (const f of dataset.forces.values()) {
    const id = String(f.id);
    const k = f.stiffness ?? 1000.0;
    const c = f.damping ?? 50.0;
    forces.set(id, {
      id,
      name: f.name,
      type: "spring_damper",
      markerA: String(f.iMarkerId),
      markerB: String(f.jMarkerId),
      stiffness: { x: k, y: k, z: k },
      damping: { x: c, y: c, z: c },
    });
  }

  return {
    name: dataset.title,
    bodies,
    markers,
    joints,
    forces,
  };
}

/**
 * Projects a SIMPACK model into an MSC Adams dataset.
 */
export function simpackToAdams(model: SimpackModel): AdamsDataset {
  const parts = new Map<string | number, AdamsPart>();
  const markers = new Map<string | number, AdamsMarker>();
  const joints = new Map<string | number, AdamsJoint>();
  const forces = new Map<string | number, AdamsForce>();

  for (const b of model.bodies.values()) {
    const isGround = b.name.toLowerCase() === "ground" || b.id === "$inertial" || b.mass === 0;
    const inertia: AdamsInertia = {
      ixx: b.inertia.ixx,
      iyy: b.inertia.iyy,
      izz: b.inertia.izz,
    };
    if (b.inertia.ixy !== undefined) inertia.ixy = b.inertia.ixy;
    if (b.inertia.izx !== undefined) inertia.ixz = b.inertia.izx;
    if (b.inertia.iyz !== undefined) inertia.iyz = b.inertia.iyz;

    parts.set(b.id, {
      id: b.id,
      name: b.name,
      isGround,
      mass: b.mass,
      cmMarkerId: b.markerId !== b.id ? b.markerId : undefined,
      inertia,
    });
  }

  for (const m of model.markers.values()) {
    markers.set(m.id, {
      id: m.id,
      name: m.name,
      partId: m.bodyId,
      position: { ...m.position },
      orientation: { ...m.orientation },
      useEuler: true,
    });
  }

  for (const j of model.joints.values()) {
    let type: AdamsJointType = "REVOLUTE";
    switch (j.type) {
      case "revolute":
        type = "REVOLUTE";
        break;
      case "prismatic":
        type = "TRANSLATIONAL";
        break;
      case "spherical":
        type = "SPHERICAL";
        break;
      case "universal":
        type = "UNIVERSAL";
        break;
      case "planar":
        type = "PLANAR";
        break;
      case "cylindrical":
        type = "CYLINDRICAL";
        break;
      case "fixed":
        type = "FIXED";
        break;
    }

    joints.set(j.id, {
      id: j.id,
      name: j.name,
      type,
      iMarkerId: j.fromMarker,
      jMarkerId: j.toMarker,
      dofCount: j.dofCount,
    });
  }

  for (const f of model.forces.values()) {
    forces.set(f.id, {
      id: f.id,
      name: f.name,
      type: "SPRINGDAMPER",
      actionType: "TRANSLATIONAL",
      iMarkerId: f.markerA,
      jMarkerId: f.markerB,
      stiffness: f.stiffness.x,
      damping: f.damping.x,
    });
  }

  return {
    title: model.name,
    parts,
    markers,
    joints,
    forces,
    motions: new Map(),
    requests: new Map(),
  };
}

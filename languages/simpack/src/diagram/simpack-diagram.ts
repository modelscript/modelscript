// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildKinematicDiagram,
  renderKinematicSvg,
  type KinematicBodyLike,
  type KinematicDiagramGraph,
  type KinematicForceElementLike,
  type KinematicJointLike,
  type KinematicSystemLike,
} from "@modelscript/diagram/kinematic-diagram-builder";
import type { SimpackModel } from "../types.js";

/**
 * Translates a SimpackModel into a normalized KinematicSystemLike topology.
 */
export function simpackToKinematicSystem(model: SimpackModel): KinematicSystemLike {
  const bodies: KinematicBodyLike[] = [];
  const bodyIds = new Set<string>();

  // Add all bodies
  for (const b of model.bodies.values()) {
    bodyIds.add(b.id);
    bodies.push({
      id: b.id,
      name: b.name || b.id,
      mass: b.mass,
      inertia: b.inertia,
      isGround: false,
    });
  }

  // Ensure $inertial / ground is present if referenced by markers
  let hasInertial = false;
  for (const m of model.markers.values()) {
    if (m.bodyId === "$inertial" || m.bodyId === "ground") {
      hasInertial = true;
      break;
    }
  }

  if (hasInertial && !bodyIds.has("$inertial") && !bodyIds.has("ground")) {
    bodies.unshift({
      id: "ground",
      name: "Ground ($inertial)",
      isGround: true,
    });
    bodyIds.add("ground");
  }

  const getMarkerBody = (markerId: string): string => {
    const marker = model.markers.get(markerId);
    if (!marker) return "ground";
    if (marker.bodyId === "$inertial") return "ground";
    return marker.bodyId;
  };

  // Translate joints
  const joints: KinematicJointLike[] = [];
  for (const j of model.joints.values()) {
    const fromBody = getMarkerBody(j.fromMarker);
    const toBody = getMarkerBody(j.toMarker);
    joints.push({
      id: j.id,
      name: j.name || j.id,
      type: j.type,
      fromBody,
      toBody,
      fromMarker: j.fromMarker,
      toMarker: j.toMarker,
    });
  }

  // Translate forces (springs, dampers, bushings)
  const forces: KinematicForceElementLike[] = [];
  for (const f of model.forces.values()) {
    const body1 = getMarkerBody(f.markerA);
    const body2 = getMarkerBody(f.markerB);
    forces.push({
      id: f.id,
      type: f.type,
      body1,
      body2,
      stiffness: f.stiffness?.x ?? f.stiffness?.z,
      damping: f.damping?.x ?? f.damping?.z,
    });
  }

  return {
    title: model.name || "SIMPACK Kinematic Model",
    bodies,
    joints,
    forces,
  };
}

/**
 * Builds an interactive AntV X6 graph model for a SIMPACK mechanism.
 */
export function buildSimpackDiagram(model: SimpackModel): KinematicDiagramGraph {
  return buildKinematicDiagram(simpackToKinematicSystem(model));
}

/**
 * Generates standalone SVG vector graphics for a SIMPACK mechanism.
 */
export function renderSimpackSvg(
  model: SimpackModel,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  return renderKinematicSvg(simpackToKinematicSystem(model), options);
}

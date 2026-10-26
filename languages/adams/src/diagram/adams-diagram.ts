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
import type { AdamsDataset } from "../types.js";

/**
 * Translates an AdamsDataset into a normalized KinematicSystemLike topology.
 */
export function adamsToKinematicSystem(dataset: AdamsDataset): KinematicSystemLike {
  const bodies: KinematicBodyLike[] = [];
  const partMap = new Map<string, string>();

  // Add all parts / bodies
  for (const part of dataset.parts.values()) {
    const partKey = String(part.id);
    const partName = part.name || `PART_${part.id}`;
    partMap.set(partKey, partKey);

    bodies.push({
      id: partKey,
      name: partName,
      mass: part.mass,
      inertia: part.inertia ? { ixx: part.inertia.ixx, iyy: part.inertia.iyy, izz: part.inertia.izz } : undefined,
      isGround: part.isGround || partKey === "ground" || partKey === "1",
    });
  }

  const getMarkerPartId = (markerId: string | number): string => {
    const m =
      dataset.markers.get(markerId) ?? dataset.markers.get(String(markerId)) ?? dataset.markers.get(Number(markerId));
    if (!m) return "ground";
    return String(m.partId);
  };

  // Translate joints
  const joints: KinematicJointLike[] = [];
  for (const joint of dataset.joints.values()) {
    const fromBody = getMarkerPartId(joint.iMarkerId);
    const toBody = getMarkerPartId(joint.jMarkerId);

    joints.push({
      id: String(joint.id),
      name: joint.name || `JOINT_${joint.id}`,
      type: joint.type.toLowerCase(),
      fromBody,
      toBody,
      fromMarker: String(joint.iMarkerId),
      toMarker: String(joint.jMarkerId),
    });
  }

  // Translate forces (spring-dampers, bushings)
  const forces: KinematicForceElementLike[] = [];
  for (const force of dataset.forces.values()) {
    const b1 = getMarkerPartId(force.iMarkerId);
    const b2 = getMarkerPartId(force.jMarkerId);

    forces.push({
      id: force.name || String(force.id),
      type: force.type.toLowerCase(),
      body1: b1,
      body2: b2,
      stiffness: force.stiffness,
      damping: force.damping,
    });
  }

  return {
    title: dataset.title || "Adams Multibody Mechanism",
    bodies,
    joints,
    forces,
  };
}

/**
 * Builds an interactive AntV X6 graph model for an Adams mechanism dataset.
 */
export function buildAdamsDiagram(dataset: AdamsDataset): KinematicDiagramGraph {
  return buildKinematicDiagram(adamsToKinematicSystem(dataset));
}

/**
 * Generates standalone SVG vector graphics for an Adams mechanism dataset.
 */
export function renderAdamsSvg(
  dataset: AdamsDataset,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  return renderKinematicSvg(adamsToKinematicSystem(dataset), options);
}

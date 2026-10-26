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
import type { GensysModel } from "../types.js";

/**
 * Translates a GensysModel into a normalized KinematicSystemLike topology.
 */
export function gensysToKinematicSystem(model: GensysModel): KinematicSystemLike {
  const bodies: KinematicBodyLike[] = [];
  const bodyNames = new Set<string>();

  // Add rigid carbody & bogie frames
  for (const b of model.bodies.values()) {
    bodyNames.add(b.name);
    bodies.push({
      id: b.name,
      name: b.name,
      mass: b.mass,
      inertia: b.inertia ? { ixx: b.inertia.jx, iyy: b.inertia.jy, izz: b.inertia.jz } : undefined,
      isGround: false,
    });
  }

  // Add wheelsets as kinematic bodies
  for (const w of model.wheelsets.values()) {
    bodyNames.add(w.name);
    bodies.push({
      id: w.name,
      name: `${w.name} (Wheelset)`,
      mass: w.mass,
      inertia: w.inertia ? { ixx: w.inertia.jx, iyy: w.inertia.jy, izz: w.inertia.jz } : undefined,
      isGround: false,
    });
  }

  // Ensure track / ground node exists if any coupling connects to track or "ground"
  let hasTrackRef = false;
  for (const c of model.couplings.values()) {
    if (c.body1 === "track" || c.body1 === "ground" || c.body2 === "track" || c.body2 === "ground") {
      hasTrackRef = true;
      break;
    }
  }

  if (hasTrackRef || model.track) {
    if (!bodyNames.has("track") && !bodyNames.has("ground")) {
      bodies.unshift({
        id: "track",
        name: "Track / Ground",
        isGround: true,
      });
      bodyNames.add("track");
    }
  }

  // Build joints: Wheelset-to-track kinematic rolling contact
  const joints: KinematicJointLike[] = [];
  for (const w of model.wheelsets.values()) {
    if (bodyNames.has("track")) {
      joints.push({
        id: `joint_${w.name}_track`,
        name: `${w.name} Rail Contact`,
        type: "prismatic",
        fromBody: "track",
        toBody: w.name,
      });
    }
  }

  // Build spring/damper couplings
  const forces: KinematicForceElementLike[] = [];
  for (const c of model.couplings.values()) {
    const b1 = bodyNames.has(c.body1) ? c.body1 : "track";
    const b2 = bodyNames.has(c.body2) ? c.body2 : "track";
    const kMax = Math.max(c.stiffness?.x ?? 0, c.stiffness?.y ?? 0, c.stiffness?.z ?? 0);
    const cMax = Math.max(c.damping?.x ?? 0, c.damping?.y ?? 0, c.damping?.z ?? 0);

    forces.push({
      id: c.name,
      type: c.type || "spring_damper",
      body1: b1,
      body2: b2,
      stiffness: kMax || undefined,
      damping: cMax || undefined,
    });
  }

  return {
    title: model.name || "GENSYS Railway Vehicle Dynamics",
    bodies,
    joints,
    forces,
  };
}

/**
 * Builds an interactive AntV X6 graph model for a GENSYS railway vehicle.
 */
export function buildGensysDiagram(model: GensysModel): KinematicDiagramGraph {
  return buildKinematicDiagram(gensysToKinematicSystem(model));
}

/**
 * Generates standalone SVG vector graphics for a GENSYS railway vehicle.
 */
export function renderGensysSvg(
  model: GensysModel,
  options?:
    | {
        isDark?: boolean | undefined;
        theme?: "dark" | "light" | undefined;
        width?: number | undefined;
        height?: number | undefined;
      }
    | undefined,
): string {
  return renderKinematicSvg(gensysToKinematicSystem(model), options);
}

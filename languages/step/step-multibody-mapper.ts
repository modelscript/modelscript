// Removed import from lsp to break nx circular dependency

export interface MultiBodyAssembly {
  name: string;
  bodies: MultiBodyPart[];
  joints: MultiBodyJoint[];
  fixedTranslations: MultiBodyFixedTranslation[];
}

export interface MultiBodyPart {
  name: string;
  stepId: string;
  mass: number;
  r_CM: [number, number, number];
  inertia: {
    I_11: number;
    I_22: number;
    I_33: number;
    I_21: number;
    I_31: number;
    I_32: number;
  };
  shapeRef?: string;
  /** Qualified variable name prefix for the body's frame, e.g. "body1" → "body1.frame_a" */
  frameVariable?: string;
}

export interface MultiBodyJoint {
  name: string;
  type: "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Planar";
  partA: string; // name
  partB: string; // name
  n: [number, number, number]; // axis
}

export interface MultiBodyFixedTranslation {
  name: string;
  partA: string;
  partB: string;
  r: [number, number, number];
  rotationMatrix?: [[number, number, number], [number, number, number], [number, number, number]];
}

import type { StepAssemblyModel } from "./src/physical-data.js";

function normalizeVec(v: [number, number, number]): [number, number, number] {
  const norm = Math.hypot(v[0], v[1], v[2]);
  if (norm < 1e-12) return [0, 0, 1];
  return [v[0] / norm, v[1] / norm, v[2] / norm];
}

function crossVec(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function mapStepToMultiBody(assemblyName: string, model: StepAssemblyModel): MultiBodyAssembly {
  const bodies: MultiBodyPart[] = [];
  const joints: MultiBodyJoint[] = [];
  const fixedTranslations: MultiBodyFixedTranslation[] = [];

  let jointCount = 1;
  let offsetCount = 1;

  for (const part of model.parts.values()) {
    const massProps = model.massProperties.get(part.id) || model.massProperties.values().next().value;
    const bodyName = part.name.replace(/[^a-zA-Z0-9_]/g, "_") || `part_${part.id.replace("#", "")}`;

    let mass = massProps?.mass;
    if (!mass || isNaN(mass)) {
      mass = massProps?.volume ? massProps.volume * 7850 : 1.0;
    }
    const r_CM: [number, number, number] = massProps?.centerOfMass ?? [0, 0, 0];
    let inertia = massProps?.inertiaTensor;
    if (!inertia) {
      const dim = massProps?.volume ? Math.cbrt(massProps.volume) : 0.1;
      const I_diag = (1 / 6) * mass * dim * dim;
      inertia = {
        I_11: I_diag,
        I_22: I_diag,
        I_33: I_diag,
        I_21: 0,
        I_31: 0,
        I_32: 0,
      };
    }

    bodies.push({
      name: bodyName,
      stepId: part.id,
      mass,
      r_CM,
      inertia,
      shapeRef: part.shapeId,
      frameVariable: `${bodyName}.frame_a`,
    });
  }

  // Joint mapping
  for (const joint of model.joints) {
    const partA = model.parts.get(joint.partA);
    const partB = model.parts.get(joint.partB);
    if (!partA || !partB) continue;

    const nameA = partA.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const nameB = partB.name.replace(/[^a-zA-Z0-9_]/g, "_");

    if (joint.type === "fixed") {
      fixedTranslations.push({
        name: `offset_${offsetCount++}`,
        partA: nameA,
        partB: nameB,
        r: joint.origin,
      });
    } else {
      let type: MultiBodyJoint["type"] = "Revolute";
      if (joint.type === "prismatic") type = "Prismatic";
      else if (joint.type === "cylindrical") type = "Cylindrical";
      else if (joint.type === "spherical") type = "Spherical";
      else if (joint.type === "planar") type = "Planar";

      joints.push({
        name: `joint_${jointCount++}`,
        type,
        partA: nameA,
        partB: nameB,
        n: joint.axis,
      });
    }
  }

  // Handle edges (static placements) with orientation frame derivation
  for (const edge of model.edges) {
    const partA = model.parts.get(edge.parentPartId);
    const partB = model.parts.get(edge.childPartId);
    if (!partA || !partB) continue;

    const nameA = partA.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const nameB = partB.name.replace(/[^a-zA-Z0-9_]/g, "_");

    const hasJoint = joints.some(
      (j) => (j.partA === nameA && j.partB === nameB) || (j.partA === nameB && j.partB === nameA),
    );
    if (!hasJoint) {
      const zAxis = normalizeVec(edge.placement.axis || [0, 0, 1]);
      const refDir = normalizeVec(edge.placement.refDirection || [1, 0, 0]);
      let xAxis = normalizeVec(crossVec(refDir, zAxis));
      if (Math.hypot(xAxis[0], xAxis[1], xAxis[2]) < 1e-6) {
        xAxis = [1, 0, 0];
      }
      const yAxis = crossVec(zAxis, xAxis);

      const rotMatrix: [[number, number, number], [number, number, number], [number, number, number]] = [
        [xAxis[0], yAxis[0], zAxis[0]],
        [xAxis[1], yAxis[1], zAxis[1]],
        [xAxis[2], yAxis[2], zAxis[2]],
      ];

      fixedTranslations.push({
        name: `offset_${offsetCount++}`,
        partA: nameA,
        partB: nameB,
        r: edge.placement.location,
        rotationMatrix: rotMatrix,
      });
    }
  }

  return { name: assemblyName, bodies, joints, fixedTranslations };
}

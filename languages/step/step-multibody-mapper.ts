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
}

export interface StepAssemblyModel {
  parts: Map<string, { id: string; name: string; shapeId?: string }>;
  massProperties: Map<
    string,
    {
      mass: number;
      centerOfMass: [number, number, number];
      inertiaTensor: { I_11: number; I_22: number; I_33: number; I_21: number; I_31: number; I_32: number };
    }
  >;
  joints: {
    partA: string;
    partB: string;
    type: string;
    origin: [number, number, number];
    axis: [number, number, number];
  }[];
  edges: { parentPartId: string; childPartId: string; placement: { location: [number, number, number] } }[];
}

export function mapStepToMultiBody(assemblyName: string, model: StepAssemblyModel): MultiBodyAssembly {
  const bodies: MultiBodyPart[] = [];
  const joints: MultiBodyJoint[] = [];
  const fixedTranslations: MultiBodyFixedTranslation[] = [];

  let jointCount = 1;
  let offsetCount = 1;

  for (const part of model.parts.values()) {
    const massProps = model.massProperties.get(part.id);
    const bodyName = part.name.replace(/[^a-zA-Z0-9_]/g, "_") || `part_${part.id.replace("#", "")}`;
    bodies.push({
      name: bodyName,
      stepId: part.id,
      mass: massProps?.mass || 1.0,
      r_CM: massProps?.centerOfMass || [0, 0, 0],
      inertia: massProps?.inertiaTensor || { I_11: 1, I_22: 1, I_33: 1, I_21: 0, I_31: 0, I_32: 0 },
      shapeRef: part.shapeId,
      frameVariable: `${bodyName}.frame_a`,
    });
  }

  // Very simplified mapping
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
        r: joint.origin, // Simplified
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

  // Handle edges (static placements)
  for (const edge of model.edges) {
    const partA = model.parts.get(edge.parentPartId);
    const partB = model.parts.get(edge.childPartId);
    if (!partA || !partB) continue;

    const nameA = partA.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const nameB = partB.name.replace(/[^a-zA-Z0-9_]/g, "_");

    // Check if there's already a joint between them
    const hasJoint = joints.some(
      (j) => (j.partA === nameA && j.partB === nameB) || (j.partA === nameB && j.partB === nameA),
    );
    if (!hasJoint) {
      fixedTranslations.push({
        name: `offset_${offsetCount++}`,
        partA: nameA,
        partB: nameB,
        r: edge.placement.location, // simplified
      });
    }
  }

  return { name: assemblyName, bodies, joints, fixedTranslations };
}

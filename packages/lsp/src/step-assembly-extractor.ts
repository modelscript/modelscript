import {
  StepAssemblyEdge,
  StepAssemblyModel,
  StepKinematicJoint,
  StepMassProperties,
  StepPart,
  StepPlacement,
} from "./step-physical-data";

/**
 * Extract assembly hierarchy, placements, and kinematics from STEP text.
 */
export function extractStepAssembly(text: string): StepAssemblyModel {
  const parts = new Map<string, StepPart>();
  const edges: StepAssemblyEdge[] = [];
  const joints: StepKinematicJoint[] = [];
  const massProperties = new Map<string, StepMassProperties>();

  const entityPattern = /#(\d+)=\s*([A-Z][A-Z0-9_]*)\(([^]*?)\)\s*;/g;
  let match: RegExpExecArray | null;

  // First pass: collect all entities into a map for easy cross-referencing
  const entities = new Map<string, { type: string; args: string }>();
  while ((match = entityPattern.exec(text)) !== null) {
    entities.set(`#${match[1]}`, { type: match[2], args: match[3] });
  }

  // Helper to parse arguments (handles simple nested parens/strings)
  const parseArgs = (argsStr: string): string[] => {
    const args: string[] = [];
    let current = "";
    let depth = 0;
    let inString = false;
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === "'" && argsStr[i - 1] !== "\\") {
        inString = !inString;
        current += char;
      } else if (!inString && char === "(") {
        depth++;
        current += char;
      } else if (!inString && char === ")") {
        depth--;
        current += char;
      } else if (!inString && char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    args.push(current.trim());
    return args;
  };

  const resolveEntity = (ref: string) => entities.get(ref);

  const getVector = (ref: string): [number, number, number] | null => {
    const ent = resolveEntity(ref);
    if (!ent || (ent.type !== "DIRECTION" && ent.type !== "CARTESIAN_POINT")) return null;
    const args = parseArgs(ent.args);
    // Usually the second arg is the tuple: ('name', (1.0, 0.0, 0.0))
    if (args.length >= 2 && args[1]?.startsWith("(")) {
      const nums = args[1]
        .slice(1, -1)
        .split(",")
        .map((s) => parseFloat(s));
      if (nums.length >= 3) return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
    }
    return null;
  };

  const getPlacement = (ref: string): StepPlacement | null => {
    const ent = resolveEntity(ref);
    if (!ent || ent.type !== "AXIS2_PLACEMENT_3D") return null;
    const args = parseArgs(ent.args);
    if (args.length < 4) return null;

    // args: [name, location, axis, ref_direction]
    const location = getVector(args[1] ?? "") || [0, 0, 0];
    const axis = getVector(args[2] ?? "") || [0, 0, 1];
    const refDirection = getVector(args[3] ?? "") || [1, 0, 0];

    return { location, axis, refDirection };
  };

  // Find products
  for (const [id, ent] of entities.entries()) {
    if (ent.type === "PRODUCT") {
      const args = parseArgs(ent.args);
      const nameMatch = args[0]?.match(/'([^']*)'/);
      if (nameMatch) {
        parts.set(id, { id, name: nameMatch[1] });
      }
    }
  }

  // Find assemblies
  for (const [, ent] of entities.entries()) {
    if (ent.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
      const args = parseArgs(ent.args);
      if (args.length >= 6) {
        // args: [id, name, desc, parent_ref, child_ref, designator]
        const parentRef = args[3] ?? "";
        const childRef = args[4] ?? "";
        // the placement is usually linked via a PRODUCT_DEFINITION_SHAPE -> SHAPE_REPRESENTATION -> ITEM_DEFINED_TRANSFORMATION
        // which is quite complex in STEP. We'll extract ITEM_DEFINED_TRANSFORMATIONs in another pass and link them.
        edges.push({
          parentPartId: parentRef,
          childPartId: childRef,
          placement: { location: [0, 0, 0], axis: [0, 0, 1], refDirection: [1, 0, 0] }, // placeholder
        });
      }
    }
  }

  // Find placements (ITEM_DEFINED_TRANSFORMATION)
  for (const [, ent] of entities.entries()) {
    if (ent.type === "ITEM_DEFINED_TRANSFORMATION") {
      const args = parseArgs(ent.args);
      // args: [name, desc, transform1, transform2]
      if (args.length >= 4) {
        // Need to trace back which parts these belong to, but for now we extract the transform
        getPlacement(args[3] ?? "");
        // For a full implementation we need to walk the SHAPE_REPRESENTATION graph.
      }
    }
  }

  // Find kinematic pairs
  for (const [, ent] of entities.entries()) {
    if (ent.type === "KINEMATIC_PAIR" || ent.type.endsWith("_PAIR")) {
      const args = parseArgs(ent.args);
      // Kinematic pair usually has name, desc, item1, item2, joint parameters
      // E.g. REVOLUTE_PAIR('name','desc',#10,#20,#30)
      if (args.length >= 4) {
        const typeMatch = ent.type.match(/^([A-Z]+)_PAIR$/);
        const jointType = typeMatch && typeMatch[1] ? typeMatch[1].toLowerCase() : "fixed";

        // This is a simplified extraction.
        joints.push({
          type: jointType as StepKinematicJoint["type"],
          partA: args[2] ?? "",
          partB: args[3] ?? "",
          axis: [0, 0, 1],
          origin: [0, 0, 0],
        });
      }
    }
  }

  // Find mass properties (RIGID_BODY_INERTIA)
  // Not implemented in simple parser

  return { parts, edges, joints, massProperties };
}

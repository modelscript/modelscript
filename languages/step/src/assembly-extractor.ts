import type {
  StepAssemblyEdge,
  StepAssemblyModel,
  StepDatum,
  StepDatumSystem,
  StepGeometricTolerance,
  StepKinematicJoint,
  StepMassProperties,
  StepPart,
  StepPlacement,
  StepToleranceType,
} from "./physical-data.js";

/**
 * Extract assembly hierarchy, placements, kinematics, mass properties, and 3D PMI from STEP text.
 */
export function extractStepAssembly(text: string): StepAssemblyModel {
  const parts = new Map<string, StepPart>();
  const edges: StepAssemblyEdge[] = [];
  const joints: StepKinematicJoint[] = [];
  const massProperties = new Map<string, StepMassProperties>();
  const tolerances: StepGeometricTolerance[] = [];
  const datums = new Map<string, StepDatum>();
  const datumSystems: StepDatumSystem[] = [];

  const entityPattern = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\(([^]*?)\)\s*;/g;
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
        const parentRef = args[3] ?? "";
        const childRef = args[4] ?? "";
        edges.push({
          parentPartId: parentRef,
          childPartId: childRef,
          placement: { location: [0, 0, 0], axis: [0, 0, 1], refDirection: [1, 0, 0] },
        });
      }
    }
  }

  // Find placements (ITEM_DEFINED_TRANSFORMATION)
  for (const [, ent] of entities.entries()) {
    if (ent.type === "ITEM_DEFINED_TRANSFORMATION") {
      const args = parseArgs(ent.args);
      if (args.length >= 4) {
        getPlacement(args[3] ?? "");
      }
    }
  }

  // Find kinematic pairs
  for (const [, ent] of entities.entries()) {
    if (ent.type === "KINEMATIC_PAIR" || ent.type.endsWith("_PAIR")) {
      const args = parseArgs(ent.args);
      if (args.length >= 4) {
        const typeMatch = ent.type.match(/^([A-Z]+)_PAIR$/);
        const jointType = typeMatch && typeMatch[1] ? typeMatch[1].toLowerCase() : "fixed";

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

  // ─────────────────────────────────────────────────────────────────────────
  // Find mass properties & 3D inertia tensors (AP242 / AP214)
  // ─────────────────────────────────────────────────────────────────────────
  // Heuristic entity scanning across representation items & property definitions
  let extractedMass: number | undefined;
  let extractedVolume: number | undefined;
  let extractedCoM: [number, number, number] | undefined;
  let extractedInertia: StepMassProperties["inertiaTensor"] | undefined;
  let targetPartId: string | undefined;

  for (const [id, ent] of entities.entries()) {
    const rawText = ent.args;

    // 1. Mass measure (explicit mass measure entity or property definition)
    if (
      ent.type !== "CARTESIAN_POINT" &&
      ent.type !== "AXIS2_PLACEMENT_3D" &&
      (ent.type === "MASS_MEASURE_WITH_UNIT" ||
        ent.type.includes("MASS_") ||
        (ent.type === "PROPERTY_DEFINITION" && /'mass'/i.test(rawText)))
    ) {
      const numMatch =
        rawText.match(/MASS_MEASURE\s*\(\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*\)/i) ||
        rawText.match(/=\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/) ||
        rawText.match(/,\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*[,)]/);
      if (numMatch && numMatch[1] && !isNaN(parseFloat(numMatch[1]))) {
        const candidate = parseFloat(numMatch[1]);
        if (candidate > 0) extractedMass = candidate;
      }
    }

    // 2. Center of mass (CARTESIAN_POINT with 'centre of mass' or 'com' in name)
    if (ent.type === "CARTESIAN_POINT") {
      const isCoM =
        rawText.toLowerCase().includes("centre of mass") ||
        rawText.toLowerCase().includes("center of mass") ||
        rawText.toLowerCase().includes("centre_of_mass") ||
        rawText.toLowerCase().includes("com");
      if (isCoM) {
        const coords = getVector(id);
        if (coords) extractedCoM = coords;
      }
    }

    // 3. Volume measure
    if (rawText.toLowerCase().includes("volume")) {
      const volMatch = rawText.match(/VOLUME_MEASURE\s*\(\s*([0-9.]+)\s*\)/i) || rawText.match(/,\s*([0-9.]+)\s*[,)]/);
      if (volMatch && volMatch[1]) {
        extractedVolume = parseFloat(volMatch[1]);
      }
    }

    // 4. 3D Inertia Tensor matrix
    if (
      ent.type === "MOMENT_OF_INERTIA_MEASURE_WITH_UNIT" ||
      ent.type === "INERTIA_MATRIX" ||
      rawText.toLowerCase().includes("inertia")
    ) {
      // Look for 6 numbers representing I_11, I_22, I_33, I_21, I_31, I_32
      // or matrix ((I11, I12, I13), (I21, I22, I23), (I31, I32, I33))
      const nums = (rawText.match(/-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g) || [])
        .map((s) => parseFloat(s))
        .filter((n) => !isNaN(n));

      if (nums.length >= 6) {
        extractedInertia = {
          I_11: nums[0] ?? 1.0,
          I_22: nums[1] ?? 1.0,
          I_33: nums[2] ?? 1.0,
          I_21: nums[3] ?? 0.0,
          I_31: nums[4] ?? 0.0,
          I_32: nums[5] ?? 0.0,
        };
      }
    }
  }

  // Bind extracted mass properties to part
  if (extractedMass !== undefined || extractedCoM !== undefined || extractedInertia !== undefined) {
    const defaultPartId = parts.keys().next().value || "#1";
    massProperties.set(defaultPartId, {
      mass: extractedMass ?? 1.0,
      centerOfMass: extractedCoM ?? [0, 0, 0],
      inertiaTensor: extractedInertia ?? { I_11: 1.0, I_22: 1.0, I_33: 1.0, I_21: 0, I_31: 0, I_32: 0 },
      volume: extractedVolume ?? 0.001,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Find Semantic 3D PMI / GD&T (AP242)
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Datums
  for (const [id, ent] of entities.entries()) {
    if (ent.type === "DATUM") {
      const args = parseArgs(ent.args);
      // DATUM('name', 'description', #shape_aspect, identification)
      const labelMatch = args[3]?.match(/'([^']*)'/) || args[0]?.match(/'([^']*)'/);
      const datumName = labelMatch ? labelMatch[1] : `D_${id.replace("#", "")}`;
      datums.set(id, {
        id,
        name: datumName,
        featureRef: args[2] ?? undefined,
      });
    }
  }

  // 2. Datum Systems
  for (const [id, ent] of entities.entries()) {
    if (ent.type === "DATUM_SYSTEM") {
      const args = parseArgs(ent.args);
      const dRefs = args[1]?.match(/#\d+/g) || [];
      const primary = dRefs[0] ? datums.get(dRefs[0])?.name || dRefs[0] : "A";
      const secondary = dRefs[1] ? datums.get(dRefs[1])?.name || dRefs[1] : undefined;
      const tertiary = dRefs[2] ? datums.get(dRefs[2])?.name || dRefs[2] : undefined;

      datumSystems.push({
        id,
        name: args[0]?.replace(/'/g, "") || undefined,
        primaryDatum: primary,
        secondaryDatum: secondary,
        tertiaryDatum: tertiary,
      });
    }
  }

  // 3. Geometric Tolerances
  const tolTypeMap: Record<string, StepToleranceType> = {
    FLATNESS_TOLERANCE: "flatness",
    ROUNDNESS_TOLERANCE: "roundness",
    CIRCULARITY_TOLERANCE: "roundness",
    CYLINDRICITY_TOLERANCE: "cylindricity",
    PERPENDICULARITY_TOLERANCE: "perpendicularity",
    PARALLELISM_TOLERANCE: "parallelism",
    POSITION_TOLERANCE: "position",
    SURFACE_PROFILE_TOLERANCE: "surface_profile",
    PROFILE_OF_SURFACE_TOLERANCE: "surface_profile",
    CONCENTRICITY_TOLERANCE: "concentricity",
    COAXIALITY_TOLERANCE: "concentricity",
    RUNOUT_TOLERANCE: "runout",
  };

  for (const [id, ent] of entities.entries()) {
    const matchedType = tolTypeMap[ent.type];
    if (matchedType || ent.type === "GEOMETRIC_TOLERANCE") {
      const args = parseArgs(ent.args);
      // Args typically: (name, description, #magnitude_measure, #shape_aspect_or_datum_system)
      const tolName = args[0]?.replace(/'/g, "") || ent.type;
      let mag = 0.05; // default fallback

      // Resolve magnitude measure
      const magRef = args[2] ?? "";
      if (magRef.startsWith("#")) {
        const magEnt = resolveEntity(magRef);
        if (magEnt) {
          const num = magEnt.args.match(/([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
          if (num && !isNaN(parseFloat(num[1]))) mag = parseFloat(num[1]);
        }
      } else {
        const num = parseFloat(magRef);
        if (!isNaN(num)) mag = num;
      }

      // Collect datum references
      const datumRefs: string[] = [];
      for (const arg of args) {
        if (arg.startsWith("#") && datums.has(arg)) {
          datumRefs.push(datums.get(arg)!.name);
        }
      }

      tolerances.push({
        id,
        name: tolName,
        type: matchedType || "position",
        magnitude: mag,
        datumReferences: datumRefs,
        appliedShapeAspect: args[3] ?? undefined,
      });
    }
  }

  return { parts, edges, joints, massProperties, tolerances, datums, datumSystems };
}

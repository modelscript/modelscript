// SPDX-License-Identifier: AGPL-3.0-or-later

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

  // First pass: collect all entities into a map for easy cross-referencing
  const entities = new Map<string, { type: string; args: string }>();
  const headerRegex = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(/g;
  let headerMatch: RegExpExecArray | null;

  while ((headerMatch = headerRegex.exec(text)) !== null) {
    const id = `#${headerMatch[1]}`;
    const type = headerMatch[2]!;
    const argsStart = headerMatch.index + headerMatch[0].length;
    let depth = 1;
    let pos = argsStart;
    let inString = false;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === "'" && text[pos - 1] !== "\\") {
        inString = !inString;
      } else if (!inString) {
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) break;
        } else if (ch === ";") {
          break;
        }
      }
      pos++;
    }
    const args = text.slice(argsStart, pos);
    entities.set(id, { type, args });
    let endPos = pos;
    if (text[endPos] === ")") endPos++;
    while (
      endPos < text.length &&
      (text[endPos] === " " || text[endPos] === "\t" || text[endPos] === "\r" || text[endPos] === "\n")
    ) {
      endPos++;
    }
    if (text[endPos] === ";") endPos++;
    headerRegex.lastIndex = endPos;
  }

  /**
   * Splits a top-level comma-separated STEP argument list while respecting nested parentheses and quoted strings.
   */
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

  /** Looks up a parsed STEP entity record by its `#id` instance handle. */
  const resolveEntity = (ref: string) => entities.get(ref);

  /**
   * Dereferences a `DIRECTION` or `CARTESIAN_POINT` entity handle and returns its `[x, y, z]` coordinates.
   */
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

  /**
   * Dereferences an `AXIS2_PLACEMENT_3D` entity handle into its origin `location`, Z `axis`, and X `refDirection`.
   */
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
        parts.set(id, { id, name: nameMatch[1]! });
      }
    }
  }

  // Collect placements from ITEM_DEFINED_TRANSFORMATION and AXIS2_PLACEMENT_3D
  const transformationPlacements: StepPlacement[] = [];
  for (const [, ent] of entities.entries()) {
    if (ent.type === "ITEM_DEFINED_TRANSFORMATION") {
      const args = parseArgs(ent.args);
      if (args.length >= 4) {
        const p2 = getPlacement(args[3] ?? "");
        const p1 = getPlacement(args[2] ?? "");
        if (p2) transformationPlacements.push(p2);
        else if (p1) transformationPlacements.push(p1);
      }
    }
  }

  // Find assemblies
  let edgeIdx = 0;
  for (const [, ent] of entities.entries()) {
    if (ent.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
      const args = parseArgs(ent.args);
      if (args.length >= 6) {
        const parentRef = args[3] ?? "";
        const childRef = args[4] ?? "";
        const placement = transformationPlacements[edgeIdx] ?? {
          location: [0, 0, 0],
          axis: [0, 0, 1],
          refDirection: [1, 0, 0],
        };
        edgeIdx++;
        edges.push({
          parentPartId: parentRef,
          childPartId: childRef,
          placement,
        });
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
        let axis: [number, number, number] = [0, 0, 1];
        let origin: [number, number, number] = [0, 0, 0];
        for (const arg of args) {
          if (arg.startsWith("#")) {
            const pl = getPlacement(arg);
            if (pl) {
              origin = pl.location;
              axis = pl.axis;
              break;
            }
          }
        }

        joints.push({
          type: jointType as StepKinematicJoint["type"],
          partA: args[2] ?? "",
          partB: args[3] ?? "",
          axis,
          origin,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Find mass properties & 3D inertia tensors (AP242 / AP214)
  // ─────────────────────────────────────────────────────────────────────────
  // Build entity -> partId ownership map across STEP representation chains:
  // PRODUCT <- PRODUCT_DEFINITION_FORMATION <- PRODUCT_DEFINITION <-
  // PRODUCT_DEFINITION_SHAPE / PROPERTY_DEFINITION <-
  // SHAPE_DEFINITION_REPRESENTATION / PROPERTY_DEFINITION_REPRESENTATION -> REPRESENTATION -> items
  const entityToPartId = new Map<string, string>();
  for (const partId of parts.keys()) {
    entityToPartId.set(partId, partId);
  }
  // Multi-pass propagation through STEP definition and representation links
  for (let pass = 0; pass < 5; pass++) {
    for (const [id, ent] of entities.entries()) {
      const refs = ent.args.match(/#\d+/g) || [];
      let foundPartId = entityToPartId.get(id);
      if (!foundPartId) {
        for (const ref of refs) {
          const mapped = entityToPartId.get(ref);
          if (mapped) {
            foundPartId = mapped;
            break;
          }
        }
      }
      if (!foundPartId) {
        // Also check if entity name matches a known part name
        for (const [pId, pObj] of parts.entries()) {
          if (pObj.name && ent.args.includes(`'${pObj.name}'`)) {
            foundPartId = pId;
            break;
          }
        }
      }
      if (foundPartId) {
        if (!entityToPartId.has(id)) {
          entityToPartId.set(id, foundPartId);
        }
        if (
          ent.type.includes("REPRESENTATION") ||
          ent.type === "PROPERTY_DEFINITION" ||
          ent.type === "PRODUCT_DEFINITION_SHAPE"
        ) {
          for (const ref of refs) {
            if (!entityToPartId.has(ref)) {
              entityToPartId.set(ref, foundPartId);
            }
          }
        }
      }
    }
  }

  const defaultPartId = parts.keys().next().value || "#1";
  const perPartAccum = new Map<
    string,
    {
      mass?: number | undefined;
      volume?: number | undefined;
      centerOfMass?: [number, number, number] | undefined;
      inertiaTensor?: StepMassProperties["inertiaTensor"] | undefined;
    }
  >();
  const getPartAccum = (partId: string) => {
    let acc = perPartAccum.get(partId);
    if (!acc) {
      acc = {};
      perPartAccum.set(partId, acc);
    }
    return acc;
  };

  let extractedMass: number | undefined;
  let extractedVolume: number | undefined;
  let extractedCoM: [number, number, number] | undefined;
  let extractedInertia: StepMassProperties["inertiaTensor"] | undefined;
  const allPoints: [number, number, number][] = [];

  for (const [id, ent] of entities.entries()) {
    const rawText = ent.args;
    const ownerPartId = entityToPartId.get(id) ?? defaultPartId;

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
        if (candidate > 0) {
          extractedMass = candidate;
          getPartAccum(ownerPartId).mass = candidate;
        }
      }
    }

    // 2. Center of mass (CARTESIAN_POINT with 'centre of mass' or 'com' in name)
    if (ent.type === "CARTESIAN_POINT") {
      const coords = getVector(id);
      if (coords) {
        allPoints.push(coords);
        const isCoM =
          rawText.toLowerCase().includes("centre of mass") ||
          rawText.toLowerCase().includes("center of mass") ||
          rawText.toLowerCase().includes("centre_of_mass") ||
          rawText.toLowerCase().includes("com");
        if (isCoM) {
          extractedCoM = coords;
          getPartAccum(ownerPartId).centerOfMass = coords;
        }
      }
    }

    // 3. Volume measure
    if (rawText.toLowerCase().includes("volume")) {
      const volMatch = rawText.match(/VOLUME_MEASURE\s*\(\s*([0-9.]+)\s*\)/i) || rawText.match(/,\s*([0-9.]+)\s*[,)]/);
      if (volMatch && volMatch[1]) {
        const vol = parseFloat(volMatch[1]);
        extractedVolume = vol;
        getPartAccum(ownerPartId).volume = vol;
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
        const inertia = {
          I_11: nums[0] ?? 1.0,
          I_22: nums[1] ?? 1.0,
          I_33: nums[2] ?? 1.0,
          I_21: nums[3] ?? 0.0,
          I_31: nums[4] ?? 0.0,
          I_32: nums[5] ?? 0.0,
        };
        extractedInertia = inertia;
        getPartAccum(ownerPartId).inertiaTensor = inertia;
      }
    }
  }

  // Bind extracted mass properties to each associated part
  if (perPartAccum.size > 0) {
    for (const [partId, acc] of perPartAccum.entries()) {
      massProperties.set(partId, {
        mass: acc.mass ?? extractedMass ?? 1.0,
        centerOfMass: acc.centerOfMass ?? extractedCoM ?? [0, 0, 0],
        inertiaTensor: acc.inertiaTensor ??
          extractedInertia ?? { I_11: 1.0, I_22: 1.0, I_33: 1.0, I_21: 0, I_31: 0, I_32: 0 },
        volume: acc.volume ?? extractedVolume ?? 0.001,
      });
    }
  } else if (extractedMass !== undefined || extractedCoM !== undefined || extractedInertia !== undefined) {
    massProperties.set(defaultPartId, {
      mass: extractedMass ?? 1.0,
      centerOfMass: extractedCoM ?? [0, 0, 0],
      inertiaTensor: extractedInertia ?? { I_11: 1.0, I_22: 1.0, I_33: 1.0, I_21: 0, I_31: 0, I_32: 0 },
      volume: extractedVolume ?? 0.001,
    });
  } else if (allPoints.length >= 4 && parts.size > 0) {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const [px, py, pz] of allPoints) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }
    const dx = Math.max(1e-3, maxX - minX);
    const dy = Math.max(1e-3, maxY - minY);
    const dz = Math.max(1e-3, maxZ - minZ);
    const vol = extractedVolume ?? dx * dy * dz;
    const estMass = Math.max(0.01, Number((vol * 1000).toFixed(4)));
    massProperties.set(defaultPartId, {
      mass: estMass,
      centerOfMass: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      inertiaTensor: {
        I_11: Number(((estMass * (dy * dy + dz * dz)) / 12).toFixed(6)),
        I_22: Number(((estMass * (dx * dx + dz * dz)) / 12).toFixed(6)),
        I_33: Number(((estMass * (dx * dx + dy * dy)) / 12).toFixed(6)),
        I_21: 0,
        I_31: 0,
        I_32: 0,
      },
      volume: vol,
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
      const datumName = labelMatch ? labelMatch[1]! : `D_${id.replace("#", "")}`;
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
          if (num && !isNaN(parseFloat(num[1]!))) mag = parseFloat(num[1]!);
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

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Monte Carlo & Hadrontherapy Semantic Linter.
 *
 * Implements diagnostic rules M9601–M9610:
 * - M9601 (topas-type-prefix-mismatch): Parameter value does not match declared TOPAS type prefix.
 * - M9602 (topas-unresolved-parent-component): Geometry component Parent references an undeclared parent volume.
 * - M9603 (topas-non-positive-geometry-dimension): Box/Cylinder/Sphere dimension is <= 0, or RMin >= RMax.
 * - M9604 (topas-child-exceeds-parent-bounds): Child geometry translation + half-lengths protrude outside parent bounding box.
 * - M9605 (topas-undefined-material): Component Material references an unknown material not in Geant4/NIST or Ma/<Name>.
 * - M9606 (topas-invalid-beam-energy): Particle source BeamEnergy <= 0 MeV or energy spread < 0.
 * - M9607 (topas-circular-include-file): Circular or self-referential includeFile chain.
 * - M9608 (topas-scorer-missing-component): Scorer Component or Quantity is missing or references an undeclared geometry component.
 * - M9609 (topas-vector-length-mismatch): Vector parameter element count does not match declared length token.
 * - M9610 (topas-duplicate-parameter-assignment): Identical parameter path assigned multiple times without 'change' override.
 */

import type { TopasDiagnostic, TopasDocument, TopasGeometryComponent } from "../types.js";

export const BUILTIN_GEANT4_NIST_MATERIALS = new Set<string>([
  "G4_WATER",
  "G4_AIR",
  "G4_BONE_COMPACT_ICRU",
  "G4_BONE_CORTICAL_ICRP",
  "G4_TISSUE_SOFT_ICRP",
  "G4_LUNG_ICRP",
  "G4_ADIPOSE_TISSUE_ICRP",
  "G4_MUSCLE_SKELETAL_ICRP",
  "G4_BRAIN_ICRP",
  "G4_Pb",
  "G4_Ti",
  "G4_Al",
  "G4_Cu",
  "G4_W",
  "G4_LEXAN",
  "G4_PMMA",
  "G4_GRAPHITE",
  "G4_Lucite",
  "G4_Galactic",
  "Vacuum",
  "Air",
  "Water",
  "Lead",
  "Brass",
  "Aluminum",
  "Lucite",
]);

export const TopasErrorCode = {
  TYPE_PREFIX_MISMATCH: {
    code: "M9601",
    rule: "topas-type-prefix-mismatch",
    severity: "error" as const,
    message: (fullPath: string, typePrefix: string, rawVal: string) =>
      `Parameter '${fullPath}' value '${rawVal}' does not match declared TOPAS type prefix '${typePrefix}:'.`,
  },
  UNRESOLVED_PARENT_COMPONENT: {
    code: "M9602",
    rule: "topas-unresolved-parent-component",
    severity: "error" as const,
    message: (compName: string, parentName: string) =>
      `Geometry component '${compName}' references undeclared parent volume '${parentName}'.`,
  },
  NON_POSITIVE_GEOMETRY_DIMENSION: {
    code: "M9603",
    rule: "topas-non-positive-geometry-dimension",
    severity: "error" as const,
    message: (compName: string, detail: string) => `Geometry component '${compName}' has invalid dimension: ${detail}.`,
  },
  CHILD_EXCEEDS_PARENT_BOUNDS: {
    code: "M9604",
    rule: "topas-child-exceeds-parent-bounds",
    severity: "error" as const,
    message: (childName: string, parentName: string, axis: string, childExtent: number, parentHalfExtent: number) =>
      `Child geometry '${childName}' protrudes outside parent '${parentName}' along ${axis}-axis ('${childExtent} mm' > '${parentHalfExtent} mm').`,
  },
  UNDEFINED_MATERIAL: {
    code: "M9605",
    rule: "topas-undefined-material",
    severity: "error" as const,
    message: (compName: string, materialName: string) =>
      `Component '${compName}' references unknown material '${materialName}' not found in Geant4/NIST materials or custom 'Ma/' definitions.`,
  },
  INVALID_BEAM_ENERGY: {
    code: "M9606",
    rule: "topas-invalid-beam-energy",
    severity: "error" as const,
    message: (sourceName: string, detail: string) =>
      `Particle source '${sourceName}' has invalid beam energy specification: ${detail}.`,
  },
  CIRCULAR_INCLUDE_FILE: {
    code: "M9607",
    rule: "topas-circular-include-file",
    severity: "error" as const,
    message: (cycleChain: string) => `Circular or self-referential includeFile chain detected: '${cycleChain}'.`,
  },
  SCORER_MISSING_COMPONENT: {
    code: "M9608",
    rule: "topas-scorer-missing-component",
    severity: "error" as const,
    message: (scorerName: string, detail: string) => `Scorer '${scorerName}' has invalid configuration: ${detail}.`,
  },
  VECTOR_LENGTH_MISMATCH: {
    code: "M9609",
    rule: "topas-vector-length-mismatch",
    severity: "error" as const,
    message: (fullPath: string, declaredCount: number, actualCount: number) =>
      `Vector parameter '${fullPath}' declares length '${declaredCount}' but provides '${actualCount}' elements.`,
  },
  DUPLICATE_PARAMETER_ASSIGNMENT: {
    code: "M9610",
    rule: "topas-duplicate-parameter-assignment",
    severity: "warning" as const,
    message: (fullPath: string) =>
      `Parameter '${fullPath}' is assigned multiple times in the same file without 'change' override prefix.`,
  },
};

function getBoundingHalfExtents(comp: TopasGeometryComponent): [number, number, number] | null {
  const t = comp.type.toLowerCase();
  if (t.includes("box")) {
    if (comp.hlx !== undefined && comp.hly !== undefined && comp.hlz !== undefined) {
      return [comp.hlx, comp.hly, comp.hlz];
    }
  } else if (t.includes("cylinder")) {
    if (comp.rMax !== undefined && comp.hl !== undefined) {
      return [comp.rMax, comp.rMax, comp.hl];
    }
  } else if (t.includes("sphere")) {
    if (comp.rMax !== undefined) {
      return [comp.rMax, comp.rMax, comp.rMax];
    }
  }
  if (comp.hlx !== undefined && comp.hly !== undefined && comp.hlz !== undefined) {
    return [comp.hlx, comp.hly, comp.hlz];
  }
  return null;
}

export function lintTopasDocument(doc: TopasDocument): TopasDiagnostic[] {
  const diagnostics: TopasDiagnostic[] = [];

  // 1. Parameter checks: M9601 (type mismatch), M9609 (vector length mismatch), M9610 (duplicate assignment)
  const seenPaths = new Set<string>();
  for (const param of doc.parameters) {
    if (
      param.vectorLengthMismatch &&
      param.declaredVectorLength !== undefined &&
      param.actualVectorLength !== undefined
    ) {
      diagnostics.push({
        code: TopasErrorCode.VECTOR_LENGTH_MISMATCH.code,
        rule: TopasErrorCode.VECTOR_LENGTH_MISMATCH.rule,
        severity: TopasErrorCode.VECTOR_LENGTH_MISMATCH.severity,
        message: TopasErrorCode.VECTOR_LENGTH_MISMATCH.message(
          param.fullPath,
          param.declaredVectorLength,
          param.actualVectorLength,
        ),
        range: param.range,
      });
    } else if (param.typeMismatch) {
      diagnostics.push({
        code: TopasErrorCode.TYPE_PREFIX_MISMATCH.code,
        rule: TopasErrorCode.TYPE_PREFIX_MISMATCH.rule,
        severity: TopasErrorCode.TYPE_PREFIX_MISMATCH.severity,
        message: TopasErrorCode.TYPE_PREFIX_MISMATCH.message(param.fullPath, param.typePrefix, param.rawValue),
        range: param.range,
      });
    }

    const normPath = param.fullPath.toLowerCase();
    if (seenPaths.has(normPath)) {
      if (!param.isChangeOverride) {
        diagnostics.push({
          code: TopasErrorCode.DUPLICATE_PARAMETER_ASSIGNMENT.code,
          rule: TopasErrorCode.DUPLICATE_PARAMETER_ASSIGNMENT.rule,
          severity: TopasErrorCode.DUPLICATE_PARAMETER_ASSIGNMENT.severity,
          message: TopasErrorCode.DUPLICATE_PARAMETER_ASSIGNMENT.message(param.fullPath),
          range: param.range,
        });
      }
    } else {
      seenPaths.add(normPath);
    }
  }

  // Build lookup tables for components and custom materials
  const compByName = new Map<string, TopasGeometryComponent>();
  for (const c of doc.components) {
    compByName.set(c.name, c);
  }

  const customMaterials = new Set<string>();
  for (const m of doc.materials) {
    customMaterials.add(m.name);
  }

  // 2. Geometry Component checks: M9602, M9603, M9604, M9605
  for (const comp of doc.components) {
    // M9602: Unresolved parent component ("World" is built-in root)
    if (comp.parent && comp.parent !== "World" && comp.parent.toLowerCase() !== "world") {
      if (!compByName.has(comp.parent)) {
        diagnostics.push({
          code: TopasErrorCode.UNRESOLVED_PARENT_COMPONENT.code,
          rule: TopasErrorCode.UNRESOLVED_PARENT_COMPONENT.rule,
          severity: TopasErrorCode.UNRESOLVED_PARENT_COMPONENT.severity,
          message: TopasErrorCode.UNRESOLVED_PARENT_COMPONENT.message(comp.name, comp.parent),
          range: comp.range,
        });
      }
    }

    // M9603: Non-positive geometry dimensions or RMin >= RMax
    const dimChecks: Array<[string, number | undefined]> = [
      ["HLX", comp.hlx],
      ["HLY", comp.hly],
      ["HLZ", comp.hlz],
      ["RMax", comp.rMax],
      ["HL", comp.hl],
    ];
    for (const [dimName, val] of dimChecks) {
      if (val !== undefined && val <= 0) {
        diagnostics.push({
          code: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.code,
          rule: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.rule,
          severity: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.severity,
          message: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.message(comp.name, `'${dimName}' (${val}) <= 0`),
          range: comp.range,
        });
      }
    }
    if (comp.rMin !== undefined && comp.rMax !== undefined && comp.rMin >= comp.rMax) {
      diagnostics.push({
        code: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.code,
        rule: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.rule,
        severity: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.severity,
        message: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.message(
          comp.name,
          `'RMin' (${comp.rMin}) >= 'RMax' (${comp.rMax})`,
        ),
        range: comp.range,
      });
    } else if (comp.rMin !== undefined && comp.rMin < 0) {
      diagnostics.push({
        code: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.code,
        rule: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.rule,
        severity: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.severity,
        message: TopasErrorCode.NON_POSITIVE_GEOMETRY_DIMENSION.message(comp.name, `'RMin' (${comp.rMin}) < 0`),
        range: comp.range,
      });
    }

    // M9604: Child exceeds parent bounds
    if (comp.parent) {
      const parentComp = compByName.get(comp.parent);
      if (parentComp) {
        const childExtents = getBoundingHalfExtents(comp);
        const parentExtents = getBoundingHalfExtents(parentComp);
        if (childExtents && parentExtents) {
          const tx = Math.abs(comp.transX ?? 0);
          const ty = Math.abs(comp.transY ?? 0);
          const tz = Math.abs(comp.transZ ?? 0);

          if (childExtents[0] > 0 && parentExtents[0] > 0 && tx + childExtents[0] > parentExtents[0] + 1e-6) {
            diagnostics.push({
              code: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.code,
              rule: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.rule,
              severity: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.severity,
              message: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.message(
                comp.name,
                parentComp.name,
                "X",
                tx + childExtents[0],
                parentExtents[0],
              ),
              range: comp.range,
            });
          } else if (childExtents[1] > 0 && parentExtents[1] > 0 && ty + childExtents[1] > parentExtents[1] + 1e-6) {
            diagnostics.push({
              code: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.code,
              rule: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.rule,
              severity: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.severity,
              message: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.message(
                comp.name,
                parentComp.name,
                "Y",
                ty + childExtents[1],
                parentExtents[1],
              ),
              range: comp.range,
            });
          } else if (childExtents[2] > 0 && parentExtents[2] > 0 && tz + childExtents[2] > parentExtents[2] + 1e-6) {
            diagnostics.push({
              code: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.code,
              rule: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.rule,
              severity: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.severity,
              message: TopasErrorCode.CHILD_EXCEEDS_PARENT_BOUNDS.message(
                comp.name,
                parentComp.name,
                "Z",
                tz + childExtents[2],
                parentExtents[2],
              ),
              range: comp.range,
            });
          }
        }
      }
    }

    // M9605: Undefined material
    if (comp.material) {
      if (!BUILTIN_GEANT4_NIST_MATERIALS.has(comp.material) && !customMaterials.has(comp.material)) {
        diagnostics.push({
          code: TopasErrorCode.UNDEFINED_MATERIAL.code,
          rule: TopasErrorCode.UNDEFINED_MATERIAL.rule,
          severity: TopasErrorCode.UNDEFINED_MATERIAL.severity,
          message: TopasErrorCode.UNDEFINED_MATERIAL.message(comp.name, comp.material),
          range: comp.range,
        });
      }
    }
  }

  // 3. Particle Source checks: M9606 (Invalid BeamEnergy <= 0 MeV or spread < 0)
  for (const src of doc.sources) {
    if (src.beamEnergy !== undefined && src.beamEnergy <= 0) {
      diagnostics.push({
        code: TopasErrorCode.INVALID_BEAM_ENERGY.code,
        rule: TopasErrorCode.INVALID_BEAM_ENERGY.rule,
        severity: TopasErrorCode.INVALID_BEAM_ENERGY.severity,
        message: TopasErrorCode.INVALID_BEAM_ENERGY.message(src.name, `'BeamEnergy' (${src.beamEnergy} MeV) <= 0`),
        range: src.range,
      });
    }
    if (src.beamEnergySpread !== undefined && src.beamEnergySpread < 0) {
      diagnostics.push({
        code: TopasErrorCode.INVALID_BEAM_ENERGY.code,
        rule: TopasErrorCode.INVALID_BEAM_ENERGY.rule,
        severity: TopasErrorCode.INVALID_BEAM_ENERGY.severity,
        message: TopasErrorCode.INVALID_BEAM_ENERGY.message(
          src.name,
          `'BeamEnergySpread' (${src.beamEnergySpread}) < 0`,
        ),
        range: src.range,
      });
    }
  }

  // 4. Include cycle checks: M9607
  const currentBasename = doc.sourceUri ? doc.sourceUri.split("/").pop() : undefined;
  const seenIncludes = new Set<string>();
  for (const inc of doc.includes) {
    if (inc.chain && inc.chain.length >= 2) {
      const visited = new Set<string>();
      for (const node of inc.chain) {
        if (visited.has(node)) {
          diagnostics.push({
            code: TopasErrorCode.CIRCULAR_INCLUDE_FILE.code,
            rule: TopasErrorCode.CIRCULAR_INCLUDE_FILE.rule,
            severity: TopasErrorCode.CIRCULAR_INCLUDE_FILE.severity,
            message: TopasErrorCode.CIRCULAR_INCLUDE_FILE.message(inc.chain.join(" -> ")),
            range: inc.range,
          });
          break;
        }
        visited.add(node);
      }
    } else if (
      (currentBasename && (inc.filePath === currentBasename || inc.filePath === doc.sourceUri)) ||
      inc.filePath === "self" ||
      seenIncludes.has(inc.filePath)
    ) {
      diagnostics.push({
        code: TopasErrorCode.CIRCULAR_INCLUDE_FILE.code,
        rule: TopasErrorCode.CIRCULAR_INCLUDE_FILE.rule,
        severity: TopasErrorCode.CIRCULAR_INCLUDE_FILE.severity,
        message: TopasErrorCode.CIRCULAR_INCLUDE_FILE.message(`${currentBasename ?? inc.filePath} -> ${inc.filePath}`),
        range: inc.range,
      });
    }
    seenIncludes.add(inc.filePath);
  }

  // Also check doc.includeGraph if present and not already reported
  if (doc.includeGraph && !diagnostics.some((d) => d.code === TopasErrorCode.CIRCULAR_INCLUDE_FILE.code)) {
    const graph = doc.includeGraph;
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const dfs = (node: string, path: string[]): string[] | null => {
      visited.add(node);
      onStack.add(node);
      for (const next of graph[node] ?? []) {
        if (!visited.has(next)) {
          const cycle = dfs(next, [...path, next]);
          if (cycle) return cycle;
        } else if (onStack.has(next)) {
          return [...path, next];
        }
      }
      onStack.delete(node);
      return null;
    };
    for (const startNode of Object.keys(graph)) {
      if (!visited.has(startNode)) {
        const cycle = dfs(startNode, [startNode]);
        if (cycle) {
          diagnostics.push({
            code: TopasErrorCode.CIRCULAR_INCLUDE_FILE.code,
            rule: TopasErrorCode.CIRCULAR_INCLUDE_FILE.rule,
            severity: TopasErrorCode.CIRCULAR_INCLUDE_FILE.severity,
            message: TopasErrorCode.CIRCULAR_INCLUDE_FILE.message(cycle.join(" -> ")),
            range: doc.includes[0]?.range ?? doc.range,
          });
          break;
        }
      }
    }
  }

  // 5. Scorer checks: M9608 (missing Component or Quantity, or undeclared geometry component)
  for (const sc of doc.scorers) {
    if (!sc.quantity) {
      diagnostics.push({
        code: TopasErrorCode.SCORER_MISSING_COMPONENT.code,
        rule: TopasErrorCode.SCORER_MISSING_COMPONENT.rule,
        severity: TopasErrorCode.SCORER_MISSING_COMPONENT.severity,
        message: TopasErrorCode.SCORER_MISSING_COMPONENT.message(sc.name, "missing required 'Quantity' parameter"),
        range: sc.range,
      });
    }
    if (!sc.component) {
      diagnostics.push({
        code: TopasErrorCode.SCORER_MISSING_COMPONENT.code,
        rule: TopasErrorCode.SCORER_MISSING_COMPONENT.rule,
        severity: TopasErrorCode.SCORER_MISSING_COMPONENT.severity,
        message: TopasErrorCode.SCORER_MISSING_COMPONENT.message(sc.name, "missing required 'Component' parameter"),
        range: sc.range,
      });
    } else if (sc.component !== "World" && !compByName.has(sc.component)) {
      diagnostics.push({
        code: TopasErrorCode.SCORER_MISSING_COMPONENT.code,
        rule: TopasErrorCode.SCORER_MISSING_COMPONENT.rule,
        severity: TopasErrorCode.SCORER_MISSING_COMPONENT.severity,
        message: TopasErrorCode.SCORER_MISSING_COMPONENT.message(
          sc.name,
          `references undeclared geometry component '${sc.component}'`,
        ),
        range: sc.range,
      });
    }
  }

  return diagnostics;
}

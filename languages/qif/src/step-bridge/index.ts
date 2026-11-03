// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — STEP AP242 (ISO 10303-242) to QIF 3.0 Bridge & Reconciliation Engine.
 *
 * Extracts geometric and PMI entities (`ADVANCED_FACE`, `CYLINDRICAL_SURFACE`, `PLANE`,
 * `SPHERICAL_SURFACE`, `CONICAL_SURFACE`, `CIRCLE`, `GEOMETRIC_TOLERANCE`, `DATUM`)
 * from STEP AP242 physical files, reconciles `stepEntityId` references (emitting M8109
 * on missing entities), and synthesizes QIF 3.0 inspection documents from STEP models.
 */

import { MATHEMATICAL_MIN_POINTS, QifErrorCode } from "../lints/rules.js";
import { computeLineOffsets, isDefaultFeatureOfSize, makeRange } from "../parser/index.js";
import type {
  QifCharacteristic,
  QifDatumDefinition,
  QifDiagnostic,
  QifDocument,
  QifFeature,
  QifFeatureType,
  QifGdtType,
  QifPlanStep,
} from "../types.js";

// Re-export helper if needed
export interface StepAp242Entity {
  id: string; // Normalized "#123"
  rawId: number;
  entityType: string;
  name: string;
  argsRaw: string;
  referencedIds: string[];
  numericParams: number[];
  mappedFeatureType?: QifFeatureType | undefined;
  mappedGdtType?: QifGdtType | undefined;
}

export interface StepFeatureMatch {
  featureId: string;
  featureName: string;
  featureType: QifFeatureType;
  stepEntityId: string;
  stepEntityType: string;
  geometryCompatible: boolean;
}

export interface StepReconciliationResult {
  stepEntities: StepAp242Entity[];
  matchedFeatures: StepFeatureMatch[];
  unresolvedFeatures: {
    featureId: string;
    featureName: string;
    stepEntityId: string;
  }[];
  diagnostics: QifDiagnostic[];
}

export function extractStepEntities(stepText: string): Map<string, StepAp242Entity> {
  const entityMap = new Map<string, StepAp242Entity>();
  const regex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;/gi;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(stepText)) !== null) {
    const numStr = m[1] ?? "0";
    const id = `#${numStr}`;
    const rawId = Number(numStr);
    const entityType = (m[2] ?? "").toUpperCase();
    const argsRaw = (m[3] ?? "").trim();

    const nameMatch = /'([^']*)'/.exec(argsRaw);
    const name = nameMatch?.[1]?.trim() || `${entityType}_${numStr}`;

    const referencedIds: string[] = [];
    const refRegex = /#(\d+)/g;
    let rm: RegExpExecArray | null;
    while ((rm = refRegex.exec(argsRaw)) !== null) {
      referencedIds.push(`#${rm[1]}`);
    }

    // Extract standalone floating point or integer numbers outside quotes and #refs
    const argsWithoutStringsAndRefs = argsRaw.replace(/'[^']*'/g, " ").replace(/#\d+/g, " ");
    const numericParams: number[] = [];
    const numRegex = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRegex.exec(argsWithoutStringsAndRefs)) !== null) {
      const val = Number(nm[0]);
      if (!Number.isNaN(val)) {
        numericParams.push(val);
      }
    }

    const mappedFeatureType = mapStepTypeToFeatureType(entityType);
    const mappedGdtType = mapStepTypeToGdtType(entityType);

    const entity: StepAp242Entity = {
      id,
      rawId,
      entityType,
      name,
      argsRaw,
      referencedIds,
      numericParams,
    };
    if (mappedFeatureType) entity.mappedFeatureType = mappedFeatureType;
    if (mappedGdtType) entity.mappedGdtType = mappedGdtType;

    entityMap.set(id, entity);
  }

  // Second pass: for ADVANCED_FACE entities, infer mappedFeatureType from referenced surface entity
  for (const ent of entityMap.values()) {
    if (ent.entityType === "ADVANCED_FACE" && !ent.mappedFeatureType) {
      for (const refId of ent.referencedIds) {
        const refEnt = entityMap.get(refId);
        if (refEnt?.mappedFeatureType) {
          ent.mappedFeatureType = refEnt.mappedFeatureType;
          if (ent.numericParams.length === 0 && refEnt.numericParams.length > 0) {
            ent.numericParams.push(...refEnt.numericParams);
          }
          break;
        }
      }
    }
  }

  return entityMap;
}

export function reconcileStepWithQif(stepText: string, qifDoc: QifDocument): StepReconciliationResult {
  const entityMap = extractStepEntities(stepText);
  const matchedFeatures: StepFeatureMatch[] = [];
  const unresolvedFeatures: { featureId: string; featureName: string; stepEntityId: string }[] = [];
  const diagnostics: QifDiagnostic[] = [];

  for (const feat of qifDoc.features) {
    if (!feat.stepEntityId) continue;

    const normalizedId = normalizeStepEntityId(feat.stepEntityId);
    const stepEnt = entityMap.get(normalizedId);

    if (!stepEnt) {
      unresolvedFeatures.push({
        featureId: feat.id,
        featureName: feat.name,
        stepEntityId: feat.stepEntityId,
      });
      diagnostics.push({
        code: QifErrorCode.UNRESOLVED_STEP_ENTITY.code,
        rule: QifErrorCode.UNRESOLVED_STEP_ENTITY.rule,
        severity: QifErrorCode.UNRESOLVED_STEP_ENTITY.severity,
        message: QifErrorCode.UNRESOLVED_STEP_ENTITY.message(feat.stepEntityId, feat.name),
        range: feat.range,
      });
    } else {
      const geometryCompatible =
        stepEnt.mappedFeatureType === undefined ||
        stepEnt.mappedFeatureType === feat.featureType ||
        stepEnt.entityType === "ADVANCED_FACE";

      matchedFeatures.push({
        featureId: feat.id,
        featureName: feat.name,
        featureType: feat.featureType,
        stepEntityId: feat.stepEntityId,
        stepEntityType: stepEnt.entityType,
        geometryCompatible,
      });
    }
  }

  return {
    stepEntities: Array.from(entityMap.values()),
    matchedFeatures,
    unresolvedFeatures,
    diagnostics,
  };
}

export function synthesizeQifFromStep(stepText: string): QifDocument {
  const lineOffsets = computeLineOffsets(stepText);
  const fullRange = makeRange(0, stepText.length, lineOffsets);
  const entityMap = extractStepEntities(stepText);

  const features: QifFeature[] = [];
  const datumDefinitions: QifDatumDefinition[] = [];
  const characteristics: QifCharacteristic[] = [];
  const planSteps: QifPlanStep[] = [];

  // Track surfaces already wrapped by an ADVANCED_FACE so we don't duplicate them
  const surfacesWrappedByFace = new Set<string>();
  for (const ent of entityMap.values()) {
    if (ent.entityType === "ADVANCED_FACE") {
      for (const refId of ent.referencedIds) {
        const refEnt = entityMap.get(refId);
        if (refEnt && isGeometricSurfaceOrCurve(refEnt.entityType)) {
          surfacesWrappedByFace.add(refId);
        }
      }
    }
  }

  let featCounter = 1;
  const stepIdToFeatureId = new Map<string, string>();

  for (const ent of entityMap.values()) {
    const isSurface = isGeometricSurfaceOrCurve(ent.entityType);
    const isFace = ent.entityType === "ADVANCED_FACE";
    if (!isSurface && !isFace) continue;
    if (isSurface && surfacesWrappedByFace.has(ent.id)) continue;

    const ft: QifFeatureType = ent.mappedFeatureType ?? "Plane";
    const fId = `F_${featCounter++}`;
    const isFos = isDefaultFeatureOfSize(ft);
    const minPts = MATHEMATICAL_MIN_POINTS[ft] ?? 4;

    const feature: QifFeature = {
      id: fId,
      qpId: `00000000-0000-4000-8000-${String(ent.rawId).padStart(12, "0")}`,
      name: ent.name,
      featureType: ft,
      isFeatureOfSize: isFos,
      stepEntityId: ent.id,
      probingPoints: minPts,
      range: fullRange,
    };

    const firstParam = ent.numericParams[0];
    if (firstParam !== undefined && (ft === "Cylinder" || ft === "Sphere" || ft === "Circle")) {
      // STEP CYLINDRICAL_SURFACE / SPHERICAL_SURFACE / CIRCLE specify radius -> convert to diameter
      feature.nominalSize = firstParam * 2;
    }

    features.push(feature);
    stepIdToFeatureId.set(ent.id, fId);
    for (const rId of ent.referencedIds) {
      if (!stepIdToFeatureId.has(rId)) {
        stepIdToFeatureId.set(rId, fId);
      }
    }
  }

  // Extract DATUM entities
  let datumCounter = 1;
  for (const ent of entityMap.values()) {
    if (ent.entityType === "DATUM") {
      const label = ent.name.startsWith("DATUM_") ? String.fromCharCode(64 + datumCounter) : ent.name;
      const dDef: QifDatumDefinition = {
        id: `D_${datumCounter++}`,
        label,
        range: fullRange,
      };
      const firstRef = ent.referencedIds[0];
      const linkedFeat = firstRef ? stepIdToFeatureId.get(firstRef) : features[0]?.id;
      if (linkedFeat) dDef.featureId = linkedFeat;
      datumDefinitions.push(dDef);
    }
  }

  if (datumDefinitions.length === 0 && features.length > 0) {
    datumDefinitions.push({
      id: "D_1",
      label: "A",
      featureId: features[0]?.id,
      range: fullRange,
    });
  }

  // Extract GEOMETRIC_TOLERANCE entities
  let charCounter = 1;
  for (const ent of entityMap.values()) {
    if (!ent.mappedGdtType) continue;
    const gdtType = ent.mappedGdtType;
    const tolVal = ent.numericParams[0] ?? 0.05;
    let targetFeatureId: string | undefined;
    for (const refId of ent.referencedIds) {
      const fid = stepIdToFeatureId.get(refId);
      if (fid) {
        targetFeatureId = fid;
        break;
      }
    }
    if (!targetFeatureId && features[0]) {
      targetFeatureId = features[0].id;
    }

    const cId = `C_${charCounter}`;
    const char: QifCharacteristic = {
      id: cId,
      qpId: `00000000-0000-4000-9000-${String(charCounter).padStart(12, "0")}`,
      name: ent.name,
      balloonNumber: charCounter,
      gdtType,
      toleranceZone: tolVal,
      isDiametrical: gdtType === "Position",
      materialCondition: "RFS",
      datumReferences:
        gdtType === "Position" || gdtType === "Perpendicularity" || gdtType === "Parallelism"
          ? datumDefinitions.slice(0, 1).map((d, i) => ({ datumLabel: d.label, precedence: i + 1 }))
          : [],
      featureIds: targetFeatureId ? [targetFeatureId] : [],
      deviceId: "CMM_1",
      range: fullRange,
    };
    characteristics.push(char);
    charCounter++;
  }

  // Generate inspection plan steps
  features.forEach((f, idx) => {
    const linkedChar = characteristics.find((c) => c.featureIds.includes(f.id));
    const step: QifPlanStep = {
      id: `S_${idx + 1}`,
      stepNumber: idx + 1,
      featureId: f.id,
      deviceId: "CMM_1",
      probingPointCount: f.probingPoints ?? MATHEMATICAL_MIN_POINTS[f.featureType] ?? 4,
      range: fullRange,
    };
    if (linkedChar) step.characteristicId = linkedChar.id;
    planSteps.push(step);
  });

  return {
    qpId: "11111111-2222-4333-8444-555555555555",
    version: "3.0.0",
    header: {
      author: "ModelScript STEP-to-QIF Synthesizer",
      application: "@modelscript/qif",
      fileUnits: "mm",
    },
    datumDefinitions,
    features,
    characteristics,
    devices: [
      {
        id: "CMM_1",
        name: "Synthesized_CMM",
        deviceType: "CMM",
        calibrationUncertainty: 0.001,
        range: fullRange,
      },
    ],
    rules: {
      minPointsPerFeature: { ...MATHEMATICAL_MIN_POINTS },
      minTurRatio: 4.0,
      range: fullRange,
    },
    planSteps,
    actuals: [],
    range: fullRange,
  };
}

function normalizeStepEntityId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function isGeometricSurfaceOrCurve(entityType: string): boolean {
  return (
    entityType === "PLANE" ||
    entityType === "CYLINDRICAL_SURFACE" ||
    entityType === "SPHERICAL_SURFACE" ||
    entityType === "CONICAL_SURFACE" ||
    entityType === "CIRCLE" ||
    entityType === "CARTESIAN_POINT"
  );
}

function mapStepTypeToFeatureType(entityType: string): QifFeatureType | undefined {
  switch (entityType) {
    case "PLANE":
      return "Plane";
    case "CYLINDRICAL_SURFACE":
      return "Cylinder";
    case "SPHERICAL_SURFACE":
      return "Sphere";
    case "CONICAL_SURFACE":
      return "Cone";
    case "CIRCLE":
      return "Circle";
    case "CARTESIAN_POINT":
    case "VERTEX_POINT":
      return "Point";
    default:
      return undefined;
  }
}

function mapStepTypeToGdtType(entityType: string): QifGdtType | undefined {
  if (entityType.includes("FLATNESS")) return "Flatness";
  if (entityType.includes("STRAIGHTNESS")) return "Straightness";
  if (entityType.includes("CIRCULARITY") || entityType.includes("ROUNDNESS")) return "Circularity";
  if (entityType.includes("CYLINDRICITY")) return "Cylindricity";
  if (entityType.includes("SURFACE_PROFILE")) return "ProfileOfSurface";
  if (entityType.includes("LINE_PROFILE")) return "ProfileOfLine";
  if (entityType.includes("PERPENDICULARITY")) return "Perpendicularity";
  if (entityType.includes("PARALLELISM")) return "Parallelism";
  if (entityType.includes("ANGULARITY")) return "Angularity";
  if (entityType.includes("POSITION")) return "Position";
  if (entityType.includes("CIRCULAR_RUNOUT")) return "CircularRunout";
  if (entityType.includes("TOTAL_RUNOUT")) return "TotalRunout";
  if (entityType === "GEOMETRIC_TOLERANCE") return "Position";
  return undefined;
}

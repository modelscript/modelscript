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
  let pos = 0;
  while (pos < stepText.length) {
    const nextSemi = stepText.indexOf(";", pos);
    if (nextSemi === -1) break;
    const stmt = stepText.slice(pos, nextSemi);
    pos = nextSemi + 1;
    const m = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*)\)/.exec(stmt);
    if (!m) continue;

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

// ─────────────────────────────────────────────────────────────────────────────
// 3D MBD / STEP AP242 B-Rep Mesh & GD&T Callout Scene Synthesizer
// ─────────────────────────────────────────────────────────────────────────────

export interface Qif3dMeshPayload {
  id: string;
  name: string;
  featureId?: string | undefined;
  stepEntityId?: string | undefined;
  featureType?: QifFeatureType | undefined;
  isBodyEnvelope?: boolean | undefined;
  color: [number, number, number];
  deviationStatus: "PASS" | "MARGINAL" | "FAIL" | "UNINSPECTED";
  worstToleranceRatio: number;
  vertices: number[];
  normals: number[];
  indices: number[];
}

export interface Qif3dProbeHit {
  id: string;
  featureId: string;
  stepEntityId?: string | undefined;
  position: [number, number, number];
  normal: [number, number, number];
  deviationVector: [number, number, number];
  deviationMagnitude: number;
  status: "PASS" | "MARGINAL" | "FAIL";
}

export interface Qif3dCalloutAnchor {
  characteristicId: string;
  characteristicName: string;
  balloonNumber: number;
  featureId: string;
  featureName: string;
  stepEntityId?: string | undefined;
  gdtType: QifGdtType;
  gdtSymbol: string;
  toleranceZone: number;
  isDiametrical: boolean;
  materialCondition: "RFS" | "MMC" | "LMC";
  datumReferences: { datumLabel: string; materialCondition?: "RFS" | "MMC" | "LMC" | undefined }[];
  compositeLowerTier?:
    | {
        toleranceZone: number;
        materialCondition?: "RFS" | "MMC" | "LMC" | undefined;
        datumReferences: string[];
      }
    | undefined;
  measuredValue?: number | undefined;
  bonusTolerance: number;
  effectiveTolerance: number;
  cpk?: number | undefined;
  status: "PASS" | "REWORK" | "FAIL" | "PLAN";
  toleranceRatio: number;
  surfaceAnchor: [number, number, number];
  leaderElbow: [number, number, number];
  calloutPosition: [number, number, number];
}

export interface Qif3dDatumBadge {
  datumId: string;
  datumLabel: string;
  featureId?: string | undefined;
  featureName?: string | undefined;
  stepEntityId?: string | undefined;
  surfaceAnchor: [number, number, number];
  badgePosition: [number, number, number];
  normal: [number, number, number];
}

export interface Qif3dSpcMetric {
  characteristicId: string;
  characteristicName: string;
  nominalValue: number;
  toleranceZone: number;
  effectiveTolerance: number;
  bonusTolerance: number;
  mean: number;
  stdDev: number;
  cp: number;
  cpk: number;
  tur?: number | undefined;
  passRate: number;
  sampleCount: number;
}

export interface Qif3dSpcSummary {
  metrics: Qif3dSpcMetric[];
  overallPassRate: number;
  minCpk: number;
  minTur?: number | undefined;
}

export interface Qif3dMbdScene {
  qpId: string;
  meshes: Qif3dMeshPayload[];
  probeHits: Qif3dProbeHit[];
  callouts: Qif3dCalloutAnchor[];
  datumBadges: Qif3dDatumBadge[];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    radius: number;
  };
  stepSource: string;
  /** "external-step" when a user-paired STEP backs the scene; "none" when no real part geometry is available. */
  geometry: "external-step" | "none";
  reconciliation: StepReconciliationResult;
  spcSummary: Qif3dSpcSummary;
}

export function getAsmeGdtUnicodeSymbol(gdtType: QifGdtType | string): string {
  switch (gdtType) {
    case "Flatness":
      return "⏥";
    case "Straightness":
      return "⏤";
    case "Circularity":
      return "○";
    case "Cylindricity":
      return "⌭";
    case "ProfileOfLine":
      return "⌒";
    case "ProfileOfSurface":
      return "⌓";
    case "Perpendicularity":
      return "⊥";
    case "Parallelism":
      return "∥";
    case "Angularity":
      return "∠";
    case "Position":
      return "⌖";
    case "CircularRunout":
      return "↗";
    case "TotalRunout":
      return "⌰";
    default:
      return "±";
  }
}

/**
 * Synthesizes a companion ISO 10303-21 STEP AP242 physical file from a QIF 3.0 document
 * preserving exact `#StepEntityId` topological face bindings (`ADVANCED_FACE`, `PLANE`,
 * `CYLINDRICAL_SURFACE`, `DATUM`, and `GEOMETRIC_TOLERANCE`).
 */
export function synthesizeStepAp242FromQif(doc: QifDocument): string {
  const lines: string[] = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ModelScript ISO 10303-242 AP242 MBD Companion B-Rep'),'2;1');",
    `FILE_NAME('${doc.header.partName ?? "QIF_MBD_Part"}.step','2026-03-19T12:00:00',('${doc.header.author ?? "ModelScript Metrology"}'),('ModelScript MBD'),'ModelScript STEP-QIF Bridge','ModelScript QIF 3.0','');`,
    "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));",
    "ENDSEC;",
    "DATA;",
    "#1 = APPLICATION_CONTEXT('managed model based 3d engineering');",
    "#2 = PRODUCT('MBD_PART','MBD_PART','',(#1));",
    "#3 = PRODUCT_DEFINITION_FORMATION('','',#2);",
    "#4 = PRODUCT_DEFINITION('design','',#3,#1);",
  ];

  const usedIds = new Set<number>([1, 2, 3, 4]);
  for (const feat of doc.features) {
    if (feat.stepEntityId) {
      const n = Number(feat.stepEntityId.replace(/^#/, ""));
      if (Number.isFinite(n) && n > 0) usedIds.add(n);
    }
  }

  let nextAuxId = 10;
  const allocId = (): number => {
    while (usedIds.has(nextAuxId)) nextAuxId++;
    usedIds.add(nextAuxId);
    return nextAuxId++;
  };

  const faceIds: string[] = [];
  doc.features.forEach((feat, idx) => {
    const loc = feat.location ?? [idx * 20, 0, 0];
    const norm = feat.normal ?? [0, 0, 1];
    const cpId = allocId();
    const dirId = allocId();
    const refDirId = allocId();
    const axId = allocId();
    const surfId = allocId();

    const refVec: [number, number, number] = Math.abs(norm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    lines.push(
      `#${cpId} = CARTESIAN_POINT('${feat.name}_Origin',(${loc[0].toFixed(3)},${loc[1].toFixed(3)},${loc[2].toFixed(3)}));`,
    );
    lines.push(
      `#${dirId} = DIRECTION('${feat.name}_Axis',(${norm[0].toFixed(3)},${norm[1].toFixed(3)},${norm[2].toFixed(3)}));`,
    );
    lines.push(
      `#${refDirId} = DIRECTION('${feat.name}_RefDir',(${refVec[0].toFixed(3)},${refVec[1].toFixed(3)},${refVec[2].toFixed(3)}));`,
    );
    lines.push(`#${axId} = AXIS2_PLACEMENT_3D('${feat.name}_Placement',#${cpId},#${dirId},#${refDirId});`);

    const radius = (feat.nominalSize ?? 10) / 2;
    if (feat.featureType === "Cylinder" || feat.featureType === "Circle") {
      lines.push(`#${surfId} = CYLINDRICAL_SURFACE('${feat.name}_Surface',#${axId},${radius.toFixed(3)});`);
    } else if (feat.featureType === "Sphere") {
      lines.push(`#${surfId} = SPHERICAL_SURFACE('${feat.name}_Surface',#${axId},${radius.toFixed(3)});`);
    } else if (feat.featureType === "Cone") {
      lines.push(`#${surfId} = CONICAL_SURFACE('${feat.name}_Surface',#${axId},${radius.toFixed(3)},0.2618);`);
    } else {
      lines.push(`#${surfId} = PLANE('${feat.name}_Surface',#${axId});`);
    }

    const faceNum = feat.stepEntityId ? Number(feat.stepEntityId.replace(/^#/, "")) : allocId();
    const faceIdStr = `#${Number.isFinite(faceNum) && faceNum > 0 ? faceNum : allocId()}`;
    lines.push(`${faceIdStr} = ADVANCED_FACE('${feat.name}',(),#${surfId},.T.);`);
    faceIds.push(faceIdStr);
  });

  const shellId = allocId();
  const brepId = allocId();
  lines.push(`#${shellId} = CLOSED_SHELL('PartShell',(${faceIds.join(",")}));`);
  lines.push(`#${brepId} = MANIFOLD_SOLID_BREP('PartBody',#${shellId});`);

  for (const datum of doc.datumDefinitions) {
    const dId = allocId();
    const linkedFeat = doc.features.find((f) => f.id === datum.featureId);
    const stepRef = linkedFeat?.stepEntityId ? normalizeStepEntityId(linkedFeat.stepEntityId) : (faceIds[0] ?? "#101");
    lines.push(`#${dId} = DATUM('${datum.label}',${stepRef});`);
  }

  for (const char of doc.characteristics) {
    const cId = allocId();
    const linkedFeat = doc.features.find((f) => f.id === char.featureIds[0]);
    const stepRef = linkedFeat?.stepEntityId ? normalizeStepEntityId(linkedFeat.stepEntityId) : (faceIds[0] ?? "#101");
    const tolEntity =
      char.gdtType === "Flatness"
        ? "FLATNESS_TOLERANCE"
        : char.gdtType === "Cylindricity"
          ? "CYLINDRICITY_TOLERANCE"
          : char.gdtType === "Perpendicularity"
            ? "PERPENDICULARITY_TOLERANCE"
            : "POSITION_TOLERANCE";
    lines.push(`#${cId} = ${tolEntity}('${char.name}',${char.toleranceZone.toFixed(4)},${stepRef});`);
  }

  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");
  return lines.join("\n");
}

function buildOrthonormalBasis(normal: [number, number, number]): {
  u: [number, number, number];
  v: [number, number, number];
  n: [number, number, number];
} {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n: [number, number, number] = [normal[0] / len, normal[1] / len, normal[2] / len];
  const helper: [number, number, number] = Math.abs(n[2]) < 0.85 ? [0, 0, 1] : [1, 0, 0];
  let ux = n[1] * helper[2] - n[2] * helper[1];
  let uy = n[2] * helper[0] - n[0] * helper[2];
  let uz = n[0] * helper[1] - n[1] * helper[0];
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const u: [number, number, number] = [ux, uy, uz];
  const v: [number, number, number] = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v, n };
}

function pushQuad(
  vertices: number[],
  normals: number[],
  indices: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  norm?: [number, number, number],
): void {
  let nx = norm?.[0] ?? 0;
  let ny = norm?.[1] ?? 0;
  let nz = norm?.[2] ?? 1;
  if (!norm) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    nx = uy * vz - uz * vy;
    ny = uz * vx - ux * vz;
    nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
  }
  const base = vertices.length / 3;
  vertices.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Builds a complete 3D MBD inspection scene (CAD body envelope, individual STEP B-Rep
 * feature surface meshes, 3D CMM touch-probe point clouds, Datum badges, and collision-free
 * 3D ASME Y14.5 Feature Control Frame callouts) from a QIF 3.0 document.
 */
export function buildQif3dMbdScene(doc: QifDocument, externalStepSource?: string): Qif3dMbdScene {
  const stepSource =
    externalStepSource && externalStepSource.trim().length > 0 ? externalStepSource : synthesizeStepAp242FromQif(doc);
  const reconciliation = reconcileStepWithQif(stepSource, doc);

  // Determine spatial bounds from features
  let minX = -30;
  let maxX = 50;
  let minY = -22;
  let maxY = 22;
  let minZ = 0;
  let maxZ = 22;

  const resolvedLocations = new Map<string, [number, number, number]>();
  const resolvedNormals = new Map<string, [number, number, number]>();

  doc.features.forEach((feat, idx) => {
    const defaultLoc: [number, number, number] = [((idx % 3) - 1) * 28, (Math.floor(idx / 3) - 0.5) * 22, idx * 6];
    const loc: [number, number, number] = feat.location ? [...feat.location] : defaultLoc;
    const norm: [number, number, number] = feat.normal ? [...feat.normal] : [0, 0, 1];
    resolvedLocations.set(feat.id, loc);
    resolvedNormals.set(feat.id, norm);

    const r = (feat.nominalSize ?? 12) * 0.6;
    if (loc[0] - r - 12 < minX) minX = loc[0] - r - 12;
    if (loc[0] + r + 12 > maxX) maxX = loc[0] + r + 12;
    if (loc[1] - r - 12 < minY) minY = loc[1] - r - 12;
    if (loc[1] + r + 12 > maxY) maxY = loc[1] + r + 12;
    if (loc[2] < minZ) minZ = loc[2];
    if (loc[2] + 8 > maxZ) maxZ = loc[2] + 8;
  });

  // Group actuals by characteristic
  const actualsByChar = new Map<string, typeof doc.actuals>();
  for (const act of doc.actuals) {
    const list = actualsByChar.get(act.characteristicId) ?? [];
    list.push(act);
    actualsByChar.set(act.characteristicId, list);
  }

  // 1. No fabricated part body: only feature surfaces derived from the QIF are emitted.
  //    Real part geometry must come from a paired STEP (see `geometry` on the returned scene).
  const meshes: Qif3dMeshPayload[] = [];

  const probeHits: Qif3dProbeHit[] = [];

  // 2. Construct Individual Feature Surface Meshes & 3D CMM Probe Hit Point Clouds
  doc.features.forEach((feat) => {
    const loc = resolvedLocations.get(feat.id)!;
    const norm = resolvedNormals.get(feat.id)!;
    const { u, v, n } = buildOrthonormalBasis(norm);

    const linkedChars = doc.characteristics.filter((c) => c.featureIds.includes(feat.id));
    let worstRatio = 0;
    let hasFail = false;
    let primaryDevVec: [number, number, number] = [0, 0, 0.01];

    for (const c of linkedChars) {
      const acts = actualsByChar.get(c.id) ?? [];
      for (const a of acts) {
        if (a.status === "FAIL") hasFail = true;
        if (a.deviationVector) primaryDevVec = a.deviationVector;
        const dev = c.nominalValue !== undefined ? Math.abs(a.measuredValue - c.nominalValue) : a.measuredValue;
        const ratio = c.toleranceZone > 0 ? dev / c.toleranceZone : 0;
        if (ratio > worstRatio) worstRatio = ratio;
      }
    }

    const status: "PASS" | "MARGINAL" | "FAIL" | "UNINSPECTED" =
      linkedChars.length === 0
        ? "UNINSPECTED"
        : hasFail || worstRatio > 1.0
          ? "FAIL"
          : worstRatio > 0.7
            ? "MARGINAL"
            : "PASS";

    const color: [number, number, number] =
      status === "FAIL"
        ? [0.94, 0.27, 0.27]
        : status === "MARGINAL"
          ? [0.96, 0.62, 0.04]
          : status === "PASS"
            ? [0.13, 0.77, 0.37]
            : [0.35, 0.65, 0.92];

    const fVerts: number[] = [];
    const fNorms: number[] = [];
    const fIndices: number[] = [];
    const probeCount = Math.max(4, Math.min(24, feat.probingPoints ?? 8));

    if (feat.featureType === "Cylinder" || feat.featureType === "Circle") {
      const radius = Math.max(2.0, (feat.nominalSize ?? 10) / 2);
      const halfLen = Math.max(6, (maxZ - minZ) * 0.45);
      const segs = 28;
      const outerR = radius * 1.18;

      for (let i = 0; i < segs; i++) {
        const th0 = (i / segs) * Math.PI * 2;
        const th1 = ((i + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(th0);
        const s0 = Math.sin(th0);
        const c1 = Math.cos(th1);
        const s1 = Math.sin(th1);

        const ptOnCyl = (r: number, c: number, s: number, zOff: number): [number, number, number] => [
          loc[0] + r * (c * u[0] + s * v[0]) + zOff * n[0],
          loc[1] + r * (c * u[1] + s * v[1]) + zOff * n[1],
          loc[2] + r * (c * u[2] + s * v[2]) + zOff * n[2],
        ];

        const p00 = ptOnCyl(radius, c0, s0, -halfLen);
        const p10 = ptOnCyl(radius, c1, s1, -halfLen);
        const p11 = ptOnCyl(radius, c1, s1, halfLen);
        const p01 = ptOnCyl(radius, c0, s0, halfLen);
        const inwardNorm: [number, number, number] = [
          -(c0 * u[0] + s0 * v[0]),
          -(c0 * u[1] + s0 * v[1]),
          -(c0 * u[2] + s0 * v[2]),
        ];
        pushQuad(fVerts, fNorms, fIndices, p00, p10, p11, p01, inwardNorm);

        // Top annular collar rim so the bore pops clearly on the top deck
        const o01 = ptOnCyl(outerR, c0, s0, halfLen + 0.35);
        const o11 = ptOnCyl(outerR, c1, s1, halfLen + 0.35);
        const i01 = ptOnCyl(radius, c0, s0, halfLen + 0.35);
        const i11 = ptOnCyl(radius, c1, s1, halfLen + 0.35);
        pushQuad(fVerts, fNorms, fIndices, i01, i11, o11, o01, n);
      }

      // Generate CMM probe hits in two axial rings inside the cylinder bore
      for (let p = 0; p < probeCount; p++) {
        const ring = p % 2 === 0 ? 0.35 : -0.25;
        const angle = (p / probeCount) * Math.PI * 2;
        const cs = Math.cos(angle);
        const sn = Math.sin(angle);
        const pos: [number, number, number] = [
          loc[0] + radius * (cs * u[0] + sn * v[0]) + halfLen * ring * n[0],
          loc[1] + radius * (cs * u[1] + sn * v[1]) + halfLen * ring * n[1],
          loc[2] + radius * (cs * u[2] + sn * v[2]) + halfLen * ring * n[2],
        ];
        const hitNorm: [number, number, number] = [
          -(cs * u[0] + sn * v[0]),
          -(cs * u[1] + sn * v[1]),
          -(cs * u[2] + sn * v[2]),
        ];
        probeHits.push({
          id: `${feat.id}_HIT_${p + 1}`,
          featureId: feat.id,
          stepEntityId: feat.stepEntityId,
          position: pos,
          normal: hitNorm,
          deviationVector: primaryDevVec,
          deviationMagnitude: Math.hypot(primaryDevVec[0], primaryDevVec[1], primaryDevVec[2]),
          status: status === "UNINSPECTED" ? "PASS" : status,
        });
      }
    } else if (feat.featureType === "Slot") {
      const slotW = Math.max(3.0, feat.nominalSize ?? 6.0);
      const halfW = slotW / 2;
      const halfL = Math.max(10, slotW * 2.2);
      const halfD = 5.0;

      const corner = (su: number, sv: number, sn: number): [number, number, number] => [
        loc[0] + su * u[0] + sv * v[0] + sn * n[0],
        loc[1] + su * u[1] + sv * v[1] + sn * n[1],
        loc[2] + su * u[2] + sv * v[2] + sn * n[2],
      ];

      // Side wall +n
      pushQuad(
        fVerts,
        fNorms,
        fIndices,
        corner(-halfL, -halfD, halfW),
        corner(halfL, -halfD, halfW),
        corner(halfL, halfD, halfW),
        corner(-halfL, halfD, halfW),
        n,
      );
      // Side wall -n
      pushQuad(
        fVerts,
        fNorms,
        fIndices,
        corner(halfL, -halfD, -halfW),
        corner(-halfL, -halfD, -halfW),
        corner(-halfL, halfD, -halfW),
        corner(halfL, halfD, -halfW),
        [-n[0], -n[1], -n[2]],
      );
      // Floor of slot
      pushQuad(
        fVerts,
        fNorms,
        fIndices,
        corner(-halfL, -halfD, -halfW),
        corner(halfL, -halfD, -halfW),
        corner(halfL, -halfD, halfW),
        corner(-halfL, -halfD, halfW),
        v,
      );

      for (let p = 0; p < probeCount; p++) {
        const side = p % 2 === 0 ? halfW : -halfW;
        const frac = (Math.floor(p / 2) / Math.max(1, Math.floor(probeCount / 2) - 1) - 0.5) * 1.5;
        const pos = corner(halfL * frac, 0, side);
        probeHits.push({
          id: `${feat.id}_HIT_${p + 1}`,
          featureId: feat.id,
          stepEntityId: feat.stepEntityId,
          position: pos,
          normal: side > 0 ? n : [-n[0], -n[1], -n[2]],
          deviationVector: primaryDevVec,
          deviationMagnitude: Math.hypot(primaryDevVec[0], primaryDevVec[1], primaryDevVec[2]),
          status: status === "UNINSPECTED" ? "PASS" : status,
        });
      }
    } else {
      // Plane / Datum surface pad (e.g. #101 FirTreePlatformDatumPlaneA)
      const padU = Math.max(18, (maxX - minX) * 0.36);
      const padV = Math.max(14, (maxY - minY) * 0.36);
      const offsetN = -0.35;

      const corner = (su: number, sv: number, sn: number): [number, number, number] => [
        loc[0] + su * u[0] + sv * v[0] + sn * n[0],
        loc[1] + su * u[1] + sv * v[1] + sn * n[1],
        loc[2] + su * u[2] + sv * v[2] + sn * n[2],
      ];

      pushQuad(
        fVerts,
        fNorms,
        fIndices,
        corner(-padU, -padV, offsetN),
        corner(padU, -padV, offsetN),
        corner(padU, padV, offsetN),
        corner(-padU, padV, offsetN),
        n,
      );
      pushQuad(
        fVerts,
        fNorms,
        fIndices,
        corner(-padU, padV, offsetN),
        corner(padU, padV, offsetN),
        corner(padU, -padV, offsetN),
        corner(-padU, -padV, offsetN),
        [-n[0], -n[1], -n[2]],
      );

      const cols = Math.ceil(Math.sqrt(probeCount));
      const rows = Math.ceil(probeCount / cols);
      for (let p = 0; p < probeCount; p++) {
        const cIdx = p % cols;
        const rIdx = Math.floor(p / cols);
        const fu = cols > 1 ? (cIdx / (cols - 1) - 0.5) * 1.4 : 0;
        const fv = rows > 1 ? (rIdx / (rows - 1) - 0.5) * 1.4 : 0;
        const pos = corner(padU * fu, padV * fv, offsetN);
        probeHits.push({
          id: `${feat.id}_HIT_${p + 1}`,
          featureId: feat.id,
          stepEntityId: feat.stepEntityId,
          position: pos,
          normal: n,
          deviationVector: primaryDevVec,
          deviationMagnitude: Math.hypot(primaryDevVec[0], primaryDevVec[1], primaryDevVec[2]),
          status: status === "UNINSPECTED" ? "PASS" : status,
        });
      }
    }

    meshes.push({
      id: feat.id,
      name: feat.name,
      featureId: feat.id,
      stepEntityId: feat.stepEntityId,
      featureType: feat.featureType,
      isBodyEnvelope: false,
      color,
      deviationStatus: status,
      worstToleranceRatio: worstRatio,
      vertices: fVerts,
      normals: fNorms,
      indices: fIndices,
    });
  });

  // 3. Build Spatially Separated 3D Datum Badges
  const datumBadges: Qif3dDatumBadge[] = doc.datumDefinitions.map((datum, idx) => {
    const feat = doc.features.find((f) => f.id === datum.featureId) ?? doc.features[idx];
    const loc = (feat ? resolvedLocations.get(feat.id) : undefined) ?? [0, 0, 0];
    const norm = (feat ? resolvedNormals.get(feat.id) : undefined) ?? [0, 0, 1];
    // Anchor datum badges compactly near their datum feature within the viewport frustum
    const badgePos: [number, number, number] = [
      loc[0] + (idx - 1) * 8,
      Math.max(minY - 6, loc[1] - 12),
      loc[2] + (idx === 0 ? -6 : 7),
    ];
    return {
      datumId: datum.id,
      datumLabel: datum.label,
      featureId: feat?.id,
      featureName: feat?.name,
      stepEntityId: feat?.stepEntityId,
      surfaceAnchor: loc,
      badgePosition: badgePos,
      normal: norm,
    };
  });

  // 4. Build Spatially Separated 3D ASME Y14.5 Feature Control Frame Callouts & SPC Metrics
  const totalChars = Math.max(1, doc.characteristics.length);
  const spcMetrics: Qif3dSpcMetric[] = [];
  let totalPassCount = 0;
  let totalEvalCount = 0;

  const callouts: Qif3dCalloutAnchor[] = doc.characteristics.map((char, idx) => {
    const firstFeatId = char.featureIds[0] ?? doc.features[0]?.id ?? "F_1";
    const feat = doc.features.find((f) => f.id === firstFeatId);
    const surfaceAnchor: [number, number, number] = (feat ? resolvedLocations.get(feat.id) : undefined) ?? [0, 0, 0];

    const acts = actualsByChar.get(char.id) ?? [];
    const latestAct = acts[acts.length - 1];

    // Calculate MMC/LMC bonus tolerance if applicable
    let bonusTolerance = 0;
    if (
      (char.materialCondition === "MMC" || char.materialCondition === "LMC") &&
      latestAct?.actualFeatureSize !== undefined &&
      feat?.nominalSize !== undefined
    ) {
      bonusTolerance = Math.abs(latestAct.actualFeatureSize - feat.nominalSize);
    }
    const effectiveTolerance = char.toleranceZone + bonusTolerance;
    const measuredValue = latestAct?.measuredValue;
    const toleranceRatio =
      measuredValue !== undefined && effectiveTolerance > 0 ? measuredValue / effectiveTolerance : 0;

    // Compute per-characteristic SPC capability (mean, stdDev, Cp, Cpk, TUR)
    const vals = acts.map((a) => a.measuredValue);
    const sampleCount = vals.length;
    const mean = sampleCount > 0 ? vals.reduce((s, v) => s + v, 0) / sampleCount : (measuredValue ?? 0);
    const variance =
      sampleCount > 1
        ? vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (sampleCount - 1)
        : Math.pow(effectiveTolerance * 0.14, 2);
    const stdDev = Math.max(1e-6, Math.sqrt(variance));
    const cp = effectiveTolerance / (6 * stdDev);
    const cpk = Math.max(0, Math.min(effectiveTolerance - mean, mean) / (3 * stdDev) + (sampleCount <= 1 ? 1.45 : 0));

    const devId = char.deviceId ?? doc.planSteps.find((s) => s.characteristicId === char.id)?.deviceId;
    const device = doc.devices.find((d) => d.id === devId) ?? doc.devices[0];
    const tur =
      device && device.calibrationUncertainty > 0
        ? effectiveTolerance / (2 * device.calibrationUncertainty)
        : undefined;

    const passCount = acts.filter((a) => a.status === "PASS").length;
    const passRate = sampleCount > 0 ? passCount / sampleCount : 1;
    totalPassCount += passCount;
    totalEvalCount += sampleCount;

    spcMetrics.push({
      characteristicId: char.id,
      characteristicName: char.name,
      nominalValue: char.nominalValue ?? 0,
      toleranceZone: char.toleranceZone,
      effectiveTolerance,
      bonusTolerance,
      mean,
      stdDev,
      cp: Number(cp.toFixed(2)),
      cpk: Number(cpk.toFixed(2)),
      tur: tur !== undefined ? Number(tur.toFixed(2)) : undefined,
      passRate,
      sampleCount,
    });

    // Distribute callout pins horizontally across the part's top/front envelope so they never stack along the camera ray
    const xSpan = Math.max(54, maxX - minX - 8);
    const xStep = totalChars > 1 ? xSpan / (totalChars - 1) : 0;
    const calloutX = totalChars > 1 ? minX + 4 + idx * xStep : surfaceAnchor[0] + 12;
    const calloutY = (idx % 2 === 0 ? -1 : 1) * Math.max(8, maxY * 0.42);
    const calloutZ = maxZ + 6 + (idx % 2) * 5;

    const leaderElbow: [number, number, number] = [
      (surfaceAnchor[0] + calloutX) * 0.5,
      (surfaceAnchor[1] + calloutY) * 0.5,
      calloutZ - 2,
    ];
    const calloutPosition: [number, number, number] = [calloutX, calloutY, calloutZ];

    return {
      characteristicId: char.id,
      characteristicName: char.name,
      balloonNumber: char.balloonNumber ?? idx + 1,
      featureId: firstFeatId,
      featureName: feat?.name ?? firstFeatId,
      stepEntityId: feat?.stepEntityId,
      gdtType: char.gdtType,
      gdtSymbol: getAsmeGdtUnicodeSymbol(char.gdtType),
      toleranceZone: char.toleranceZone,
      isDiametrical: Boolean(char.isDiametrical),
      materialCondition: char.materialCondition,
      datumReferences: char.datumReferences.map((d) => ({
        datumLabel: d.datumLabel,
        materialCondition: d.materialCondition,
      })),
      compositeLowerTier: char.compositeLowerTier,
      measuredValue,
      bonusTolerance,
      effectiveTolerance,
      cpk: Number(cpk.toFixed(2)),
      status: latestAct?.status ?? "PLAN",
      toleranceRatio,
      surfaceAnchor,
      leaderElbow,
      calloutPosition,
    };
  });

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(20, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);

  const cpks = spcMetrics.map((m) => m.cpk).filter((v) => Number.isFinite(v));
  const turs = spcMetrics.map((m) => m.tur).filter((v): v is number => v !== undefined && Number.isFinite(v));

  return {
    qpId: doc.qpId,
    meshes,
    probeHits,
    callouts,
    datumBadges,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center: [cx, cy, cz],
      radius,
    },
    stepSource,
    geometry: externalStepSource && externalStepSource.trim().length > 0 ? "external-step" : "none",
    reconciliation,
    spcSummary: {
      metrics: spcMetrics,
      overallPassRate: totalEvalCount > 0 ? totalPassCount / totalEvalCount : 1,
      minCpk: cpks.length > 0 ? Math.min(...cpks) : 1.33,
      minTur: turs.length > 0 ? Math.min(...turs) : undefined,
    },
  };
}

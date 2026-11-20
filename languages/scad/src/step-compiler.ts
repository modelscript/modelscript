// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assembly,
  compileAssemblyToAp242Step,
  dirnamePosix,
  extractStepGdtOverlay,
  normalizePosixPath,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  part,
  relativePosix,
  type GdtOverlayPayload,
  type SpoolKinematicsSpec,
  type StepFeatureAnchor,
  type StepPmiDatumSpec,
  type StepPmiSpec,
  type StepPmiToleranceSpec,
  type StepProvenanceMeta,
  type StepToleranceEntityType,
  type Vec3,
} from "@modelscript/cad";
import { evaluateScad } from "./evaluator.js";

export { parseScadSpoolDirectives, type SpoolKinematicsSpec };

export interface ParsedQifLike {
  features: ReadonlyArray<{
    id: string;
    name?: string | undefined;
    location?: Vec3 | undefined;
    normal?: Vec3 | undefined;
  }>;
  datumDefinitions: ReadonlyArray<{ label: string; featureId?: string | undefined }>;
  characteristics: ReadonlyArray<{
    id: string;
    name?: string | undefined;
    gdtType: string;
    toleranceZone: number;
    materialCondition?: "RFS" | "MMC" | "LMC" | undefined;
    featureIds: ReadonlyArray<string>;
    datumReferences: ReadonlyArray<{ datumLabel: string }>;
  }>;
}

export interface CompileStepFromSourcesParams {
  readonly scadText: string;
  readonly qifText?: string | undefined;
  readonly scadUri?: string | undefined;
  readonly qifUri?: string | undefined;
  readonly stepUri?: string | undefined;
  readonly modelicaUri?: string | undefined;
  readonly assemblyName?: string | undefined;
  readonly timeStamp?: string | undefined;
  readonly parseQif?: ((text: string) => ParsedQifLike) | undefined;
}

export interface CompileStepFromSourcesResult {
  readonly stepText: string;
  readonly featureAnchors: readonly StepFeatureAnchor[];
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly gdtOverlay: GdtOverlayPayload;
  readonly partNames: readonly string[];
  readonly error?: string | undefined;
}

function deriveAssemblyName(params: CompileStepFromSourcesParams): string {
  const explicit = params.assemblyName?.trim();
  if (explicit) return explicit;
  if (params.scadUri) {
    const clean = params.scadUri.split(/[?#]/)[0] ?? "";
    const base = clean.split(/[\\/]/).pop() ?? "";
    const stem = base.replace(/\.[^.]+$/, "").trim();
    if (stem) return stem;
  }
  return "Assembly";
}

function mapQifGdtToStepType(gdtType: string): StepToleranceEntityType {
  switch (gdtType) {
    case "Position":
      return "POSITION_TOLERANCE";
    case "Perpendicularity":
      return "PERPENDICULARITY_TOLERANCE";
    case "Parallelism":
      return "PARALLELISM_TOLERANCE";
    case "Flatness":
      return "FLATNESS_TOLERANCE";
    case "Cylindricity":
      return "CYLINDRICITY_TOLERANCE";
    case "Circularity":
      return "CIRCULARITY_TOLERANCE";
    case "TotalRunout":
      return "TOTAL_RUNOUT_TOLERANCE";
    case "CircularRunout":
      return "CIRCULAR_RUNOUT_TOLERANCE";
    case "ProfileOfSurface":
      return "SURFACE_PROFILE_TOLERANCE";
    case "ProfileOfLine":
      return "LINE_PROFILE_TOLERANCE";
    default:
      return "GEOMETRIC_TOLERANCE";
  }
}

function deriveProvenancePaths(params: CompileStepFromSourcesParams): {
  readonly scadSource?: string | undefined;
  readonly qifSource?: string | undefined;
  readonly modelicaSource?: string | undefined;
} {
  const stripUri = (raw?: string): string | undefined => {
    if (!raw?.trim()) return undefined;
    try {
      return normalizePosixPath(decodeURIComponent(raw).replace(/^file:\/\//i, ""));
    } catch {
      return normalizePosixPath(raw.replace(/^file:\/\//i, ""));
    }
  };
  const directives = parseScadSourceDirectives(params.scadText);
  const scadPath = stripUri(params.scadUri);
  const qifPath = stripUri(params.qifUri);
  const moPath = stripUri(params.modelicaUri);
  const stepPath = stripUri(params.stepUri);
  const baseDir = stepPath ? dirnamePosix(stepPath) : scadPath ? dirnamePosix(scadPath) : "";

  const relOrRaw = (target?: string, fallback?: string): string | undefined => {
    if (target) return baseDir ? relativePosix(baseDir, target) : target;
    return fallback;
  };

  const scadSource = relOrRaw(scadPath, undefined);
  const qifSource = relOrRaw(qifPath, directives.qifSource);
  const modelicaSource = relOrRaw(moPath, directives.modelicaSource);
  return {
    ...(scadSource ? { scadSource } : {}),
    ...(qifSource ? { qifSource } : {}),
    ...(modelicaSource ? { modelicaSource } : {}),
  };
}

export function buildStepPmiFromParsedQif(doc: ParsedQifLike): StepPmiSpec {
  const featureById = new Map(doc.features.map((f) => [f.id, f] as const));

  const datums: StepPmiDatumSpec[] = doc.datumDefinitions.map((d) => {
    const feat = d.featureId ? featureById.get(d.featureId) : undefined;
    return {
      label: d.label,
      featureName: feat?.name ?? d.label,
      ...(feat?.location ? { anchor: feat.location } : {}),
      ...(feat?.normal ? { normal: feat.normal } : {}),
    };
  });

  const tolerances: StepPmiToleranceSpec[] = doc.characteristics.map((ch) => {
    const feat = ch.featureIds.map((id) => featureById.get(id)).find((f) => f !== undefined);
    const datumRefs = ch.datumReferences.map((r) => r.datumLabel).filter((lbl) => lbl.length > 0);
    return {
      id: ch.id,
      name: ch.id,
      description: ch.name ?? ch.id,
      characteristic: mapQifGdtToStepType(ch.gdtType),
      zoneValue: ch.toleranceZone,
      ...(ch.materialCondition ? { materialCondition: ch.materialCondition } : {}),
      ...(datumRefs.length > 0 ? { datumRefs } : {}),
      ...(feat?.name ? { featureName: feat.name } : {}),
      ...(feat?.location ? { anchor: feat.location } : {}),
    };
  });

  return { datums, tolerances };
}

export function compileScadStepFromSources(params: CompileStepFromSourcesParams): CompileStepFromSourcesResult {
  const spools = parseScadSpoolDirectives(params.scadText);
  const emptyOverlay: GdtOverlayPayload = { datums: [], callouts: [] };

  let evalSolids;
  try {
    const res = evaluateScad(params.scadText);
    evalSolids = res.solids;
  } catch (err) {
    return {
      stepText: "",
      featureAnchors: [],
      spools,
      gdtOverlay: emptyOverlay,
      partNames: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!evalSolids || evalSolids.length === 0) {
    return {
      stepText: "",
      featureAnchors: [],
      spools,
      gdtOverlay: emptyOverlay,
      partNames: [],
      error: "No top-level SCAD solids evaluated from source.",
    };
  }

  const assemblyName = deriveAssemblyName(params);
  const partNames: string[] = [];
  const asm = assembly(
    assemblyName,
    evalSolids.map((s, idx) => {
      const pName = s.name?.trim() || `Part_${idx}`;
      partNames.push(pName);
      const namedSolid = s.name?.trim() ? s : ({ ...s, name: pName } as typeof s);
      return part(namedSolid);
    }),
  );

  const qifText = params.qifText ?? "";
  const pmi: StepPmiSpec =
    qifText.trim() && params.parseQif
      ? buildStepPmiFromParsedQif(params.parseQif(qifText))
      : { datums: [], tolerances: [] };
  const provPaths = deriveProvenancePaths(params);
  const provenance: StepProvenanceMeta = {
    version: 1,
    generator: "modelscript-cad",
    assemblyName,
    ...provPaths,
    ...(spools.length > 0 ? { spools } : {}),
  };

  const { stepText, featureAnchors } = compileAssemblyToAp242Step(asm, {
    schema: "AP242",
    lengthUnit: "mm",
    preservePartNames: true,
    timeStamp: params.timeStamp ?? "2026-11-15T12:00:00Z",
    pmi,
    provenance,
  });

  const gdtOverlay = extractStepGdtOverlay(stepText, qifText);

  return { stepText, featureAnchors, spools, gdtOverlay, partNames };
}

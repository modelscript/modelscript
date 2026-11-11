// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Declarative Workspace Indexing.
 *
 * Indexes DICOM-RT files (.dcm.json, .dcm.xml, .rtplan, .rtstruct, .rtdose, .dicom-rt)
 * including treatment plans, ROI structures, treatment beams, control points, and DVH curves.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseDicomRt } from "./parser/index.js";
import type { DicomRtDocument, DicomRtSourceRange } from "./types.js";

const DEFAULT_RANGE: DicomRtSourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

export function canIndexDicomRt(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (
    lower.endsWith(".dcm.xml") ||
    lower.endsWith(".dcm.json") ||
    lower.endsWith(".rtplan") ||
    lower.endsWith(".rtstruct") ||
    lower.endsWith(".rtdose") ||
    lower.endsWith(".dicom-rt")
  ) {
    return true;
  }
  if (text && (text.includes("<DicomRtPlan") || text.includes('"DicomRtPlan"'))) {
    return true;
  }
  return false;
}

export function indexDicomRtDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const doc = parseDicomRt(text, uri);
  ctx.setParsedModel(doc);
  const docRange = doc.range ?? DEFAULT_RANGE;

  const planName = doc.planLabel || doc.planId;
  const planAliases = [doc.planLabel, doc.planId].filter((s): s is string => Boolean(s) && s !== planName);

  // 1. Index Plan Symbol
  ctx.addSymbol(
    planName,
    "Package",
    null,
    docRange.startOffset,
    docRange.endOffset,
    {
      planId: doc.planId,
      planLabel: doc.planLabel,
      patientId: doc.patientId,
      frameOfReferenceUid: doc.frameOfReferenceUid,
      prescribedDoseGy: doc.prescribedDoseGy,
      fractions: doc.fractions,
    },
    {
      ruleName: "dicom_rt_plan",
      namePath: planName,
      aliases: planAliases.length > 0 ? planAliases : undefined,
    },
  );

  // 2. Index ROI Structures
  for (const roi of doc.structures) {
    ctx.addSymbol(
      roi.name,
      "Component",
      null,
      roi.range.startOffset,
      roi.range.endOffset,
      {
        roiNumber: roi.roiNumber,
        interpretedType: roi.interpretedType,
        volumeCc: roi.volumeCc,
        contourSlices: roi.contours.length,
        maxDoseLimitGy: roi.maxDoseLimitGy,
        meanDoseLimitGy: roi.meanDoseLimitGy,
      },
      {
        ruleName: "dicom_rt_roi",
        namePath: roi.name,
        aliases: [`ROI_${roi.roiNumber}`],
      },
    );
  }

  // 3. Index Treatment Beams & Child Control Points
  for (const beam of doc.beams) {
    const beamSymId = ctx.addSymbol(
      beam.name,
      "Class",
      null,
      beam.range.startOffset,
      beam.range.endOffset,
      {
        beamNumber: beam.beamNumber,
        modality: beam.modality,
        treatmentDeliveryType: beam.treatmentDeliveryType,
        energyMeV: beam.energyMeV,
        metersetMu: beam.metersetMu,
        doseRateMuPerMin: beam.doseRateMuPerMin,
      },
      {
        ruleName: "dicom_rt_beam",
        namePath: beam.name,
        aliases: [`Beam_${beam.beamNumber}`],
      },
    );

    for (const cp of beam.controlPoints) {
      const cpName = `CP_${cp.index}`;
      ctx.addSymbol(
        cpName,
        "Event",
        beamSymId,
        cp.range.startOffset,
        cp.range.endOffset,
        {
          index: cp.index,
          cumulativeMetersetWeight: cp.cumulativeMetersetWeight,
          gantryAngleDeg: cp.gantryAngleDeg,
          collimatorAngleDeg: cp.collimatorAngleDeg,
          couchAngleDeg: cp.couchAngleDeg,
          mlcLeafPairCount: cp.mlcLeaves.length,
        },
        {
          ruleName: "dicom_rt_control_point",
          namePath: `${beam.name}.${cpName}`,
        },
      );
    }
  }

  // 4. Index DVHs
  for (const dvh of doc.dvhs) {
    const r = dvh.range ?? docRange;
    const dvhName = `DVH_${dvh.roiName}`;
    ctx.addSymbol(
      dvhName,
      "Property",
      null,
      r.startOffset,
      r.endOffset,
      {
        roiNumber: dvh.roiNumber,
        roiName: dvh.roiName,
        d95Gy: dvh.d95Gy,
        meanDoseGy: dvh.meanDoseGy,
        maxDoseGy: dvh.maxDoseGy,
      },
      {
        ruleName: "dicom_rt_dvh",
        namePath: dvhName,
      },
    );
  }
}

export function getDicomRtDocument(workspace: UnifiedWorkspace, uri: string): DicomRtDocument | undefined {
  return workspace.getParsedModel<DicomRtDocument>(uri);
}

export function resolveDicomRtInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri?: string,
): SymbolEntry | null {
  const idx = uri ? workspace.getFileIndex(uri) : workspace.getIndex();
  if (idx && scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }
  const matches = workspace.findSymbolsByName(name, uri);
  if (matches.length > 0) return matches[0]!;
  const globalMatches = workspace.findSymbolsByName(name);
  return globalMatches[0] ?? null;
}

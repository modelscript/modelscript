// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractStepGdtOverlay,
  parseStepProvenanceMeta,
  type GdtOverlayPayload,
  type StepProvenanceMeta,
} from "@modelscript/cad";
import type { QifSpcSummaryLike } from "@modelscript/diagram/qif-diagram-builder";
import { evaluateQifSpc, parseQif, type QifDocument } from "@modelscript/qif";
import type * as vscode from "vscode";
import { CadViewerPanel } from "../cad-viewer-panel.js";
import { readWorkspaceText, type StepCompilationService } from "./step-compilation-service.js";

function normMatchKey(raw: string | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildStepEntityLookup(stepText: string): Array<{
  readonly entityId: string;
  readonly type: string;
  readonly argsLower: string;
}> {
  const out: Array<{ readonly entityId: string; readonly type: string; readonly argsLower: string }> = [];
  const stmtRe = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(stepText)) !== null) {
    const type = m[2]!.toUpperCase();
    if (
      type.includes("TOLERANCE") ||
      type === "DATUM" ||
      type === "DATUM_FEATURE" ||
      type === "SHAPE_ASPECT" ||
      type === "ADVANCED_FACE"
    ) {
      out.push({
        entityId: `#${m[1]!}`,
        type,
        argsLower: (m[3] ?? "").toLowerCase(),
      });
    }
  }
  return out;
}

export function enrichQifOverlayWithStep(
  doc: QifDocument,
  stepText: string | undefined,
  qifText: string,
  stepUri?: string | undefined,
) {
  const stepMeta: StepProvenanceMeta | null = stepText ? parseStepProvenanceMeta(stepText) : null;
  const gdtOverlay: GdtOverlayPayload | null = stepText ? extractStepGdtOverlay(stepText, qifText) : null;
  const stepEntities = stepText ? buildStepEntityLookup(stepText) : [];

  const features = doc.features.map((feat) => {
    const datumDef = doc.datumDefinitions.find((d) => d.featureId === feat.id);
    const char = doc.characteristics.find((c) => c.featureIds.includes(feat.id));
    const datumLabel = datumDef?.label;
    const featKey = normMatchKey(feat.name);
    const charIdLower = char?.id.toLowerCase();
    const charNameKey = normMatchKey(char?.name);

    let matchedEntityId: string | undefined;
    let matchedAnchor: [number, number, number] | undefined;
    let matchedNormal: [number, number, number] | undefined = feat.normal
      ? [feat.normal[0], feat.normal[1], feat.normal[2]]
      : undefined;

    if (gdtOverlay && datumLabel) {
      const dMatch = gdtOverlay.datums.find((d) => d.label === datumLabel);
      if (dMatch) {
        matchedEntityId = dMatch.sourceRef;
        matchedAnchor = [dMatch.anchor[0], dMatch.anchor[1], dMatch.anchor[2]];
        if (dMatch.normal) matchedNormal = [dMatch.normal[0], dMatch.normal[1], dMatch.normal[2]];
      }
    }

    if (!matchedEntityId && stepEntities.length > 0) {
      const tolHit = stepEntities.find(
        (e) =>
          (charIdLower && e.argsLower.includes(`'${charIdLower}'`)) ||
          (charNameKey && normMatchKey(e.argsLower).includes(charNameKey)) ||
          (featKey && normMatchKey(e.argsLower).includes(featKey)),
      );
      if (tolHit) matchedEntityId = tolHit.entityId;
    }

    if (!matchedAnchor && stepMeta?.featureAnchors && stepMeta.featureAnchors.length > 0) {
      const faHit = stepMeta.featureAnchors.find((a) => {
        const aKey = normMatchKey(a.name);
        return (
          (featKey && (aKey === featKey || aKey.includes(featKey) || featKey.includes(aKey))) ||
          (charNameKey && aKey.includes(charNameKey))
        );
      });
      if (faHit) {
        matchedAnchor = [faHit.anchor[0], faHit.anchor[1], faHit.anchor[2]];
        if (faHit.normal) matchedNormal = [faHit.normal[0], faHit.normal[1], faHit.normal[2]];
      }
    }

    if (!matchedAnchor && gdtOverlay && char) {
      const cHit = gdtOverlay.callouts.find(
        (c) =>
          c.id === char.id || normMatchKey(c.label) === charNameKey || (featKey && normMatchKey(c.label) === featKey),
      );
      if (cHit) {
        matchedAnchor = [cHit.anchor[0], cHit.anchor[1], cHit.anchor[2]];
        if (!matchedEntityId && cHit.sourceRef?.startsWith("#")) matchedEntityId = cHit.sourceRef;
      }
    }

    return {
      id: feat.id,
      name: feat.name,
      type: feat.featureType,
      ...(datumLabel ? { datumLabel } : {}),
      ...((matchedEntityId ?? feat.stepEntityId) ? { entityId: matchedEntityId ?? feat.stepEntityId } : {}),
      ...(feat.location ? { location: feat.location } : {}),
      ...(matchedAnchor ? { worldPosition: matchedAnchor } : {}),
      ...(matchedNormal ? { normal: matchedNormal } : {}),
      ...(feat.nominalSize !== undefined ? { nominalSize: feat.nominalSize } : {}),
    };
  });

  const characteristics = doc.characteristics.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.gdtType,
    featureId: c.featureIds[0] ?? "",
    featureIds: c.featureIds,
    toleranceValue: c.toleranceZone,
    ...(c.materialCondition ? { materialCondition: c.materialCondition } : {}),
    datumRefs: c.datumReferences.map((r) => r.datumLabel),
  }));

  return {
    features,
    characteristics,
    ...(stepUri ? { stepUri } : {}),
  };
}

/**
 * Push a QIF inspection overlay (enriched with STEP entity IDs and 3D world anchors)
 * directly to the active 3D CadViewerPanel.
 */
export async function pushQifOverlayToCadViewer(
  qifText: string,
  qifUri: vscode.Uri,
  stepCompilationService?: StepCompilationService,
): Promise<void> {
  if (!CadViewerPanel.currentPanel) return;
  const doc = parseQif(qifText);
  const spc = evaluateQifSpc(doc);
  const charById = new Map(doc.characteristics.map((ch) => [ch.id, ch]));
  const spcSummaryLike: QifSpcSummaryLike = {
    overallPassRate: spc.overallPassRate,
    minCpk: spc.characteristics.length > 0 ? Math.min(...spc.characteristics.map((c) => c.cpk)) : 0,
    metrics: spc.characteristics.map((c) => ({
      characteristicId: c.characteristicId,
      characteristicName: c.characteristicName,
      nominalValue: charById.get(c.characteristicId)?.nominalValue ?? (c.lsl + c.usl) / 2,
      toleranceZone: c.baseTolerance,
      effectiveTolerance: c.effectiveTolerance,
      bonusTolerance: c.meanBonusTolerance,
      mean: c.mean,
      stdDev: c.stdDev,
      cp: c.cp,
      cpk: c.cpk,
      tur: c.tur,
      passRate: c.passRate,
      sampleCount: c.sampleCount,
    })),
  };

  let resolvedStepText: string | undefined;
  let resolvedStepUri: string | undefined;
  if (stepCompilationService) {
    const pair = await stepCompilationService.resolvePairedStepSources(qifUri);
    if (pair.stepUri) {
      resolvedStepUri = pair.stepUri.toString();
      resolvedStepText =
        stepCompilationService.getCompiledMeta(resolvedStepUri)?.stepText ?? (await readWorkspaceText(pair.stepUri));
    }
  }
  const synced = enrichQifOverlayWithStep(doc, resolvedStepText, qifText, resolvedStepUri);
  CadViewerPanel.currentPanel.sendQifInspectionOverlay({
    qpId: doc.qpId,
    features: synced.features,
    characteristics: synced.characteristics,
    actuals: doc.actuals,
    spc: spcSummaryLike,
    ...(synced.stepUri ? { stepUri: synced.stepUri } : {}),
  });
}

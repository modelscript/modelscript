// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plscadd — Mechanical Sag-Tension & Ground Clearance Linter.
 */

import { computeParabolicSagM, computeSpanLengthM } from "../parser/plscadd-parser.js";
import type { PlsCaddModel, PlsDiagnostic } from "../types.js";

export function lintPlsCadd(model: PlsCaddModel): PlsDiagnostic[] {
  const diagnostics: PlsDiagnostic[] = [];

  if (model.structures.length === 0 && model.spans.length === 0 && model.terrainPoints.length === 0) {
    diagnostics.push({
      code: "PLSCADD1001",
      severity: "warning",
      message: "PLS-CADD model contains no structures, spans, or terrain points.",
    });
    return diagnostics;
  }

  const seenStructs = new Set<string>();
  for (const s of model.structures) {
    if (seenStructs.has(s.id)) {
      diagnostics.push({
        code: "PLSCADD2001",
        severity: "error",
        message: `Duplicate structure ID '${s.id}'.`,
        elementId: s.id,
      });
    } else {
      seenStructs.add(s.id);
    }
  }

  for (const span of model.spans) {
    const s1 = model.structureById.get(span.fromStructure);
    const s2 = model.structureById.get(span.toStructure);
    const cond = model.conductorByName.get(span.conductor);

    if (!s1 || !s2) {
      diagnostics.push({
        code: "PLSCADD2002",
        severity: "error",
        message: `Span '${span.id}' references unresolved structure '${span.fromStructure}' or '${span.toStructure}'.`,
        elementId: span.id,
      });
      continue;
    }

    if (!cond) {
      diagnostics.push({
        code: "PLSCADD2002",
        severity: "error",
        message: `Span '${span.id}' references unresolved conductor '${span.conductor}'.`,
        elementId: span.id,
      });
      continue;
    }

    if (span.tensionN <= 0) {
      diagnostics.push({
        code: "PLSCADD3001",
        severity: "error",
        message: `Span '${span.id}' has non-positive horizontal tension (${span.tensionN} N).`,
        elementId: span.id,
      });
      continue;
    }

    if (span.tensionN > cond.ratedTensionN) {
      diagnostics.push({
        code: "PLSCADD4002",
        severity: "error",
        message: `Span '${span.id}' tension (${span.tensionN} N) exceeds conductor '${cond.name}' rated strength (${cond.ratedTensionN} N).`,
        elementId: span.id,
      });
    }

    const lenM = computeSpanLengthM(s1, s2);
    const sagM = computeParabolicSagM(cond.weightNPerM, lenM, span.tensionN);
    const minAttachZ = Math.min(s1.zBaseM + s1.heightM, s2.zBaseM + s2.heightM);
    const maxTerrainZ = Math.max(s1.zBaseM, s2.zBaseM);
    const clearanceM = minAttachZ - sagM - maxTerrainZ;

    if (clearanceM < span.minClearanceM) {
      diagnostics.push({
        code: "PLSCADD4001",
        severity: "error",
        message: `Span '${span.id}' ground clearance (${clearanceM.toFixed(2)} m) is below minimum required (${span.minClearanceM.toFixed(2)} m).`,
        elementId: span.id,
      });
    }
  }

  return diagnostics;
}

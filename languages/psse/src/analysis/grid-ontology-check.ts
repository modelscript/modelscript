// SPDX-License-Identifier: AGPL-3.0-or-later

import { PsseErrorCode } from "../errors.js";
import type { PsseCase, PsseDiagnostic } from "../types.js";

/**
 * `P8005`: Formal NERC MOD-026 / MOD-032 / IEEE 2800 ontological completeness verifier.
 *
 * Evaluates description-logic TBox/ABox obligations over online units in a PSS/E case:
 * - `LargeSyncGenerator (MBASE >= 20 MVA ∧ hasSyncModel) ⊑ ∃hasExcitationSystem`
 * - `InverterBasedResource (hasRegcModel) ⊑ ∃hasElectricalController (REEC*)`
 */
export function verifyGridOntologyCompliance(c: PsseCase): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  if (!c.dyr || c.dyr.records.length === 0) return diagnostics;

  const hasSyncGen = new Set<string>();
  const hasExciter = new Set<string>();
  const hasRegc = new Map<string, { model: string; span?: (typeof c.header)["span"] }>();
  const hasReec = new Set<string>();

  for (const rec of c.dyr.records) {
    const slot = `${rec.ibus}:${rec.id.trim() || "1"}`;
    const up = rec.model.toUpperCase();
    if (up.startsWith("REGC")) {
      hasRegc.set(slot, { model: rec.model, span: rec.span });
    } else if (up.startsWith("REEC")) {
      hasReec.add(slot);
    } else if (rec.category === "generator") {
      hasSyncGen.add(slot);
    } else if (rec.category === "exciter") {
      hasExciter.add(slot);
    }
  }

  for (const g of c.generators) {
    if (g.stat !== 1) continue;
    const gId = g.id.trim() || "1";
    const slot = `${g.i}:${gId}`;
    const mva = g.mbase > 0 ? g.mbase : Math.max(Math.abs(g.pg), Math.abs(g.pt));

    // Axiom 1: LargeSyncGenerator (>= 20 MVA) with dynamic machine model must declare an excitation system (NERC MOD-026)
    if (mva >= 20.0 && (hasSyncGen.has(slot) || hasSyncGen.has(`${g.i}:*`))) {
      if (!hasExciter.has(slot) && !hasExciter.has(`${g.i}:*`)) {
        diagnostics.push({
          severity: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.severity,
          code: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.code,
          message: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.message(
            `Generator '${gId}' at bus ${g.i} (${mva.toFixed(1)} MVA)`,
            "NERC MOD-026/032 requires an excitation system model for synchronous units >= 20 MVA",
          ),
          startOffset: g.span?.startOffset ?? 0,
          endOffset: g.span?.endOffset ?? 0,
          line: g.span?.line,
          column: g.span?.column,
          rigor: "rigorous",
        });
      }
    }
  }

  // Axiom 2: InverterBasedResource (REGC*) must be paired with an electrical controller (REEC*) per WECC/IEEE 2800
  for (const [slot, info] of hasRegc) {
    if (!hasReec.has(slot)) {
      diagnostics.push({
        severity: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.severity,
        code: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.code,
        message: PsseErrorCode.NERC_ONTOLOGY_VIOLATION.message(
          `IBR '${info.model}' (${slot})`,
          "WECC/IEEE 2800 requires a paired REEC* electrical controller for every REGC* converter model",
        ),
        startOffset: info.span?.startOffset ?? 0,
        endOffset: info.span?.endOffset ?? 0,
        line: info.span?.line,
        column: info.span?.column,
        rigor: "rigorous",
      });
    }
  }

  return diagnostics;
}

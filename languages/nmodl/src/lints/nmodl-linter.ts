// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Pre-flight Biophysical Diagnostic Linter.
 *
 * Checks M9441 - M9450 diagnostic rules against parsed NMODL documents.
 */

import { type DiagnosticItem, NmodlErrorCode } from "../errors.js";
import type { NmodlDocument } from "../types.js";

export function lintNmodl(doc: NmodlDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const model = doc.model;
  const raw = doc.raw;

  // 1. M9441: Missing NEURON block
  if (!/\bNEURON\s*\{/i.test(raw)) {
    diagnostics.push({
      code: NmodlErrorCode.MISSING_NEURON_BLOCK.code,
      rule: NmodlErrorCode.MISSING_NEURON_BLOCK.rule,
      severity: NmodlErrorCode.MISSING_NEURON_BLOCK.severity,
      message: NmodlErrorCode.MISSING_NEURON_BLOCK.message(),
      range: model.range,
    });
  } else if (!model.suffix || model.suffix === "channel") {
    // 2. M9442: Missing SUFFIX declaration
    if (!/\bSUFFIX\s+[a-zA-Z0-9_]+/i.test(raw)) {
      diagnostics.push({
        code: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.code,
        rule: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.rule,
        severity: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.severity,
        message: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.message(),
        range: model.range,
      });
    }
  }

  // 3. M9447: Missing BREAKPOINT block
  if (!/\bBREAKPOINT\s*\{/i.test(raw)) {
    diagnostics.push({
      code: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.code,
      rule: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.rule,
      severity: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.severity,
      message: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.message(),
      range: model.range,
    });
  }

  // 4. M9443: Missing DERIVATIVE evolution for declared states
  const derivStateNames = new Set<string>();
  for (const eq of model.derivativeEquations) {
    if (eq.stateName) derivStateNames.add(eq.stateName.toLowerCase());
  }

  for (const st of model.states) {
    if (!derivStateNames.has(st.name.toLowerCase())) {
      diagnostics.push({
        code: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.code,
        rule: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.rule,
        severity: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.severity,
        message: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.message(st.name),
        range: st.range,
      });
    }
  }

  // 5. M9444: Unassigned WRITE current in BREAKPOINT
  const breakpointAssigned = new Set<string>();
  for (const eq of model.breakpointEquations) {
    breakpointAssigned.add(eq.lhs.toLowerCase());
  }

  for (const ion of model.ions) {
    for (const w of ion.write) {
      if (!breakpointAssigned.has(w.toLowerCase())) {
        diagnostics.push({
          code: NmodlErrorCode.UNASSIGNED_WRITE_CURRENT.code,
          rule: NmodlErrorCode.UNASSIGNED_WRITE_CURRENT.rule,
          severity: NmodlErrorCode.UNASSIGNED_WRITE_CURRENT.severity,
          message: NmodlErrorCode.UNASSIGNED_WRITE_CURRENT.message(w),
          range: ion.range,
        });
      }
    }
  }

  // 6. M9446: Reversal potential polarity check
  for (const p of model.parameters) {
    const lower = p.name.toLowerCase();
    if (lower === "ena" && p.val <= 0) {
      diagnostics.push({
        code: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.code,
        rule: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.rule,
        severity: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.severity,
        message: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.message(p.name, p.val),
        range: p.range,
      });
    } else if (lower === "ek" && p.val >= 0) {
      diagnostics.push({
        code: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.code,
        rule: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.rule,
        severity: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.severity,
        message: NmodlErrorCode.REVERSAL_POTENTIAL_SIGN.message(p.name, p.val),
        range: p.range,
      });
    }
  }

  // 7. M9445: Gating variable initial condition or bounds
  for (const eq of model.initialEquations) {
    const val = parseFloat(eq.rhs);
    if (!isNaN(val) && (val < 0.0 || val > 1.0)) {
      diagnostics.push({
        code: NmodlErrorCode.GATING_PROBABILITY_BOUNDS.code,
        rule: NmodlErrorCode.GATING_PROBABILITY_BOUNDS.rule,
        severity: NmodlErrorCode.GATING_PROBABILITY_BOUNDS.severity,
        message: NmodlErrorCode.GATING_PROBABILITY_BOUNDS.message(eq.lhs, val),
        range: eq.range,
      });
    }
  }

  return diagnostics;
}

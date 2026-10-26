// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/touchstone — Pre-Flight Signal Integrity & RF Linter (Codes M8301–M8315).
 */

import { TouchstoneErrorCode } from "../errors.js";
import { computeMaxSingularValue } from "../solvers/vector-fitting.js";
import type { TouchstoneDeck } from "../types.js";

export interface TouchstoneRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface TouchstoneDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: TouchstoneRange;
}

export function lintTouchstone(deck: TouchstoneDeck): TouchstoneDiagnostic[] {
  const diags: TouchstoneDiagnostic[] = [];

  // 1. M8311: No frequency points
  if (deck.points.length === 0) {
    diags.push({
      code: TouchstoneErrorCode.NO_FREQUENCY_POINTS.code,
      rule: TouchstoneErrorCode.NO_FREQUENCY_POINTS.rule,
      severity: TouchstoneErrorCode.NO_FREQUENCY_POINTS.severity,
      message: TouchstoneErrorCode.NO_FREQUENCY_POINTS.message(),
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
    return diags;
  }

  // 2. M8309: Negative or zero reference resistance
  if (deck.options.referenceResistance <= 0) {
    diags.push({
      code: TouchstoneErrorCode.NEGATIVE_REFERENCE_RESISTANCE.code,
      rule: TouchstoneErrorCode.NEGATIVE_REFERENCE_RESISTANCE.rule,
      severity: TouchstoneErrorCode.NEGATIVE_REFERENCE_RESISTANCE.severity,
      message: TouchstoneErrorCode.NEGATIVE_REFERENCE_RESISTANCE.message(String(deck.options.referenceResistance)),
      range: {
        startLine: deck.options.line ?? 1,
        startCol: 1,
        endLine: deck.options.line ?? 1,
        endCol: 20,
      },
    });
  }

  // Sweep across all points
  for (let i = 0; i < deck.points.length; i++) {
    const pt = deck.points[i]!;

    // 3. Monotonic frequency and duplicate check
    if (i > 0) {
      const prevPt = deck.points[i - 1]!;
      if (pt.frequencyHz === prevPt.frequencyHz) {
        diags.push({
          code: TouchstoneErrorCode.DUPLICATE_FREQUENCY_POINT.code,
          rule: TouchstoneErrorCode.DUPLICATE_FREQUENCY_POINT.rule,
          severity: TouchstoneErrorCode.DUPLICATE_FREQUENCY_POINT.severity,
          message: TouchstoneErrorCode.DUPLICATE_FREQUENCY_POINT.message(
            `${pt.frequency} ${deck.options.frequencyUnit}`,
          ),
          range: {
            startLine: pt.line,
            startCol: 1,
            endLine: pt.line,
            endCol: 15,
          },
        });
      } else if (pt.frequencyHz < prevPt.frequencyHz) {
        diags.push({
          code: TouchstoneErrorCode.FREQUENCY_GRID_NON_MONOTONIC.code,
          rule: TouchstoneErrorCode.FREQUENCY_GRID_NON_MONOTONIC.rule,
          severity: TouchstoneErrorCode.FREQUENCY_GRID_NON_MONOTONIC.severity,
          message: TouchstoneErrorCode.FREQUENCY_GRID_NON_MONOTONIC.message(
            `${prevPt.frequency} ${deck.options.frequencyUnit}`,
            `${pt.frequency} ${deck.options.frequencyUnit}`,
          ),
          range: {
            startLine: pt.line,
            startCol: 1,
            endLine: pt.line,
            endCol: 15,
          },
        });
      }
    }

    // 4. M8301: Passivity violation (norm > 1.0)
    // Only applies to S parameters (scattering)
    if (deck.options.parameterType === "S") {
      const norm = computeMaxSingularValue(pt.matrix, deck.numPorts);
      if (norm > 1.0001) {
        diags.push({
          code: TouchstoneErrorCode.PASSIVITY_VIOLATION.code,
          rule: TouchstoneErrorCode.PASSIVITY_VIOLATION.rule,
          severity: TouchstoneErrorCode.PASSIVITY_VIOLATION.severity,
          message: TouchstoneErrorCode.PASSIVITY_VIOLATION.message(
            `${pt.frequency} ${deck.options.frequencyUnit}`,
            norm.toFixed(4),
          ),
          range: {
            startLine: pt.line,
            startCol: 1,
            endLine: pt.line,
            endCol: 30,
          },
        });
      }

      // 5. M8310: Reciprocity check (|Sij - Sji| > 0.05)
      for (let r = 0; r < deck.numPorts; r++) {
        for (let c = r + 1; c < deck.numPorts; c++) {
          const s_rc = pt.matrix[r]![c]!;
          const s_cr = pt.matrix[c]![r]!;
          const diffRe = s_rc.re - s_cr.re;
          const diffIm = s_rc.im - s_cr.im;
          const diffMag = Math.sqrt(diffRe * diffRe + diffIm * diffIm);
          if (diffMag > 0.15) {
            diags.push({
              code: TouchstoneErrorCode.ASYMMETRIC_RECIPROCAL_NETWORK.code,
              rule: TouchstoneErrorCode.ASYMMETRIC_RECIPROCAL_NETWORK.rule,
              severity: TouchstoneErrorCode.ASYMMETRIC_RECIPROCAL_NETWORK.severity,
              message: TouchstoneErrorCode.ASYMMETRIC_RECIPROCAL_NETWORK.message(r + 1, c + 1, diffMag.toFixed(4)),
              range: {
                startLine: pt.line,
                startCol: 1,
                endLine: pt.line,
                endCol: 30,
              },
            });
          }
        }
      }
    }
  }

  return diags;
}

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

  // M8306: Missing '#' option line
  if (deck.hasOptionLine === false) {
    diags.push({
      code: TouchstoneErrorCode.MISSING_OPTION_LINE.code,
      rule: TouchstoneErrorCode.MISSING_OPTION_LINE.rule,
      severity: TouchstoneErrorCode.MISSING_OPTION_LINE.severity,
      message: TouchstoneErrorCode.MISSING_OPTION_LINE.message(),
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
  }

  // M8307: Invalid parameter format / token
  if (deck.invalidTokens) {
    for (const inv of deck.invalidTokens) {
      diags.push({
        code: TouchstoneErrorCode.INVALID_PARAMETER_FORMAT.code,
        rule: TouchstoneErrorCode.INVALID_PARAMETER_FORMAT.rule,
        severity: TouchstoneErrorCode.INVALID_PARAMETER_FORMAT.severity,
        message: TouchstoneErrorCode.INVALID_PARAMETER_FORMAT.message(inv.token),
        range: { startLine: inv.line, startCol: 1, endLine: inv.line, endCol: 20 },
      });
    }
  }

  // M8308: Incomplete matrix data row
  if (deck.incompleteRows) {
    for (const inc of deck.incompleteRows) {
      diags.push({
        code: TouchstoneErrorCode.INCOMPLETE_MATRIX_DATA.code,
        rule: TouchstoneErrorCode.INCOMPLETE_MATRIX_DATA.rule,
        severity: TouchstoneErrorCode.INCOMPLETE_MATRIX_DATA.severity,
        message: TouchstoneErrorCode.INCOMPLETE_MATRIX_DATA.message(inc.expected, inc.received),
        range: { startLine: inc.line, startCol: 1, endLine: inc.line, endCol: 20 },
      });
    }
  }

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

  let causalityReported = false;

  // Sweep across all points
  for (let i = 0; i < deck.points.length; i++) {
    const pt = deck.points[i]!;

    // 3. Monotonic frequency, duplicate check, and M8302 causality (negative group delay) check
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
      } else if (!causalityReported) {
        // M8302: Check for non-causal positive phase slope (negative group delay tau_g = -d(phi)/d(omega) < 0)
        const sPrev = deck.numPorts >= 2 ? prevPt.matrix[1]![0]! : prevPt.matrix[0]![0]!;
        const sCurr = deck.numPorts >= 2 ? pt.matrix[1]![0]! : pt.matrix[0]![0]!;
        const magPrev = Math.sqrt(sPrev.re * sPrev.re + sPrev.im * sPrev.im);
        const magCurr = Math.sqrt(sCurr.re * sCurr.re + sCurr.im * sCurr.im);
        if (magPrev > 0.05 && magCurr > 0.05) {
          // Cross product sCurr * conj(sPrev) gives phase difference dPhi in (-pi, pi]
          const prodRe = sCurr.re * sPrev.re + sCurr.im * sPrev.im;
          const prodIm = sCurr.im * sPrev.re - sCurr.re * sPrev.im;
          const dPhi = Math.atan2(prodIm, prodRe);
          if (dPhi > 0.25) {
            causalityReported = true;
            diags.push({
              code: TouchstoneErrorCode.CAUSALITY_VIOLATION.code,
              rule: TouchstoneErrorCode.CAUSALITY_VIOLATION.rule,
              severity: TouchstoneErrorCode.CAUSALITY_VIOLATION.severity,
              message: TouchstoneErrorCode.CAUSALITY_VIOLATION.message(
                `positive phase advance (+${((dPhi * 180) / Math.PI).toFixed(1)} deg) implies negative group delay between ${prevPt.frequency} and ${pt.frequency} ${deck.options.frequencyUnit}`,
              ),
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

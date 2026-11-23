// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hec2ErrorCode } from "../errors.js";
import { parseHec2Deck } from "../parser/hec2-parser.js";
import type { Hec2Deck, Hec2Diagnostic } from "../types.js";

/**
 * Runs all semantic and structural HEC-2 lints (`HEC21001`–`HEC25006`) on a parsed `Hec2Deck`.
 */
export function lintHec2Deck(deck: Hec2Deck): Hec2Diagnostic[] {
  const diags: Hec2Diagnostic[] = [];

  // HEC21001: Syntax / parse errors
  for (const err of deck.parseErrors) {
    diags.push({
      code: Hec2ErrorCode.SYNTAX_ERROR.code,
      codeId: Hec2ErrorCode.SYNTAX_ERROR.codeId,
      rule: Hec2ErrorCode.SYNTAX_ERROR.rule,
      severity: Hec2ErrorCode.SYNTAX_ERROR.severity,
      message: Hec2ErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
    });
  }

  // HEC22001: Missing J1 job control card
  if (!deck.jobCard) {
    diags.push({
      code: Hec2ErrorCode.MISSING_JOB_CARD.code,
      codeId: Hec2ErrorCode.MISSING_JOB_CARD.codeId,
      rule: Hec2ErrorCode.MISSING_JOB_CARD.rule,
      severity: Hec2ErrorCode.MISSING_JOB_CARD.severity,
      message: Hec2ErrorCode.MISSING_JOB_CARD.message(),
      line: 1,
    });
  }

  // HEC22002: Missing EJ or ER end card
  if (!deck.hasEndJob && !deck.hasEndRun) {
    const lastLine = deck.cards.length > 0 ? deck.cards[deck.cards.length - 1]!.line : 1;
    diags.push({
      code: Hec2ErrorCode.MISSING_END_CARD.code,
      codeId: Hec2ErrorCode.MISSING_END_CARD.codeId,
      rule: Hec2ErrorCode.MISSING_END_CARD.rule,
      severity: Hec2ErrorCode.MISSING_END_CARD.severity,
      message: Hec2ErrorCode.MISSING_END_CARD.message(),
      line: lastLine,
    });
  }

  // HEC23001 / HEC23002: Manning's n on NC cards
  for (const nc of deck.manningCards) {
    const checks: Array<[string, number]> = [
      ["XNL", nc.xnl],
      ["XNR", nc.xnr],
      ["XNCH", nc.xnch],
    ];
    for (const [field, val] of checks) {
      if (val <= 0) {
        diags.push({
          code: Hec2ErrorCode.NON_POSITIVE_MANNING.code,
          codeId: Hec2ErrorCode.NON_POSITIVE_MANNING.codeId,
          rule: Hec2ErrorCode.NON_POSITIVE_MANNING.rule,
          severity: Hec2ErrorCode.NON_POSITIVE_MANNING.severity,
          message: Hec2ErrorCode.NON_POSITIVE_MANNING.message("NC", field, val),
          line: nc.line,
        });
      } else if (val < 0.008 || val > 0.25) {
        diags.push({
          code: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.code,
          codeId: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.codeId,
          rule: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.rule,
          severity: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.severity,
          message: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.message("NC", field, val),
          line: nc.line,
        });
      }
    }
  }

  // HEC23001 / HEC23002: Manning's n on NH cards
  for (const nh of deck.horizontalManningCards) {
    for (let idx = 0; idx < nh.pairs.length; idx++) {
      const pair = nh.pairs[idx]!;
      if (pair.n <= 0) {
        diags.push({
          code: Hec2ErrorCode.NON_POSITIVE_MANNING.code,
          codeId: Hec2ErrorCode.NON_POSITIVE_MANNING.codeId,
          rule: Hec2ErrorCode.NON_POSITIVE_MANNING.rule,
          severity: Hec2ErrorCode.NON_POSITIVE_MANNING.severity,
          message: Hec2ErrorCode.NON_POSITIVE_MANNING.message("NH", `N(${idx + 1})`, pair.n),
          line: nh.line,
        });
      } else if (pair.n < 0.008 || pair.n > 0.25) {
        diags.push({
          code: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.code,
          codeId: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.codeId,
          rule: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.rule,
          severity: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.severity,
          message: Hec2ErrorCode.MANNING_OUT_OF_BOUNDS.message("NH", `N(${idx + 1})`, pair.n),
          line: nh.line,
        });
      }
    }
  }

  // HEC25002: Non-positive discharge Q on J1 or QT cards
  if (deck.jobCard?.q !== undefined && deck.jobCard.q <= 0) {
    diags.push({
      code: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.code,
      codeId: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.codeId,
      rule: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.rule,
      severity: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.severity,
      message: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.message("J1", deck.jobCard.q),
      line: deck.jobCard.line,
    });
  }
  if (deck.dischargeTable) {
    for (const qVal of deck.dischargeTable.discharges) {
      if (qVal <= 0) {
        diags.push({
          code: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.code,
          codeId: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.codeId,
          rule: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.rule,
          severity: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.severity,
          message: Hec2ErrorCode.NON_POSITIVE_DISCHARGE.message("QT", qVal),
          line: deck.dischargeTable.line,
        });
      }
    }
  }

  // Per-cross-section checks
  for (const xs of deck.crossSections) {
    // HEC24001: GR point count mismatch with X1 NUMST (when NUMST > 0)
    if (xs.numst > 0 && xs.grPoints.length !== xs.numst) {
      diags.push({
        code: Hec2ErrorCode.GR_COUNT_MISMATCH.code,
        codeId: Hec2ErrorCode.GR_COUNT_MISMATCH.codeId,
        rule: Hec2ErrorCode.GR_COUNT_MISMATCH.rule,
        severity: Hec2ErrorCode.GR_COUNT_MISMATCH.severity,
        message: Hec2ErrorCode.GR_COUNT_MISMATCH.message(xs.secno, xs.numst, xs.grPoints.length),
        line: xs.line,
      });
    }

    // HEC24002: Non-monotonic GR station coordinates
    for (let i = 1; i < xs.grPoints.length; i++) {
      const prev = xs.grPoints[i - 1]!;
      const curr = xs.grPoints[i]!;
      if (curr.station < prev.station) {
        diags.push({
          code: Hec2ErrorCode.NON_MONOTONIC_STATION.code,
          codeId: Hec2ErrorCode.NON_MONOTONIC_STATION.codeId,
          rule: Hec2ErrorCode.NON_MONOTONIC_STATION.rule,
          severity: Hec2ErrorCode.NON_MONOTONIC_STATION.severity,
          message: Hec2ErrorCode.NON_MONOTONIC_STATION.message(xs.secno, prev.station, curr.station),
          line: xs.line,
        });
        break;
      }
    }

    // HEC24003 / HEC24004: Bank stations STCHL / STCHR within GR station range
    if (xs.grPoints.length >= 2) {
      let minSta = Infinity;
      let maxSta = -Infinity;
      for (const p of xs.grPoints) {
        if (p.station < minSta) minSta = p.station;
        if (p.station > maxSta) maxSta = p.station;
      }
      if (xs.stchl > xs.stchr) {
        diags.push({
          code: Hec2ErrorCode.BANK_STATION_INVERTED.code,
          codeId: Hec2ErrorCode.BANK_STATION_INVERTED.codeId,
          rule: Hec2ErrorCode.BANK_STATION_INVERTED.rule,
          severity: Hec2ErrorCode.BANK_STATION_INVERTED.severity,
          message: Hec2ErrorCode.BANK_STATION_INVERTED.message(xs.secno, xs.stchl, xs.stchr),
          line: xs.line,
        });
      }
      if (xs.stchl < minSta || xs.stchl > maxSta) {
        diags.push({
          code: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.code,
          codeId: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.codeId,
          rule: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.rule,
          severity: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.severity,
          message: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.message(xs.secno, "STCHL", xs.stchl, minSta, maxSta),
          line: xs.line,
        });
      }
      if (xs.stchr < minSta || xs.stchr > maxSta) {
        diags.push({
          code: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.code,
          codeId: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.codeId,
          rule: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.rule,
          severity: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.severity,
          message: Hec2ErrorCode.BANK_STATION_OUT_OF_BOUNDS.message(xs.secno, "STCHR", xs.stchr, minSta, maxSta),
          line: xs.line,
        });
      }
    }

    // HEC25001: Negative reach lengths XLOBL, XLOBR, XLCH
    const reachChecks: Array<[string, number]> = [
      ["XLOBL", xs.xlobl],
      ["XLOBR", xs.xlobr],
      ["XLCH", xs.xlch],
    ];
    for (const [field, val] of reachChecks) {
      if (val < 0) {
        diags.push({
          code: Hec2ErrorCode.NEGATIVE_REACH_LENGTH.code,
          codeId: Hec2ErrorCode.NEGATIVE_REACH_LENGTH.codeId,
          rule: Hec2ErrorCode.NEGATIVE_REACH_LENGTH.rule,
          severity: Hec2ErrorCode.NEGATIVE_REACH_LENGTH.severity,
          message: Hec2ErrorCode.NEGATIVE_REACH_LENGTH.message(xs.secno, field, val),
          line: xs.line,
        });
      }
    }
  }

  // HEC25006: Insufficient cross-sections
  if (deck.crossSections.length < 2) {
    diags.push({
      code: Hec2ErrorCode.INSUFFICIENT_CROSS_SECTIONS.code,
      codeId: Hec2ErrorCode.INSUFFICIENT_CROSS_SECTIONS.codeId,
      rule: Hec2ErrorCode.INSUFFICIENT_CROSS_SECTIONS.rule,
      severity: Hec2ErrorCode.INSUFFICIENT_CROSS_SECTIONS.severity,
      message: Hec2ErrorCode.INSUFFICIENT_CROSS_SECTIONS.message(deck.crossSections.length),
      line: 1,
    });
  }

  return diags;
}

/**
 * Convenience helper to parse and lint a raw HEC-2 deck string.
 */
export function lintHec2Text(text: string): Hec2Diagnostic[] {
  return lintHec2Deck(parseHec2Deck(text));
}

export { Hec2ErrorCode } from "../errors.js";

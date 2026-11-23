// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static analysis and diagnostic linter for USACE HEC-1 card decks (`HEC11001`–`HEC15006`).
 */

import { Hec1ErrorCode, type Hec1Diagnostic } from "../errors.js";
import type { Hec1Deck } from "../types.js";

export { Hec1ErrorCode, type Hec1Diagnostic } from "../errors.js";

/**
 * Runs all HEC-1 hydrologic and structural lint rules on a parsed `Hec1Deck`.
 */
export function lintHec1Deck(deck: Hec1Deck): Hec1Diagnostic[] {
  const diagnostics: Hec1Diagnostic[] = [];

  // HEC11001: Syntax errors from parser
  for (const err of deck.parseErrors) {
    diagnostics.push({
      code: Hec1ErrorCode.SYNTAX_ERROR.code,
      id: Hec1ErrorCode.SYNTAX_ERROR.id,
      rule: Hec1ErrorCode.SYNTAX_ERROR.rule,
      severity: Hec1ErrorCode.SYNTAX_ERROR.severity,
      message: Hec1ErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // HEC12001 & HEC15002: Time-interval card IT
  if (!deck.timeControl) {
    diagnostics.push({
      code: Hec1ErrorCode.MISSING_TIME_INTERVAL.code,
      id: Hec1ErrorCode.MISSING_TIME_INTERVAL.id,
      rule: Hec1ErrorCode.MISSING_TIME_INTERVAL.rule,
      severity: Hec1ErrorCode.MISSING_TIME_INTERVAL.severity,
      message: Hec1ErrorCode.MISSING_TIME_INTERVAL.message(),
      line: 1,
    });
  } else if (deck.timeControl.nmin <= 0 || deck.timeControl.nq <= 0) {
    diagnostics.push({
      code: Hec1ErrorCode.INVALID_TIME_INTERVAL.code,
      id: Hec1ErrorCode.INVALID_TIME_INTERVAL.id,
      rule: Hec1ErrorCode.INVALID_TIME_INTERVAL.rule,
      severity: Hec1ErrorCode.INVALID_TIME_INTERVAL.severity,
      message: Hec1ErrorCode.INVALID_TIME_INTERVAL.message(deck.timeControl.nmin, deck.timeControl.nq),
      line: deck.timeControl.line,
    });
  }

  // HEC12002: Missing ZZ end-of-job card
  if (!deck.hasEndCard) {
    const lastLine = deck.cards.length > 0 ? deck.cards[deck.cards.length - 1]!.line : 1;
    diagnostics.push({
      code: Hec1ErrorCode.MISSING_END_CARD.code,
      id: Hec1ErrorCode.MISSING_END_CARD.id,
      rule: Hec1ErrorCode.MISSING_END_CARD.rule,
      severity: Hec1ErrorCode.MISSING_END_CARD.severity,
      message: Hec1ErrorCode.MISSING_END_CARD.message(),
      line: lastLine,
    });
  }

  const dtHours = deck.timeControl && deck.timeControl.nmin > 0 ? deck.timeControl.nmin / 60.0 : undefined;

  // Walk stations in deck execution order while tracking duplicate IDs and HEC-1 hydrograph stack depth
  const seenIds = new Set<string>();
  let stackDepth = 0;

  for (const st of deck.stationList) {
    // HEC12003: Duplicate KK station ID
    if (seenIds.has(st.id)) {
      diagnostics.push({
        code: Hec1ErrorCode.DUPLICATE_STATION_ID.code,
        id: Hec1ErrorCode.DUPLICATE_STATION_ID.id,
        rule: Hec1ErrorCode.DUPLICATE_STATION_ID.rule,
        severity: Hec1ErrorCode.DUPLICATE_STATION_ID.severity,
        message: Hec1ErrorCode.DUPLICATE_STATION_ID.message(st.id),
        line: st.line,
        stationId: st.id,
      });
    } else {
      seenIds.add(st.id);
    }

    if (st.kind === "subbasin") {
      // HEC13001: Non-positive drainage area on BA card
      if (st.area !== undefined && (!Number.isFinite(st.area) || st.area <= 0)) {
        diagnostics.push({
          code: Hec1ErrorCode.NON_POSITIVE_DRAINAGE_AREA.code,
          id: Hec1ErrorCode.NON_POSITIVE_DRAINAGE_AREA.id,
          rule: Hec1ErrorCode.NON_POSITIVE_DRAINAGE_AREA.rule,
          severity: Hec1ErrorCode.NON_POSITIVE_DRAINAGE_AREA.severity,
          message: Hec1ErrorCode.NON_POSITIVE_DRAINAGE_AREA.message(st.id, st.area),
          line: st.areaLine ?? st.line,
          stationId: st.id,
        });
      }

      // HEC13003: Missing precipitation (PB/PI/PC) for subbasin
      const hasPrecip =
        (st.precipitationTotal !== undefined && Number.isFinite(st.precipitationTotal) && st.precipitationTotal > 0) ||
        (st.precipitationIncrements !== undefined && st.precipitationIncrements.length > 0) ||
        (st.precipitationCumulative !== undefined && st.precipitationCumulative.length > 0);
      if (!hasPrecip) {
        diagnostics.push({
          code: Hec1ErrorCode.MISSING_PRECIPITATION.code,
          id: Hec1ErrorCode.MISSING_PRECIPITATION.id,
          rule: Hec1ErrorCode.MISSING_PRECIPITATION.rule,
          severity: Hec1ErrorCode.MISSING_PRECIPITATION.severity,
          message: Hec1ErrorCode.MISSING_PRECIPITATION.message(st.id),
          line: st.line,
          stationId: st.id,
        });
      }

      // Loss parameters checks (HEC13002, HEC15004)
      if (st.loss) {
        if (st.loss.method === "SCS") {
          const cn = st.loss.curveNumber;
          if (!Number.isFinite(cn) || cn <= 0 || cn > 100) {
            diagnostics.push({
              code: Hec1ErrorCode.CURVE_NUMBER_OUT_OF_RANGE.code,
              id: Hec1ErrorCode.CURVE_NUMBER_OUT_OF_RANGE.id,
              rule: Hec1ErrorCode.CURVE_NUMBER_OUT_OF_RANGE.rule,
              severity: Hec1ErrorCode.CURVE_NUMBER_OUT_OF_RANGE.severity,
              message: Hec1ErrorCode.CURVE_NUMBER_OUT_OF_RANGE.message(st.id, cn),
              line: st.loss.line,
              stationId: st.id,
            });
          }
          if (st.loss.strtl !== undefined && st.loss.strtl < 0) {
            diagnostics.push({
              code: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.code,
              id: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.id,
              rule: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.rule,
              severity: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.severity,
              message: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.message(
                st.id,
                `initial abstraction STRTL (${st.loss.strtl}) must be >= 0`,
              ),
              line: st.loss.line,
              stationId: st.id,
            });
          }
          if (st.loss.rtimp < 0 || st.loss.rtimp > 100) {
            diagnostics.push({
              code: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.code,
              id: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.id,
              rule: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.rule,
              severity: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.severity,
              message: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.message(
                st.id,
                `impervious percentage RTIMP (${st.loss.rtimp}) must be within [0, 100]`,
              ),
              line: st.loss.line,
              stationId: st.id,
            });
          }
        } else if (st.loss.method === "Uniform") {
          if (st.loss.strtl < 0 || st.loss.cnstl < 0 || st.loss.rtimp < 0 || st.loss.rtimp > 100) {
            diagnostics.push({
              code: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.code,
              id: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.id,
              rule: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.rule,
              severity: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.severity,
              message: Hec1ErrorCode.INVALID_LOSS_PARAMETERS.message(
                st.id,
                `uniform loss parameters must be non-negative and RTIMP in [0, 100]`,
              ),
              line: st.loss.line,
              stationId: st.id,
            });
          }
        }
      }

      // Unit hydrograph checks (HEC15003, HEC15005)
      if (!st.unitHydrograph) {
        diagnostics.push({
          code: Hec1ErrorCode.MISSING_UNIT_HYDROGRAPH.code,
          id: Hec1ErrorCode.MISSING_UNIT_HYDROGRAPH.id,
          rule: Hec1ErrorCode.MISSING_UNIT_HYDROGRAPH.rule,
          severity: Hec1ErrorCode.MISSING_UNIT_HYDROGRAPH.severity,
          message: Hec1ErrorCode.MISSING_UNIT_HYDROGRAPH.message(st.id),
          line: st.line,
          stationId: st.id,
        });
      } else if (st.unitHydrograph.method === "Clark") {
        if (
          !Number.isFinite(st.unitHydrograph.tc) ||
          st.unitHydrograph.tc <= 0 ||
          !Number.isFinite(st.unitHydrograph.r) ||
          st.unitHydrograph.r <= 0
        ) {
          diagnostics.push({
            code: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.code,
            id: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.id,
            rule: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.rule,
            severity: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.severity,
            message: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.message(
              st.id,
              "Clark",
              `TC (${st.unitHydrograph.tc}) and R (${st.unitHydrograph.r}) must be > 0`,
            ),
            line: st.unitHydrograph.line,
            stationId: st.id,
          });
        }
      } else if (st.unitHydrograph.method === "SCS") {
        if (!Number.isFinite(st.unitHydrograph.tlag) || st.unitHydrograph.tlag <= 0) {
          diagnostics.push({
            code: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.code,
            id: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.id,
            rule: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.rule,
            severity: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.severity,
            message: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.message(
              st.id,
              "SCS",
              `TLAG (${st.unitHydrograph.tlag}) must be > 0`,
            ),
            line: st.unitHydrograph.line,
            stationId: st.id,
          });
        }
      } else if (st.unitHydrograph.method === "Snyder") {
        if (
          !Number.isFinite(st.unitHydrograph.tp) ||
          st.unitHydrograph.tp <= 0 ||
          !Number.isFinite(st.unitHydrograph.cp) ||
          st.unitHydrograph.cp <= 0
        ) {
          diagnostics.push({
            code: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.code,
            id: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.id,
            rule: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.rule,
            severity: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.severity,
            message: Hec1ErrorCode.INVALID_UNIT_HYDROGRAPH_PARAMS.message(
              st.id,
              "Snyder",
              `TP (${st.unitHydrograph.tp}) and CP (${st.unitHydrograph.cp}) must be > 0`,
            ),
            line: st.unitHydrograph.line,
            stationId: st.id,
          });
        }
      }

      // Subbasin pushes 1 hydrograph onto the HEC-1 stack
      stackDepth += 1;
    } else if (st.kind === "route") {
      // HEC15006: Routing requires at least 1 upstream hydrograph
      if (stackDepth < 1) {
        diagnostics.push({
          code: Hec1ErrorCode.ROUTING_WITHOUT_UPSTREAM.code,
          id: Hec1ErrorCode.ROUTING_WITHOUT_UPSTREAM.id,
          rule: Hec1ErrorCode.ROUTING_WITHOUT_UPSTREAM.rule,
          severity: Hec1ErrorCode.ROUTING_WITHOUT_UPSTREAM.severity,
          message: Hec1ErrorCode.ROUTING_WITHOUT_UPSTREAM.message(st.id),
          line: st.line,
          stationId: st.id,
        });
      }

      if (st.muskingum) {
        const { nstps, amskk, x, line } = st.muskingum;
        const validKSteps = Number.isFinite(amskk) && amskk > 0 && Number.isFinite(nstps) && nstps >= 1;
        if (!validKSteps) {
          diagnostics.push({
            code: Hec1ErrorCode.INVALID_MUSKINGUM_K_OR_STEPS.code,
            id: Hec1ErrorCode.INVALID_MUSKINGUM_K_OR_STEPS.id,
            rule: Hec1ErrorCode.INVALID_MUSKINGUM_K_OR_STEPS.rule,
            severity: Hec1ErrorCode.INVALID_MUSKINGUM_K_OR_STEPS.severity,
            message: Hec1ErrorCode.INVALID_MUSKINGUM_K_OR_STEPS.message(st.id, amskk, nstps),
            line,
            stationId: st.id,
          });
        }

        const validX = Number.isFinite(x) && x >= 0 && x <= 0.5;
        if (!validX) {
          diagnostics.push({
            code: Hec1ErrorCode.INVALID_MUSKINGUM_X.code,
            id: Hec1ErrorCode.INVALID_MUSKINGUM_X.id,
            rule: Hec1ErrorCode.INVALID_MUSKINGUM_X.rule,
            severity: Hec1ErrorCode.INVALID_MUSKINGUM_X.severity,
            message: Hec1ErrorCode.INVALID_MUSKINGUM_X.message(st.id, x),
            line,
            stationId: st.id,
          });
        }

        // HEC14002: Muskingum stability criterion: dt / (2 * K_sub) >= X
        if (validKSteps && validX && dtHours !== undefined) {
          const kSub = amskk / Math.max(1, Math.round(nstps));
          if (dtHours / (2.0 * kSub) < x - 1e-12) {
            diagnostics.push({
              code: Hec1ErrorCode.MUSKINGUM_STABILITY_VIOLATION.code,
              id: Hec1ErrorCode.MUSKINGUM_STABILITY_VIOLATION.id,
              rule: Hec1ErrorCode.MUSKINGUM_STABILITY_VIOLATION.rule,
              severity: Hec1ErrorCode.MUSKINGUM_STABILITY_VIOLATION.severity,
              message: Hec1ErrorCode.MUSKINGUM_STABILITY_VIOLATION.message(st.id, dtHours, kSub, x),
              line,
              stationId: st.id,
            });
          }
        }
      }
      // Routing replaces top of stack (stackDepth unchanged if >= 1)
    } else if (st.kind === "combine") {
      const count = st.combineCount ?? 0;
      if (count < 2 || stackDepth < count) {
        diagnostics.push({
          code: Hec1ErrorCode.INVALID_COMBINE_COUNT.code,
          id: Hec1ErrorCode.INVALID_COMBINE_COUNT.id,
          rule: Hec1ErrorCode.INVALID_COMBINE_COUNT.rule,
          severity: Hec1ErrorCode.INVALID_COMBINE_COUNT.severity,
          message: Hec1ErrorCode.INVALID_COMBINE_COUNT.message(st.id, count, stackDepth),
          line: st.combineLine ?? st.line,
          stationId: st.id,
        });
      }
      if (count >= 2 && stackDepth >= count) {
        stackDepth = stackDepth - count + 1;
      } else if (stackDepth === 0) {
        stackDepth = 1;
      }
    }
  }

  return diagnostics;
}

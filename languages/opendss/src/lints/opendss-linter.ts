// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Pre-Flight Distribution Grid Linter (Codes M8401–M8415).
 */

import { OpenDssErrorCode } from "../errors.js";
import type { DssDeck, DssRange } from "../types.js";

export interface OpenDssDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: DssRange;
}

export function lintOpenDss(deck: DssDeck): OpenDssDiagnostic[] {
  const diags: OpenDssDiagnostic[] = [];

  // 1. M8405: Missing Circuit definition
  if (!deck.circuit) {
    diags.push({
      code: OpenDssErrorCode.MISSING_CIRCUIT_DEFINITION.code,
      rule: OpenDssErrorCode.MISSING_CIRCUIT_DEFINITION.rule,
      severity: OpenDssErrorCode.MISSING_CIRCUIT_DEFINITION.severity,
      message: OpenDssErrorCode.MISSING_CIRCUIT_DEFINITION.message(),
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
  }

  // Collect all valid bus names from circuit, lines, and transformers
  const knownBuses = new Set<string>();
  if (deck.circuit) {
    knownBuses.add(deck.circuit.bus1);
  }
  for (const [, line] of deck.lines) {
    knownBuses.add(line.bus1);
    knownBuses.add(line.bus2);
  }
  for (const [, xfmr] of deck.transformers) {
    for (const b of xfmr.buses) {
      knownBuses.add(b);
    }
  }

  // 2. Check Line definitions
  for (const [, line] of deck.lines) {
    // M8407: Non-positive length
    if (line.length <= 0) {
      diags.push({
        code: OpenDssErrorCode.ZERO_OR_NEGATIVE_LINE_LENGTH.code,
        rule: OpenDssErrorCode.ZERO_OR_NEGATIVE_LINE_LENGTH.rule,
        severity: OpenDssErrorCode.ZERO_OR_NEGATIVE_LINE_LENGTH.severity,
        message: OpenDssErrorCode.ZERO_OR_NEGATIVE_LINE_LENGTH.message(line.name, line.length),
        range: line.range,
      });
    }

    // M8408: Missing line code
    if (line.lineCode && !deck.lineCodes.has(line.lineCode)) {
      diags.push({
        code: OpenDssErrorCode.MISSING_LINE_CODE.code,
        rule: OpenDssErrorCode.MISSING_LINE_CODE.rule,
        severity: OpenDssErrorCode.MISSING_LINE_CODE.severity,
        message: OpenDssErrorCode.MISSING_LINE_CODE.message(line.name, line.lineCode),
        range: line.range,
      });
    }
  }

  // 3. Check Load definitions
  for (const [, load] of deck.loads) {
    // M8401: Unconnected bus node
    if (!knownBuses.has(load.bus1)) {
      diags.push({
        code: OpenDssErrorCode.UNCONNECTED_BUS_NODE.code,
        rule: OpenDssErrorCode.UNCONNECTED_BUS_NODE.rule,
        severity: OpenDssErrorCode.UNCONNECTED_BUS_NODE.severity,
        message: OpenDssErrorCode.UNCONNECTED_BUS_NODE.message("Load", load.name, load.bus1),
        range: load.range,
      });
    }

    // M8406: Negative load power
    if (load.kw < 0) {
      diags.push({
        code: OpenDssErrorCode.NEGATIVE_LOAD_POWER.code,
        rule: OpenDssErrorCode.NEGATIVE_LOAD_POWER.rule,
        severity: OpenDssErrorCode.NEGATIVE_LOAD_POWER.severity,
        message: OpenDssErrorCode.NEGATIVE_LOAD_POWER.message(load.name, load.kw),
        range: load.range,
      });
    }
  }

  // 4. Check PV systems
  for (const [, pv] of deck.pvSystems) {
    if (!knownBuses.has(pv.bus1)) {
      diags.push({
        code: OpenDssErrorCode.UNCONNECTED_BUS_NODE.code,
        rule: OpenDssErrorCode.UNCONNECTED_BUS_NODE.rule,
        severity: OpenDssErrorCode.UNCONNECTED_BUS_NODE.severity,
        message: OpenDssErrorCode.UNCONNECTED_BUS_NODE.message("PVSystem", pv.name, pv.bus1),
        range: pv.range,
      });
    }
  }

  // 5. M8404: Reverse power hosting risk check
  let totalDerKw = 0;
  for (const [, pv] of deck.pvSystems) totalDerKw += pv.pmpp;
  for (const [, st] of deck.storages) totalDerKw += st.kwRated;

  for (const [, xfmr] of deck.transformers) {
    const kvaRating = xfmr.kvas[1] ?? xfmr.kvas[0] ?? 1000;
    if (totalDerKw > kvaRating) {
      diags.push({
        code: OpenDssErrorCode.REVERSE_POWER_HOSTING_RISK.code,
        rule: OpenDssErrorCode.REVERSE_POWER_HOSTING_RISK.rule,
        severity: OpenDssErrorCode.REVERSE_POWER_HOSTING_RISK.severity,
        message: OpenDssErrorCode.REVERSE_POWER_HOSTING_RISK.message(xfmr.name, totalDerKw, kvaRating),
        range: xfmr.range,
      });
    }
  }

  return diags;
}

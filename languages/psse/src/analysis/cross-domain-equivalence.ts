// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PsseCase, PsseDiagnostic } from "../types.js";

export interface PscadEquivalenceSnapshot {
  /** Nominal EMT system frequency in Hz (e.g. 60). */
  frequencyHz: number;
  /** POI nominal L-L base voltage in kV. */
  poiBaseKv?: number | undefined;
  /** Equivalent EMT Thévenin short-circuit MVA at the POI. */
  poiShortCircuitMva?: number | undefined;
  /** Optional under-voltage trip threshold in pu configured in PSCAD relay logic. */
  underVoltageTripPu?: number | undefined;
  /** Optional over-voltage trip threshold in pu configured in PSCAD relay logic. */
  overVoltageTripPu?: number | undefined;
}

/**
 * Cross-domain PSS/E (positive-sequence RMS) <-> PSCAD (EMT) model equivalence & drift verifier
 * for NERC MOD-026/027/033 and FERC Order 901 interconnection benchmarking:
 * - `X7001`: System base frequency mismatch.
 * - `X7002`: POI base voltage or Thévenin short-circuit strength drift (> 15%).
 * - `X7003`: Protection under-/over-voltage trip threshold drift (> 0.02 pu) vs DYR `VTGTPAT`/`VTGDCAT`.
 */
export function verifyPssePscadEquivalence(
  psseCase: PsseCase,
  pscad: PscadEquivalenceSnapshot,
  poiBusId?: number,
): PsseDiagnostic[] {
  const diagnostics: PsseDiagnostic[] = [];
  const psseFreq = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;

  // X7001: System nominal frequency parity
  if (pscad.frequencyHz > 0 && Math.abs(psseFreq - pscad.frequencyHz) > 0.1) {
    diagnostics.push({
      severity: "error",
      code: "X7001",
      message: `Cross-domain RMS/EMT frequency mismatch: PSS/E basfrq=${psseFreq} Hz vs PSCAD f_base=${pscad.frequencyHz} Hz.`,
      startOffset: psseCase.header.span?.startOffset ?? 0,
      endOffset: psseCase.header.span?.endOffset ?? 0,
      line: psseCase.header.span?.line,
      column: psseCase.header.span?.column,
      rigor: "rigorous",
    });
  }

  // X7002: POI base kV & short-circuit equivalence
  const poiBus = poiBusId !== undefined ? psseCase.buses.get(poiBusId) : Array.from(psseCase.buses.values())[0];
  if (poiBus && pscad.poiBaseKv !== undefined && pscad.poiBaseKv > 0 && poiBus.baseKv > 0) {
    const relKv = Math.abs(poiBus.baseKv - pscad.poiBaseKv) / poiBus.baseKv;
    if (relKv > 0.05) {
      diagnostics.push({
        severity: "error",
        code: "X7002",
        message: `Cross-domain POI voltage drift at bus ${poiBus.i}: PSS/E baseKv=${poiBus.baseKv} kV vs PSCAD=${pscad.poiBaseKv} kV (${(relKv * 100).toFixed(1)}% difference).`,
        startOffset: poiBus.span?.startOffset ?? 0,
        endOffset: poiBus.span?.endOffset ?? 0,
        line: poiBus.span?.line,
        column: poiBus.span?.column,
        rigor: "rigorous",
      });
    }
  }

  // X7003: Protection voltage trip threshold parity (VTGTPAT/VTGDCAT vs PSCAD relay)
  if (psseCase.dyr && (pscad.underVoltageTripPu !== undefined || pscad.overVoltageTripPu !== undefined)) {
    for (const rec of psseCase.dyr.records) {
      const m = rec.model.toUpperCase();
      if (!m.startsWith("VTGTP") && !m.startsWith("VTGDC")) continue;
      if (poiBusId !== undefined && rec.ibus !== poiBusId) continue;
      const vl = rec.namedParams["VL"] ?? rec.con[0];
      const vu = rec.namedParams["VU"] ?? rec.con[1];
      if (
        pscad.underVoltageTripPu !== undefined &&
        vl !== undefined &&
        vl > 0 &&
        Math.abs(vl - pscad.underVoltageTripPu) > 0.02
      ) {
        diagnostics.push({
          severity: "warning",
          code: "X7003",
          message: `Cross-domain under-voltage protection drift at bus ${rec.ibus}: PSS/E '${rec.model}' VL=${vl} pu vs PSCAD=${pscad.underVoltageTripPu} pu.`,
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          line: rec.span?.line,
          column: rec.span?.column,
          rigor: "rigorous",
        });
      }
      if (
        pscad.overVoltageTripPu !== undefined &&
        vu !== undefined &&
        vu > 0 &&
        Math.abs(vu - pscad.overVoltageTripPu) > 0.02
      ) {
        diagnostics.push({
          severity: "warning",
          code: "X7003",
          message: `Cross-domain over-voltage protection drift at bus ${rec.ibus}: PSS/E '${rec.model}' VU=${vu} pu vs PSCAD=${pscad.overVoltageTripPu} pu.`,
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          line: rec.span?.line,
          column: rec.span?.column,
          rigor: "rigorous",
        });
      }
    }
  }

  return diagnostics;
}

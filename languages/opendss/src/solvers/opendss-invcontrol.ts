// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck, DssRecloser } from "../types.js";
import { evaluateTccCurve } from "./opendss-protection.js";

/**
 * Result of IEEE 1547 autonomous inverter control dispatch for a DER unit.
 */
export interface InvControlDerResult {
  derName: string;
  voltagePu: number;
  pActiveKw: number;
  qReactiveKvar: number;
  curtailedKw: number;
  mode: string;
}

/**
 * Result of multi-shot recloser clearing operation.
 */
export interface RecloserSequenceResult {
  recloserName: string;
  faultCurrentAmps: number;
  shots: {
    shotNumber: number;
    curveType: "fast" | "slow";
    tripTimeSeconds: number;
    recloseDelaySeconds: number;
  }[];
  totalClearingTimeSeconds: number;
  finalState: "cleared" | "locked_out";
}

/**
 * Evaluates standard IEEE 1547-2018 Volt-VAR curve Q(V).
 *
 * @param vPu - Measured terminal voltage in per-unit.
 * @param qMaxKvar - Maximum reactive power capability in kVAR.
 * @param vBreakpoints - [V1, V2, V3, V4] voltage setpoints in p.u. (default: [0.92, 0.98, 1.02, 1.08]).
 */
export function evaluateVoltVarCurve(vPu: number, qMaxKvar: number, vBreakpoints = [0.92, 0.98, 1.02, 1.08]): number {
  const [v1, v2, v3, v4] = vBreakpoints;
  if (v1 === undefined || v2 === undefined || v3 === undefined || v4 === undefined) {
    return 0;
  }

  if (vPu <= v1) {
    return qMaxKvar; // Maximum capacitive injection
  }
  if (vPu < v2) {
    const fraction = (v2 - vPu) / (v2 - v1);
    return fraction * qMaxKvar;
  }
  if (vPu <= v3) {
    return 0.0; // Deadband
  }
  if (vPu < v4) {
    const fraction = (vPu - v3) / (v4 - v3);
    return -fraction * qMaxKvar; // Inductive absorption
  }
  return -qMaxKvar;
}

/**
 * Evaluates standard IEEE 1547-2018 Volt-Watt curve P(V).
 *
 * @param vPu - Measured terminal voltage in per-unit.
 * @param pRatedKw - Rated active power output in kW.
 * @param vStartPu - Overvoltage threshold to initiate curtailment (default: 1.05 pu).
 * @param vStopPu - Voltage at maximum curtailment (default: 1.10 pu).
 * @param pMinFraction - Minimum curtailed power level (default: 0.2).
 */
export function evaluateVoltWattCurve(
  vPu: number,
  pRatedKw: number,
  vStartPu = 1.05,
  vStopPu = 1.1,
  pMinFraction = 0.2,
): number {
  if (vPu <= vStartPu) {
    return pRatedKw;
  }
  if (vPu >= vStopPu) {
    return pRatedKw * pMinFraction;
  }
  const ramp = (vPu - vStartPu) / (vStopPu - vStartPu);
  return pRatedKw * (1.0 - ramp * (1.0 - pMinFraction));
}

/**
 * Evaluates autonomous IEEE 1547 InvControl curves across all managed DER units in a circuit.
 */
export function evaluateInvControls(
  deck: DssDeck,
  busVoltagesPu: Map<string, number>,
): Map<string, InvControlDerResult> {
  const results = new Map<string, InvControlDerResult>();
  if (!deck.invControls) return results;

  for (const [, invCtrl] of deck.invControls) {
    for (const derName of invCtrl.derList) {
      // Find PVSystem, Storage, or Generator
      const pv = deck.pvSystems.get(derName);
      const st = deck.storages.get(derName);
      const gen = deck.generators?.get(derName);

      const busName = pv?.bus1 ?? st?.bus1 ?? gen?.bus1;
      if (!busName) continue;

      const vPu = busVoltagesPu.get(busName) ?? 1.0;
      const pRated = pv?.pmpp ?? st?.kwRated ?? gen?.kw ?? 100.0;
      const qMax = pv ? Math.sqrt(Math.max(0, pv.kva * pv.kva - pv.pmpp * pv.pmpp)) || pv.pmpp * 0.44 : pRated * 0.44;

      let pActual = pRated;
      let qActual = 0;

      if (invCtrl.mode === "VOLTVAR" || invCtrl.mode === "COMBINED") {
        qActual = evaluateVoltVarCurve(vPu, qMax, invCtrl.voltageCurveX);
      }
      if (invCtrl.mode === "VOLTWATT" || invCtrl.mode === "COMBINED") {
        pActual = evaluateVoltWattCurve(vPu, pRated);
      }

      results.set(derName, {
        derName,
        voltagePu: vPu,
        pActiveKw: pActual,
        qReactiveKvar: qActual,
        curtailedKw: Math.max(0, pRated - pActual),
        mode: invCtrl.mode,
      });
    }
  }

  return results;
}

export const dispatchInvControl = evaluateInvControls;

/**
 * Simulates a multi-shot recloser operating sequence under an overcurrent fault condition.
 *
 * @param recloser - Recloser device definition with fast/slow curves and reclose intervals.
 * @param deck - Circuit deck containing TCC curves.
 * @param faultCurrentAmps - Fault current passing through recloser.
 * @param isPermanentFault - Whether fault persists (true -> lockout, false -> cleared on intermediate shot).
 */
export function evaluateRecloserSequence(
  recloser: DssRecloser,
  deck: DssDeck,
  faultCurrentAmps: number,
  isPermanentFault = false,
): RecloserSequenceResult {
  const shots: RecloserSequenceResult["shots"] = [];
  const fastCurve = recloser.fastCurve ? deck.tccCurves?.get(recloser.fastCurve) : undefined;
  const slowCurve = recloser.slowCurve ? deck.tccCurves?.get(recloser.slowCurve) : undefined;

  const totalShots = Math.max(1, recloser.numFastShots + recloser.numSlowShots);
  const mult = faultCurrentAmps / Math.max(1.0, recloser.phaseTrip);

  let totalClearingTime = 0;
  let finalState: "cleared" | "locked_out" = "cleared";

  for (let s = 1; s <= totalShots; s++) {
    const isFast = s <= recloser.numFastShots;
    const curve = isFast ? fastCurve : slowCurve;
    const td = isFast ? (recloser.tdPhase ?? 1.0) : (recloser.tdPhase ?? 1.0) * 1.5;
    const tripTime = curve ? evaluateTccCurve(curve, mult) * td : 0.05 * s;
    const delayIdx = s - 1;
    const delay = recloser.intervalSeconds[delayIdx] ?? 0.5 * s;

    shots.push({
      shotNumber: s,
      curveType: isFast ? "fast" : "slow",
      tripTimeSeconds: tripTime,
      recloseDelaySeconds: delay,
    });

    totalClearingTime += tripTime;

    if (!isPermanentFault && s === 1) {
      // Temporary fault cleared on fast trip
      finalState = "cleared";
      break;
    }

    if (s < totalShots) {
      totalClearingTime += delay;
    } else {
      // Reached maximum shots without clearing
      finalState = isPermanentFault ? "locked_out" : "cleared";
    }
  }

  return {
    recloserName: recloser.name,
    faultCurrentAmps,
    shots,
    totalClearingTimeSeconds: totalClearingTime,
    finalState,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-end watershed network simulation for a parsed `Hec1Deck`.
 *
 * Follows the classic USACE HEC-1 hydrograph stack semantics:
 *   - Subbasin (`BA` + precip + loss + UH): computes runoff hydrograph and pushes onto stack.
 *   - Route (`RM` / `RS`): pops top hydrograph, routes it, and pushes routed hydrograph.
 *   - Combine (`HC` with `icomp`): pops `icomp` hydrographs, sums them, and pushes combined hydrograph.
 */

import type {
  Hec1Deck,
  Hec1HydrographPoint,
  Hec1SimulationResult,
  Hec1Station,
  Hec1StationSimulationResult,
} from "../types.js";
import { integrateHydrographVolume, routeMuskingum } from "./muskingum.js";
import { computeExcessHyetograph } from "./scs-cn.js";
import { convolveUnitHydrograph, generateUnitHydrograph } from "./unit-hydrograph.js";

function extractIncrementalPrecip(station: Hec1Station, nq: number): number[] {
  if (station.precipitationIncrements && station.precipitationIncrements.length > 0) {
    return [...station.precipitationIncrements];
  }
  if (station.precipitationCumulative && station.precipitationCumulative.length > 0) {
    const inc: number[] = [];
    let prev = 0.0;
    for (const c of station.precipitationCumulative) {
      inc.push(Math.max(0.0, c - prev));
      prev = c;
    }
    return inc;
  }
  if (station.precipitationTotal !== undefined && station.precipitationTotal > 0) {
    // Distribute total storm depth using an SCS Type II-like symmetric S-curve over first half of NQ
    const stormSteps = Math.max(4, Math.min(nq, 24));
    const inc: number[] = [];
    let prev = 0.0;
    for (let i = 1; i <= stormSteps; i++) {
      const tNorm = i / stormSteps;
      const cumFrac = Math.pow(tNorm, 3) / (Math.pow(tNorm, 3) + Math.pow(1 - tNorm, 3));
      const cumP = cumFrac * station.precipitationTotal;
      inc.push(Math.max(0.0, cumP - prev));
      prev = cumP;
    }
    return inc;
  }
  return [];
}

function summarizeStation(
  station: Hec1Station,
  hydrograph: Hec1HydrographPoint[],
  excessRainTotal?: number,
): Hec1StationSimulationResult {
  let peakFlow = 0.0;
  let timeToPeakHours = 0.0;
  for (const pt of hydrograph) {
    if (pt.flow > peakFlow) {
      peakFlow = pt.flow;
      timeToPeakHours = pt.timeHours;
    }
  }
  return {
    stationId: station.id,
    kind: station.kind,
    hydrograph,
    peakFlow,
    timeToPeakHours,
    totalVolume: integrateHydrographVolume(hydrograph),
    excessRainTotal,
  };
}

/**
 * Simulates all stations in a parsed `Hec1Deck`.
 */
export function simulateHec1Deck(deck: Hec1Deck): Hec1SimulationResult {
  const nmin = deck.timeControl && deck.timeControl.nmin > 0 ? deck.timeControl.nmin : 15;
  const dtHours = nmin / 60.0;
  const nq = deck.timeControl && deck.timeControl.nq > 0 ? deck.timeControl.nq : 100;

  const results = new Map<string, Hec1StationSimulationResult>();
  const stack: Hec1HydrographPoint[][] = [];
  let outletStationId: string | undefined;

  for (const st of deck.stationList) {
    if (st.kind === "subbasin") {
      const incPrecip = extractIncrementalPrecip(st, nq);
      const excess = computeExcessHyetograph(incPrecip, st.loss, dtHours, deck.unitSystem);
      const excessTotal = excess.reduce((acc, v) => acc + v, 0.0);

      const area = st.area && st.area > 0 ? st.area : 1.0;
      const uhSpec = st.unitHydrograph ?? { method: "SCS", tlag: 1.0, line: st.line };
      const uh = generateUnitHydrograph(area, uhSpec, dtHours, deck.unitSystem);
      const baseflow = st.baseflow ? Math.max(0.0, st.baseflow.strtq) : 0.0;

      const hydrograph = convolveUnitHydrograph(excess, uh, dtHours, nq, baseflow);
      stack.push(hydrograph);
      results.set(st.id, summarizeStation(st, hydrograph, excessTotal));
      outletStationId = st.id;
    } else if (st.kind === "route") {
      const upstream = stack.pop();
      if (!upstream) continue;
      let routed: Hec1HydrographPoint[];
      if (st.muskingum) {
        routed = routeMuskingum(upstream, {
          kHours: st.muskingum.amskk,
          x: st.muskingum.x,
          nstps: st.muskingum.nstps,
          dtHours,
        });
      } else if (st.storageRouting) {
        // Fallback linear storage routing (X = 0)
        routed = routeMuskingum(upstream, {
          kHours: Math.max(dtHours, st.storageRouting.nstps * dtHours),
          x: Math.max(0.0, Math.min(0.5, st.storageRouting.x)),
          nstps: st.storageRouting.nstps,
          dtHours,
        });
      } else {
        routed = [...upstream];
      }
      stack.push(routed);
      results.set(st.id, summarizeStation(st, routed));
      outletStationId = st.id;
    } else if (st.kind === "combine") {
      const count = Math.max(2, st.combineCount ?? 2);
      const popped: Hec1HydrographPoint[][] = [];
      for (let k = 0; k < count && stack.length > 0; k++) {
        popped.push(stack.pop()!);
      }
      const len = popped.reduce((m, h) => Math.max(m, h.length), nq);
      const combined: Hec1HydrographPoint[] = new Array<Hec1HydrographPoint>(len);
      for (let i = 0; i < len; i++) {
        let sum = 0.0;
        for (const h of popped) {
          sum += h[i]?.flow ?? 0.0;
        }
        combined[i] = { timeHours: i * dtHours, flow: sum };
      }
      stack.push(combined);
      results.set(st.id, summarizeStation(st, combined));
      outletStationId = st.id;
    }
  }

  return {
    timeStepHours: dtHours,
    unitSystem: deck.unitSystem,
    stations: results,
    outletStationId,
  };
}

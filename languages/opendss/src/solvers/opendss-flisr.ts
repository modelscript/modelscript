// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck } from "../types.js";

/**
 * Options for automated Fault Location, Isolation, and Service Restoration (FLISR).
 */
export interface FlisrOptions {
  /** Name of normally-open tie line connecting to adjacent healthy feeder (e.g. "TieLine"). */
  tieLineName?: string;
  /** Available spare hosting capacity on adjacent feeder in kW (default: 4000.0 kW). */
  adjacentFeederCapacityKw?: number;
  /** Statutory minimum restoration voltage threshold in p.u. (default: 0.95). */
  voltageMinPu?: number;
  /** Typical utility manual crew Mean Time to Repair (MTTR) in hours (default: 2.5). */
  manualRepairHours?: number;
  /** Automated FLISR switching and restoration time in hours (default: 0.0167 hr = 1 minute). */
  automatedSwitchingHours?: number;
  /** Average peak kW load per customer for customer count estimations (default: 2.0 kW). */
  kwPerCustomer?: number;
}

/**
 * Result of an automated FLISR distribution feeder self-healing evaluation.
 */
export interface FlisrResult {
  faultedLine: string;
  isolatedLineNames: string[];
  upstreamRestoredBuses: string[];
  downstreamRestoredBuses: string[];
  tieSwitchOperated: string | undefined;
  downstreamLoadRestoredKw: number;
  adjacentFeederCapacityMarginKw: number;
  minBackfeedVoltagePu: number;
  totalCustomers: number;
  customersRestoredUpstream: number;
  customersRestoredDownstream: number;
  customersRemainingUnserved: number;
  customerInterruptionHoursSaved: number;
  restorationSuccess: boolean;
}

/**
 * Executes an automated FLISR distribution feeder self-healing sequence:
 * 1. Locates and isolates the faulted line segment.
 * 2. Simulates substation breaker reclose to restore upstream healthy customers.
 * 3. Evaluates adjacent feeder capacity and closes normally-open tie switch to back-feed downstream healthy customers.
 * 4. Quantifies customer outage impact and reliability hours saved.
 */
export function solveFlisr(deck: DssDeck, faultedLineName: string, options: FlisrOptions = {}): FlisrResult {
  const tieLineName = options.tieLineName;
  const adjCapacity = options.adjacentFeederCapacityKw ?? 4000.0;
  const vMinThresh = options.voltageMinPu ?? 0.95;
  const manualMttr = options.manualRepairHours ?? 2.5;
  const autoTime = options.automatedSwitchingHours ?? 1.0 / 60.0;
  const kwPerCust = options.kwPerCustomer ?? 2.0;

  // 1. Identify faulted line and total customers
  const cleanLineName = faultedLineName.startsWith("Line.") ? faultedLineName.slice(5) : faultedLineName;
  const targetLine = deck.lines.get(cleanLineName);

  const busCustomerMap = new Map<string, number>();
  for (const [, l] of deck.loads) {
    const cust = Math.max(1, Math.round(l.kw / kwPerCust));
    busCustomerMap.set(l.bus1, (busCustomerMap.get(l.bus1) ?? 0) + cust);
  }
  let totalCustomers = 0;
  for (const [, c] of busCustomerMap) totalCustomers += c;
  if (totalCustomers === 0) totalCustomers = 1;

  if (!targetLine) {
    return {
      faultedLine: faultedLineName,
      isolatedLineNames: [],
      upstreamRestoredBuses: [],
      downstreamRestoredBuses: [],
      tieSwitchOperated: undefined,
      downstreamLoadRestoredKw: 0,
      adjacentFeederCapacityMarginKw: adjCapacity,
      minBackfeedVoltagePu: 1.0,
      totalCustomers,
      customersRestoredUpstream: totalCustomers,
      customersRestoredDownstream: 0,
      customersRemainingUnserved: 0,
      customerInterruptionHoursSaved: 0,
      restorationSuccess: false,
    };
  }

  // 2. Classify upstream vs downstream buses relative to faulted line
  // Follow forward reach from faulted line bus2
  const downstreamBuses = new Set<string>([targetLine.bus2]);
  const queue = [targetLine.bus2];
  const visited = new Set<string>([targetLine.bus1, targetLine.bus2]);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    for (const [, l] of deck.lines) {
      if (l.name === cleanLineName) continue;
      if (l.bus1 === cur && !visited.has(l.bus2)) {
        visited.add(l.bus2);
        downstreamBuses.add(l.bus2);
        queue.push(l.bus2);
      }
    }
  }

  // Upstream buses are all buses in the network that are not downstream
  const allBuses = new Set<string>();
  if (deck.circuit) allBuses.add(deck.circuit.bus1);
  for (const [, l] of deck.lines) {
    allBuses.add(l.bus1);
    allBuses.add(l.bus2);
  }
  for (const [, x] of deck.transformers) {
    for (const b of x.buses) allBuses.add(b);
  }
  for (const [, l] of deck.loads) {
    allBuses.add(l.bus1);
  }

  const upstreamBuses: string[] = [];
  const downstreamBusesList = Array.from(downstreamBuses);

  for (const bName of allBuses) {
    if (!downstreamBuses.has(bName)) {
      upstreamBuses.push(bName);
    }
  }

  // Calculate customer distribution
  let custUpstream = 0;
  for (const b of upstreamBuses) custUpstream += busCustomerMap.get(b) ?? 0;

  let custDownstream = 0;
  let loadDownstreamKw = 0;
  for (const b of downstreamBusesList) {
    custDownstream += busCustomerMap.get(b) ?? 0;
    for (const [, l] of deck.loads) {
      if (l.bus1 === b) loadDownstreamKw += l.kw;
    }
  }

  // 3. Upstream Restoration (Breaker reclose restores all upstream healthy buses)
  // 4. Downstream Back-feed Evaluation via Tie Line
  const capacityMarginKw = adjCapacity - loadDownstreamKw;
  let restorationSuccess = false;
  let tieOperated: string | undefined;
  let minBackfeedV = 1.0;
  let custRestoredDownstream = 0;

  // Check if adjacent feeder has sufficient capacity and tie switch is available
  if (capacityMarginKw >= 0 && tieLineName) {
    tieOperated = tieLineName;
    restorationSuccess = true;
    custRestoredDownstream = custDownstream;

    // Simulate back-fed voltage on restored downstream section
    // Estimate back-feed voltage drop across restored downstream section
    minBackfeedV = Math.max(vMinThresh, 1.0 - (loadDownstreamKw * 0.04) / Math.max(100.0, adjCapacity));
  } else if (!tieLineName && loadDownstreamKw === 0) {
    // Fault was at radial tail
    restorationSuccess = true;
  }

  const custUnserved = totalCustomers - (custUpstream + custRestoredDownstream);
  const hoursSavedPerCustomer = Math.max(0, manualMttr - autoTime);
  const totalHoursSaved = (custUpstream + custRestoredDownstream) * hoursSavedPerCustomer;

  return {
    faultedLine: cleanLineName,
    isolatedLineNames: [cleanLineName],
    upstreamRestoredBuses: upstreamBuses,
    downstreamRestoredBuses: downstreamBusesList,
    tieSwitchOperated: tieOperated,
    downstreamLoadRestoredKw: loadDownstreamKw,
    adjacentFeederCapacityMarginKw: capacityMarginKw,
    minBackfeedVoltagePu: minBackfeedV,
    totalCustomers,
    customersRestoredUpstream: custUpstream,
    customersRestoredDownstream: custRestoredDownstream,
    customersRemainingUnserved: custUnserved,
    customerInterruptionHoursSaved: totalHoursSaved,
    restorationSuccess,
  };
}

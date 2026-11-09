// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck } from "../types.js";

/**
 * Predictive reliability indices conforming to IEEE 1366 standard.
 */
export interface SystemReliabilityIndices {
  /** System Average Interruption Frequency Index (interruptions / customer / year). */
  saifi: number;
  /** System Average Interruption Duration Index (hours / customer / year). */
  saidi: number;
  /** Customer Average Interruption Duration Index (hours / interruption). */
  caidi: number;
  /** Average Service Availability Index (fraction between 0 and 1, typically > 0.9998). */
  asai: number;
  /** Total Expected Energy Not Supplied (kWh / year). */
  eenKwh: number;
  /** Total customers served across the distribution feeder. */
  totalCustomers: number;
}

/**
 * Per-bus reliability performance summary.
 */
export interface BusReliabilityResult {
  busName: string;
  customers: number;
  averageOutagesPerYear: number;
  annualOutageHours: number;
  eenKwh: number;
}

/**
 * Complete distribution feeder predictive reliability study result.
 */
export interface ReliabilityResult {
  system: SystemReliabilityIndices;
  buses: Map<string, BusReliabilityResult>;
  criticalBranches: {
    lineName: string;
    annualFailures: number;
    customersAffected: number;
    impactScore: number;
  }[];
}

/**
 * Options for distribution predictive reliability evaluation.
 */
export interface ReliabilityOptions {
  /** Overhead line failure rate in faults per km per year (default: 0.08). */
  overheadFaultRatePerKm?: number;
  /** Cable failure rate in faults per km per year (default: 0.02). */
  cableFaultRatePerKm?: number;
  /** Mean Time to Repair (MTTR) in hours (default: 2.5). */
  meanTimeToRepairHours?: number;
  /** Average peak kW load per customer (default: 2.0 kW/cust). */
  kwPerCustomer?: number;
}

/**
 * Evaluates predictive distribution system reliability indices (SAIFI, SAIDI, CAIDI, ASAI, EEN)
 * based on network topology, line failure rates, and downstream customer exposure.
 */
export function solveReliability(deck: DssDeck, options: ReliabilityOptions = {}): ReliabilityResult {
  const faultRatePerKm = options.overheadFaultRatePerKm ?? 0.08;
  const mttr = options.meanTimeToRepairHours ?? 2.5;
  const kwPerCust = options.kwPerCustomer ?? 2.0;

  // 1. Calculate customer count per bus based on connected load kW
  const busCustomers = new Map<string, number>();
  const busLoadKw = new Map<string, number>();
  let totalCustomers = 0;

  for (const [, load] of deck.loads) {
    const cust = Math.max(1, Math.round(load.kw / kwPerCust));
    busCustomers.set(load.bus1, (busCustomers.get(load.bus1) ?? 0) + cust);
    busLoadKw.set(load.bus1, (busLoadKw.get(load.bus1) ?? 0) + load.kw);
    totalCustomers += cust;
  }
  if (totalCustomers === 0) totalCustomers = 1;

  // 2. Track downstream reach of each line (topological dependency)
  const lineDownstreamBuses = new Map<string, Set<string>>();
  for (const [lineName, line] of deck.lines) {
    const reachable = new Set<string>([line.bus2]);
    // Follow downstream lines from bus2
    const queue = [line.bus2];
    const visited = new Set<string>([line.bus1, line.bus2]);

    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      for (const [, otherLine] of deck.lines) {
        if (otherLine.bus1 === cur && !visited.has(otherLine.bus2)) {
          visited.add(otherLine.bus2);
          reachable.add(otherLine.bus2);
          queue.push(otherLine.bus2);
        }
      }
    }
    lineDownstreamBuses.set(lineName, reachable);
  }

  // 3. Accumulate outages per bus
  const busOutages = new Map<string, number>();
  const busOutageHours = new Map<string, number>();
  const busEen = new Map<string, number>();
  const criticalBranches: ReliabilityResult["criticalBranches"] = [];

  for (const [lineName, line] of deck.lines) {
    const lambda = line.length * faultRatePerKm;
    const downstream = lineDownstreamBuses.get(lineName) ?? new Set();

    let affectedCust = 0;
    for (const b of downstream) {
      const cust = busCustomers.get(b) ?? 0;
      affectedCust += cust;
      if (cust > 0) {
        busOutages.set(b, (busOutages.get(b) ?? 0) + lambda);
        busOutageHours.set(b, (busOutageHours.get(b) ?? 0) + lambda * mttr);
        const kw = busLoadKw.get(b) ?? 0;
        busEen.set(b, (busEen.get(b) ?? 0) + lambda * mttr * kw);
      }
    }

    criticalBranches.push({
      lineName,
      annualFailures: lambda,
      customersAffected: affectedCust,
      impactScore: lambda * affectedCust * mttr,
    });
  }

  // Sort critical branches by impact score (highest outage risk first)
  criticalBranches.sort((a, b) => b.impactScore - a.impactScore);

  // 4. Compute system-wide IEEE 1366 indices
  let sumCustomerOutages = 0;
  let sumCustomerOutageHours = 0;
  let totalEenKwh = 0;

  const busResults = new Map<string, BusReliabilityResult>();

  for (const [busName, cust] of busCustomers) {
    const outages = busOutages.get(busName) ?? 0;
    const hours = busOutageHours.get(busName) ?? 0;
    const een = busEen.get(busName) ?? 0;

    sumCustomerOutages += outages * cust;
    sumCustomerOutageHours += hours * cust;
    totalEenKwh += een;

    busResults.set(busName, {
      busName,
      customers: cust,
      averageOutagesPerYear: outages,
      annualOutageHours: hours,
      eenKwh: een,
    });
  }

  const saifi = sumCustomerOutages / totalCustomers;
  const saidi = sumCustomerOutageHours / totalCustomers;
  const caidi = saifi > 1e-6 ? saidi / saifi : 0;
  const asai = Math.max(0, 1.0 - saidi / 8760);

  return {
    system: {
      saifi,
      saidi,
      caidi,
      asai,
      eenKwh: totalEenKwh,
      totalCustomers,
    },
    buses: busResults,
    criticalBranches,
  };
}

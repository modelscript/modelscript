// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Distribution Network Reliability Assessment Engine (IEEE 1366 / IEC 60050-191).
 *
 * Implements predictive reliability analysis for distribution feeders:
 * - Failure Modes and Effects Analysis (FMEA).
 * - Upstream protective devices (Breakers, Reclosers, Fuses).
 * - Sectionalizing switches and automated FLISR (Fault Location, Isolation, and Service Restoration).
 * - Normally open tie switches for backfeeding downstream healthy segments.
 * - Computation of IEEE 1366 standard indices:
 *   SAIFI, SAIDI, CAIDI, ASAI, MAIFI, EENS, ASIFI, ASIDI.
 */

export type ProtectionDeviceType = "circuit_breaker" | "recloser" | "fuse" | "sectionalizer" | "disconnect";

export interface ReliabilityProtectionDevice {
  id: string;
  type: ProtectionDeviceType;
  branchId: string; // Branch where device is installed
  hasAutoReclosing?: boolean; // For reclosers / CBs: clears temporary faults
  isAutomated?: boolean; // For automated switches (FLISR remote control)
  switchingTimeHours?: number; // Time to open/close (e.g. 0.05h for FLISR, 0.75h for manual)
}

export interface ReliabilityTieSwitch {
  id: string;
  fromBus: string;
  toBus: string;
  normallyOpen: boolean; // default true
  reserveCapacityMw: number; // Max power capacity available for backfeeding
  switchingTimeHours: number; // Time to close tie switch (e.g. 0.1h automated, 1.0h manual)
}

export interface ReliabilityBranch {
  id: string;
  fromBus: string;
  toBus: string;
  lengthKm?: number;
  failureRatePerYear?: number; // Total annual permanent failure rate lambda (failures/year)
  failureRatePerKmYear?: number; // Fault rate per km (default 0.06 faults/km/yr for OHL, 0.02 for cable)
  temporaryFailureRateFactor?: number; // Ratio of temp faults to permanent (default 3.0)
  repairTimeHours?: number; // Mean Time to Repair MTTR (default 3.5 hours)
  isUnderground?: boolean;
}

export interface ReliabilityLoadPoint {
  busId: string;
  customerCount: number; // N_i
  averageLoadKw: number; // P_i
  priorityCustomerCount?: number; // Critical customers (hospitals, data centers)
}

export interface DistributionFeederReliabilityModel {
  feederId: string;
  sourceBusId: string;
  branches: ReliabilityBranch[];
  loadPoints: ReliabilityLoadPoint[];
  protectionDevices?: ReliabilityProtectionDevice[];
  tieSwitches?: ReliabilityTieSwitch[];
}

export interface LoadPointReliabilityResult {
  busId: string;
  customerCount: number;
  averageLoadKw: number;
  annualInterruptionFrequency: number; // lambda_i (sustained int/yr)
  annualMomentaryInterruptionFrequency: number; // lambda_i,temp (momentary int/yr)
  annualOutageDurationHours: number; // U_i (hrs/yr)
  energyNotSuppliedKwh: number; // EENS_i (kWh/yr)
}

export interface SystemReliabilityIndices {
  saifi: number; // System Average Interruption Frequency Index (int/cust/yr)
  saidi: number; // System Average Interruption Duration Index (hrs/cust/yr)
  caidi: number; // Customer Average Interruption Duration Index (hrs/int)
  asai: number; // Average Service Availability Index (fraction 0..1)
  maifi: number; // Momentary Average Interruption Frequency Index (mom/cust/yr)
  eensMwh: number; // Expected Energy Not Supplied (MWh/yr)
  asifi: number; // Average System Interruption Frequency Index (load-weighted)
  asidi: number; // Average System Interruption Duration Index (load-weighted)
  totalCustomers: number;
  totalLoadKw: number;
}

export interface DistributionReliabilityStudyResult {
  feederId: string;
  system: SystemReliabilityIndices;
  loadPoints: Map<string, LoadPointReliabilityResult>;
  criticalBranches: {
    branchId: string;
    annualFailures: number;
    affectedCustomers: number;
    contributionToSaidiHours: number;
  }[];
}

/**
 * Executes a predictive reliability assessment on a distribution feeder model.
 */
export function evaluateDistributionReliability(
  model: DistributionFeederReliabilityModel,
): DistributionReliabilityStudyResult {
  // 1. Build adjacency graph and identify upstream paths from sourceBusId
  const adj = new Map<string, { to: string; branch: ReliabilityBranch }[]>();
  for (const b of model.branches) {
    if (!adj.has(b.fromBus)) adj.set(b.fromBus, []);
    if (!adj.has(b.toBus)) adj.set(b.toBus, []);
    adj.get(b.fromBus)!.push({ to: b.toBus, branch: b });
    adj.get(b.toBus)!.push({ to: b.fromBus, branch: b });
  }

  // Radial BFS to determine parent pointers, tree depth, and paths
  const parentBranch = new Map<string, { parentBus: string; branch: ReliabilityBranch }>();
  const visited = new Set<string>();
  const queue = [model.sourceBusId];
  visited.add(model.sourceBusId);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const edge of adj.get(cur) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        parentBranch.set(edge.to, { parentBus: cur, branch: edge.branch });
        queue.push(edge.to);
      }
    }
  }

  // Device index by branch
  const devicesByBranch = new Map<string, ReliabilityProtectionDevice[]>();
  for (const dev of model.protectionDevices ?? []) {
    if (!devicesByBranch.has(dev.branchId)) devicesByBranch.set(dev.branchId, []);
    devicesByBranch.get(dev.branchId)!.push(dev);
  }

  // Determine path of branches from source to every bus
  const pathToBus = new Map<string, ReliabilityBranch[]>();
  for (const lp of model.loadPoints) {
    const path: ReliabilityBranch[] = [];
    let cur = lp.busId;
    while (cur !== model.sourceBusId && parentBranch.has(cur)) {
      const p = parentBranch.get(cur)!;
      path.push(p.branch);
      cur = p.parentBus;
    }
    path.reverse();
    pathToBus.set(lp.busId, path);
  }

  // 2. Perform FMEA: For each branch k in the feeder, determine its impact on every load point l
  const lpResults = new Map<
    string,
    {
      lambda: number;
      lambdaTemp: number;
      unavailabilityHours: number;
      eensKwh: number;
    }
  >();

  for (const lp of model.loadPoints) {
    lpResults.set(lp.busId, { lambda: 0, lambdaTemp: 0, unavailabilityHours: 0, eensKwh: 0 });
  }

  const branchSaidiContrib = new Map<string, number>();

  for (const branch of model.branches) {
    // Failure rates
    const len = branch.lengthKm ?? 1.0;
    const ratePerKm = branch.failureRatePerKmYear ?? (branch.isUnderground ? 0.02 : 0.06);
    const lambdaPerm = branch.failureRatePerYear ?? ratePerKm * len;
    const tempFactor = branch.temporaryFailureRateFactor ?? 3.0;
    const lambdaTemp = lambdaPerm * tempFactor;
    const mttr = branch.repairTimeHours ?? (branch.isUnderground ? 8.0 : 3.5);

    // Protection on this branch or upstream
    // Find closest upstream protective device
    let isFusedLateral = false;
    for (const d of devicesByBranch.get(branch.id) ?? []) {
      if (d.type === "fuse") {
        isFusedLateral = true;
        break;
      }
    }

    let saidiAccumForBranch = 0;

    for (const lp of model.loadPoints) {
      const path = pathToBus.get(lp.busId) ?? [];
      const branchOnPath = path.some((b) => b.id === branch.id);
      const res = lpResults.get(lp.busId)!;

      if (branchOnPath) {
        // Fault is upstream of load point -> sustained interruption
        // Can load point be backfed via tie switch?
        let canBackfeed = false;
        let switchTime = 0.75; // 45 min default sectionalizing
        if (model.tieSwitches && model.tieSwitches.length > 0) {
          const tie = model.tieSwitches[0]!;
          if (tie.normallyOpen && tie.reserveCapacityMw * 1000 >= lp.averageLoadKw) {
            canBackfeed = true;
            switchTime = tie.switchingTimeHours;
          }
        }

        const duration = canBackfeed ? switchTime : mttr;
        res.lambda += lambdaPerm;
        res.unavailabilityHours += lambdaPerm * duration;
        res.eensKwh += lambdaPerm * duration * lp.averageLoadKw;

        saidiAccumForBranch += lambdaPerm * duration * lp.customerCount;

        // Temporary fault: if upstream recloser exists, it clears temp faults without sustained outage
        const hasRecloser = path.some((b) =>
          (devicesByBranch.get(b.id) ?? []).some((d) => d.type === "recloser" || d.hasAutoReclosing),
        );
        if (hasRecloser) {
          res.lambdaTemp += lambdaTemp;
        } else {
          // No auto-reclosing -> temp fault becomes permanent trip
          res.lambda += lambdaTemp;
          res.unavailabilityHours += lambdaTemp * 0.5; // Quick manual reclose
          res.eensKwh += lambdaTemp * 0.5 * lp.averageLoadKw;
        }
      } else {
        // Fault is not on path to this load point (it's on an adjacent or lateral branch)
        if (isFusedLateral) {
          // Fused lateral faults do NOT interrupt healthy backbone customers!
          // No impact.
        } else {
          // Fault is on an unfused lateral or adjacent feeder segment.
          // Main feeder breaker trips, sectionalizer isolates faulted branch in t_iso, then breaker recloses.
          const sectionalizerTime = 0.5; // 30 min to isolate faulted section and re-energize healthy
          res.lambda += lambdaPerm;
          res.unavailabilityHours += lambdaPerm * sectionalizerTime;
          res.eensKwh += lambdaPerm * sectionalizerTime * lp.averageLoadKw;

          saidiAccumForBranch += lambdaPerm * sectionalizerTime * lp.customerCount;
        }
      }
    }

    branchSaidiContrib.set(branch.id, saidiAccumForBranch);
  }

  // 3. Aggregate IEEE 1366 System Indices
  let totalCustomers = 0;
  let totalLoadKw = 0;
  let sumLambdaCust = 0;
  let sumLambdaTempCust = 0;
  let sumDurationCust = 0;
  let sumLambdaLoad = 0;
  let sumDurationLoad = 0;
  let totalEensKwh = 0;

  const finalLpResults = new Map<string, LoadPointReliabilityResult>();

  for (const lp of model.loadPoints) {
    const raw = lpResults.get(lp.busId)!;
    totalCustomers += lp.customerCount;
    totalLoadKw += lp.averageLoadKw;

    sumLambdaCust += raw.lambda * lp.customerCount;
    sumLambdaTempCust += raw.lambdaTemp * lp.customerCount;
    sumDurationCust += raw.unavailabilityHours * lp.customerCount;

    sumLambdaLoad += raw.lambda * lp.averageLoadKw;
    sumDurationLoad += raw.unavailabilityHours * lp.averageLoadKw;
    totalEensKwh += raw.eensKwh;

    finalLpResults.set(lp.busId, {
      busId: lp.busId,
      customerCount: lp.customerCount,
      averageLoadKw: lp.averageLoadKw,
      annualInterruptionFrequency: Math.round(raw.lambda * 1e4) / 1e4,
      annualMomentaryInterruptionFrequency: Math.round(raw.lambdaTemp * 1e4) / 1e4,
      annualOutageDurationHours: Math.round(raw.unavailabilityHours * 1e3) / 1e3,
      energyNotSuppliedKwh: Math.round(raw.eensKwh * 10) / 10,
    });
  }

  const nCust = Math.max(1, totalCustomers);
  const nLoad = Math.max(1, totalLoadKw);

  const saifi = sumLambdaCust / nCust;
  const saidi = sumDurationCust / nCust;
  const caidi = saifi > 0 ? saidi / saifi : 0;
  const asai = (8760 * nCust - sumDurationCust) / (8760 * nCust);
  const maifi = sumLambdaTempCust / nCust;
  const eensMwh = totalEensKwh / 1000;
  const asifi = sumLambdaLoad / nLoad;
  const asidi = sumDurationLoad / nLoad;

  // Critical branches ranked by SAIDI contribution
  const criticalBranches = model.branches
    .map((b) => {
      const len = b.lengthKm ?? 1.0;
      const ratePerKm = b.failureRatePerKmYear ?? (b.isUnderground ? 0.02 : 0.06);
      const lambdaPerm = b.failureRatePerYear ?? ratePerKm * len;
      const saidiContrib = (branchSaidiContrib.get(b.id) ?? 0) / nCust;
      return {
        branchId: b.id,
        annualFailures: Math.round(lambdaPerm * 1e3) / 1e3,
        affectedCustomers: totalCustomers,
        contributionToSaidiHours: Math.round(saidiContrib * 1e3) / 1e3,
      };
    })
    .sort((a, b) => b.contributionToSaidiHours - a.contributionToSaidiHours);

  return {
    feederId: model.feederId,
    system: {
      saifi: Math.round(saifi * 1e4) / 1e4,
      saidi: Math.round(saidi * 1e3) / 1e3,
      caidi: Math.round(caidi * 1e3) / 1e3,
      asai: Math.round(asai * 1e6) / 1e6,
      maifi: Math.round(maifi * 1e3) / 1e3,
      eensMwh: Math.round(eensMwh * 100) / 100,
      asifi: Math.round(asifi * 1e4) / 1e4,
      asidi: Math.round(asidi * 1e3) / 1e3,
      totalCustomers,
      totalLoadKw,
    },
    loadPoints: finalLpResults,
    criticalBranches,
  };
}

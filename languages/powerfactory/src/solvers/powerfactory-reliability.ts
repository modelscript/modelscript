// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PowerFactory Distribution Network Predictive Reliability Bridge.
 *
 * Bridges PowerFactory models directly into the IEEE 1366 reliability assessment engine.
 */

import {
  type DistributionFeederReliabilityModel,
  type DistributionReliabilityStudyResult,
  evaluateDistributionReliability,
  type ReliabilityBranch,
  type ReliabilityLoadPoint,
  type ReliabilityProtectionDevice,
} from "@modelscript/simulate";
import type { PowerFactoryModel } from "../types.js";

export interface PowerFactoryReliabilityOptions {
  sourceBusId?: string;
  defaultCustomerPerKw?: number; // Customers per kW of load (default 0.5, i.e. 2 kW/customer)
  overheadLineFaultRatePerKm?: number; // default: 0.06 faults/km/yr
  cableFaultRatePerKm?: number; // default: 0.02 faults/km/yr
  meanTimeToRepairHours?: number; // default: 3.5 hours
}

/**
 * Evaluates IEEE 1366 reliability indices for a PowerFactory distribution grid.
 */
export function solvePowerFactoryReliability(
  model: PowerFactoryModel,
  options?: PowerFactoryReliabilityOptions,
): DistributionReliabilityStudyResult {
  // 1. Identify source bus (substation or slack terminal)
  let sourceBusId = options?.sourceBusId;
  if (!sourceBusId) {
    // Pick first substation terminal or first terminal with a synchronous generator
    for (const [, gen] of model.generators) {
      if (gen.bus1Id) {
        sourceBusId = gen.bus1Id;
        break;
      }
    }
  }
  if (!sourceBusId && model.terminals.size > 0) {
    sourceBusId = model.terminals.keys().next().value!;
  }
  if (!sourceBusId) {
    sourceBusId = "Substation";
  }

  // 2. Extract branches (lines + transformers)
  const branches: ReliabilityBranch[] = [];
  const ohlRate = options?.overheadLineFaultRatePerKm ?? 0.06;
  const cableRate = options?.cableFaultRatePerKm ?? 0.02;
  const mttr = options?.meanTimeToRepairHours ?? 3.5;

  for (const [id, line] of model.lines) {
    const fromBus = line.bus1Id || "unknown_from";
    const toBus = line.bus2Id || "unknown_to";
    const len = line.dline && line.dline > 0 ? line.dline : 1.0;
    const isCable = line.loc_name.toLowerCase().includes("cable") || line.loc_name.toLowerCase().includes("cbl");
    const ratePerKm = isCable ? cableRate : ohlRate;

    branches.push({
      id,
      fromBus,
      toBus,
      lengthKm: len,
      failureRatePerYear: len * ratePerKm,
      repairTimeHours: mttr,
      isUnderground: isCable,
    });
  }

  for (const [id, tr] of model.transformers2w) {
    branches.push({
      id,
      fromBus: tr.bushvId || "unknown_from",
      toBus: tr.buslvId || "unknown_to",
      lengthKm: 0.05,
      failureRatePerYear: 0.015, // Low transformer failure rate
      repairTimeHours: 12.0, // High transformer replacement time
      isUnderground: false,
    });
  }

  // 3. Extract load points
  const loadPoints: ReliabilityLoadPoint[] = [];
  const custPerKw = options?.defaultCustomerPerKw ?? 0.5;

  for (const [, load] of model.loads) {
    const busId = load.bus1Id || "unknown_bus";
    const pKw = Math.max(10.0, (load.plini || 1.0) * 1000);
    const customers = Math.max(1, Math.round(pKw * custPerKw));

    loadPoints.push({
      busId,
      customerCount: customers,
      averageLoadKw: pKw,
    });
  }

  // Fallback: If no explicit loads, add load points at non-source terminals
  if (loadPoints.length === 0) {
    for (const [termId] of model.terminals) {
      if (termId !== sourceBusId) {
        loadPoints.push({
          busId: termId,
          customerCount: 200,
          averageLoadKw: 500,
        });
      }
    }
  }

  // 4. Extract protection devices
  const protectionDevices: ReliabilityProtectionDevice[] = [];
  for (const [swId, sw] of model.switches) {
    const isBreaker =
      sw.loc_name.toLowerCase().includes("brk") ||
      sw.loc_name.toLowerCase().includes("cb") ||
      sw.loc_name.toLowerCase().includes("q");

    protectionDevices.push({
      id: swId,
      type: isBreaker ? "circuit_breaker" : "sectionalizer",
      branchId: sw.bus1Id || "unknown",
      hasAutoReclosing: isBreaker,
    });
  }

  const feederModel: DistributionFeederReliabilityModel = {
    feederId: model.name || "PowerFactory_Feeder",
    sourceBusId,
    branches,
    loadPoints,
    protectionDevices,
  };

  return evaluateDistributionReliability(feederModel);
}

export { evaluateDistributionReliability };

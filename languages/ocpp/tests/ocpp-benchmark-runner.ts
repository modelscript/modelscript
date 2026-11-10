// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for OCPP 2.0.1 Smart Charging & EV Fleet Power Allocation.
 *
 * Evaluates:
 * 1. Multi-EVSE fleet depot with concurrent charging sessions
 * 2. Urgency-weighted smart charging power distribution under transformer grid limit
 * 3. Energy required and time-to-target calculations
 * 4. Lowering to structurally square DAEBuilder linear memory arena
 */

import assert from "node:assert/strict";
import {
  lowerOcppToDae,
  parseOcpp,
  scheduleSmartCharging,
  type AllocationResult,
  type OcppNetwork,
} from "../src/index.js";

export const OCPP_FLEET_DEPOT_BENCHMARK = `
station "Metro_Transit_Depot" {
  gridLimitKW: 350.0

  evse 1 {
    connector 1 {
      maxPowerKW: 150.0
      currentSession: {
        transactionId: "BUS-401"
        evBatteryCapacityKWh: 280.0
        currentSoC: 0.15
        targetSoC: 0.85
        departureMinutes: 45
      }
    }
  }

  evse 2 {
    connector 1 {
      maxPowerKW: 150.0
      currentSession: {
        transactionId: "VAN-102"
        evBatteryCapacityKWh: 120.0
        currentSoC: 0.30
        targetSoC: 0.90
        departureMinutes: 30
      }
    }
  }

  evse 3 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "VAN-105"
        evBatteryCapacityKWh: 90.0
        currentSoC: 0.50
        targetSoC: 0.95
        departureMinutes: 90
      }
    }
  }

  evse 4 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "CAR-018"
        evBatteryCapacityKWh: 75.0
        currentSoC: 0.20
        targetSoC: 0.80
        departureMinutes: 120
      }
    }
  }
}
`;

export interface OcppBenchmarkMetrics {
  stationsCount: number;
  evseCount: number;
  activeSessionsCount: number;
  totalAllocatedPowerKW: number;
  gridLimitKW: number;
  gridLimitRespected: boolean;
  busAllocatedKW: number;
  vanAllocatedKW: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runOcppBenchmark(
  networkStr = OCPP_FLEET_DEPOT_BENCHMARK,
): OcppBenchmarkMetrics {
  const net: OcppNetwork = parseOcpp(networkStr);

  assert.equal(net.stations.length, 1);
  const station = net.stations[0]!;
  assert.equal(station.evses.length, 4);

  const allocations: AllocationResult[] = scheduleSmartCharging(net);
  assert.equal(allocations.length, 4);

  let totalAllocated = 0;
  for (const a of allocations) {
    totalAllocated += a.allocatedPowerKW;
    assert.ok(a.allocatedPowerKW > 0, "Allocated power must be > 0");
    assert.ok(a.energyRequiredKWh > 0, "Energy required must be > 0");
    assert.ok(a.estimatedTimeToTargetMinutes > 0, "Time to target must be > 0");
  }

  assert.ok(
    totalAllocated <= station.gridLimitKW + 1e-3,
    `Total allocated ${totalAllocated} must not exceed gridLimit ${station.gridLimitKW}`,
  );

  const bus401 = allocations.find((a) => a.transactionId === "BUS-401")!;
  const van102 = allocations.find((a) => a.transactionId === "VAN-102")!;
  const van105 = allocations.find((a) => a.transactionId === "VAN-105")!;
  const car018 = allocations.find((a) => a.transactionId === "CAR-018")!;

  assert.ok(bus401 && van102 && van105 && car018);
  // VAN-102 departs in 30 mins, highest urgency -> should receive close to connector max (150kW) or high proportion
  assert.ok(van102.allocatedPowerKW >= van105.allocatedPowerKW);

  // DAE Lowering
  const arena = lowerOcppToDae(net);
  const varCount = arena.getVarCount();
  const eqCount = arena.getEqCount();

  assert.equal(varCount, 14, `Expected 14 DAE variables, got ${varCount}`);
  assert.equal(eqCount, 14, `Expected 14 DAE equations, got ${eqCount}`);
  assert.equal(varCount, eqCount, "OCPP DAE must be structurally square");

  return {
    stationsCount: net.stations.length,
    evseCount: station.evses.length,
    activeSessionsCount: allocations.length,
    totalAllocatedPowerKW: totalAllocated,
    gridLimitKW: station.gridLimitKW,
    gridLimitRespected: totalAllocated <= station.gridLimitKW + 1e-3,
    busAllocatedKW: bus401.allocatedPowerKW,
    vanAllocatedKW: van102.allocatedPowerKW,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("ocpp-benchmark-runner.ts")) {
  const m = runOcppBenchmark();
  console.log("OCPP Benchmark Results:", m);
}

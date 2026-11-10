// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOcpp } from "../src/parser/ocpp-parser.js";
import { scheduleSmartCharging } from "../src/solver/charging-scheduler.js";

const OVERLOADED_STATION = `
station "Overloaded_Hub" {
  gridLimitKW: 120.0

  evse 1 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "EV-1"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.1
        targetSoC: 0.9
        departureMinutes: 30
      }
    }
  }

  evse 2 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "EV-2"
        evBatteryCapacityKWh: 100.0
        currentSoC: 0.4
        targetSoC: 0.8
        departureMinutes: 120
      }
    }
  }
}
`;

describe("OCPP Smart Charging Scheduler", () => {
  it("throttles and balances power when total connector capacity exceeds transformer limit", () => {
    const net = parseOcpp(OVERLOADED_STATION);
    const results = scheduleSmartCharging(net);

    assert.strictEqual(results.length, 2);

    const ev1 = results.find((r) => r.transactionId === "EV-1")!;
    const ev2 = results.find((r) => r.transactionId === "EV-2")!;

    // Total allocated power must strictly respect the 120 kW grid limit
    const totalAllocated = ev1.allocatedPowerKW + ev2.allocatedPowerKW;
    assert.ok(
      totalAllocated <= 120.0 + 0.1,
      `Total power ${totalAllocated} kW must not exceed gridLimit 120 kW`,
    );

    // EV-1 has 30 min departure (urgent) vs EV-2 with 120 min departure (relaxed)
    // Urgency-weighted scheduling must grant higher power to EV-1
    assert.ok(
      ev1.allocatedPowerKW > ev2.allocatedPowerKW,
      `Urgent EV-1 (${ev1.allocatedPowerKW} kW) should receive more power than EV-2 (${ev2.allocatedPowerKW} kW)`,
    );
  });
});

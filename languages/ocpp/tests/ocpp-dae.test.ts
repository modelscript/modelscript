// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerOcppToDae } from "../src/dae/ocpp-to-dae.js";
import { parseOcpp } from "../src/parser/ocpp-parser.js";

const DAE_TEST_STATION = `
station "DCFC_Depot" {
  gridLimitKW: 200.0

  evse 1 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "TX-1"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.25
        targetSoC: 0.85
        departureMinutes: 45
      }
    }
  }

  evse 2 {
    connector 1 {
      maxPowerKW: 100.0
      currentSession: {
        transactionId: "TX-2"
        evBatteryCapacityKWh: 60.0
        currentSoC: 0.50
        targetSoC: 0.90
        departureMinutes: 60
      }
    }
  }
}
`;

describe("OCPP DAE Lowering", () => {
  it("compiles EV charging network into DAEBuilder linear arena", () => {
    const net = parseOcpp(DAE_TEST_STATION);
    const arena = lowerOcppToDae(net);

    // Variables per station:
    // 1 gridLimit parameter, 1 P_station continuous variable
    // For each of 2 sessions: P, SoC, Q (3 * 2 = 6)
    // Total variables = 8
    assert.strictEqual(arena.getVarCount(), 8);

    // Equations:
    // 1 gridLimit = 200.0
    // For each session: P binding (1), SoC init (1), Q binding (1) -> 3 * 2 = 6
    // 1 station power balance equation: P_station = P_1 + P_2
    // Total equations = 8
    assert.strictEqual(arena.getEqCount(), 8);
  });
});

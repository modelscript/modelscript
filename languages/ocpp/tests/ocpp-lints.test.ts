// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintOcpp } from "../src/lints/rules.js";
import { parseOcpp } from "../src/parser/ocpp-parser.js";

const VALID_STATION = `
station "Valid_Depot" {
  gridLimitKW: 200.0

  evse 1 {
    connector 1 {
      maxPowerKW: 50.0
      currentSession: {
        transactionId: "TX-1"
        evBatteryCapacityKWh: 60.0
        currentSoC: 0.2
        targetSoC: 0.8
        departureMinutes: 90
      }
    }
  }
}
`;

const OVERLOAD_STATION = `
station "Overload_Depot" {
  gridLimitKW: 50.0

  evse 1 {
    connector 1 {
      maxPowerKW: 60.0
    }
  }
}
`;

const INVALID_SOC_STATION = `
station "Bad_SoC_Depot" {
  gridLimitKW: 100.0

  evse 1 {
    connector 1 {
      maxPowerKW: 50.0
      currentSession: {
        transactionId: "TX-BAD"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.85
        targetSoC: 0.30
        departureMinutes: 60
      }
    }
  }
}
`;

const INFEASIBLE_DEADLINE_STATION = `
station "Infeasible_Depot" {
  gridLimitKW: 100.0

  evse 1 {
    connector 1 {
      maxPowerKW: 50.0
      currentSession: {
        transactionId: "TX-RUSH"
        evBatteryCapacityKWh: 100.0
        currentSoC: 0.10
        targetSoC: 0.90
        departureMinutes: 10
      }
    }
  }
}
`;

describe("OCPP Linter", () => {
  it("passes valid charging station without diagnostics", () => {
    const net = parseOcpp(VALID_STATION);
    const diags = lintOcpp(net);
    assert.strictEqual(diags.length, 0);
  });

  it("warns when connector capacity exceeds station grid limit", () => {
    const net = parseOcpp(OVERLOAD_STATION);
    const diags = lintOcpp(net);
    const w = diags.find((d) => d.code === 3001);
    assert.ok(w, "Should report M3001 power limit warning");
  });

  it("errors on inverted SoC values (target <= current)", () => {
    const net = parseOcpp(INVALID_SOC_STATION);
    const diags = lintOcpp(net);
    const err = diags.find((d) => d.code === 3002);
    assert.ok(err, "Should report M3002 invalid SoC error");
  });

  it("warns on infeasible departure deadline", () => {
    const net = parseOcpp(INFEASIBLE_DEADLINE_STATION);
    const diags = lintOcpp(net);
    const w = diags.find((d) => d.code === 5001);
    assert.ok(w, "Should report M5001 infeasible deadline warning");
  });
});

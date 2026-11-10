// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOcpp } from "../src/parser/ocpp-parser.js";

const SAMPLE_DECLARATIVE = `
station "Fleet_Depot_1" {
  model: "Terra-184"
  vendor: "ABB"
  gridLimitKW: 180.0

  evse 1 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1001"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.2
        targetSoC: 0.8
        departureMinutes: 45
      }
    }
  }

  evse 2 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1002"
        evBatteryCapacityKWh: 120.0
        currentSoC: 0.4
        targetSoC: 0.9
        departureMinutes: 60
      }
    }
  }
}
`;

const SAMPLE_JSON_RPC = JSON.stringify({
  chargingStationId: "Depot_DCFC_2",
  chargingProfile: {
    chargingProfileId: 101,
    stackLevel: 1,
    chargingProfilePurpose: "TxDefaultProfile",
    chargingSchedule: {
      chargingScheduleId: 501,
      chargingRateUnit: "kW",
      duration: 3600,
      chargingSchedulePeriod: [
        { startPeriod: 0, limit: 120.0, numberPhases: 3 },
        { startPeriod: 1800, limit: 60.0, numberPhases: 3 },
      ],
    },
  },
  evseId: 1,
  connectorId: 1,
  transactionId: "TX-5001",
});

describe("OCPP Parser", () => {
  it("parses declarative charging station with multiple EVSEs and active sessions", () => {
    const net = parseOcpp(SAMPLE_DECLARATIVE);
    assert.strictEqual(net.stations.length, 1);
    const st = net.stations[0]!;
    assert.strictEqual(st.id, "Fleet_Depot_1");
    assert.strictEqual(st.model, "Terra-184");
    assert.strictEqual(st.vendor, "ABB");
    assert.strictEqual(st.gridLimitKW, 180.0);
    assert.strictEqual(st.evses.length, 2);

    const e1 = st.evses[0]!;
    assert.strictEqual(e1.id, 1);
    assert.strictEqual(e1.connectors.length, 1);
    const c1 = e1.connectors[0]!;
    assert.strictEqual(c1.type, "CCS2");
    assert.strictEqual(c1.maxPowerKW, 90.0);
    assert.ok(c1.currentSession);
    assert.strictEqual(c1.currentSession?.transactionId, "TX-1001");
    assert.strictEqual(c1.currentSession?.evBatteryCapacityKWh, 80.0);
    assert.strictEqual(c1.currentSession?.currentSoC, 0.2);
    assert.strictEqual(c1.currentSession?.targetSoC, 0.8);
    assert.strictEqual(c1.currentSession?.departureMinutes, 45);
  });

  it("parses JSON-RPC SetChargingProfile payload into network model", () => {
    const net = parseOcpp(SAMPLE_JSON_RPC);
    assert.strictEqual(net.stations.length, 1);
    const st = net.stations[0]!;
    assert.strictEqual(st.id, "Depot_DCFC_2");
    assert.strictEqual(st.evses.length, 1);
    assert.strictEqual(st.chargingProfiles?.length, 1);
    const cp = st.chargingProfiles[0]!;
    assert.strictEqual(cp.id, 101);
    assert.strictEqual(cp.chargingProfilePurpose, "TxDefaultProfile");
    assert.strictEqual(cp.chargingSchedule.chargingSchedulePeriod.length, 2);
    assert.strictEqual(cp.chargingSchedule.chargingSchedulePeriod[0]?.limit, 120.0);
  });
});

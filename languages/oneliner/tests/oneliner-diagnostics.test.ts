// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OneLinerErrorCode, lintOneLinerCase } from "../src/lints/index.js";
import type { OneLinerCase } from "../src/types.js";

describe("ASPEN OneLiner Diagnostic Linter", () => {
  it("detects duplicate bus or branch IDs (OLX1001)", () => {
    const c: OneLinerCase = {
      title: "Dup ID Case",
      baseMva: 100.0,
      frequencyHz: 60.0,
      busses: [
        { id: "B1", name: "Bus 1", baseKv: 115.0 },
        { id: "B1", name: "Bus 1 Duplicate", baseKv: 115.0 }, // Duplicate!
      ],
      branches: [],
      mutuals: [],
      generators: [],
      overcurrentRelays: [],
      distanceRelays: [],
    };

    const lints = lintOneLinerCase(c);
    assert.ok(lints.some((l) => l.code === OneLinerErrorCode.DUPLICATE_ID && l.elementId === "B1"));
  });

  it("detects unknown terminal bus referenced in branch (OLX2001)", () => {
    const c: OneLinerCase = {
      title: "Unknown Bus Case",
      baseMva: 100.0,
      frequencyHz: 60.0,
      busses: [{ id: "B1", name: "Bus 1", baseKv: 115.0 }],
      branches: [
        {
          id: "L1-99",
          bus1: "B1",
          bus2: "NON_EXISTENT_BUS", // Undefined!
          z1: { r: 0.01, x: 0.1 },
          z0: { r: 0.03, x: 0.3 },
        },
      ],
      mutuals: [],
      generators: [],
      overcurrentRelays: [],
      distanceRelays: [],
    };

    const lints = lintOneLinerCase(c);
    assert.ok(lints.some((l) => l.code === OneLinerErrorCode.UNKNOWN_BUS));
  });

  it("detects non-positive sequence reactance (OLX3001)", () => {
    const c: OneLinerCase = {
      title: "Non-Positive Reactance",
      baseMva: 100.0,
      frequencyHz: 60.0,
      busses: [
        { id: "B1", name: "Bus 1", baseKv: 115.0 },
        { id: "B2", name: "Bus 2", baseKv: 115.0 },
      ],
      branches: [
        {
          id: "L1-2",
          bus1: "B1",
          bus2: "B2",
          z1: { r: 0.01, x: -0.05 }, // Negative reactance!
          z0: { r: 0.03, x: 0.1 },
        },
      ],
      mutuals: [],
      generators: [],
      overcurrentRelays: [],
      distanceRelays: [],
    };

    const lints = lintOneLinerCase(c);
    assert.ok(lints.some((l) => l.code === OneLinerErrorCode.INVALID_IMPEDANCE));
  });

  it("detects invalid relay pickup or reach settings (OLX4001)", () => {
    const c: OneLinerCase = {
      title: "Invalid Relay Settings",
      baseMva: 100.0,
      frequencyHz: 60.0,
      busses: [{ id: "B1", name: "Bus 1", baseKv: 115.0 }],
      branches: [],
      mutuals: [],
      generators: [],
      overcurrentRelays: [
        {
          id: "OC_BAD",
          name: "Bad Overcurrent",
          branchId: "L1",
          busId: "B1",
          pickupA: -100.0, // Negative pickup!
          ctRatio: 1.0,
          timeDial: 1.0,
          curve: "IEEE_Very_Inverse",
        },
      ],
      distanceRelays: [
        {
          id: "DIST_BAD",
          name: "Bad Distance",
          branchId: "L1",
          busId: "B1",
          zone1ReachOhms: -5.0, // Negative reach!
          zone2ReachOhms: 10.0,
          zone2DelaySec: 0.35,
        },
      ],
    };

    const lints = lintOneLinerCase(c);
    assert.ok(lints.some((l) => l.code === OneLinerErrorCode.INVALID_RELAY_SETTING && l.elementId === "OC_BAD"));
    assert.ok(lints.some((l) => l.code === OneLinerErrorCode.INVALID_RELAY_SETTING && l.elementId === "DIST_BAD"));
  });
});

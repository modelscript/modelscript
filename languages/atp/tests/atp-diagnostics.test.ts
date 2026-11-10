// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AtpErrorCode, lintAtpCase } from "../src/lints/index.js";
import type { AtpCase } from "../src/types.js";

describe("ATP Diagnostic Linter", () => {
  it("detects invalid simulation control time step (ATP1001)", () => {
    const atpCase: AtpCase = {
      title: "Bad Control",
      control: { deltaTSec: -1.0, tMaxSec: 0.1 },
      branches: [],
      switches: [],
      sources: [],
      outputNodes: [],
    };

    const lints = lintAtpCase(atpCase);
    assert.ok(lints.some((l) => l.code === AtpErrorCode.INVALID_CONTROL));
  });

  it("detects dangling isolated bus without source (ATP2001)", () => {
    const atpCase: AtpCase = {
      title: "Dangling Bus",
      control: { deltaTSec: 1e-5, tMaxSec: 0.1 },
      branches: [{ node1: "SRC_BUS", node2: "ISOLATED_BUS", rOhms: 10, lMh: 0, cUf: 0 }],
      switches: [],
      sources: [{ node: "SRC_BUS", typeCode: 14, amplitude: 1000, frequencyHz: 60, phaseDeg: 0 }],
      outputNodes: [],
    };

    const lints = lintAtpCase(atpCase);
    assert.ok(lints.some((l) => l.code === AtpErrorCode.DANGLING_BUS && l.node === "ISOLATED_BUS"));
  });

  it("detects negative RLC parameters (ATP3001)", () => {
    const atpCase: AtpCase = {
      title: "Negative RLC",
      control: { deltaTSec: 1e-5, tMaxSec: 0.1 },
      branches: [{ node1: "B1", node2: "B2", rOhms: -5.0, lMh: 10, cUf: 0 }],
      switches: [],
      sources: [],
      outputNodes: [],
    };

    const lints = lintAtpCase(atpCase);
    assert.ok(lints.some((l) => l.code === AtpErrorCode.NEGATIVE_PARAMETER));
  });

  it("warns on switch timing conflicts (ATP4001)", () => {
    const atpCase: AtpCase = {
      title: "Switch Conflict",
      control: { deltaTSec: 1e-5, tMaxSec: 0.1 },
      branches: [],
      switches: [{ node1: "B1", node2: "B2", tCloseSec: 0.05, tOpenSec: 0.02 }],
      sources: [],
      outputNodes: [],
    };

    const lints = lintAtpCase(atpCase);
    assert.ok(lints.some((l) => l.code === AtpErrorCode.SWITCH_TIMING_VIOLATION));
  });
});

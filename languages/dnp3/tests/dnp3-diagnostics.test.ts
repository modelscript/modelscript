// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Dnp3ErrorCode, lintDnp3Profile } from "../src/lints/index.js";
import type { Dnp3DeviceProfile } from "../src/types.js";

describe("DNP3 Diagnostic Linter", () => {
  it("detects invalid outstation or master link address (DNP2001)", () => {
    const profile: Dnp3DeviceProfile = {
      id: "BAD_ADDR",
      deviceName: "Bad Addr RTU",
      vendor: "Vendor",
      version: "1.0",
      outstationAddress: 70000, // Exceeds 65519
      masterAddress: -1,
      binaryInputs: [],
      binaryOutputs: [],
      analogInputs: [],
      analogOutputs: [],
      counters: [],
    };

    const lints = lintDnp3Profile(profile);
    assert.ok(lints.some((l) => l.code === Dnp3ErrorCode.INVALID_ADDRESS));
  });

  it("detects duplicate point indices within point groups (DNP1001)", () => {
    const profile: Dnp3DeviceProfile = {
      id: "DUP_PTS",
      deviceName: "Dup Points RTU",
      vendor: "Vendor",
      version: "1.0",
      outstationAddress: 10,
      masterAddress: 1,
      binaryInputs: [
        { index: 0, name: "PT_A", eventClass: 1 },
        { index: 0, name: "PT_B", eventClass: 1 }, // Duplicate index 0!
      ],
      binaryOutputs: [],
      analogInputs: [],
      analogOutputs: [],
      counters: [],
    };

    const lints = lintDnp3Profile(profile);
    assert.ok(lints.some((l) => l.code === Dnp3ErrorCode.DUPLICATE_POINT_INDEX && l.pointIndex === 0));
  });

  it("detects negative deadband and invalid scaling (DNP3001)", () => {
    const profile: Dnp3DeviceProfile = {
      id: "BAD_SCALING",
      deviceName: "Bad Scaling RTU",
      vendor: "Vendor",
      version: "1.0",
      outstationAddress: 10,
      masterAddress: 1,
      binaryInputs: [],
      binaryOutputs: [],
      analogInputs: [
        {
          index: 0,
          name: "AI_NEG_DB",
          eventClass: 2,
          deadband: -1.5,
          scalingMultiplier: 1.0,
          scalingOffset: 0.0,
          units: "kV",
        },
      ],
      analogOutputs: [],
      counters: [],
    };

    const lints = lintDnp3Profile(profile);
    assert.ok(lints.some((l) => l.code === Dnp3ErrorCode.INVALID_SCALING_DEADBAND));
  });

  it("detects inverted analog limits minVal > maxVal (DNP4001)", () => {
    const profile: Dnp3DeviceProfile = {
      id: "INVERTED_LIMITS",
      deviceName: "Inverted Limits RTU",
      vendor: "Vendor",
      version: "1.0",
      outstationAddress: 10,
      masterAddress: 1,
      binaryInputs: [],
      binaryOutputs: [],
      analogInputs: [
        {
          index: 0,
          name: "AI_INV",
          eventClass: 2,
          deadband: 0.1,
          scalingMultiplier: 1.0,
          scalingOffset: 0.0,
          units: "kV",
          minVal: 500,
          maxVal: 100, // Inverted!
        },
      ],
      analogOutputs: [],
      counters: [],
    };

    const lints = lintDnp3Profile(profile);
    assert.ok(lints.some((l) => l.code === Dnp3ErrorCode.INVERTED_LIMITS));
  });
});

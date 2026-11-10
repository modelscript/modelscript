// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDnp3 } from "../src/parser/dnp3-parser.js";
import { writeDnp3Xml } from "../src/parser/dnp3-writer.js";
import type { Dnp3DeviceProfile } from "../src/types.js";

describe("IEEE 1815 / DNP3 XML Serializer", () => {
  it("serializes Dnp3DeviceProfile into valid XML and roundtrips", () => {
    const profile: Dnp3DeviceProfile = {
      id: "RTU_WATER_WELL",
      deviceName: "Wellfield Master RTU",
      vendor: "Schneider Electric",
      version: "4.1",
      outstationAddress: 45,
      masterAddress: 2,
      binaryInputs: [{ index: 0, name: "PUMP_OVERLOAD", eventClass: 1, normalState: 0 }],
      binaryOutputs: [{ index: 0, name: "START_PUMP" }],
      analogInputs: [
        {
          index: 0,
          name: "WELL_DRAWDOWN_FT",
          eventClass: 2,
          deadband: 0.25,
          scalingMultiplier: 0.1,
          scalingOffset: 5.0,
          units: "ft",
          minVal: 0,
          maxVal: 200,
        },
      ],
      analogOutputs: [{ index: 0, name: "CHLORINE_DOSING_PPM", units: "ppm", minVal: 0, maxVal: 5 }],
      counters: [{ index: 0, name: "TOTAL_GALLONS", eventClass: 1, units: "gal" }],
    };

    const xml = writeDnp3Xml(profile);
    assert.ok(xml.includes("DNP3DeviceProfile"));
    assert.ok(xml.includes("Wellfield Master RTU"));
    assert.ok(xml.includes("Schneider Electric"));
    assert.ok(xml.includes("PUMP_OVERLOAD"));
    assert.ok(xml.includes("WELL_DRAWDOWN_FT"));
    assert.ok(xml.includes("CHLORINE_DOSING_PPM"));
    assert.ok(xml.includes("TOTAL_GALLONS"));

    // Roundtrip test
    const parsed = parseDnp3(xml);
    assert.equal(parsed.deviceName, "Wellfield Master RTU");
    assert.equal(parsed.vendor, "Schneider Electric");
    assert.equal(parsed.outstationAddress, 45);
    assert.equal(parsed.binaryInputs.length, 1);
    assert.equal(parsed.binaryInputs[0]!.name, "PUMP_OVERLOAD");
    assert.equal(parsed.binaryOutputs.length, 1);
    assert.equal(parsed.analogInputs.length, 1);
    assert.equal(parsed.analogInputs[0]!.deadband, 0.25);
    assert.equal(parsed.analogInputs[0]!.units, "ft");
    assert.equal(parsed.counters.length, 1);
  });
});

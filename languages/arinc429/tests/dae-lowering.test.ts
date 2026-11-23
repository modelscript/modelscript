// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arinc429ToDae, lowerArinc429ToDae } from "../src/dae/index.js";
import { encodeArinc429Word, formatArinc429Hex, parseArinc429 } from "../src/parser/index.js";
import { arinc429ToCsv, arinc429ToJsbsimTelemetry } from "../src/projections/index.js";

function buildCruiseFlightSource(): string {
  const wAlt = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 36000 }));
  const wMach = formatArinc429Hex(encodeArinc429Word({ label: "205", value: 0.78 }));
  const wCas = formatArinc429Hex(encodeArinc429Word({ label: "206", value: 275 }));
  const wPitch = formatArinc429Hex(encodeArinc429Word({ label: "324", value: 2.5 }));
  const wRoll = formatArinc429Hex(encodeArinc429Word({ label: "325", value: -15.0 }));
  const wHdg = formatArinc429Hex(encodeArinc429Word({ label: "314", value: 90.0 }));
  const wLat = formatArinc429Hex(encodeArinc429Word({ label: "310", value: 40.6413 }));
  const wLon = formatArinc429Hex(encodeArinc429Word({ label: "311", value: -73.7781 }));
  return `
BUS FLIGHT_DECK_1
RATE HIGH
LABEL 203 ALTITUDE ENCODING BNR RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20
LABEL 205 MACH ENCODING BNR RANGE 4.096 RESOLUTION 0.000015625 UNITS Mach RATE 20
LABEL 206 AIRSPEED ENCODING BNR RANGE 1024 RESOLUTION 0.00390625 UNITS kt RATE 20
LABEL 324 PITCH ENCODING BNR RANGE 180 UNITS deg RATE 50
LABEL 325 ROLL ENCODING BNR RANGE 180 UNITS deg RATE 50
LABEL 314 HEADING ENCODING BNR RANGE 180 UNITS deg RATE 25
LABEL 310 LATITUDE ENCODING BNR RANGE 180 UNITS deg RATE 10
LABEL 311 LONGITUDE ENCODING BNR RANGE 180 UNITS deg RATE 10
FRAME 0.000 WORD ${wAlt}
FRAME 0.010 WORD ${wMach}
FRAME 0.020 WORD ${wCas}
FRAME 0.030 WORD ${wPitch}
FRAME 0.040 WORD ${wRoll}
FRAME 0.050 WORD ${wHdg}
FRAME 0.060 WORD ${wLat}
FRAME 0.070 WORD ${wLon}
`;
}

describe("ARINC 429 DAEBuilder Lowering & Telemetry Projections", () => {
  it("lowers flight-state kinematic ODEs directly into DAEBuilder", () => {
    const doc = parseArinc429(buildCruiseFlightSource());
    const builder = new DAEBuilder(undefined, "CruiseKinematics");
    const result = lowerArinc429ToDae(builder, doc);

    assert.strictEqual(result.stateVarIndices.length, 4);
    assert.strictEqual(result.equationCount, 4);
    assert.ok(result.variableMap.has("altitude_m"));
    assert.ok(result.variableMap.has("north_m"));
    assert.ok(result.variableMap.has("east_m"));
    assert.ok(result.variableMap.has("heading_rad"));
    assert.ok(result.variableMap.has("airspeed_mps"));
    assert.ok(result.variableMap.has("bus_utilization_pct"));

    const wrapped = arinc429ToDae(doc);
    assert.ok(wrapped instanceof DAEBuilder);
    assert.strictEqual(wrapped.getEqCount(), 4);
    assert.ok(wrapped.getVarCount() >= 14);
  });

  it("projects decoded frames to CSV and JSBSim telemetry XML", () => {
    const doc = parseArinc429(buildCruiseFlightSource());

    const csv = arinc429ToCsv(doc);
    const lines = csv.trim().split("\n");
    assert.strictEqual(lines.length, 9); // header + 8 frames
    assert.ok(lines[0]?.includes("label_octal"));
    assert.ok(csv.includes("36000.000000"));

    const jsbsim = arinc429ToJsbsimTelemetry(doc);
    assert.ok(jsbsim.includes(`<jsbsim_telemetry source="arinc429" bus="FLIGHT_DECK_1" rate="HIGH">`));
    assert.ok(jsbsim.includes(`position/h-sl-ft">36000.0000</property>`));
    assert.ok(jsbsim.includes(`velocities/vc-kts">275.0000</property>`));
    const pitchMatch = jsbsim.match(/attitude\/theta-deg">(-?[0-9.]+)<\/property>/);
    const rollMatch = jsbsim.match(/attitude\/phi-deg">(-?[0-9.]+)<\/property>/);
    assert.ok(pitchMatch && Math.abs(Number(pitchMatch[1]) - 2.5) < 1e-3);
    assert.ok(rollMatch && Math.abs(Number(rollMatch[1]) - -15.0) < 1e-3);
    assert.ok(jsbsim.includes(`attitude/psi-true-deg">90.0000</property>`));
  });
});

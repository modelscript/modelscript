// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintCcsds } from "../src/lints/index.js";
import { parseCcsds } from "../src/parser/index.js";

describe("CCSDS & XTCE Pre-Flight Diagnostic Linters (M8201–M8208)", () => {
  it("passes clean OPM with 0 diagnostics", () => {
    const src = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = CLEAN_SAT
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-10-26T00:00:00.000
SEMI_MAJOR_AXIS = 7000.0
ECCENTRICITY = 0.001
INCLINATION = 51.6
MASS = 500.0
`;
    const doc = parseCcsds(src, "clean.opm");
    const diags = lintCcsds(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("M8201: detects sub-orbital impact trajectory (rp < R_Earth)", () => {
    const src = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = REENTRY_VEHICLE
REF_FRAME = EME2000
TIME_SYSTEM = UTC
SEMI_MAJOR_AXIS = 6300.0
ECCENTRICITY = 0.001
`;
    const doc = parseCcsds(src, "suborbital.opm");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8201");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("Sub-orbital pericenter radius"));
  });

  it("M8203: detects hyperbolic unbounded orbit (e >= 1.0)", () => {
    const src = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = VOYAGER_FLYBY
REF_FRAME = EME2000
TIME_SYSTEM = UTC
SEMI_MAJOR_AXIS = -15000.0
ECCENTRICITY = 1.25
`;
    const doc = parseCcsds(src, "hyperbolic.opm");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8203");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "warning");
    assert(d.message.includes("hyperbolic or parabolic"));
  });

  it("M8204: detects unrecognized reference frame", () => {
    const src = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = BAD_FRAME_SAT
REF_FRAME = INVALID_FRAME_XYZ
TIME_SYSTEM = UTC
SEMI_MAJOR_AXIS = 7000.0
ECCENTRICITY = 0.001
`;
    const doc = parseCcsds(src, "bad_frame.opm");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8204");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("Unrecognized or non-inertial reference frame 'INVALID_FRAME_XYZ'."));
  });

  it("M8208: detects non-positive spacecraft mass", () => {
    const src = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = ZERO_MASS_SAT
REF_FRAME = EME2000
TIME_SYSTEM = UTC
SEMI_MAJOR_AXIS = 7000.0
ECCENTRICITY = 0.001
MASS = -10.0
`;
    const doc = parseCcsds(src, "bad_mass.opm");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8208");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("Spacecraft mass -10 kg must be strictly positive."));
  });

  it("M8206: detects non-monotonic OEM ephemeris epochs", () => {
    const src = `CCSDS_OEM_VERS = 2.0
OBJECT_NAME = NON_MONO_SAT
REF_FRAME = EME2000
TIME_SYSTEM = UTC

DATA_START
2026-10-26T00:05:00.000 6678.0 0.0 0.0 0.0 7.7 0.0
2026-10-26T00:02:00.000 6673.0 460.0 0.0 -0.5 7.7 0.0
DATA_STOP
`;
    const doc = parseCcsds(src, "non_monotonic.oem");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8206");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("is not strictly greater than previous timestamp"));
  });

  it("M8207: detects duplicate parameter in XTCE", () => {
    const src = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="DuplicateParamSystem">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="BusVoltage" parameterTypeRef="float" />
      <Parameter name="BusVoltage" parameterTypeRef="float" />
    </ParameterSet>
  </TelemetryMetaData>
</SpaceSystem>
`;
    const doc = parseCcsds(src, "duplicate.xtce");
    const diags = lintCcsds(doc);
    const d = diags.find((x) => x.code === "M8207");
    assert(d !== undefined);
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("Duplicate telemetry parameter declaration for 'BusVoltage'."));
  });
});

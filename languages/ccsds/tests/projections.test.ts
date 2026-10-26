// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseCcsds } from "../src/parser/index.js";
import { ccsdsToModelica, ccsdsToSysml } from "../src/projections/index.js";

const SAMPLE_OPM = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = ISS_ZARYA
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-10-26T00:00:00.000
SEMI_MAJOR_AXIS = 6780.0
ECCENTRICITY = 0.0006
INCLINATION = 51.64
MASS = 450000.0
`;

const SAMPLE_XTCE = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="LunarGateway">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="CabinPressure" parameterTypeRef="float" units="kPa" />
      <Parameter name="O2Level" parameterTypeRef="float" units="percent" />
    </ParameterSet>
  </TelemetryMetaData>
  <CommandMetaData>
    <MetaCommand name="VentAirlock">
      <ArgumentList>
        <Argument name="DurationSec" argumentTypeRef="int" />
      </ArgumentList>
    </MetaCommand>
  </CommandMetaData>
</SpaceSystem>
`;

describe("CCSDS & XTCE Polyglot Projections", () => {
  it("projects orbit message to Modelica continuous astrodynamics model", () => {
    const doc = parseCcsds(SAMPLE_OPM, "iss.opm");
    const mo = ccsdsToModelica(doc);

    assert(mo.includes("model ISS_ZARYA"));
    assert(mo.includes("parameter Real mu ="));
    assert(mo.includes("der(x) = vx;"));
    assert(mo.includes("der(vx) = -mu * x / (r^3);"));
    assert(mo.includes("altitude = r - R_earth;"));
  });

  it("projects XTCE telemetry and command dictionaries to SysML v2", () => {
    const doc = parseCcsds(SAMPLE_XTCE, "gateway.xtce");
    const sysml = ccsdsToSysml(doc);

    assert(sysml.includes("package LunarGateway {"));
    assert(sysml.includes("port def TelemetryPort"));
    assert(sysml.includes("out item CabinPressure : ScalarValues::Real;"));
    assert(sysml.includes("action def TelecommandHandler"));
    assert(sysml.includes("action VentAirlock"));
  });
});

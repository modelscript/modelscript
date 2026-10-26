// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseCcsds, parseKvn, parseXtce } from "../src/parser/index.js";

const SAMPLE_OEM = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-10-26T00:00:00.000
ORIGINATOR = NASA_JPL

META_START
OBJECT_NAME = ISS_ZARYA
OBJECT_ID = 1998-067A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-10-26T00:00:00.000
STOP_TIME = 2026-10-26T00:02:00.000
META_STOP

DATA_START
2026-10-26T00:00:00.000 6678.137 0.0 0.0 0.0 7.726 0.0
2026-10-26T00:01:00.000 6673.820 463.56 0.0 -0.536 7.708 0.0
2026-10-26T00:02:00.000 6660.890 926.12 0.0 -1.071 7.652 0.0
DATA_STOP
`;

const SAMPLE_OPM = `CCSDS_OPM_VERS = 2.0
CREATION_DATE = 2026-10-26T00:00:00.000
ORIGINATOR = ESA_ESOC

OBJECT_NAME = SENTINEL_1A
OBJECT_ID = 2014-016A
REF_FRAME = GCRF
TIME_SYSTEM = UTC

EPOCH = 2026-10-26T12:00:00.000
X = 7071.0
Y = 0.0
Z = 0.0
X_DOT = 0.0
Y_DOT = 5.311
Z_DOT = 5.311

SEMI_MAJOR_AXIS = 7071.0
ECCENTRICITY = 0.0001
INCLINATION = 98.18
RA_OF_ASC_NODE = 45.0
ARG_OF_PERICENTER = 90.0
TRUE_ANOMALY = 0.0

MASS = 2157.0
SOLAR_RAD_AREA = 12.0
SOLAR_RAD_COEFF = 1.3
DRAG_AREA = 8.5
DRAG_COEFF = 2.2
`;

const SAMPLE_XTCE = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="CubeSat_Mission" xmlns="http://www.omg.org/spec/XTCE/20180204">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="BatteryVoltage" parameterTypeRef="Float32Type" units="V" />
      <Parameter name="BatteryCurrent" parameterTypeRef="Float32Type" units="A" />
      <Parameter name="OBC_Temperature" parameterTypeRef="Int16Type" units="degC" />
      <Parameter name="DeploymentStatus" parameterTypeRef="BoolType" />
    </ParameterSet>
    <ContainerSet>
      <SequenceContainer name="HousekeepingPacket">
        <EntryList>
          <ParameterRefEntry parameterRef="BatteryVoltage" />
          <ParameterRefEntry parameterRef="BatteryCurrent" />
          <ParameterRefEntry parameterRef="OBC_Temperature" />
          <ParameterRefEntry parameterRef="DeploymentStatus" />
        </EntryList>
      </SequenceContainer>
    </ContainerSet>
  </TelemetryMetaData>
  <CommandMetaData>
    <MetaCommand name="DeploySolarPanels">
      <ArgumentList>
        <Argument name="ReleaseDurationMs" argumentTypeRef="uint16" />
      </ArgumentList>
    </MetaCommand>
  </CommandMetaData>
</SpaceSystem>
`;

describe("CCSDS & XTCE Zero-Regex Parsers", () => {
  it("parses CCSDS OEM ephemeris file", () => {
    const doc = parseKvn(SAMPLE_OEM);
    assert.strictEqual(doc.format, "OEM");
    assert.strictEqual(doc.metadata.objectName, "ISS_ZARYA");
    assert.strictEqual(doc.metadata.refFrame, "EME2000");
    assert.strictEqual(doc.points.length, 3);

    const p0 = doc.points[0]!;
    assert.strictEqual(p0.epoch, "2026-10-26T00:00:00.000");
    assert.strictEqual(p0.x, 6678.137);
    assert.strictEqual(p0.vy, 7.726);
  });

  it("parses CCSDS OPM state vector and Keplerian elements", () => {
    const doc = parseKvn(SAMPLE_OPM);
    assert.strictEqual(doc.format, "OPM");
    assert.strictEqual(doc.metadata.objectName, "SENTINEL_1A");
    assert.strictEqual(doc.stateVector.x, 7071.0);
    assert.strictEqual(doc.stateVector.vy, 5.311);

    assert(doc.keplerian !== undefined);
    assert.strictEqual(doc.keplerian.semiMajorAxisKm, 7071.0);
    assert.strictEqual(doc.keplerian.inclinationDeg, 98.18);

    assert(doc.spacecraft !== undefined);
    assert.strictEqual(doc.spacecraft.massKg, 2157.0);
    assert.strictEqual(doc.spacecraft.dragCoeff, 2.2);
  });

  it("parses OMG XTCE telemetry dictionaries and commands", () => {
    const doc = parseXtce(SAMPLE_XTCE);
    assert.strictEqual(doc.format, "XTCE");
    assert.strictEqual(doc.name, "CubeSat_Mission");
    assert.strictEqual(doc.parameters.length, 4);

    const battV = doc.parameters.find((p) => p.name === "BatteryVoltage");
    assert(battV !== undefined);
    assert.strictEqual(battV.paramType, "float");
    assert.strictEqual(battV.units, "V");

    assert.strictEqual(doc.containers.length, 1);
    const cont = doc.containers[0]!;
    assert.strictEqual(cont.name, "HousekeepingPacket");
    assert.strictEqual(cont.entries.length, 4);

    assert.strictEqual(doc.commands.length, 1);
    assert.strictEqual(doc.commands[0]!.name, "DeploySolarPanels");
    assert.strictEqual(doc.commands[0]!.arguments.length, 1);
  });

  it("unified parseCcsds dispatches correctly", () => {
    const docOem = parseCcsds(SAMPLE_OEM, "orbit.oem");
    assert.strictEqual(docOem.format, "OEM");

    const docXtce = parseCcsds(SAMPLE_XTCE, "telemetry.xtce");
    assert.strictEqual(docXtce.format, "XTCE");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CcsdsCommand } from "../src/commands/ccsds.js";

const SAMPLE_OPM = `CCSDS_OPM_VERS = 2.0
CREATION_DATE = 2026-10-26T00:00:00.000
ORIGINATOR = NASA_GSFC

OBJECT_NAME = SWOT_MISSION
OBJECT_ID = 2022-172A
REF_FRAME = EME2000
TIME_SYSTEM = UTC

EPOCH = 2026-10-26T00:00:00.000
X = 7268.0
Y = 0.0
Z = 0.0
X_DOT = 0.0
Y_DOT = 7.412
Z_DOT = 0.0

SEMI_MAJOR_AXIS = 7268.0
ECCENTRICITY = 0.001
INCLINATION = 77.6
RA_OF_ASC_NODE = 30.0
ARG_OF_PERICENTER = 45.0
TRUE_ANOMALY = 0.0

MASS = 2200.0
DRAG_AREA = 9.0
DRAG_COEFF = 2.2
`;

const SAMPLE_XTCE = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="SWOT_Payload">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="RadarPower" parameterTypeRef="float" units="W" />
      <Parameter name="AltimeterEcho" parameterTypeRef="int" />
    </ParameterSet>
    <ContainerSet>
      <SequenceContainer name="TelemetryFrame">
        <EntryList>
          <ParameterRefEntry parameterRef="RadarPower" />
          <ParameterRefEntry parameterRef="AltimeterEcho" />
        </EntryList>
      </SequenceContainer>
    </ContainerSet>
  </TelemetryMetaData>
</SpaceSystem>
`;

test("CCSDS CLI Commands (msx ccsds inspect, lint, propagate, to-modelica, to-sysml, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "languages/ccsds/tests/scratch_ccsds_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const opmFile = path.join(tmpDir, "orbit.opm");
  const xtceFile = path.join(tmpDir, "payload.xtce");
  fs.writeFileSync(opmFile, SAMPLE_OPM, "utf-8");
  fs.writeFileSync(xtceFile, SAMPLE_XTCE, "utf-8");

  await t.test("msx ccsds inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (CcsdsCommand.handler as any)({
        action: "inspect",
        files: [opmFile, xtceFile],
      });
      assert.ok(logs.some((l) => l.includes("SWOT_MISSION")));
      assert.ok(logs.some((l) => l.includes("SEMI_MAJOR_AXIS = 7268.00 km") || l.includes("7268.00 km")));
      assert.ok(logs.some((l) => l.includes("SWOT_Payload")));
      assert.ok(logs.some((l) => l.includes("Telemetry Parameters: 2")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ccsds lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (CcsdsCommand.handler as any)({
        action: "lint",
        files: [opmFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics reported")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ccsds propagate", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (CcsdsCommand.handler as any)({
        action: "propagate",
        files: [opmFile],
        duration: 600,
        step: 60,
      });
      assert.ok(logs.some((l) => l.includes("Cowell Orbit Propagation")));
      assert.ok(logs.some((l) => l.includes("Initial Altitude:")));
      assert.ok(logs.some((l) => l.includes("Final Altitude:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ccsds to-modelica", async () => {
    const outFile = path.join(tmpDir, "orbit.mo");

    await (CcsdsCommand.handler as any)({
      action: "to-modelica",
      files: [opmFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("model SWOT_MISSION"));
    assert.ok(content.includes("der(x) = vx;"));
    assert.ok(content.includes("altitude = r - R_earth;"));
  });

  await t.test("msx ccsds to-sysml", async () => {
    const outFile = path.join(tmpDir, "payload.sysml");

    await (CcsdsCommand.handler as any)({
      action: "to-sysml",
      files: [xtceFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("package SWOT_Payload {"));
    assert.ok(content.includes("port def TelemetryPort"));
    assert.ok(content.includes("RadarPower"));
  });

  await t.test("msx ccsds to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (CcsdsCommand.handler as any)({
        action: "to-dae",
        files: [opmFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered CCSDS spacecraft orbit into linear DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

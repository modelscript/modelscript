// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { executeCcsdsAction, getCcsdsDocumentSymbols, getCcsdsHover, validateCcsds } from "../src/lsp.js";

const SAMPLE_OPM = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = CHANDRAYAAN
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-10-26T00:00:00.000
SEMI_MAJOR_AXIS = 7000.0
ECCENTRICITY = 0.001
MASS = 1400.0
`;

const SAMPLE_XTCE = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="LanderTelemetry">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="AltimeterRange" parameterTypeRef="float" units="m" />
    </ParameterSet>
  </TelemetryMetaData>
</SpaceSystem>
`;

describe("CCSDS LSP Language Services", () => {
  it("validates clean deck with zero diagnostics", () => {
    const diags = validateCcsds(SAMPLE_OPM, "orbit.opm");
    assert.strictEqual(diags.length, 0);
  });

  it("extracts document symbols for spacecraft and parameters", () => {
    const syms = getCcsdsDocumentSymbols(SAMPLE_OPM, "orbit.opm");
    assert.strictEqual(syms.length, 1);
    assert.strictEqual(syms[0]!.name, "CHANDRAYAAN");

    const xtceSyms = getCcsdsDocumentSymbols(SAMPLE_XTCE, "lander.xtce");
    assert.strictEqual(xtceSyms.length, 1);
    assert.strictEqual(xtceSyms[0]!.name, "LanderTelemetry");
    assert(xtceSyms[0]!.children!.some((c) => c.name === "AltimeterRange"));
  });

  it("provides hover details on parameters", () => {
    const offset = SAMPLE_XTCE.indexOf("AltimeterRange");
    const hover = getCcsdsHover(SAMPLE_XTCE, offset, "lander.xtce");
    assert(hover !== null);
    assert(hover.contents.value.includes("AltimeterRange"));
    assert(hover.contents.value.toLowerCase().includes("units"));
  });

  it("executes custom actions (toModelica, toSysml, toDae, propagate, summary)", () => {
    const resMo = executeCcsdsAction("ccsds.toModelica", SAMPLE_OPM);
    assert(resMo.modelica.includes("model CHANDRAYAAN"));

    const resSysml = executeCcsdsAction("ccsds.toSysml", SAMPLE_XTCE);
    assert(resSysml.sysml.includes("package LanderTelemetry"));

    const resDae = executeCcsdsAction("ccsds.toDae", SAMPLE_OPM);
    assert(resDae.variables > 0);
    assert(resDae.equations > 0);

    const resProp = executeCcsdsAction("ccsds.propagate", SAMPLE_OPM, { duration: 300, step: 60 });
    assert(resProp.pointCount >= 5);

    const resSum = executeCcsdsAction("ccsds.summary", SAMPLE_OPM);
    assert.strictEqual(resSum.name, "CHANDRAYAAN");
    assert.strictEqual(resSum.format, "OPM");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPowerFactoryModel, PowerFactoryErrorCode, type PowerFactoryDiagnostic } from "../src/lints/index.js";
import { parsePowerFactoryXml } from "../src/parser/powerfactory-parser.js";

const VALID_PF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_110kV_1">
    <uknom>110.0</uknom>
  </DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_110kV_2">
    <uknom>110.0</uknom>
  </DataObject>
  <DataObject class="TypLne" loc_name="LineType_110">
    <r1>0.12</r1>
    <x1>0.39</x1>
  </DataObject>
  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_110kV_1</bus1>
    <bus2>Bus_110kV_2</bus2>
    <dline>25.0</dline>
    <typ_id>LineType_110</typ_id>
  </DataObject>
  <DataObject class="ElmSym" loc_name="Gen_1">
    <bus1>Bus_110kV_1</bus1>
    <pgini>50.0</pgini>
    <sgini>100.0</sgini>
    <usetp>1.02</usetp>
  </DataObject>
  <DataObject class="ElmLod" loc_name="Load_2">
    <bus1>Bus_110kV_2</bus1>
    <plini>45.0</plini>
  </DataObject>
</PowerFactory>`;

const INVALID_PF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_HV">
    <uknom>110.0</uknom>
  </DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_LV">
    <uknom>20.0</uknom>
  </DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_Floating">
    <uknom>20.0</uknom>
  </DataObject>

  <!-- Missing R1 and typId, non-positive length -->
  <DataObject class="ElmLne" loc_name="BadLine">
    <bus1>Bus_HV</bus1>
    <bus2>Unknown_Bus_3</bus2>
    <dline>-5.0</dline>
  </DataObject>

  <!-- Transformer HV mismatch (>20% difference from 110kV bus) -->
  <DataObject class="TypTr2" loc_name="WrongTrafoType">
    <utrn_h>400.0</utrn_h>
    <utrn_l>20.0</utrn_l>
  </DataObject>
  <DataObject class="ElmTr2" loc_name="BadTrafo">
    <bushv>Bus_HV</bushv>
    <buslv>Bus_LV</buslv>
    <typ_id>WrongTrafoType</typ_id>
  </DataObject>

  <!-- Generator voltage setpoint out of range and pgini > sgini -->
  <DataObject class="ElmSym" loc_name="BadGen">
    <bus1>Bus_HV</bus1>
    <pgini>250.0</pgini>
    <sgini>100.0</sgini>
    <usetp>1.45</usetp>
  </DataObject>
</PowerFactory>`;

describe("DIgSILENT PowerFactory Linter & Diagnostic Suite (@modelscript/powerfactory)", () => {
  it("validates compliant PowerFactory network model with 0 errors", () => {
    const model = parsePowerFactoryXml(VALID_PF_XML);
    const diags: PowerFactoryDiagnostic[] = lintPowerFactoryModel(model);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, "Valid PowerFactory model should have 0 error diagnostics");
  });

  it("detects unresolved terminal references (PF1008)", () => {
    const model = parsePowerFactoryXml(INVALID_PF_XML);
    const diags = lintPowerFactoryModel(model);
    const unres = diags.find(
      (d) => d.code === PowerFactoryErrorCode.UNRESOLVED_TERMINAL_REFERENCE.code && d.message.includes("Unknown_Bus_3"),
    );
    assert.ok(unres, "Should flag unknown terminal reference PF1008");
    assert.equal(unres.severity, "error");
  });

  it("detects invalid line parameters and non-positive length (PF1002)", () => {
    const model = parsePowerFactoryXml(INVALID_PF_XML);
    const diags = lintPowerFactoryModel(model);
    const lenDiag = diags.find(
      (d) => d.code === PowerFactoryErrorCode.INVALID_LINE_PARAMETERS.code && d.message.includes("-5 km"),
    );
    assert.ok(lenDiag, "Should flag negative line length PF1002");

    const noR1Diag = diags.find(
      (d) =>
        d.code === PowerFactoryErrorCode.INVALID_LINE_PARAMETERS.code &&
        d.message.includes("lacks explicit resistance"),
    );
    assert.ok(noR1Diag, "Should flag missing resistance and line type PF1002");
  });

  it("detects transformer voltage mismatch (PF1003)", () => {
    const model = parsePowerFactoryXml(INVALID_PF_XML);
    const diags = lintPowerFactoryModel(model);
    const trafoDiag = diags.find((d) => d.code === PowerFactoryErrorCode.TRANSFORMER_VOLTAGE_MISMATCH.code);
    assert.ok(trafoDiag, "Should flag transformer rating mismatch PF1003");
    assert.equal(trafoDiag.severity, "warning");
  });

  it("detects generator voltage setpoint bounds and power rating violations (PF1004 & PF1005)", () => {
    const model = parsePowerFactoryXml(INVALID_PF_XML);
    const diags = lintPowerFactoryModel(model);
    const usetpDiag = diags.find((d) => d.code === PowerFactoryErrorCode.GENERATOR_VOLTAGE_SETPOINT_OUT_OF_RANGE.code);
    assert.ok(usetpDiag, "Should flag generator voltage setpoint 1.45 pu outside [0.8, 1.2]");
    assert.equal(usetpDiag.severity, "warning");

    const powerDiag = diags.find((d) => d.code === PowerFactoryErrorCode.GENERATOR_POWER_EXCEEDS_MBASE.code);
    assert.ok(powerDiag, "Should flag generator P (250 MW) exceeding S (100 MVA)");
    assert.equal(powerDiag.severity, "warning");
  });

  it("detects floating and unconnected terminals (PF1001)", () => {
    const model = parsePowerFactoryXml(INVALID_PF_XML);
    const diags = lintPowerFactoryModel(model);
    const floatDiag = diags.find(
      (d) => d.code === PowerFactoryErrorCode.FLOATING_TERMINAL.code && d.message.includes("Bus_Floating"),
    );
    assert.ok(floatDiag, "Should flag unconnected terminal Bus_Floating PF1001");
    assert.equal(floatDiag.severity, "warning");
  });
});

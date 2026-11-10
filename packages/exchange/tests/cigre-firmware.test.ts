// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CigreWasmFirmwareRunner,
  generateCigreFmi3ModelDescriptionXml,
  generateNativeShimDllSource,
  type CigreModelInputs,
} from "../src/index.js";

describe("CIGRE TB 881 / IEEE P2800.2 Real-Code WebAssembly Firmware Sandbox", () => {
  it("executes sandboxed CIGRE TB 881 firmware and enforces IEEE 2800 fast reactive current", () => {
    const runner = new CigreWasmFirmwareRunner();
    const info = runner.getInfo();

    assert.equal(info.abiVersion, "CIGRE_TB881_v1");
    assert.ok(info.modelName.length > 0);
    assert.equal(info.numInputs, 10);
    assert.equal(info.numOutputs, 8);

    runner.initialize({
      nominalFreqHz: 60.0,
      mbaseMva: 100.0,
      vNominalKv: 34.5,
      controlMode: "voltage_control",
      parameters: {
        KP_V: 1.5,
        KI_V: 40.0,
        I_MAX: 1.25,
        V_REF: 1.0,
        P_REF: 1.0,
      },
    });

    // 1. Nominal operating condition (V = 1.0 pu)
    const nominalIn: CigreModelInputs = {
      timeSec: 0.1,
      va: 1.0,
      vb: -0.5,
      vc: -0.5,
      ia: 1.0,
      ib: -0.5,
      ic: -0.5,
      pRefPu: 1.0,
      vRefPu: 1.0,
    };

    const outNominal = runner.step(nominalIn);
    assert.equal(outNominal.isRideThroughActive, false);
    assert.equal(outNominal.isTripped, false);
    assert.ok(outNominal.idTargetPu > 0.8, "Active current should match ~1.0 pu");
    assert.ok(Math.abs(outNominal.iqTargetPu) < 0.1, "Reactive current should be minimal at nominal V");

    // 2. Voltage sag condition (V = 0.50 pu -> deep sag)
    const sagIn: CigreModelInputs = {
      timeSec: 0.15,
      va: 0.50,
      vb: -0.25,
      vc: -0.25,
      ia: 1.0,
      ib: -0.5,
      ic: -0.5,
      pRefPu: 1.0,
      vRefPu: 1.0,
    };

    const outSag = runner.step(sagIn);
    assert.equal(outSag.isRideThroughActive, true, "Ride-through must be active during 0.50 pu sag");
    assert.ok(outSag.iqTargetPu > 0.5, "Fast reactive current must be injected to support voltage");
    assert.ok(Math.abs(outSag.iqTargetPu) <= 1.25 + 1e-4, "Must not exceed max current rating");

    runner.terminate();
  });

  it("generates FMI 3.0 Co-Simulation XML metadata and native C shim source", () => {
    const runner = new CigreWasmFirmwareRunner();
    const info = runner.getInfo();

    const xml = generateCigreFmi3ModelDescriptionXml(info, "{12345678-ABCD-EF01-2345-6789ABCDEF01}");
    assert.ok(xml.includes('fmiVersion="3.0"'));
    assert.ok(xml.includes('name="va"'));
    assert.ok(xml.includes('name="idTarget"'));
    assert.ok(xml.includes('name="isRideThroughActive"'));

    const cSrc = generateNativeShimDllSource(info);
    assert.ok(cSrc.includes("conec_"));
    assert.ok(cSrc.includes("_step_"));
    assert.ok(cSrc.includes("CigreInputs"));
    assert.ok(cSrc.includes("CigreOutputs"));
  });
});

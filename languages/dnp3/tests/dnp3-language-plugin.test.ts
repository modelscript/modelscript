// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllDnp3Models, getDnp3Model } from "../src/indexing.js";
import { dnp3Language } from "../src/language.js";
import { getDnp3Diagnostics, getDnp3DocumentSymbols } from "../src/lsp.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DNP3DeviceProfile xmlns="http://www.dnp.org/DNP3/DeviceProfile/2010" id="SUB_RTU_PLUGIN">
  <DeviceIdentity>
    <Vendor>General Electric</Vendor>
    <DeviceName>GE D20 RTU</DeviceName>
    <Version>5.0</Version>
  </DeviceIdentity>
  <CommunicationSettings>
    <OutstationAddress>50</OutstationAddress>
    <MasterAddress>1</MasterAddress>
  </CommunicationSettings>
  <DNP3PointList>
    <BinaryInputs>
      <BinaryInput index="0" name="LINE_CB_STATUS" class="1" normalState="1"/>
    </BinaryInputs>
    <BinaryOutputs>
      <BinaryOutput index="0" name="TRIP_LINE_CB"/>
    </BinaryOutputs>
    <AnalogInputs>
      <AnalogInput index="0" name="BUS_FREQ_HZ" class="2" deadband="0.02" mult="0.01" offset="60.0" units="Hz" min="55" max="65"/>
    </AnalogInputs>
    <Counters>
      <Counter index="0" name="PULSE_ACCUM" class="1" units="pulses"/>
    </Counters>
  </DNP3PointList>
</DNP3DeviceProfile>`;

describe("DNP3 Language Plugin & LSP Services", () => {
  it("indexes DNP3 documents in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(dnp3Language);
    ws.setDocument("file:///test/rtu.xml", SAMPLE_XML);

    const model = getDnp3Model(ws, "file:///test/rtu.xml");
    assert.ok(model !== undefined);
    assert.equal(model?.deviceName, "GE D20 RTU");
    assert.equal(model?.vendor, "General Electric");
    assert.equal(model?.outstationAddress, 50);
    assert.equal(model?.binaryInputCount, 1);
    assert.equal(model?.analogInputCount, 1);
    assert.equal(model?.totalPointCount, 4);
    assert.ok(ws.findSymbolsByName("BUS_FREQ_HZ").length >= 1);

    assert.equal(getAllDnp3Models(ws).length, 1);
    ws.clear();
    assert.equal(getAllDnp3Models(ws).length, 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getDnp3DocumentSymbols(SAMPLE_XML);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.ok(root.name.includes("GE D20 RTU"));
    assert.ok(root.children !== undefined);
    assert.ok(root.children!.length >= 3); // Binary Inputs, Binary Outputs, Analog Inputs, Counters
  });

  it("generates LSP diagnostics", () => {
    const diagnostics = getDnp3Diagnostics(SAMPLE_XML);
    assert.equal(diagnostics.filter((d) => d.severity === 1).length, 0);
  });

  it("executes language actions (telemetry processing, DAE lowering, export)", async () => {
    const actions = dnp3Language.actions;
    assert.ok(actions.length >= 4);

    const daeAction = actions.find((a) => a.id === "lower_dnp3_dae");
    assert.ok(daeAction !== undefined);
    const daeResult = (await daeAction!.execute({} as any, { documentText: SAMPLE_XML })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeResult.variableCount > 0);
    assert.ok(daeResult.equationCount > 0);

    const telAction = actions.find((a) => a.id === "process_dnp3_telemetry");
    assert.ok(telAction !== undefined);
    const telResult = (await telAction!.execute({} as any, {
      documentText: SAMPLE_XML,
      samples: [0, 1, 2, 10, 12],
    })) as any;
    assert.ok(telResult !== null);
    assert.equal(telResult.converged, true);
    assert.ok(telResult.rawSampleCount === 5);

    const exportAction = actions.find((a) => a.id === "export_dnp3_xml");
    assert.ok(exportAction !== undefined);
    const xml = await exportAction!.execute({} as any, { documentText: SAMPLE_XML });
    assert.equal(typeof xml, "string");
    assert.ok((xml as string).includes("<DNP3DeviceProfile"));
  });
});

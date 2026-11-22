// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_DESIGN_RULES, compileToIPC2581, parseIPC2581, runDRC, type PCBLayout } from "../src/ecad/index.js";

describe("IPC-2581B/C Bidirectional Import & Round-Trip", () => {
  const sampleLayout: PCBLayout = {
    traces: [
      { start: [10, 10], end: [20, 20], width: 0.25, layer: "TopCopper", net: "VCC" },
      { start: [15, 15], end: [25, 15], width: 0.3, layer: "BottomCopper", net: "GND" },
    ],
    pads: [
      {
        center: [10, 10],
        width: 1.5,
        height: 0.6,
        drill: 0,
        shape: "roundrect",
        layer: "TopCopper",
        net: "VCC",
        component: "U1",
      },
      {
        center: [40, 25],
        width: 0.8,
        height: 0.8,
        drill: 0.4,
        shape: "circle",
        layer: "TopCopper",
        net: "GND",
        component: "J1",
      },
    ],
    vias: [{ center: [20, 20], drill: 0.3, annularRing: 0.15, net: "VCC" }],
    outline: {
      vertices: [
        [0, 0],
        [80, 0],
        [80, 50],
        [0, 50],
      ],
    },
    stackup: [
      { name: "TopCopper", type: "CONDUCTOR", sequence: 1, side: "TOP", thicknessMm: 0.035, material: "Copper" },
      {
        name: "CoreFR4",
        type: "DIELECTRIC",
        sequence: 2,
        thicknessMm: 1.53,
        material: "FR4",
        dielectricConstant: 4.3,
        lossTangent: 0.02,
      },
      { name: "BottomCopper", type: "CONDUCTOR", sequence: 3, side: "BOTTOM", thicknessMm: 0.035, material: "Copper" },
    ],
    netlist: {
      totalPins: 3,
      totalConnections: 1,
      nets: [
        {
          id: "VCC",
          pins: [
            { name: "U1.1", component: "U1", localName: "1" },
            { name: "J1.1", component: "J1", localName: "1" },
          ],
        },
        {
          id: "GND",
          pins: [{ name: "J1.2", component: "J1", localName: "2" }],
        },
      ],
      components: [
        {
          name: "U1",
          pins: ["1"],
          placement: { x: 10, y: 10, angle: 0, layer: "TopCopper", footprint: "SOIC-8" },
        },
        {
          name: "J1",
          pins: ["1", "2"],
          placement: { x: 40, y: 25, angle: 90, layer: "TopCopper", footprint: "HDR-2" },
        },
      ],
    },
  };

  it("round-trips PCBLayout -> compileToIPC2581 -> parseIPC2581 -> runDRC losslessly", () => {
    const xml = compileToIPC2581(sampleLayout, {
      assemblyName: "FlightController_RevC",
      revision: "3.0.1",
      enterprise: "ModelScript Aero",
      ipcClass: "CLASS_3",
      componentValues: { U1: "STM32H7", J1: "2-Pin Header" },
      componentMPNs: { U1: "STM32H743VIT6", J1: "61300211121" },
    });

    const parsed = parseIPC2581(xml);
    assert.strictEqual(parsed.diagnostics.length, 0, `Unexpected diagnostics: ${JSON.stringify(parsed.diagnostics)}`);

    // Metadata
    assert.strictEqual(parsed.metadata.assemblyName, "FlightController_RevC");
    assert.strictEqual(parsed.metadata.revision, "3.0.1");
    assert.strictEqual(parsed.metadata.enterprise, "ModelScript Aero");
    assert.strictEqual(parsed.metadata.ipcClass, "CLASS_3");
    assert.strictEqual(parsed.metadata.units, "MILLIMETER");

    // Geometry & Connectivity
    const { layout } = parsed;
    assert.strictEqual(layout.traces.length, 2);
    assert.deepStrictEqual(layout.traces[0]!.start, [10, 10]);
    assert.deepStrictEqual(layout.traces[0]!.end, [20, 20]);
    assert.strictEqual(layout.traces[0]!.width, 0.25);

    assert.strictEqual(layout.pads.length, 2);
    assert.strictEqual(layout.pads[0]!.shape, "roundrect");
    assert.strictEqual(layout.pads[0]!.component, "U1");
    assert.strictEqual(layout.pads[1]!.drill, 0.4);

    assert.strictEqual(layout.vias.length, 1);
    assert.strictEqual(layout.vias[0]!.drill, 0.3);
    assert(Math.abs(layout.vias[0]!.annularRing - 0.15) < 1e-6);

    assert.strictEqual(layout.outline?.vertices.length, 4);
    assert.deepStrictEqual(layout.outline?.vertices[2], [80, 50]);

    // Stackup & BOM
    assert.strictEqual(layout.stackup?.length, 3);
    assert.strictEqual(layout.stackup?.[1]?.dielectricConstant, 4.3);
    assert.strictEqual(layout.bom?.U1?.mpn, "STM32H743VIT6");
    assert.strictEqual(layout.bom?.J1?.value, "2-Pin Header");

    // Netlist
    assert.strictEqual(layout.netlist.nets.length, 2);
    assert.strictEqual(layout.netlist.components.length, 2);
    assert.strictEqual(layout.netlist.components[1]!.placement?.angle, 90);

    // Feeds directly into ModelScript's DRC engine
    const drc = runDRC({
      traces: layout.traces.map((t) => ({
        points: [
          { x: t.start[0], y: t.start[1] },
          { x: t.end[0], y: t.end[1] },
        ],
        width: t.width,
        layer: t.layer,
        netId: t.net,
        selected: false,
      })),
      pads: layout.pads.map((p, idx) => ({
        center: { x: p.center[0], y: p.center[1] },
        width: p.width,
        height: p.height,
        shape: p.shape,
        layer: p.layer,
        netId: p.net,
        component: p.component,
        pinName: `${p.component}.${idx + 1}`,
        selected: false,
      })),
      vias: layout.vias.map((v) => ({
        center: { x: v.center[0], y: v.center[1] },
        outerRadius: v.drill / 2 + v.annularRing,
        drillRadius: v.drill / 2,
        netId: v.net,
        selected: false,
      })),
      boardOutline: (layout.outline?.vertices ?? []).map(([x, y]) => ({ x, y })),
      rules: DEFAULT_DESIGN_RULES,
      expectedNets: new Map(layout.netlist.nets.map((n) => [n.id, n.pins.map((p) => p.name)])),
    });
    const errors = drc.violations.filter((v) => v.severity === "error");
    assert.strictEqual(errors.length, 0, `Unexpected DRC errors: ${JSON.stringify(errors)}`);
  });

  it("imports standard IPC-2581C XML from external EDA tools with INCH -> mm conversion", () => {
    const externalXml = `<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581">
  <Content roleRef="Owner">
    <DictionaryStandard units="INCH">
      <EntryStandard id="SMD_0603">
        <RectCenter width="0.040" height="0.030"/>
      </EntryStandard>
      <EntryStandard id="VIA_STD">
        <Circle diameter="0.024"/>
      </EntryStandard>
    </DictionaryStandard>
    <DictionaryLineDesc units="INCH">
      <EntryLineDesc id="TRACE_10MIL">
        <LineDesc lineEnd="ROUND" lineWidth="0.010"/>
      </EntryLineDesc>
    </DictionaryLineDesc>
  </Content>
  <Bom name="EXT_BOM">
    <BomHeader assembly="AltiumBoard" revision="B"/>
    <BomItem OEMDesignNumberRef="RC0603FR-0710KL" quantity="1">
      <RefDes name="R1"/>
      <Characteristics>
        <Textual textualCharacteristicName="value" textualCharacteristicValue="10k"/>
      </Characteristics>
    </BomItem>
  </Bom>
  <Ecad name="AltiumBoard">
    <CadHeader units="INCH"/>
    <CadData>
      <Layer name="L1_TOP" layerFunction="SIGNAL" side="TOP"/>
      <Layer name="CORE1" layerFunction="DIELECTRIC" side="INTERNAL"/>
      <Stackup name="STACK_2L">
        <StackupGroup name="MAIN">
          <StackupLayer layerOrGroupRef="L1_TOP" thickness="0.0014" sequence="1"/>
          <StackupLayer layerOrGroupRef="CORE1" thickness="0.060" sequence="2" matDes="FR4" er="4.4"/>
        </StackupGroup>
      </Stackup>
      <Step name="PCB">
        <Profile>
          <Polygon>
            <PolyBegin x="0" y="0"/>
            <PolyStepSegment x="2.0" y="0"/>
            <PolyStepSegment x="2.0" y="1.0"/>
            <PolyStepSegment x="0" y="1.0"/>
            <PolyStepSegment x="0" y="0"/>
          </Polygon>
        </Profile>
        <Component refDes="R1" packageRef="0603" layerRef="L1_TOP">
          <Location x="1.0" y="0.5"/>
          <Xform rotation="180"/>
        </Component>
        <LogicalNet name="NET_SIG">
          <PinRef componentRef="R1" pin="1"/>
          <PinRef componentRef="R1" pin="2"/>
        </LogicalNet>
        <LayerFeature layerRef="L1_TOP">
          <Set net="NET_SIG" componentRef="R1">
            <Pad>
              <Location x="1.0" y="0.5"/>
              <StandardPrimitiveRef id="SMD_0603"/>
              <PinRef componentRef="R1" pin="1"/>
            </Pad>
            <Features>
              <Line startX="1.0" startY="0.5" endX="1.5" endY="0.5">
                <LineDescRef id="TRACE_10MIL"/>
              </Line>
            </Features>
          </Set>
          <Set net="NET_SIG" padUsage="VIA">
            <Pad>
              <Location x="1.5" y="0.5"/>
              <StandardPrimitiveRef id="VIA_STD"/>
            </Pad>
          </Set>
        </LayerFeature>
      </Step>
    </CadData>
  </Ecad>
</IPC-2581>`;

    const parsed = parseIPC2581(externalXml);
    assert.strictEqual(parsed.diagnostics.length, 0);
    assert.strictEqual(parsed.metadata.units, "INCH");
    assert.strictEqual(parsed.metadata.assemblyName, "AltiumBoard");

    // Board outline: 2.0 in x 1.0 in -> 50.8 mm x 25.4 mm
    assert.strictEqual(parsed.layout.outline?.vertices.length, 4);
    assert(Math.abs(parsed.layout.outline!.vertices[1]![0] - 50.8) < 1e-6);
    assert(Math.abs(parsed.layout.outline!.vertices[2]![1] - 25.4) < 1e-6);

    // Component placement & BOM
    assert.strictEqual(parsed.layout.netlist.components.length, 1);
    assert(Math.abs(parsed.layout.netlist.components[0]!.placement!.x - 25.4) < 1e-6);
    assert.strictEqual(parsed.layout.netlist.components[0]!.placement!.angle, 180);
    assert.strictEqual(parsed.layout.bom?.R1?.mpn, "RC0603FR-0710KL");
    assert.strictEqual(parsed.layout.bom?.R1?.value, "10k");

    // Trace (10 mil = 0.254 mm)
    assert.strictEqual(parsed.layout.traces.length, 1);
    assert(Math.abs(parsed.layout.traces[0]!.width - 0.254) < 1e-6);
    assert(Math.abs(parsed.layout.traces[0]!.end[0] - 38.1) < 1e-6);

    // Pad & Via
    assert.strictEqual(parsed.layout.pads.length, 1);
    assert(Math.abs(parsed.layout.pads[0]!.width - 1.016) < 1e-6);
    assert.strictEqual(parsed.layout.vias.length, 1);

    // Stackup
    assert.strictEqual(parsed.layout.stackup?.length, 2);
    assert.strictEqual(parsed.layout.stackup?.[1]?.dielectricConstant, 4.4);
  });

  it("reports diagnostics gracefully for malformed or incomplete XML", () => {
    const bad = parseIPC2581("<NotIPC2581/>");
    assert.strictEqual(bad.diagnostics.length, 1);
    assert.strictEqual(bad.diagnostics[0]!.code, "IPC2581_MISSING_ROOT");

    const noStep = parseIPC2581('<IPC-2581 version="C"><Ecad name="Empty"/></IPC-2581>');
    assert(noStep.diagnostics.some((d) => d.code === "IPC2581_MISSING_STEP"));
  });
});

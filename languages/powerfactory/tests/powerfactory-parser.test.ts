// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  parsePowerFactoryAscii,
  parsePowerFactoryFile,
  parsePowerFactoryText,
  parsePowerFactoryXml,
} from "../src/parser/powerfactory-parser.js";

const samplePowerFactoryXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmSubstat" loc_name="Substation_Alpha">
    <desc>Primary 110kV Transmission Substation</desc>
  </DataObject>

  <DataObject class="ElmTerm" loc_name="Bus_110kV_1">
    <uknom>110.0</uknom>
    <fnom>50.0</fnom>
    <substat>Substation_Alpha</substat>
  </DataObject>

  <DataObject class="ElmTerm" loc_name="Bus_110kV_2">
    <uknom>110.0</uknom>
    <fnom>50.0</fnom>
    <substat>Substation_Alpha</substat>
  </DataObject>

  <DataObject class="ElmTerm" loc_name="Bus_20kV_1">
    <uknom>20.0</uknom>
    <fnom>50.0</fnom>
  </DataObject>

  <DataObject class="TypLne" loc_name="LineType_110kV">
    <uline>110.0</uline>
    <r1>0.12</r1>
    <x1>0.39</x1>
    <b1>2.85</b1>
    <snom>80.0</snom>
    <inom>0.42</inom>
  </DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_110kV_1</bus1>
    <bus2>Bus_110kV_2</bus2>
    <dline>25.0</dline>
    <typ_id>LineType_110kV</typ_id>
  </DataObject>

  <DataObject class="TypTr2" loc_name="TrafoType_110_20">
    <strn>40.0</strn>
    <utrn_h>110.0</utrn_h>
    <utrn_l>20.0</utrn_l>
    <ukrr>12.0</ukrr>
    <pkr>180.0</pkr>
    <vecgrp>Dyn11</vecgrp>
  </DataObject>

  <DataObject class="ElmTr2" loc_name="Trafo_1">
    <bushv>Bus_110kV_2</bushv>
    <buslv>Bus_20kV_1</buslv>
    <typ_id>TrafoType_110_20</typ_id>
  </DataObject>

  <DataObject class="TypSym" loc_name="GenType_Hydro">
    <snom>120.0</snom>
    <unom>110.0</unom>
    <cosn>0.85</cosn>
    <H>4.5</H>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_Alpha">
    <bus1>Bus_110kV_1</bus1>
    <pgini>85.0</pgini>
    <qgini>15.0</qgini>
    <usetp>1.02</usetp>
    <typ_id>GenType_Hydro</typ_id>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load_Dist">
    <bus1>Bus_20kV_1</bus1>
    <plini>35.0</plini>
    <qlini>10.0</qlini>
  </DataObject>

  <DataObject class="StaSwitch" loc_name="CB_BusCoupler">
    <bus1>Bus_110kV_1</bus1>
    <bus2>Bus_110kV_2</bus2>
    <on_off>1</on_off>
    <isBreaker>1</isBreaker>
  </DataObject>

  <DataObject class="SetDesktop" loc_name="Substation_Diagram">
    <IntGrf pDataObj="Bus_110kV_1" r_x="100.0" r_y="150.0" r_dx="80.0" r_dy="10.0"/>
    <IntGrf pDataObj="Line_1_2" r_x="140.0" r_y="150.0"/>
  </DataObject>
</PowerFactory>`;

test("parsePowerFactoryXml: parses full substation, terminals, lines, and transformers", () => {
  const model = parsePowerFactoryXml(samplePowerFactoryXml);

  assert.strictEqual(model.substations.size, 1);
  assert.ok(model.substations.has("Substation_Alpha"));

  assert.strictEqual(model.terminals.size, 3);
  const bus1 = model.terminals.get("Bus_110kV_1");
  assert.ok(bus1);
  assert.strictEqual(bus1.uknom, 110.0);
  assert.strictEqual(bus1.fnom, 50.0);

  assert.strictEqual(model.lineTypes.size, 1);
  const lType = model.lineTypes.get("LineType_110kV");
  assert.ok(lType);
  assert.strictEqual(lType.r1, 0.12);
  assert.strictEqual(lType.x1, 0.39);

  assert.strictEqual(model.lines.size, 1);
  const line = model.lines.get("Line_1_2");
  assert.ok(line);
  assert.strictEqual(line.bus1Id, "Bus_110kV_1");
  assert.strictEqual(line.bus2Id, "Bus_110kV_2");
  assert.strictEqual(line.dline, 25.0);

  assert.strictEqual(model.transformers2w.size, 1);
  const trafo = model.transformers2w.get("Trafo_1");
  assert.ok(trafo);
  assert.strictEqual(trafo.bushvId, "Bus_110kV_2");
  assert.strictEqual(trafo.buslvId, "Bus_20kV_1");

  assert.strictEqual(model.generators.size, 1);
  const gen = model.generators.get("Gen_Alpha");
  assert.ok(gen);
  assert.strictEqual(gen.pgini, 85.0);
  assert.strictEqual(gen.usetp, 1.02);

  assert.strictEqual(model.loads.size, 1);
  const lod = model.loads.get("Load_Dist");
  assert.ok(lod);
  assert.strictEqual(lod.plini, 35.0);
  assert.strictEqual(lod.qlini, 10.0);

  assert.strictEqual(model.switches.size, 1);
  const sw = model.switches.get("CB_BusCoupler");
  assert.ok(sw);
  assert.strictEqual(sw.on_off, 1);
  assert.strictEqual(sw.isBreaker, true);

  assert.strictEqual(model.diagrams.size, 1);
  const diag = model.diagrams.get("Substation_Diagram");
  assert.ok(diag);
  assert.strictEqual(diag.graphics.length, 2);
});

test("parsePowerFactoryFile: successfully unzips and parses binary .dz archive", () => {
  // Compress XML payload into a valid ZIP buffer
  const zipBuffer = zipSync({
    "project.xml": strToU8(samplePowerFactoryXml),
  });

  const model = parsePowerFactoryFile(zipBuffer, "test_network.dz");
  assert.strictEqual(model.terminals.size, 3);
  assert.strictEqual(model.lines.size, 1);
  assert.strictEqual(model.generators.size, 1);
});

test("parsePowerFactoryAscii: parses legacy .pfd ASCII format", () => {
  const pfdAscii = `
    ElmTerm "Bus1" { uknom=220.0 fnom=50.0 }
    ElmTerm "Bus2" { uknom=220.0 fnom=50.0 }
    ElmLne "L1" { bus1="Bus1" bus2="Bus2" dline=40.0 r1=0.08 x1=0.32 b1=3.5 }
    ElmSym "G1" { bus1="Bus1" pgini=200.0 qgini=30.0 usetp=1.03 }
    ElmLod "Ld1" { bus1="Bus2" plini=180.0 qlini=45.0 }
  `;

  const model = parsePowerFactoryText(pfdAscii, "AsciiCase");
  assert.strictEqual(model.terminals.size, 2);
  assert.strictEqual(model.lines.size, 1);
  assert.strictEqual(model.generators.size, 1);
  assert.strictEqual(model.loads.size, 1);
});

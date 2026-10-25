// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseLps, parseLpsKeyDeck, parseLpsXml, serializeLpsKeyDeck, serializeLpsXml } from "../src/parser/index.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudio id="study_texas_trunk" title="Texas Gulf Coast Gas Trunkline" simulationType="TGNET">
  <Nodes>
    <Node name="Hub_Supply" type="SUPPLY" elevation="10m" pressure="75.0bar" flow="120.0" />
    <Node name="Mid_Compressor_Suction" type="JUNCTION" elevation="25m" />
    <Node name="Mid_Compressor_Discharge" type="JUNCTION" elevation="25m" />
    <Node name="City_Gate_Delivery" type="DELIVERY" elevation="5m" minDeliveryPressure="35.0bar" flow="120.0" />
  </Nodes>
  <Pipes>
    <Pipe name="Line_101" from="Hub_Supply" to="Mid_Compressor_Suction" length="80.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
    <Pipe name="Line_102" from="Mid_Compressor_Discharge" to="City_Gate_Delivery" length="110.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
  </Pipes>
  <Compressors>
    <Compressor name="Station_A" from="Mid_Compressor_Suction" to="Mid_Compressor_Discharge" type="CENTRIFUGAL" power="22000000" maxRatio="1.8" efficiency="0.84" mode="DISCHARGE_PRESSURE" setpoint="85.0bar" status="RUNNING" />
  </Compressors>
  <GasComposition ch4="0.91" c2h6="0.05" c3h8="0.018" co2="0.008" n2="0.014" h2="0.05" ghv="39.2" />
  <SimulationControls startTime="0" endTime="86400" timeStep="60" eos="AGA8" steadyStateFirst="true" />
</PipelineStudio>`;

const SAMPLE_KEY_DECK = `CASE GulfCoastDeck TITLE "Gulf Coast Gas Deck"
SIMULATION TGNET
NODE Node_Inlet TYPE SUPPLY ELEVATION 15m PRESSURE 70.0bar FLOW 80.0
NODE Node_Junction TYPE JUNCTION ELEVATION 20m
NODE Node_Outlet TYPE DELIVERY ELEVATION 10m MINP 30.0bar FLOW 80.0
PIPE Main_Trunk FROM Node_Inlet TO Node_Junction LENGTH 60km DIAMETER 24in ROUGHNESS 0.000045 MAOP 100bar
PIPE Distribution_Branch FROM Node_Junction TO Node_Outlet LENGTH 45km DIAMETER 20in ROUGHNESS 0.000045 MAOP 80bar
COMPOSITION CH4 0.93 C2H6 0.04 C3H8 0.01 CO2 0.01 N2 0.01 H2 0.02
INTEGRATION START 0 END 43200 DT 30 EOS AGA8`;

test("PipelineStudio XML Parser parses full network study", () => {
  const model = parseLpsXml(SAMPLE_XML);
  assert.equal(model.id, "study_texas_trunk");
  assert.equal(model.title, "Texas Gulf Coast Gas Trunkline");
  assert.equal(model.type, "TGNET");
  assert.equal(model.nodes.length, 4);
  assert.equal(model.pipes.length, 2);
  assert.equal(model.compressors.length, 1);
  assert.ok(model.gasComposition != null);
  assert.equal(model.gasComposition.hydrogen, 0.05);

  // Check pipe dimensions parsed with units
  const p1 = model.pipes[0];
  assert.equal(p1.length, 80000); // 80 km
  assert.ok(Math.abs(p1.diameter - 0.762) < 0.001); // 30 inch
  assert.equal(p1.maop, 95e5); // 95 bar

  // Check compressor
  const c = model.compressors[0];
  assert.equal(c.name, "Station_A");
  assert.equal(c.fromNode, "Mid_Compressor_Suction");
  assert.equal(c.toNode, "Mid_Compressor_Discharge");
  assert.equal(c.controlMode, "DISCHARGE_PRESSURE");
  assert.equal(c.setpoint, 85e5);
});

test("PipelineStudio Keyword Deck Parser parses ASCII input decks", () => {
  const model = parseLpsKeyDeck(SAMPLE_KEY_DECK);
  assert.equal(model.id, "GulfCoastDeck");
  assert.equal(model.title, "Gulf Coast Gas Deck");
  assert.equal(model.nodes.length, 3);
  assert.equal(model.pipes.length, 2);
  assert.equal(model.nodes[0].pressure, 70e5);
  assert.equal(model.nodes[2].minDeliveryPressure, 30e5);
  assert.equal(model.pipes[0].length, 60000); // 60 km
  assert.ok(Math.abs(model.pipes[0].diameter - 0.6096) < 0.001); // 24 inch
  assert.ok(model.gasComposition != null);
  assert.equal(model.gasComposition.methane, 0.93);
});

test("Unified parseLps auto-detects format", () => {
  const xmlModel = parseLps(SAMPLE_XML);
  assert.equal(xmlModel.type, "TGNET");

  const keyModel = parseLps(SAMPLE_KEY_DECK);
  assert.equal(keyModel.type, "TGNET");
});

test("Serializer round-trips correctly", () => {
  const model = parseLpsXml(SAMPLE_XML);
  const serializedXml = serializeLpsXml(model);
  const reparsed = parseLpsXml(serializedXml);
  assert.equal(reparsed.nodes.length, model.nodes.length);
  assert.equal(reparsed.pipes.length, model.pipes.length);
  assert.equal(reparsed.compressors.length, model.compressors.length);

  const serializedDeck = serializeLpsKeyDeck(model);
  const reparsedDeck = parseLpsKeyDeck(serializedDeck);
  assert.equal(reparsedDeck.nodes.length, model.nodes.length);
  assert.equal(reparsedDeck.pipes.length, model.pipes.length);
});

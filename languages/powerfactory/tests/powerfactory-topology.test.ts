// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { processPowerFactoryTopology } from "../src/topology/topology-processor.js";

test("processPowerFactoryTopology: merges terminals connected by closed breakers", () => {
  const xmlWithClosedBreaker = `<?xml version="1.0" encoding="UTF-8"?>
  <PowerFactory>
    <DataObject class="ElmTerm" loc_name="T1"><uknom>110.0</uknom></DataObject>
    <DataObject class="ElmTerm" loc_name="T2"><uknom>110.0</uknom></DataObject>
    <DataObject class="ElmTerm" loc_name="T3"><uknom>110.0</uknom></DataObject>

    <!-- Closed switch between T1 and T2 -->
    <DataObject class="StaSwitch" loc_name="CB12">
      <bus1>T1</bus1><bus2>T2</bus2><on_off>1</on_off>
    </DataObject>

    <!-- Line from T2 to T3 -->
    <DataObject class="ElmLne" loc_name="L23">
      <bus1>T2</bus1><bus2>T3</bus2><dline>10.0</dline><r1>1.0</r1><x1>4.0</x1><b1>20.0</b1>
    </DataObject>
  </PowerFactory>`;

  const model = parsePowerFactoryText(xmlWithClosedBreaker);
  const topo = processPowerFactoryTopology(model);

  // T1 and T2 should be merged into one bus, T3 into another bus -> total 2 buses
  assert.strictEqual(topo.buses.size, 2);
  const busT1 = topo.termToBus.get("T1");
  const busT2 = topo.termToBus.get("T2");
  const busT3 = topo.termToBus.get("T3");

  assert.strictEqual(busT1, busT2, "T1 and T2 must share the same bus number");
  assert.notStrictEqual(busT1, busT3, "T1 and T3 must be distinct buses");

  assert.strictEqual(topo.mappedLines.length, 1);
  const mLine = topo.mappedLines[0]!;
  assert.strictEqual(mLine.fromBus, busT2);
  assert.strictEqual(mLine.toBus, busT3);
});

test("processPowerFactoryTopology: separates terminals when breaker is opened", () => {
  const xmlWithOpenBreaker = `<?xml version="1.0" encoding="UTF-8"?>
  <PowerFactory>
    <DataObject class="ElmTerm" loc_name="T1"><uknom>110.0</uknom></DataObject>
    <DataObject class="ElmTerm" loc_name="T2"><uknom>110.0</uknom></DataObject>
    <DataObject class="StaSwitch" loc_name="CB12">
      <bus1>T1</bus1><bus2>T2</bus2><on_off>0</on_off>
    </DataObject>
    <DataObject class="ElmLne" loc_name="L12">
      <bus1>T1</bus1><bus2>T2</bus2><dline>10.0</dline><r1>1.0</r1><x1>4.0</x1><b1>20.0</b1>
    </DataObject>
  </PowerFactory>`;

  const model = parsePowerFactoryText(xmlWithOpenBreaker);
  const topo = processPowerFactoryTopology(model);

  assert.strictEqual(topo.buses.size, 2);
  const b1 = topo.termToBus.get("T1");
  const b2 = topo.termToBus.get("T2");
  assert.notStrictEqual(b1, b2, "Open breaker keeps terminals separate");

  assert.strictEqual(topo.mappedLines.length, 1);
  assert.strictEqual(topo.mappedLines[0]!.fromBus, b1);
  assert.strictEqual(topo.mappedLines[0]!.toBus, b2);
});

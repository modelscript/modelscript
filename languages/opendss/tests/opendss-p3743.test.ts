// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileP3743ToEmtCorridors } from "@modelscript/exchange";
import assert from "node:assert";
import test from "node:test";
import { opendssToP3743Corridors, parseOpenDss } from "../src/index.js";

test("OpenDSS physical line geometry exports to P3743 corridors and compiles to wideband EMT", () => {
  const dss = `
Clear
New Circuit.TestTower basekv=115 pu=1.0
New WireData.ACSR_Drake diam=2.814 rdac=0.0728 gmrac=1.135 units=cm
New LineSpacing.HFrame nconds=3 nphases=3 x=[-4, 0, 4] y=[15, 15, 15] units=m
New LineGeometry.G115 nconds=3 nphases=3 wires=[ACSR_Drake, ACSR_Drake, ACSR_Drake] spacing=HFrame
New Line.L1 bus1=B1 bus2=B2 length=25 units=km geometry=G115
`;
  const deck = parseOpenDss(dss);
  const exported = opendssToP3743Corridors(deck, { soilRhoOhmM: 150, baseKvLL: 115 });
  assert.strictEqual(exported.buses.length, 2);
  assert.strictEqual(exported.corridors.length, 1);
  assert.strictEqual(exported.conductorsByCorridor["l1"]?.length ?? exported.conductorsByCorridor["L1"]?.length, 3);

  const compiled = compileP3743ToEmtCorridors(
    {
      metadata: {
        schemaVersion: "IEEE-P3743-draft-1.0",
        caseId: "OPENDSS-P3743-01",
        title: "OpenDSS Tower to P3743",
        nominalFrequencyHz: 60,
        baseMva: 100,
        createdAtIso: "2026-11-15T00:00:00Z",
      },
      buses: exported.buses,
      corridors: exported.corridors,
      vendorModels: [],
      boundaryEquivalents: [],
    },
    { conductorsByCorridor: exported.conductorsByCorridor },
  );

  assert.strictEqual(compiled.corridors.length, 1);
  assert.ok(compiled.corridors[0]!.fdLine.yPoles.length > 0);
});

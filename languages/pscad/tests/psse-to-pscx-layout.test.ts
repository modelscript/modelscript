// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseRaw, psseToPscxSchematic } from "@modelscript/psse";
import assert from "node:assert";
import test from "node:test";
import { extractEmtNetlist, parsePscx } from "../src/index.js";

const FOUR_BUS_DOUBLE_CKT_RAW = `0, 100.00, 33, 0, 1, 60.00
PSSE TO PSCX AUTO-LAYOUT TEST
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'MID_A', 230.0000, 1, 1, 1, 1, 1.00000, -2.0000
3, 'MID_B', 230.0000, 1, 1, 1, 1, 0.99500, -3.0000
4, 'LOAD4', 230.0000, 1, 1, 1, 1, 0.99000, -5.0000
0 / END OF BUS DATA
4, '1 ', 1, 1, 1, 80.0, 20.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 82.0, 20.0, 200.0, -200.0, 1.020, 0, 100.0, 0.003, 0.15, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.010, 0.080, 0.04, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
1, 2, '2 ', 0.010, 0.080, 0.04, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
1, 3, '1 ', 0.012, 0.095, 0.04, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
2, 4, '1 ', 0.015, 0.110, 0.05, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
3, 4, '1 ', 0.015, 0.110, 0.05, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;

test("psseToPscxSchematic auto-lays out buses, parallel lines, Manhattan wires on 18-px grid and round-trips through parsePscx", () => {
  const psseCase = parseRaw(FOUR_BUS_DOUBLE_CKT_RAW);
  const { pscxXml, layout } = psseToPscxSchematic(psseCase, {
    projectName: "FourBusAutoLayout",
    dtEmtSec: 50e-6,
    durationSec: 0.25,
  });

  // 1. Layered topological placement: Slack on layer 0, MID_A & MID_B on layer 1, LOAD4 on layer 2
  assert.equal(layout.buses.length, 4);
  assert.equal(layout.layerCount, 3);
  const byName = new Map(layout.buses.map((b) => [b.name, b]));
  assert.equal(byName.get("SLACK")?.layer, 0);
  assert.equal(byName.get("MID_A")?.layer, 1);
  assert.equal(byName.get("MID_B")?.layer, 1);
  assert.equal(byName.get("LOAD4")?.layer, 2);

  // Zero overlapping bus coordinates and strict 18-px grid snapping
  const busCoords = new Set<string>();
  for (const b of layout.buses) {
    assert.equal(b.x % 18, 0, `Bus ${b.name} x=${b.x} not snapped to 18-px grid`);
    assert.equal(b.y % 18, 0, `Bus ${b.name} y=${b.y} not snapped to 18-px grid`);
    const key = `${b.x},${b.y}`;
    assert.ok(!busCoords.has(key), `Overlapping bus coordinate at ${key}`);
    busCoords.add(key);
  }

  // 2. Parallel double-circuit lines (1-2 ckt 1 & 2) must be vertically separated
  const tlines = layout.components.filter(
    (c) => c.definitionName === "master:tline" || c.definitionName === "master:pi_section",
  );
  assert.equal(tlines.length, 5);
  const lineCoords = new Set(tlines.map((c) => `${c.x},${c.y}`));
  assert.equal(lineCoords.size, 5, "Expected parallel transmission lines to have distinct non-overlapping coordinates");

  // 3. All wire segments must be snapped to 18-px grid and strictly orthogonal (Manhattan)
  assert.ok(layout.wires.length >= 12);
  for (const w of layout.wires) {
    assert.ok(w.vertices.length >= 2);
    for (let i = 0; i < w.vertices.length; i++) {
      const pt = w.vertices[i]!;
      assert.equal(pt.x % 18, 0, `Wire ${w.id} vertex x=${pt.x} not on 18-px grid`);
      assert.equal(pt.y % 18, 0, `Wire ${w.id} vertex y=${pt.y} not on 18-px grid`);
      if (i > 0) {
        const prev = w.vertices[i - 1]!;
        assert.ok(prev.x === pt.x || prev.y === pt.y, `Non-orthogonal wire segment in ${w.id}`);
      }
    }
  }

  // 4. Round-trip through @modelscript/pscad parsePscx & extractEmtNetlist
  const parsed = parsePscx(pscxXml);
  assert.equal(parsed.name, "FourBusAutoLayout");
  assert.equal(parsed.rootModule.buses.length, 4);
  assert.equal(parsed.rootModule.components.length, layout.components.length);
  assert.equal(parsed.rootModule.wires.length, layout.wires.length);

  const emtNetlist = extractEmtNetlist(parsed);
  assert.ok(emtNetlist.buses.size >= 4);
  assert.ok(emtNetlist.sources.length >= 1);
});

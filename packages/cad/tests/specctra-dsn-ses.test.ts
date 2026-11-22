// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  DEFAULT_DESIGN_RULES,
  applySpecctraSesToLayout,
  exportToSpecctraDsn,
  parseSpecctraSes,
  runDRC,
  type PCBLayout,
} from "../src/ecad/index.js";

describe("Specctra DSN Exporter & Session (.ses) Autorouter Importer", () => {
  const unroutedLayout: PCBLayout = {
    traces: [],
    pads: [
      {
        center: [10, 10],
        shape: "rect",
        width: 1.0,
        height: 1.0,
        drill: 0,
        layer: "TopCopper",
        net: "VCC",
        component: "R1",
      },
      {
        center: [30, 10],
        shape: "rect",
        width: 1.0,
        height: 1.0,
        drill: 0,
        layer: "TopCopper",
        net: "VCC",
        component: "C1",
      },
    ],
    vias: [],
    outline: {
      vertices: [
        [0, 0],
        [50, 0],
        [50, 30],
        [0, 30],
      ],
    },
    netlist: {
      totalPins: 2,
      totalConnections: 1,
      nets: [
        {
          id: "VCC",
          pins: [
            { name: "R1.1", component: "R1", localName: "1" },
            { name: "C1.1", component: "C1", localName: "1" },
          ],
        },
      ],
      components: [
        { name: "R1", pins: ["1"], placement: { footprint: "0603", layer: "TopCopper", x: 10, y: 10, angle: 0 } },
        { name: "C1", pins: ["1"], placement: { footprint: "0603", layer: "TopCopper", x: 30, y: 10, angle: 0 } },
      ],
    },
  };

  it("exports valid Specctra .dsn S-expression for external autorouters", () => {
    const dsn = exportToSpecctraDsn(unroutedLayout, { designName: "demo_board" });
    assert(dsn.startsWith("(pcb demo_board"));
    assert(dsn.includes("(resolution mm 1000)"));
    assert(dsn.includes("(boundary (path pcb 0 0 0 50 0 50 30 0 30 0 0))"));
    assert(dsn.includes("(place R1 10 10 front 0)"));
    assert(dsn.includes("(net VCC (pins R1-1 C1-1))"));
  });

  it("imports Freerouting .ses session with um resolution scaling and merges into PCBLayout for DRC", () => {
    const ses = `(session "demo_board.ses"
      (base_design "demo_board.dsn")
      (routes
        (resolution um 10)
        (network_out
          (net VCC
            (wire (path TopCopper 2500 100000 100000 200000 100000 200000 150000))
            (via "Via[0-1]_0.6:0.3_mm" 200000 150000)
            (wire (path BottomCopper 2500 200000 150000 300000 100000))
          )
        )
      )
    )`;

    const parsed = parseSpecctraSes(ses);
    assert.strictEqual(parsed.diagnostics.length, 0);
    assert.strictEqual(parsed.traces.length, 3);
    assert(Math.abs(parsed.traces[0]!.width - 0.25) < 1e-6);
    assert.deepStrictEqual(parsed.traces[0]!.start, [10, 10]);
    assert.deepStrictEqual(parsed.traces[0]!.end, [20, 10]);
    assert.strictEqual(parsed.vias.length, 1);
    assert.deepStrictEqual(parsed.vias[0]!.center, [20, 15]);

    const routed = applySpecctraSesToLayout(unroutedLayout, ses);
    assert.strictEqual(routed.traces.length, 3);
    assert.strictEqual(routed.vias.length, 1);

    const drc = runDRC({
      traces: routed.traces.map((t) => ({
        points: [
          { x: t.start[0], y: t.start[1] },
          { x: t.end[0], y: t.end[1] },
        ],
        width: t.width,
        layer: t.layer,
        netId: t.net,
        selected: false,
      })),
      pads: routed.pads.map((p, idx) => ({
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
      vias: routed.vias.map((v) => ({
        center: { x: v.center[0], y: v.center[1] },
        outerRadius: v.drill / 2 + v.annularRing,
        drillRadius: v.drill / 2,
        netId: v.net,
        selected: false,
      })),
      boardOutline: routed.outline!.vertices.map(([x, y]) => ({ x, y })),
      rules: DEFAULT_DESIGN_RULES,
      expectedNets: new Map([["VCC", ["R1.1", "C1.1"]]]),
    });
    assert.strictEqual(drc.violations.filter((v) => v.severity === "error").length, 0);
  });
});

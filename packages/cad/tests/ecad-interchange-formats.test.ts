// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  applyIdxToLayout,
  exportToIdx,
  generateManufacturingFiles,
  parseEdif200,
  parseExcellon,
  parseGerber,
  parseIdx,
  type PCBLayout,
} from "../src/ecad/index.js";

describe("ECAD Interchange Formats: IDX v4.0, Gerber/Excellon Import & EDIF 2 0 0", () => {
  const layout: PCBLayout = {
    traces: [{ start: [10, 10], end: [30, 10], width: 0.25, layer: "TopCopper", net: "VCC" }],
    pads: [
      {
        center: [10, 10],
        shape: "rect",
        width: 1.2,
        height: 0.8,
        drill: 0,
        layer: "TopCopper",
        net: "VCC",
        component: "R1",
      },
      {
        center: [5, 5],
        shape: "circle",
        width: 4.5,
        height: 4.5,
        drill: 3.2,
        layer: "TopCopper",
        net: "",
        component: "H1",
      },
    ],
    vias: [{ center: [20, 10], drill: 0.3, annularRing: 0.15, net: "VCC" }],
    outline: {
      vertices: [
        [0, 0],
        [60, 0],
        [60, 40],
        [0, 40],
      ],
    },
    keepouts: [
      {
        layer: "TopCopper",
        vertices: [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
        ],
        noComponents: true,
      },
    ],
    netlist: {
      totalPins: 1,
      totalConnections: 0,
      nets: [{ id: "VCC", pins: [{ name: "R1.1", component: "R1", localName: "1" }] }],
      components: [
        { name: "R1", pins: ["1"], placement: { footprint: "0603", layer: "TopCopper", x: 10, y: 10, angle: 0 } },
      ],
    },
  };

  it("round-trips ProSTEP iViP IDX v4.0 ECAD-MCAD exchange", () => {
    const xml = exportToIdx(layout, {
      designName: "SensorBoard",
      boardThicknessMm: 1.6,
      componentHeightsMm: { R1: 0.8 },
    });
    const parsed = parseIdx(xml);
    assert.strictEqual(parsed.diagnostics.length, 0);
    assert.strictEqual(parsed.designName, "SensorBoard");
    assert.strictEqual(parsed.boardThicknessMm, 1.6);
    assert.strictEqual(parsed.outline?.vertices.length, 4);
    assert.strictEqual(parsed.keepouts.length, 1);
    assert.strictEqual(parsed.mountingHoles.length, 1);
    assert.strictEqual(parsed.mountingHoles[0]!.diameterMm, 3.2);
    assert.strictEqual(parsed.components.length, 1);
    assert.strictEqual(parsed.components[0]!.heightMm, 0.8);

    const updated = applyIdxToLayout(layout, parsed);
    assert.strictEqual(updated.keepouts?.length, 1);
  });

  it("round-trips RS-274X Gerber and parses Excellon drill files", () => {
    const files = generateManufacturingFiles(layout);
    const topFile = files.find((f) => f.filename.endsWith(".gtl") || f.filename.toLowerCase().includes("top"));
    assert(topFile, "Expected TopCopper Gerber file");
    const parsed = parseGerber(topFile.content, "TopCopper");
    assert.strictEqual(parsed.traces.length, 1);
    assert(Math.abs(parsed.traces[0]!.end[0] - 30) < 1e-3);
    assert(parsed.pads.length >= 1);

    const drill = parseExcellon("M48\nMETRIC,TZ\nT1C0.300\n%\nT1\nX20.0Y10.0\nM30\n");
    assert.strictEqual(drill.holes.length, 1);
    assert.deepStrictEqual(drill.holes[0]!.center, [20, 10]);
    assert.strictEqual(drill.holes[0]!.drill, 0.3);
  });

  it("parses EDIF 2 0 0 enterprise schematic netlists into NetlistGraph", () => {
    const edif = `(edif MainBoard
      (edifVersion 2 0 0)
      (library MainLib
        (cell Top
          (view Netlist
            (contents
              (instance R1 (viewRef Netlist (cellRef RES_0603)))
              (instance C1 (viewRef Netlist (cellRef CAP_0603)))
              (net (rename N_OUT "VOUT")
                (joined
                  (portRef 2 (instanceRef R1))
                  (portRef 1 (instanceRef C1))
                )
              )
            )
          )
        )
      )
    )`;
    const res = parseEdif200(edif);
    assert.strictEqual(res.diagnostics.length, 0);
    assert.strictEqual(res.designName, "MainBoard");
    assert.strictEqual(res.netlist.components.length, 2);
    assert.strictEqual(res.netlist.nets.length, 1);
    assert.strictEqual(res.netlist.nets[0]!.id, "VOUT");
    assert.strictEqual(res.netlist.nets[0]!.pins.length, 2);
  });
});

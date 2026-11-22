// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_DESIGN_RULES, compileToIPC2581, parseIPC2581, runDRC } from "@modelscript/cad/ecad";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { kicadBoardToPcbLayout } from "../src/cad-bridge.js";
import { exportToKiCadPcb } from "../src/export.js";
import { lintKiCadBoard } from "../src/lints/index.js";
import { parseKiCadBoard, parseKiCadSchematic } from "../src/parser/kicad-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_KICAD_PCB = `(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (setup
    (stackup
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "core") (thickness 1.53) (material "FR4") (epsilon_r 4.3) (loss_tangent 0.02))
      (layer "B.Cu" (type "copper") (thickness 0.035))
    )
  )
  (net 0 "")
  (net 1 "VCC")
  (net 2 "GND")
  (footprint "Resistor_SMD:R_0603_1608Metric"
    (layer "F.Cu")
    (at 20 15 90)
    (property "Reference" "R1")
    (property "Value" "10k")
    (property "MPN" "RC0603FR-0710KL")
    (pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Mask") (net 1 "VCC"))
    (pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Mask") (net 2 "GND"))
  )
  (footprint "Connector_PinHeader:PinHeader_1x02"
    (layer "F.Cu")
    (at 40 15)
    (property "Reference" "J1")
    (property "Value" "PWR")
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 1 "VCC"))
    (pad "2" thru_hole circle (at 0 2.54) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 2 "GND"))
  )
  (gr_rect (start 0 0) (end 60 40) (layer "Edge.Cuts") (width 0.1))
  (segment (start 20 15.8) (end 40 15) (width 0.25) (layer "F.Cu") (net 1))
  (arc (start 20 14.2) (mid 30 16) (end 40 17.54) (width 0.25) (layer "B.Cu") (net 2))
  (via (at 30 15) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
  (zone (net 2) (net_name "GND") (layer "B.Cu")
    (connect_pads (clearance 0.3))
    (polygon (pts (xy 1 1) (xy 59 1) (xy 59 39) (xy 1 39)))
  )
)`;

describe("@modelscript/kicad — KiCad 8 S-Expression Parser, CAD Bridge, Linter & Round-Trip", () => {
  it("parses KiCad 8 .kicad_pcb, lowers to PCBLayout, runs DRC, and bridges to IPC-2581", () => {
    const board = parseKiCadBoard(SAMPLE_KICAD_PCB);
    assert.strictEqual(board.diagnostics.length, 0);
    assert.strictEqual(board.version, "20240108");
    assert.strictEqual(board.footprints.length, 2);
    assert.strictEqual(board.segments.length, 1);
    assert.strictEqual(board.arcs.length, 1);
    assert.strictEqual(board.vias.length, 1);
    assert.strictEqual(board.zones.length, 1);
    assert.strictEqual(board.outline.length, 4);

    // Check rotated pad transform for R1 at (20, 15, 90 deg) with local pad1 (-0.8, 0) -> (20, 15.8)
    const r1Pad1 = board.footprints[0]!.pads[0]!;
    assert(Math.abs(r1Pad1.boardPos[0] - 20) < 1e-6);
    assert(Math.abs(r1Pad1.boardPos[1] - 15.8) < 1e-6);

    // Bridge to canonical PCBLayout
    const layout = kicadBoardToPcbLayout(board);
    assert.strictEqual(layout.traces.length, 1);
    assert.strictEqual(layout.traces[0]!.layer, "TopCopper");
    assert.strictEqual(layout.arcs?.length, 1);
    assert.strictEqual(layout.zones?.length, 1);
    assert.strictEqual(layout.pads.length, 4);
    assert.strictEqual(layout.vias.length, 1);
    assert.strictEqual(layout.stackup?.length, 3);
    assert.strictEqual(layout.stackup?.[1]?.dielectricConstant, 4.3);
    assert.strictEqual(layout.bom?.R1?.mpn, "RC0603FR-0710KL");

    // Run DRC directly on KiCad board
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
    assert.strictEqual(drc.violations.filter((v) => v.severity === "error").length, 0);

    // Cross-format bridge: KiCad -> PCBLayout -> IPC-2581C -> parseIPC2581
    const ipcXml = compileToIPC2581(layout, { assemblyName: "KiCadBridgeTest" });
    const roundTripped = parseIPC2581(ipcXml);
    assert.strictEqual(roundTripped.diagnostics.length, 0);
    assert.strictEqual(roundTripped.layout.traces.length, 1);
    assert.strictEqual(roundTripped.layout.pads.length, 4);
    assert.strictEqual(roundTripped.layout.vias.length, 1);
  });

  it("round-trips PCBLayout -> exportToKiCadPcb -> parseKiCadBoard -> kicadBoardToPcbLayout", () => {
    const initialBoard = parseKiCadBoard(SAMPLE_KICAD_PCB);
    const initialLayout = kicadBoardToPcbLayout(initialBoard);

    const emitted = exportToKiCadPcb(initialLayout);
    const reparsedBoard = parseKiCadBoard(emitted);
    assert.strictEqual(reparsedBoard.diagnostics.length, 0);

    const reparsedLayout = kicadBoardToPcbLayout(reparsedBoard);
    assert.strictEqual(reparsedLayout.traces.length, initialLayout.traces.length);
    assert.strictEqual(reparsedLayout.pads.length, initialLayout.pads.length);
    assert.strictEqual(reparsedLayout.vias.length, initialLayout.vias.length);
    assert.strictEqual(reparsedLayout.arcs?.length, initialLayout.arcs?.length);
    assert.strictEqual(reparsedLayout.zones?.length, initialLayout.zones?.length);
    assert.strictEqual(reparsedLayout.outline?.vertices.length, 4);
    assert.strictEqual(reparsedLayout.stackup?.length, 3);
    assert.strictEqual(reparsedLayout.bom?.R1?.mpn, "RC0603FR-0710KL");
  });

  it("detects ECAD lints (duplicate refdes, undeclared net, missing Edge.Cuts)", () => {
    const buggy = `(kicad_pcb
      (version 20240108)
      (net 0 "")
      (footprint "R_0603" (layer "F.Cu") (at 10 10) (property "Reference" "R1"))
      (footprint "R_0603" (layer "F.Cu") (at 20 10) (property "Reference" "R1"))
      (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 99))
    )`;
    const board = parseKiCadBoard(buggy);
    const lints = lintKiCadBoard(board);
    assert(lints.some((d) => d.code === "K2001"));
    assert(lints.some((d) => d.code === "K4002"));
    assert(lints.some((d) => d.code === "K5001"));
  });

  it("parses KiCad .kicad_sch symbols, wires, and labels", () => {
    const sch = parseKiCadSchematic(`(kicad_sch
      (version 20231120)
      (generator "eeschema")
      (symbol (lib_id "Device:R") (at 100 50 0) (property "Reference" "R1") (property "Value" "4.7k") (property "Footprint" "Resistor_SMD:R_0603"))
      (wire (pts (xy 100 55) (xy 120 55)))
      (global_label "VCC" (at 100 45 0))
    )`);
    assert.strictEqual(sch.diagnostics.length, 0);
    assert.strictEqual(sch.symbols.length, 1);
    assert.strictEqual(sch.symbols[0]!.refDes, "R1");
    assert.strictEqual(sch.wires.length, 1);
    assert.strictEqual(sch.labels.length, 1);
    assert.strictEqual(sch.labels[0]!.name, "VCC");
  });

  it("ships a compiled native WebAssembly GLR parser (dist/parser.wasm)", () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    assert(fs.existsSync(wasmPath), "Expected dist/parser.wasm to be generated by build:parser");
    assert(fs.statSync(wasmPath).size > 0);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToIPC2581, exportToIdx, exportToSpecctraDsn, parseIdx, parseIPC2581 } from "@modelscript/cad/ecad";
import assert from "node:assert";
import { describe, it } from "node:test";
import { kicadBoardToPcbLayout } from "../src/cad-bridge.js";
import { exportToKiCadPcb } from "../src/export.js";
import { parseKiCadBoard } from "../src/parser/kicad-parser.js";

describe("@modelscript/kicad — Full Polyglot ECAD Pipeline Benchmark", () => {
  it("round-trips a multi-component board across KiCad -> IPC-2581 -> IDX -> Specctra -> KiCad", () => {
    const src = `(kicad_pcb
      (version 20240108)
      (net 0 "")
      (net 1 "VIN")
      (net 2 "SW")
      (net 3 "GND")
      (footprint "Inductor_SMD:L_6030" (layer "F.Cu") (at 25 20)
        (property "Reference" "L1") (property "Value" "4.7uH")
        (pad "1" smd rect (at -2 0) (size 1.5 2.5) (layers "F.Cu") (net 2 "SW"))
        (pad "2" smd rect (at 2 0) (size 1.5 2.5) (layers "F.Cu") (net 1 "VIN"))
      )
      (footprint "Capacitor_SMD:C_0805" (layer "F.Cu") (at 40 20)
        (property "Reference" "C1") (property "Value" "10uF")
        (pad "1" smd rect (at -1 0) (size 1.0 1.2) (layers "F.Cu") (net 1 "VIN"))
        (pad "2" smd rect (at 1 0) (size 1.0 1.2) (layers "F.Cu") (net 3 "GND"))
      )
      (gr_rect (start 0 0) (end 70 45) (layer "Edge.Cuts") (width 0.1))
      (segment (start 27 20) (end 39 20) (width 0.5) (layer "F.Cu") (net 1))
    )`;

    const layout = kicadBoardToPcbLayout(parseKiCadBoard(src));
    const ipc = parseIPC2581(compileToIPC2581(layout));
    assert.strictEqual(ipc.diagnostics.length, 0);

    const idx = parseIdx(exportToIdx(ipc.layout, { designName: "BuckStage" }));
    assert.strictEqual(idx.components.length, 2);
    assert.strictEqual(idx.outline?.vertices.length, 4);

    const dsn = exportToSpecctraDsn(ipc.layout, { designName: "BuckStage" });
    assert(dsn.includes("(net VIN"));

    const reKiCad = parseKiCadBoard(exportToKiCadPcb(ipc.layout));
    assert.strictEqual(reKiCad.footprints.length, 2);
    assert.strictEqual(reKiCad.segments.length, 1);
  });
});

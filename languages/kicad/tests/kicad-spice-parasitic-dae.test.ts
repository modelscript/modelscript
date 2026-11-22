// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { exportKiCadSchematicToSpice, lowerKiCadSchematicWithParasitics } from "../src/dae/dae-lower.js";
import { parseKiCadBoard, parseKiCadSchematic } from "../src/parser/kicad-parser.js";

const DIODE_CLAMP_SCH = `(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Simulation_SPICE:VDC" (symbol "VDC_1_1"
      (pin passive line (at 0 5 270) (length 1) (name "+") (number "1"))
      (pin passive line (at 0 -5 90) (length 1) (name "-") (number "2"))
    ))
    (symbol "Device:R" (symbol "R_1_1"
      (pin passive line (at 0 5 270) (length 1) (name "~") (number "1"))
      (pin passive line (at 0 -5 90) (length 1) (name "~") (number "2"))
    ))
    (symbol "Device:D" (symbol "D_1_1"
      (pin passive line (at 0 5 270) (length 1) (name "A") (number "1"))
      (pin passive line (at 0 -5 90) (length 1) (name "K") (number "2"))
    ))
    (symbol "power:GND" (power) (symbol "GND_0_1" (pin power_in line (at 0 0 90) (length 0) (name "GND") (number "1"))))
  )
  (symbol (lib_id "Simulation_SPICE:VDC") (at 10 20 0) (property "Reference" "V1") (property "Value" "5V"))
  (symbol (lib_id "Device:R") (at 30 15 90) (property "Reference" "R1") (property "Value" "1k"))
  (symbol (lib_id "Device:D") (at 45 20 0) (property "Reference" "D1") (property "Value" "1N4148"))
  (symbol (lib_id "power:GND") (at 10 25 0) (property "Reference" "#PWR1") (property "Value" "GND"))
  (symbol (lib_id "power:GND") (at 45 25 0) (property "Reference" "#PWR2") (property "Value" "GND"))
  (wire (pts (xy 10 15) (xy 25 15)))
  (wire (pts (xy 35 15) (xy 45 15)))
  (label "VIN" (at 10 15 0))
  (label "VCLAMP" (at 45 15 0))
)`;

const PAIRED_PCB = `(kicad_pcb
  (version 20240108)
  (net 0 "")
  (net 1 "VCLAMP")
  (segment (start 0 0) (end 40 0) (width 0.35) (layer "F.Cu") (net 1))
)`;

describe("@modelscript/kicad — Active Diode Lowering, SPICE Export & Coupled Layout Parasitics", () => {
  it("lowers nonlinear Shockley diode + injects layout RLGC parasitics into DAEBuilder", () => {
    const sch = parseKiCadSchematic(DIODE_CLAMP_SCH);
    const board = parseKiCadBoard(PAIRED_PCB);
    const res = lowerKiCadSchematicWithParasitics(sch, board);

    assert.strictEqual(res.loweredComponentCount, 3);
    assert.strictEqual(res.parasiticNetCount, 1);
    // Base: 3 node voltages + 3 branch currents + 3 params = 9 vars + 3 trace RLGC params = 12 vars
    assert.strictEqual(res.arena.varCount, 12);
    assert.strictEqual(res.arena.eqCount, 6);
  });

  it("exports a valid SPICE .cir netlist with .MODEL DDEFAULT", () => {
    const sch = parseKiCadSchematic(DIODE_CLAMP_SCH);
    const spice = exportKiCadSchematicToSpice(sch, "DiodeClamp");
    assert(spice.includes("V1 VIN 0 DC 5"));
    assert(spice.includes("R1 VIN VCLAMP 1k"));
    assert(spice.includes("D1 VCLAMP 0 DDEFAULT"));
    assert(spice.includes(".MODEL DDEFAULT D("));
  });
});

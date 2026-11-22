// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerKiCadSchematicToDAE, parseEngineeringValue } from "../src/dae/dae-lower.js";
import { parseKiCadSchematic } from "../src/parser/kicad-parser.js";

const RC_LOWPASS_SCHEMATIC = `(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (lib_symbols
    (symbol "Simulation_SPICE:VDC"
      (symbol "VDC_1_1"
        (pin passive line (at 0 5.08 270) (length 2.54) (name "+") (number "1"))
        (pin passive line (at 0 -5.08 90) (length 2.54) (name "-") (number "2"))
      )
    )
    (symbol "Device:R"
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
    (symbol "Device:C"
      (symbol "C_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
    (symbol "power:GND"
      (power)
      (symbol "GND_0_1"
        (pin power_in line (at 0 0 90) (length 0) (name "GND") (number "1"))
      )
    )
  )
  (symbol (lib_id "Simulation_SPICE:VDC") (at 50 50 0)
    (property "Reference" "V1")
    (property "Value" "5V")
  )
  (symbol (lib_id "Device:R") (at 70 44.92 90)
    (property "Reference" "R1")
    (property "Value" "1k")
  )
  (symbol (lib_id "Device:C") (at 85 50 0)
    (property "Reference" "C1")
    (property "Value" "100nF")
  )
  (symbol (lib_id "power:GND") (at 50 55.08 0)
    (property "Reference" "#PWR01")
    (property "Value" "GND")
  )
  (symbol (lib_id "power:GND") (at 85 53.81 0)
    (property "Reference" "#PWR02")
    (property "Value" "GND")
  )
  (wire (pts (xy 50 44.92) (xy 66.19 44.92)))
  (wire (pts (xy 73.81 44.92) (xy 85 44.92)))
  (wire (pts (xy 85 44.92) (xy 85 46.19)))
  (label "VIN" (at 50 44.92 0))
  (label "VOUT" (at 85 44.92 0))
)`;

describe("@modelscript/kicad — Direct DAEBuilder MNA Lowering", () => {
  it("parses KiCad engineering SI values accurately", () => {
    assert.strictEqual(parseEngineeringValue("10k"), 10_000);
    assert.strictEqual(parseEngineeringValue("4k7"), 4700);
    assert(Math.abs((parseEngineeringValue("100nF") ?? 0) - 1e-7) < 1e-15);
    assert(Math.abs((parseEngineeringValue("4.7uH") ?? 0) - 4.7e-6) < 1e-15);
    assert.strictEqual(parseEngineeringValue("5V"), 5);
    assert.strictEqual(parseEngineeringValue("1Meg"), 1_000_000);
  });

  it("lowers a KiCad 8 RC low-pass filter schematic into a balanced linear-memory DAEBuilder arena", () => {
    const sch = parseKiCadSchematic(RC_LOWPASS_SCHEMATIC);
    const dae = lowerKiCadSchematicToDAE(sch);

    assert.strictEqual(dae.diagnostics.length, 0);
    assert.strictEqual(dae.groundNet, "GND");
    assert.strictEqual(dae.nodeCount, 3);
    assert.strictEqual(dae.loweredComponentCount, 3);

    // Variables:
    //   3 node voltages (v_VIN, v_VOUT, v_GND)
    //   3 branch currents (i_V1, i_R1, i_C1)
    //   1 capacitor state voltage (v_C_C1)
    //   3 parameters (V_V1, R_R1, C_C1)
    // Total = 10 variables (7 unknowns + 3 parameters)
    assert.strictEqual(dae.arena.varCount, 10);

    // Equations:
    //   1 ground reference (v_GND = 0)
    //   1 V1 source (v_VIN - v_GND = V_V1)
    //   1 R1 Ohm's law (v_VIN - v_VOUT = R_R1 * i_R1)
    //   2 C1 constitutive (v_C_C1 = v_VOUT - v_GND; i_C1 = C_C1 * der(v_C_C1))
    //   2 KCL (VIN, VOUT)
    // Total = 7 equations matching 7 continuous unknowns!
    assert.strictEqual(dae.arena.eqCount, 7);
  });
});

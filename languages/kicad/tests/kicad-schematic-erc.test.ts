// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintKiCadSchematic } from "../src/lints/index.js";
import { parseKiCadSchematic } from "../src/parser/kicad-parser.js";
import { extractSchematicNetlist } from "../src/schematic-netlist.js";

const RC_FILTER_SCHEMATIC = `(kicad_sch
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

describe("@modelscript/kicad — Schematic Netlist Extraction & ERC Lints", () => {
  it("extracts geometric wire, label, and power-symbol connectivity from .kicad_sch", () => {
    const sch = parseKiCadSchematic(RC_FILTER_SCHEMATIC);
    assert.strictEqual(sch.diagnostics.length, 0);
    assert.strictEqual(Object.keys(sch.libSymbols).length, 4);

    const res = extractSchematicNetlist(sch);
    assert.strictEqual(res.netlist.components.length, 3);
    assert.strictEqual(res.netlist.nets.length, 3);

    assert.strictEqual(res.pinNetMap.get("V1.1"), "VIN");
    assert.strictEqual(res.pinNetMap.get("R1.1"), "VIN");
    assert.strictEqual(res.pinNetMap.get("R1.2"), "VOUT");
    assert.strictEqual(res.pinNetMap.get("C1.1"), "VOUT");
    assert.strictEqual(res.pinNetMap.get("V1.2"), "GND");
    assert.strictEqual(res.pinNetMap.get("C1.2"), "GND");

    const erc = lintKiCadSchematic(sch);
    assert.strictEqual(erc.length, 0, `Unexpected ERC diagnostics: ${JSON.stringify(erc)}`);
  });

  it("detects ERC output conflicts (K3001), unconnected pins (K3002), undriven power_in (K3003), duplicate refdes (K2002), and missing lib_id (K2003)", () => {
    const badSch = parseKiCadSchematic(`(kicad_sch
      (version 20231120)
      (lib_symbols
        (symbol "Logic:Buf"
          (symbol "Buf_1_1"
            (pin power_in line (at 0 5 270) (length 1) (name "VDD") (number "1"))
            (pin output line (at 5 0 180) (length 1) (name "Y") (number "2"))
            (pin input line (at -5 0 0) (length 1) (name "A") (number "3"))
          )
        )
      )
      (symbol (lib_id "Logic:Buf") (at 20 20 0) (property "Reference" "U1") (property "Value" "74HC04"))
      (symbol (lib_id "Logic:Buf") (at 40 20 0) (property "Reference" "U1") (property "Value" "74HC04"))
      (symbol (lib_id "Missing:Part") (at 60 20 0) (property "Reference" "U2") (property "Value" ""))
      (wire (pts (xy 25 20) (xy 45 20)))
    )`);

    const erc = lintKiCadSchematic(badSch);
    const codes = new Set(erc.map((d) => d.code));
    assert(codes.has("K2002"), "Expected K2002 duplicate refdes");
    assert(codes.has("K2003"), "Expected K2003 unresolved lib_id");
    assert(codes.has("K3001"), "Expected K3001 output-to-output conflict");
    assert(codes.has("K3002"), "Expected K3002 unconnected pin");
    assert(codes.has("K3003"), "Expected K3003 undriven power_in pin");
    assert(codes.has("K4003"), "Expected K4003 missing Value");
  });
});

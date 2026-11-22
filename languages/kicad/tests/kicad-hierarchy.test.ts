// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { extractHierarchicalNetlist } from "../src/hierarchy.js";
import { parseKiCadSchematic } from "../src/parser/kicad-parser.js";

const ROOT_SCH = `(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Device:R"
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
    (symbol "power:GND" (power) (symbol "GND_0_1" (pin power_in line (at 0 0 90) (length 0) (name "GND") (number "1"))))
  )
  (symbol (lib_id "Device:R") (at 20 20 0) (property "Reference" "R1") (property "Value" "1k"))
  (symbol (lib_id "power:GND") (at 20 23.81 0) (property "Reference" "#PWR1") (property "Value" "GND"))
  (wire (pts (xy 20 16.19) (xy 40 16.19)))
  (label "SIG_IN" (at 20 16.19 0))
  (sheet (at 40 10) (size 20 20)
    (property "Sheetname" "FilterStage")
    (property "Sheetfile" "filter.kicad_sch")
    (pin "IN" input (at 40 16.19 180))
  )
)`;

const CHILD_SCH = `(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Device:C"
      (symbol "C_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
    (symbol "power:GND" (power) (symbol "GND_0_1" (pin power_in line (at 0 0 90) (length 0) (name "GND") (number "1"))))
  )
  (symbol (lib_id "Device:C") (at 30 30 0) (property "Reference" "C1") (property "Value" "100nF"))
  (symbol (lib_id "power:GND") (at 30 33.81 0) (property "Reference" "#PWR2") (property "Value" "GND"))
  (hierarchical_label "IN" (at 30 26.19 0))
)`;

describe("@modelscript/kicad — Multi-Sheet Hierarchical Schematic Resolution", () => {
  it("merges parent sheet pins with child hierarchical_labels and shared power nets", () => {
    const rootSch = parseKiCadSchematic(ROOT_SCH);
    const childSch = parseKiCadSchematic(CHILD_SCH);
    const netlist = extractHierarchicalNetlist(ROOT_SCH, rootSch, { "filter.kicad_sch": childSch });

    assert.strictEqual(netlist.components.length, 2);
    const sigNet = netlist.nets.find((n) => n.id === "SIG_IN")!;
    assert(sigNet, "Expected SIG_IN net");
    assert(sigNet.pins.some((p) => p.name === "R1.1"));
    assert(sigNet.pins.some((p) => p.name === "FilterStage/C1.1"));

    const gndNet = netlist.nets.find((n) => n.id === "GND")!;
    assert(gndNet, "Expected unified GND net across parent and child sheets");
    assert.strictEqual(gndNet.pins.length, 2);
  });
});

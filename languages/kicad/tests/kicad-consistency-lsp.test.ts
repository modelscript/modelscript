// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { verifySchematicPcbConsistency } from "../src/consistency.js";
import { findCrossFileDefinition, resolveKiCadHover } from "../src/lsp.js";
import { parseKiCadBoard, parseKiCadSchematic } from "../src/parser/kicad-parser.js";

const PAIRED_SCH = `(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Device:R"
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
      )
    )
  )
  (symbol (lib_id "Device:R") (at 50 50 0)
    (property "Reference" "R1")
    (property "Value" "10k")
    (property "Footprint" "Resistor_SMD:R_0603")
  )
  (symbol (lib_id "Device:R") (at 70 50 0)
    (property "Reference" "R2")
    (property "Value" "4.7k")
    (property "Footprint" "Resistor_SMD:R_0603")
  )
  (label "VCC" (at 50 46.19 0))
  (label "GND" (at 50 53.81 0))
)`;

const MISMATCHED_PCB = `(kicad_pcb
  (version 20240108)
  (net 0 "")
  (net 1 "VCC")
  (net 2 "GND")
  (footprint "Resistor_SMD:R_0805"
    (layer "F.Cu")
    (at 20 20)
    (property "Reference" "R1")
    (property "Value" "22k")
    (pad "1" smd rect (at -0.8 0) (size 0.9 0.9) (layers "F.Cu") (net 2 "GND"))
    (pad "2" smd rect (at 0.8 0) (size 0.9 0.9) (layers "F.Cu") (net 2 "GND"))
  )
  (footprint "Capacitor_SMD:C_0603"
    (layer "F.Cu")
    (at 40 20)
    (property "Reference" "C99")
    (property "Value" "100nF")
  )
  (segment (start 19.2 20) (end 30 20) (width 0.35) (layer "F.Cu") (net 2))
)`;

describe("@modelscript/kicad — Schematic ↔ PCB Consistency & Cross-File LSP", () => {
  it("detects missing PCB components (K2010), orphan footprints (K2011), value/footprint drift (K2012/K2013), and net mismatch (K2014)", () => {
    const sch = parseKiCadSchematic(PAIRED_SCH);
    const board = parseKiCadBoard(MISMATCHED_PCB);

    const diags = verifySchematicPcbConsistency(sch, board);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has("K2010"), "Expected K2010 for R2 missing from PCB");
    assert(codes.has("K2011"), "Expected K2011 for orphan footprint C99");
    assert(codes.has("K2012"), "Expected K2012 for R1 value drift (10k vs 22k)");
    assert(codes.has("K2013"), "Expected K2013 for R1 footprint drift (0603 vs 0805)");
    assert(codes.has("K2014"), "Expected K2014 for R1.1 net mismatch (VCC vs GND)");
  });

  it("provides cross-file go-to-definition and parasitic-enriched LSP hover", () => {
    const sch = parseKiCadSchematic(PAIRED_SCH);
    const board = parseKiCadBoard(MISMATCHED_PCB);

    // Go-to-definition: schematic R1 -> PCB R1 footprint, and back
    const toPcb = findCrossFileDefinition("R1", "kicad_sch", sch, board);
    assert(toPcb !== null && toPcb.kind === "kicad_pcb");
    const toSch = findCrossFileDefinition("R1", "kicad_pcb", sch, board);
    assert(toSch !== null && toSch.kind === "kicad_sch");

    // Hover on footprint R1 inside PCB
    const fpHover = resolveKiCadHover(board, toPcb.span.startOffset + 5);
    assert(fpHover !== null);
    assert(fpHover.markdown.includes("Footprint `R1`"));
    assert(fpHover.markdown.includes("22k"));

    // Hover on net GND inside PCB includes RLGC parasitics
    const gndNet = board.nets.find((n) => n.name === "GND")!;
    const netHover = resolveKiCadHover(board, gndNet.span!.startOffset + 2);
    assert(netHover !== null);
    assert(netHover.markdown.includes("Net `GND`"));
    assert(netHover.markdown.includes("Parasitics:"));
    assert(netHover.markdown.includes("IPC-2221 Ampacity"));
  });
});

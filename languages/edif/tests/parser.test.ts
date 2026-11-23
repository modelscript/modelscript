// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEdif, parseEdifNumericValue, tokenizeEdif } from "../src/index.js";

const SAMPLE_EDIF = `(edif rc_divider
  (edifVersion 2 0 0)
  (edifLevel 0)
  (keywordMap (keywordLevel 0))
  (status
    (written
      (timeStamp 2026 11 22 12 0 0)
      (author "ModelScript")
      (program "msx" (version "0.1.0"))
      (comment "Sample EDIF 2.0.0 netlist")))
  (external PRIMITIVES
    (edifLevel 0)
    (technology (numberDefinition))
    (cell RES
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port P (direction INOUT))
          (port N (direction INOUT)))))
    (cell CAP
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port P (direction INOUT))
          (port N (direction INOUT))))))
  (library WORK
    (edifLevel 0)
    (technology (numberDefinition))
    (cell (rename TopDiv "Top-Divider")
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port VIN (direction INPUT))
          (port VOUT (direction OUTPUT))
          (port GND (direction INOUT)))
        (contents
          (instance R1
            (viewRef netlist (cellRef RES (libraryRef PRIMITIVES)))
            (property R (number (e 10 3)))
            (designator "R1"))
          (instance C1
            (viewRef netlist (cellRef CAP (libraryRef PRIMITIVES)))
            (property C (string "100nF")))
          (net N_IN (joined (portRef VIN) (portRef P (instanceRef R1))))
          (net N_OUT (joined (portRef VOUT) (portRef N (instanceRef R1)) (portRef P (instanceRef C1))))
          (net N_GND (joined (portRef GND) (portRef N (instanceRef C1))))))))
  (design TopDesign (cellRef TopDiv (libraryRef WORK))))`;

describe("@modelscript/edif Parser Suite", () => {
  it("tokenizes S-expressions, strings, numbers, and identifiers with spans", () => {
    const { tokens, errors } = tokenizeEdif(`(edif test (edifVersion 2 0 0) (comment "hi"))`);
    assert.strictEqual(errors.length, 0);
    assert.ok(tokens.length > 10);
    assert.strictEqual(tokens[0]!.kind, "lparen");
    assert.strictEqual(tokens[1]!.value, "edif");
    assert.strictEqual(tokens[1]!.span.line, 1);
  });

  it("parses complete EDIF 2.0.0 document including rename, properties, external, library, and design", () => {
    const doc = parseEdif(SAMPLE_EDIF);
    assert.strictEqual(doc.syntaxErrors.length, 0);
    assert.strictEqual(doc.name, "rc_divider");
    assert.deepStrictEqual(doc.edifVersion, [2, 0, 0]);
    assert.strictEqual(doc.edifLevel, 0);
    assert.strictEqual(doc.keywordLevel, 0);
    assert.strictEqual(doc.status?.written?.author, "ModelScript");
    assert.strictEqual(doc.status?.written?.program, "msx");
    assert.strictEqual(doc.status?.written?.programVersion, "0.1.0");

    assert.strictEqual(doc.externals.length, 1);
    assert.strictEqual(doc.externals[0]!.isExternal, true);
    assert.strictEqual(doc.externals[0]!.cells.length, 2);

    assert.strictEqual(doc.libraries.length, 1);
    const topCell = doc.libraries[0]!.cells[0]!;
    assert.strictEqual(topCell.name, "TopDiv");
    assert.strictEqual(topCell.originalName, "Top-Divider");
    assert.strictEqual(topCell.views[0]!.ports.length, 3);
    assert.strictEqual(topCell.views[0]!.instances.length, 2);
    assert.strictEqual(topCell.views[0]!.nets.length, 3);

    const r1 = topCell.views[0]!.instances[0]!;
    assert.strictEqual(r1.designator, "R1");
    assert.strictEqual(parseEdifNumericValue(r1.properties[0]!.value), 10000);

    const c1 = topCell.views[0]!.instances[1]!;
    const cVal = parseEdifNumericValue(c1.properties[0]!.value);
    assert.ok(cVal !== undefined && Math.abs(cVal - 1e-7) < 1e-12);

    assert.strictEqual(doc.design?.name, "TopDesign");
    assert.strictEqual(doc.design?.cellName, "TopDiv");
    assert.strictEqual(doc.design?.libraryName, "WORK");
  });

  it("records syntax errors for unbalanced parentheses and unterminated strings", () => {
    const bad1 = parseEdif(`(edif broken (edifVersion 2 0 0)`);
    assert.ok(bad1.syntaxErrors.length >= 1);

    const bad2 = parseEdif(`(edif broken (comment "unterminated))`);
    assert.ok(bad2.syntaxErrors.length >= 1);

    const bad3 = parseEdif(`(notEdif foo)`);
    assert.ok(bad3.syntaxErrors.length >= 1);
  });
});

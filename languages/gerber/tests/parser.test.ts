// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeGerberCoordinate, parseGerber } from "../src/parser/index.js";

describe("@modelscript/gerber — RS-274-D & RS-274X Parser", () => {
  it("decodes leading-zero and trailing-zero omitted coordinates accurately", () => {
    // Leading zero omission (L), X24: "12500" -> 1.2500
    assert.ok(Math.abs(decodeGerberCoordinate("12500", 2, 4, "L") - 1.25) < 1e-12);
    assert.ok(Math.abs(decodeGerberCoordinate("-5000", 2, 4, "L") - -0.5) < 1e-12);
    assert.ok(Math.abs(decodeGerberCoordinate("0", 2, 4, "L") - 0) < 1e-12);

    // Trailing zero omission (T), X24 (total 6 digits): "125" -> "125000" -> 12.5000
    assert.ok(Math.abs(decodeGerberCoordinate("125", 2, 4, "T") - 12.5) < 1e-12);
    assert.ok(Math.abs(decodeGerberCoordinate("-05", 2, 4, "T") - -5.0) < 1e-12);
  });

  it("parses complete RS-274X header, apertures, macros, attributes, and commands", () => {
    const src = [
      "G04 Top Copper Layer*",
      "%TF.FileFunction,Copper,L1,Top*%",
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%AMTHERM*7,0,0,2.0,1.2,0.3,45*%",
      "%ADD10C,0.254*%",
      "%ADD11C,1.500X0.800*%",
      "%ADD12R,2.000X1.000*%",
      "%ADD13O,2.400X1.200X0.600*%",
      "%ADD14P,1.800X6X30X0.500*%",
      "%ADD15THERM*%",
      "%TA.AperFunction,Conductor*%",
      "%LPD*%",
      "G75*",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X100000Y0D01*",
      "G03X100000Y100000I0J50000D01*",
      "D11*",
      "X0Y0D03*",
      "G36*",
      "G01*",
      "X20000Y20000D02*",
      "X40000Y20000D01*",
      "X40000Y40000D01*",
      "X20000Y40000D01*",
      "X20000Y20000D01*",
      "G37*",
      "M02*",
    ].join("\n");

    const doc = parseGerber(src, "top.gtl");
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.unit, "MM");
    assert.equal(doc.hasExplicitUnit, true);
    assert.equal(doc.hasEof, true);
    assert.ok(doc.formatSpec);
    assert.equal(doc.formatSpec.zeroOmission, "L");
    assert.equal(doc.formatSpec.coordNotation, "A");
    assert.equal(doc.formatSpec.xInteger, 3);
    assert.equal(doc.formatSpec.xDecimal, 4);

    assert.equal(doc.comments.length, 1);
    assert.equal(doc.comments[0]?.text, "Top Copper Layer");
    assert.equal(doc.attributes.length, 2);
    assert.equal(doc.attributes[0]?.kind, "TF");
    assert.equal(doc.attributes[1]?.kind, "TA");

    assert.equal(doc.macros.size, 1);
    assert.equal(doc.macros.get("THERM")?.primitives.length, 1);
    assert.equal(doc.macros.get("THERM")?.primitives[0]?.code, 7);

    assert.equal(doc.apertures.size, 6);
    assert.equal(doc.apertures.get(10)?.shape, "C");
    assert.equal(doc.apertures.get(10)?.width, 0.254);
    assert.equal(doc.apertures.get(11)?.holeDiameter, 0.8);
    assert.equal(doc.apertures.get(12)?.shape, "R");
    assert.equal(doc.apertures.get(12)?.width, 2.0);
    assert.equal(doc.apertures.get(12)?.height, 1.0);
    assert.equal(doc.apertures.get(13)?.shape, "O");
    assert.equal(doc.apertures.get(14)?.shape, "P");
    assert.equal(doc.apertures.get(14)?.vertices, 6);
    assert.equal(doc.apertures.get(14)?.rotationDeg, 30);
    assert.equal(doc.apertures.get(14)?.holeDiameter, 0.5);
    assert.equal(doc.apertures.get(15)?.shape, "MACRO");
    assert.equal(doc.apertures.get(15)?.macroName, "THERM");
  });

  it("parses legacy RS-274-D commands (G70/G71, G90/G91 incremental, G54D10, modal D-codes)", () => {
    const src = [
      "G04 Legacy RS-274-D 1970s photoplotter tape*",
      "G70*",
      "G91*",
      "%ADD10C,0.010*%",
      "G54D10*",
      "G01*",
      "X10000Y10000D02*",
      "X5000Y0D01*",
      "X0Y5000*",
      "M02*",
    ].join("\n");

    const doc = parseGerber(src, "legacy.pho");
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.unit, "IN");
    assert.equal(doc.hasLegacyUnitCommand, true);
    assert.equal(doc.hasIncrementalMode, true);
    assert.equal(doc.hasEof, true);

    const ops = doc.commands.filter((c) => c.kind === "OPERATION");
    assert.equal(ops.length, 3);
    // Move to (1.0, 1.0)
    assert.ok(Math.abs((ops[0]?.x ?? 0) - 1.0) < 1e-9);
    assert.ok(Math.abs((ops[0]?.y ?? 0) - 1.0) < 1e-9);
    // Incremental +0.5 in X -> (1.5, 1.0)
    assert.ok(Math.abs((ops[1]?.x ?? 0) - 1.5) < 1e-9);
    assert.ok(Math.abs((ops[1]?.y ?? 0) - 1.0) < 1e-9);
    // Modal D01, incremental +0.5 in Y -> (1.5, 1.5)
    assert.equal(ops[2]?.op, "DRAW");
    assert.ok(Math.abs((ops[2]?.x ?? 0) - 1.5) < 1e-9);
    assert.ok(Math.abs((ops[2]?.y ?? 0) - 1.5) < 1e-9);
  });

  it("parses %SR step-and-repeat and %LP polarity directives", () => {
    const src = [
      "%FSLAX24Y24*%",
      "%MOMM*%",
      "%ADD10C,0.500*%",
      "%SRX2Y3I5.0J4.0*%",
      "%LPD*%",
      "D10*",
      "X0Y0D03*",
      "%LPC*%",
      "X10000Y0D03*",
      "%SR*%",
      "M02*",
    ].join("\n");

    const doc = parseGerber(src, "panel.gbr");
    assert.equal(doc.parseErrors.length, 0);
    const ops = doc.commands.filter((c) => c.kind === "OPERATION");
    assert.equal(ops.length, 2);
    assert.equal(ops[0]?.stepRepeat.xRepeat, 2);
    assert.equal(ops[0]?.stepRepeat.yRepeat, 3);
    assert.equal(ops[0]?.polarity, "D");
    assert.equal(ops[1]?.polarity, "C");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJcampDx, parseJcampDxBlock, serializeJcampDx } from "../src/parser/index.js";

const SAMPLE_IR = `##TITLE=Acetone FTIR Spectrum
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##ORIGIN=ModelScript Cleanroom Lab
##OWNER=PUBLIC DOMAIN
##XUNITS=1/CM
##YUNITS=ABSORBANCE
##FIRSTX=1750
##LASTX=1700
##NPOINTS=6
##XFACTOR=1
##YFACTOR=0.01
$$ Carbonyl C=O stretch region
##XYDATA=(X++(Y..Y))
1750 10 25 85 110 40 12
##END=
`;

const SAMPLE_MS = `##TITLE=Methane EI-MS
##JCAMP-DX=5.00
##DATA TYPE=MASS SPECTRUM
##XUNITS=M/Z
##YUNITS=RELATIVE ABUNDANCE
##NPOINTS=4
##PEAK TABLE=(XY..XY)
12, 3.8; 14, 20.4; 15, 88.8; 16, 100.0
##END=
`;

describe("@modelscript/jcamp-dx Parser", () => {
  it("parses standard IR JCAMP-DX 4.24 LDRs, comments, and XYDATA", () => {
    const doc = parseJcampDx(SAMPLE_IR);
    assert.strictEqual(doc.blocks.length, 1);
    const block = doc.primary!;
    assert.strictEqual(block.title, "Acetone FTIR Spectrum");
    assert.strictEqual(block.jcampDxVersion, "4.24");
    assert.strictEqual(block.dataType, "INFRARED SPECTRUM");
    assert.strictEqual(block.origin, "ModelScript Cleanroom Lab");
    assert.strictEqual(block.owner, "PUBLIC DOMAIN");
    assert.strictEqual(block.xUnits, "1/CM");
    assert.strictEqual(block.yUnits, "ABSORBANCE");
    assert.strictEqual(block.firstX, 1750);
    assert.strictEqual(block.lastX, 1700);
    assert.strictEqual(block.nPoints, 6);
    assert.strictEqual(block.points.length, 6);
    assert.strictEqual(block.comments.length, 1);
    assert.strictEqual(block.hasEnd, true);
    assert.strictEqual(block.points[0]!.x, 1750);
    assert.ok(Math.abs(block.points[3]!.y - 1.1) < 1e-12);
    assert.strictEqual(block.points[5]!.x, 1700);
  });

  it("parses Mass Spectrum PEAK TABLE=(XY..XY)", () => {
    const block = parseJcampDxBlock(SAMPLE_MS);
    assert.strictEqual(block.dataType, "MASS SPECTRUM");
    assert.strictEqual(block.peakTable.length, 4);
    assert.deepStrictEqual(block.peakTable[3], { x: 16, y: 100 });
  });

  it("parses compound LINK blocks with nested child spectra", () => {
    const compound = `##TITLE=Compound Link Container
##JCAMP-DX=4.24
##DATA TYPE=LINK
##BLOCKS=2
##TITLE=Child Spectrum 1
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##XUNITS=1/CM
##YUNITS=ABSORBANCE
##FIRSTX=1720
##LASTX=1700
##NPOINTS=3
##XYDATA=(X++(Y..Y))
1720 10 50 10
##END=
##TITLE=Child Spectrum 2
##JCAMP-DX=5.00
##DATA TYPE=MASS SPECTRUM
##PEAK TABLE=(XY..XY)
15, 80; 16, 100
##END=
##END=
`;
    const doc = parseJcampDx(compound);
    assert.strictEqual(doc.blocks.length, 1);
    assert.strictEqual(doc.blocks[0]!.dataType, "LINK");
    assert.strictEqual(doc.blocks[0]!.children.length, 2);
    assert.strictEqual(doc.primary?.title, "Child Spectrum 1");
  });

  it("serializes and re-parses a spectrum block cleanly", () => {
    const block = parseJcampDxBlock(SAMPLE_IR);
    const serialized = serializeJcampDx(block, "DIFDUP");
    assert.ok(serialized.includes("##TITLE=Acetone FTIR Spectrum"));
    assert.ok(serialized.includes("##XYDATA=(X++(Y..Y))"));
    const reparsed = parseJcampDxBlock(serialized);
    assert.strictEqual(reparsed.points.length, block.points.length);
    for (let i = 0; i < block.points.length; i++) {
      assert.ok(Math.abs(reparsed.points[i]!.x - block.points[i]!.x) < 1e-9);
      assert.ok(Math.abs(reparsed.points[i]!.y - block.points[i]!.y) < 1e-9);
    }
  });
});

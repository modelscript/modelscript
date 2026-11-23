// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintJcampDx } from "../src/lints/index.js";

describe("@modelscript/jcamp-dx Lints (JDX1001–JDX5006)", () => {
  it("reports zero diagnostics for a valid JCAMP-DX 4.24 spectrum", () => {
    const valid = `##TITLE=Clean IR Spectrum
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##FIRSTX=1800
##LASTX=1700
##NPOINTS=3
##XFACTOR=1
##YFACTOR=0.01
##XYDATA=(X++(Y..Y))
1800 95 40 92
##END=
`;
    const diags = lintJcampDx(valid);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects missing mandatory LDRs (JDX2001–JDX2004)", () => {
    const missingAll = `##XUNITS=1/CM
##XYDATA=(X++(Y..Y))
1000 10 20
`;
    const diags = lintJcampDx(missingAll);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("JDX2001"), "Expected JDX2001 missing TITLE");
    assert.ok(codes.has("JDX2002"), "Expected JDX2002 missing JCAMP-DX");
    assert.ok(codes.has("JDX2003"), "Expected JDX2003 missing DATA TYPE");
    assert.ok(codes.has("JDX2004"), "Expected JDX2004 missing END");
  });

  it("detects NPOINTS mismatch (JDX3001), DIFDUP checkpoint error (JDX3002), and non-positive factors (JDX4001/JDX4002)", () => {
    const broken = `##TITLE=Broken Spectrum
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##FIRSTX=1000
##LASTX=1005
##NPOINTS=99
##XFACTOR=-1
##YFACTOR=0
##XYDATA=(X++(Y..Y))
1000 A00J0U
1003 A99NT
##END=
`;
    const diags = lintJcampDx(broken);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("JDX3001"), "Expected JDX3001 NPOINTS mismatch");
    assert.ok(codes.has("JDX3002"), "Expected JDX3002 DIFDUP checkpoint error");
    assert.ok(codes.has("JDX4001"), "Expected JDX4001 non-positive XFACTOR");
    assert.ok(codes.has("JDX4002"), "Expected JDX4002 non-positive YFACTOR");
  });

  it("detects FIRSTX/LASTX mismatch (JDX5001/JDX5002), invalid transmittance (JDX5003/JDX5004), and syntax errors (JDX1001)", () => {
    const badTrans = `##TITLE=Out of Range Transmittance
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##MALFORMED_LDR_NO_EQUALS
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##FIRSTX=2000
##LASTX=1500
##NPOINTS=3
##XFACTOR=1
##YFACTOR=1
##PEAK TABLE=(XY..XY)
1800, -0.15; 1750, 0.5; 1700, 1.35
##END=
`;
    const diags = lintJcampDx(badTrans);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("JDX1001"), "Expected JDX1001 syntax error");
    assert.ok(codes.has("JDX5001"), "Expected JDX5001 FIRSTX mismatch");
    assert.ok(codes.has("JDX5002"), "Expected JDX5002 LASTX mismatch");
    assert.ok(codes.has("JDX5003"), "Expected JDX5003 transmittance < 0");
    assert.ok(codes.has("JDX5004"), "Expected JDX5004 transmittance > 1.2");
  });
});

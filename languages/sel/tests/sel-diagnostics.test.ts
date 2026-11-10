// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSELSettings } from "../src/lints/index.js";
import { parseSELAscii } from "../src/parser/sel-parser.js";

describe("SEL Diagnostic Linter", () => {
  it("detects missing or unconfigured relay identifier (SEL1001)", () => {
    const text = `
RELAY="SEL-411L"
GROUP 1
50P1P=10.0
`;
    const settings = parseSELAscii(text);
    const diags = lintSELSettings(settings);
    const sel1001 = diags.find((d) => d.code === "SEL1001");
    assert.ok(sel1001, "Should flag missing RID");
  });

  it("detects inverted overcurrent pickups and distance reaches (SEL3001)", () => {
    const text = `
RELAY="SEL-411L"
RID="TEST_RELAY"
GROUP 1
50P1P=5.00
51P1P=10.00
Z1P=10.00
Z2P=5.00
`;
    const settings = parseSELAscii(text);
    const diags = lintSELSettings(settings);
    const sel3001List = diags.filter((d) => d.code === "SEL3001");
    assert.ok(sel3001List.length >= 2, "Should flag inverted 50P/51P and Z1P/Z2P");
  });

  it("detects undefined Relay Word bit references (SEL2001)", () => {
    const text = `
RELAY="SEL-411L"
RID="TEST_RELAY"
GROUP 1
TRIP=50P1P OR NON_EXISTENT_BIT_XYZ
`;
    const settings = parseSELAscii(text);
    const diags = lintSELSettings(settings);
    const sel2001 = diags.find((d) => d.code === "SEL2001");
    assert.ok(sel2001, "Should flag undefined word bit NON_EXISTENT_BIT_XYZ");
    assert.ok(sel2001.message.includes("NON_EXISTENT_BIT_XYZ"));
  });

  it("detects circular SELogic equation dependencies (SEL4001)", () => {
    const text = `
RELAY="SEL-411L"
RID="TEST_RELAY"
GROUP 1
SV01=SV02 AND IN101
SV02=SV01 OR 50P1P
`;
    const settings = parseSELAscii(text);
    const diags = lintSELSettings(settings);
    const sel4001 = diags.find((d) => d.code === "SEL4001");
    assert.ok(sel4001, "Should detect circular dependency between SV01 and SV02");
  });
});

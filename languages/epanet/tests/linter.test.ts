// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { EpanetErrorCode, lintEpanet } from "../src/lints/index.js";
import { parseInp } from "../src/parser/index.js";

describe("EPANET Pre-Flight Diagnostic Linters (M8101–M8108)", () => {
  it("M8106: detects duplicate node ID", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      J1  120  0
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.DUPLICATE_NODE_ID.code));
    assert(diags.some((d) => d.message.includes("'J1'") && d.message.endsWith(".")));
  });

  it("M8107: detects duplicate link ID", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      J2  100  0
      [PIPES]
      P1  J1  J2  100  200  100  0  OPEN
      P1  J1  J2  150  200  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.DUPLICATE_LINK_ID.code));
  });

  it("M8104: detects zero or negative pipe length", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      J2  100  0
      [PIPES]
      P1  J1  J2  0.0  200  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.ZERO_LENGTH_PIPE.code));
  });

  it("M8105: detects zero or negative pipe diameter", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      J2  100  0
      [PIPES]
      P1  J1  J2  100  0  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.ZERO_DIAMETER_PIPE.code));
  });

  it("M8108: detects link referencing non-existent node", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      [PIPES]
      P1  J1  GhostNode  100  200  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.UNREFERENCED_NODE_IN_LINK.code));
  });

  it("M8101: detects isolated hydraulic node", () => {
    const inp = `
      [JUNCTIONS]
      J1  100  0
      J2  100  0
      J3  100  0
      [PIPES]
      P1  J1  J2  100  200  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.ISOLATED_HYDRAULIC_NODE.code));
    assert(diags.some((d) => d.message.includes("'j3'")));
  });

  it("M8102: warns on junction elevation exceeding source head", () => {
    const inp = `
      [RESERVOIRS]
      R1  100
      [JUNCTIONS]
      J1  150  10
      [PIPES]
      P1  R1  J1  100  200  100  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.NEGATIVE_PRESSURE_RISK.code));
  });

  it("M8103: detects non-monotonic pump curve", () => {
    const inp = `
      [CURVES]
      PumpCurve1  10  50
      PumpCurve1  20  60
      PumpCurve1  30  40
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert(diags.some((d) => d.code === EpanetErrorCode.NON_MONOTONIC_PUMP_CURVE.code));
  });

  it("passes clean network deck with 0 diagnostics", () => {
    const inp = `
      [RESERVOIRS]
      R1  200
      [JUNCTIONS]
      J1  50  20
      J2  40  30
      [PIPES]
      P1  R1  J1  500  250  120  0  OPEN
      P2  J1  J2  300  200  120  0  OPEN
    `;
    const net = parseInp(inp);
    const diags = lintEpanet(net);

    assert.strictEqual(diags.length, 0);
  });
});

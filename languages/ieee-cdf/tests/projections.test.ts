// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BPA_3_BUS_IPF, IEEE_14_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { parseIeeeCdf } from "../src/parser/index.js";
import { ieeeCdfToMatpower, ieeeCdfToModelica, ieeeCdfToPsseRaw } from "../src/projections/index.js";

describe("@modelscript/ieee-cdf Polyglot Projections Suite", () => {
  it("projects IEEE 14-bus network to MATPOWER v2 .m case file", () => {
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);
    const matpower = ieeeCdfToMatpower(net, "case14_export");

    assert.ok(matpower.includes("function mpc = case14_export"));
    assert.ok(matpower.includes("mpc.version = '2';"));
    assert.ok(matpower.includes("mpc.baseMVA = 100.00;"));
    assert.ok(matpower.includes("mpc.bus = ["));
    assert.ok(matpower.includes("mpc.gen = ["));
    assert.ok(matpower.includes("mpc.branch = ["));
    // Bus 9 shunt B = 0.19 pu * 100 MVA = 19.0000 MVAR
    assert.ok(matpower.includes("19.0000"));
    // Tap transformer 4-7 with ratio 0.978000
    assert.ok(matpower.includes("0.978000"));
  });

  it("projects IEEE 14-bus network to PSS/E v33 .raw format", () => {
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);
    const raw = ieeeCdfToPsseRaw(net);

    assert.ok(raw.includes("0, 100.00, 33, 0, 1, 60.00"));
    assert.ok(raw.includes("0 / END OF BUS DATA, BEGIN LOAD DATA"));
    assert.ok(raw.includes("0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA"));
    assert.ok(raw.includes("0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA"));
    assert.ok(raw.includes("0 / END OF GENERATOR DATA, BEGIN BRANCH DATA"));
    assert.ok(raw.includes("0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA"));
    assert.ok(raw.includes("XFMR_4_7"));
    assert.ok(raw.trimEnd().endsWith("Q"));
  });

  it("projects BPA IPF 3-bus network to self-contained Modelica AC power-flow model", () => {
    const net = parseIeeeCdf(BPA_3_BUS_IPF);
    const mo = ieeeCdfToModelica(net, "BpaThreeBus");

    assert.ok(mo.includes("model BpaThreeBus"));
    assert.ok(mo.includes("parameter Real S_base = 100.00"));
    assert.ok(mo.includes("Real V_1("));
    assert.ok(mo.includes("Real theta_3("));
    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("cos(theta_"));
    assert.ok(mo.includes("end BpaThreeBus;"));
  });
});

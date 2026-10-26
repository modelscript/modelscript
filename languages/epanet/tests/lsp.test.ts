// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { executeEpanetAction, getEpanetDocumentSymbols, getEpanetHover, validateEpanet } from "../src/lsp.js";

const VALID_INP = `
[TITLE]
Clean Network Model

[RESERVOIRS]
 Res1  100.0

[JUNCTIONS]
 J1  50.0  10.0
 J2  45.0  15.0

[PIPES]
 P1  Res1  J1  800  200  100  0  OPEN
 P2  J1    J2  500  150  100  0  OPEN
`;

describe("EPANET LSP Language Services", () => {
  it("validates clean network with zero diagnostics", () => {
    const diags = validateEpanet(VALID_INP);
    assert.strictEqual(diags.length, 0);
  });

  it("extracts document symbols for junctions, reservoirs, and pipes", () => {
    const symbols = getEpanetDocumentSymbols(VALID_INP);
    assert(symbols.length >= 4);

    const jSym = symbols.find((s) => s.name.includes("J1"));
    assert(jSym !== undefined);

    const rSym = symbols.find((s) => s.name.includes("Res1"));
    assert(rSym !== undefined);

    const pSym = symbols.find((s) => s.name.includes("P1"));
    assert(pSym !== undefined);
  });

  it("provides hover details on junctions and pipes", () => {
    const jHover = getEpanetHover(VALID_INP, 85);
    assert(jHover !== null);
    assert(jHover.contents.value.includes("EPANET Junction"));

    const pHover = getEpanetHover(VALID_INP, 150);
    assert(pHover !== null);
    assert(pHover.contents.value.includes("EPANET Pipe"));
  });

  it("executes custom actions (toModelica, toDae, solve, summary)", () => {
    const summary = executeEpanetAction("epanet.summary", VALID_INP);
    assert.strictEqual(summary.junctions, 2);
    assert.strictEqual(summary.reservoirs, 1);
    assert.strictEqual(summary.pipes, 2);

    const moRes = executeEpanetAction("epanet.toModelica", VALID_INP);
    assert(moRes.modelica.includes("model Clean_Network_Model"));

    const daeRes = executeEpanetAction("epanet.toDae", VALID_INP);
    assert(daeRes.variables >= 4);
    assert(daeRes.equations >= 4);

    const solveRes = executeEpanetAction("epanet.solve", VALID_INP);
    assert.strictEqual(solveRes.converged, true);
    assert(solveRes.pressures["J1"] > 0);
  });
});

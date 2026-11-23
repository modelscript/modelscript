// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nec2ToModelica, nec2ToTouchstone, parseNec2Deck } from "../src/index.js";

describe("@modelscript/nec2 Projections (Touchstone .s1p & Modelica)", () => {
  const dipoleDeck = parseNec2Deck(`
CM Half-Wave Dipole Sweep
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 5 0 0 280.0 10.0
EX 0 1 11 0 1.0 0.0
EN
`);

  it("projects NEC-2 frequency sweep to valid Touchstone 1.1 .s1p in RI, MA, and DB formats", () => {
    const s1pRi = nec2ToTouchstone(dipoleDeck, { format: "RI", z0: 50 });
    assert.ok(s1pRi.includes("# MHZ S RI R 50"));
    const dataLines = s1pRi.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("!") && !l.startsWith("#"));
    assert.strictEqual(dataLines.length, 5, "Expected 5 frequency rows in .s1p");
    for (const row of dataLines) {
      const parts = row.trim().split(/\s+/).map(Number);
      assert.strictEqual(parts.length, 3);
      assert.ok(Math.hypot(parts[1]!, parts[2]!) <= 1.0 + 1e-6, "Passive antenna |S11| must be <= 1");
    }

    const s1pMa = nec2ToTouchstone(dipoleDeck, { format: "MA", z0: 75 });
    assert.ok(s1pMa.includes("# MHZ S MA R 75"));

    const s1pDb = nec2ToTouchstone(dipoleDeck, { format: "DB", z0: 50 });
    assert.ok(s1pDb.includes("# MHZ S DB R 50"));
  });

  it("projects NEC-2 antenna to a Modelica equivalent resonant RLC circuit model", () => {
    const mo = nec2ToModelica(dipoleDeck, { modelName: "HalfWaveDipole300MHz" });
    assert.ok(mo.includes("model HalfWaveDipole300MHz"));
    assert.ok(mo.includes("parameter Real R_rad ="));
    assert.ok(mo.includes("parameter Real L_ant ="));
    assert.ok(mo.includes("parameter Real C_ant ="));
    assert.ok(mo.includes("L_ant * der(i_ant) = v_feed - (R_rad + R_loss) * i_ant - v_cap;"));
    assert.ok(mo.includes("C_ant * der(v_cap) = i_ant;"));
    assert.ok(mo.includes("p_rad = R_rad * i_ant * i_ant;"));
    assert.ok(mo.includes("end HalfWaveDipole300MHz;"));
  });
});

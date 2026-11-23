// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrasysDeck } from "../src/parser/index.js";
import { trasysToModelica, trasysToSinda } from "../src/projections/index.js";

const SAMPLE_DECK = `
HEADER OPTIONS DATA
  MODEL = ThermalCubeSat
HEADER SURFACE DATA
  S PANEL_N RECTANGLE W=0.3 H=0.3 NODE=101 PROP=SOLAR_CELL ACTIVE=TOP TZ=0.0
  S PANEL_S RECTANGLE W=0.3 H=0.3 NODE=102 PROP=WHITE_PAINT_Z93 ACTIVE=BOTTOM TZ=0.3
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = 500
  BETA = 30
  SOLAR = 1361
  ALBEDO = 0.30
  PLANETIR = 237
HEADER OPERATIONS DATA
  FFCAL
  RKCAL
  QCAL
END OF DATA
`;

describe("TRASYS Projections (SINDA & Modelica)", () => {
  it("projects a TRASYS model into a valid SINDA/FLUINT conductor deck", () => {
    const deck = parseTrasysDeck(SAMPLE_DECK);
    const sinda = trasysToSinda(deck);

    assert.ok(sinda.includes("HEADER NODE DATA"));
    assert.ok(sinda.includes("HEADER CONDUCTOR DATA"));
    assert.ok(sinda.includes("HEADER SOURCE DATA"));
    assert.ok(sinda.includes("END OF DATA"));
    // Thermal nodes & deep space boundary node 99999
    assert.ok(sinda.includes("101,"));
    assert.ok(sinda.includes("102,"));
    assert.ok(sinda.includes("-99999,"));
    // Negative RADK radiation conductors
    assert.ok(sinda.includes("RADK PANEL_N <-> PANEL_S"));
    assert.ok(sinda.includes("RADK PANEL_N -> SPACE"));
  });

  it("projects a TRASYS model into a valid Modelica radiative heat balance model", () => {
    const deck = parseTrasysDeck(SAMPLE_DECK);
    const mo = trasysToModelica(deck);

    assert.ok(mo.includes("model ThermalCubeSat"));
    assert.ok(mo.includes("parameter Real sigma_SB"));
    assert.ok(mo.includes("Real T_PANEL_N("));
    assert.ok(mo.includes("Real T_PANEL_S("));
    assert.ok(mo.includes("G_rad_PANEL_N_PANEL_S"));
    assert.ok(mo.includes("T_PANEL_N^4 - T_space^4"));
    assert.ok(mo.includes("end ThermalCubeSat;"));
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrasysDeck } from "../src/parser/index.js";

const FULL_DECK = `
C Classic NASA TRASYS Thermal Radiation Deck
HEADER OPTIONS DATA
  TITLE = Spacecraft Radiator Panel Test
  MODEL = LEO_TEST_SAT
  UNITS = SI
  RAYS = 5000 $ Monte Carlo ray count

HEADER SURFACE DATA
C Primary radiator rectangle with White Paint Z-93
  S RAD1 RECTANGLE W=2.0 H=1.5 NODE=101 PROP=WHITE_PAINT_Z93 ACTIVE=TOP SHADE=YES
    TX=0.0 TY=0.0 TZ=0.5 ROTX=0 ROTY=0 ROTZ=90
C Circular baffle disk
  S BAF1 DISK R=0.8 NODE=102 PROP=0.96, 0.90 ACTIVE=BOTH SHADE=YES TZ=1.5
C Cylindrical bus
  BUS1 CYLINDER R=0.6 L=1.8 NODE=103 PROP=SILVER_TEFLON ACTIVE=TOP SHADE=YES
C Conical adapter
  ADAPT1 CONE R1=0.6 R2=0.3 L=0.5 NODE=104 PROP=0.25, 0.03 ACTIVE=TOP
C Spherical sensor head
  SPH1 SPHERE R=0.25 NODE=105 PROP=BLACK_PAINT ACTIVE=TOP TZ=2.2
C Paraboloid high-gain antenna
  HGA1 PARABOLOID R=1.2 F=0.6 NODE=106 PROP=0.20, 0.80 ACTIVE=TOP TX=2.0
C Triangular solar baffle polygon
  POLY1 POLYGON (0, 0, 0) (1, 0, 0) (0.5, 1, 0) NODE=107 PROP=GOLD_KAPTON ACTIVE=TOP

HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = 400.0 $ ISS-like LEO altitude (km)
  BETA = 23.5
  SOLAR = 1361.0
  ALBEDO = 0.30
  PLANETIR = 237.0

HEADER OPERATIONS DATA
  FFCAL
  CALL RKCAL(EPS=0.001)
  QCAL

END OF DATA
`;

describe("TRASYS Deck Parser", () => {
  it("parses all HEADER sections, 7 surface primitives, transforms, orbit, operations, and END OF DATA", () => {
    const deck = parseTrasysDeck(FULL_DECK);

    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.hasEndOfData, true);
    assert.strictEqual(deck.name, "LEO_TEST_SAT");
    assert.strictEqual(deck.options.units, "SI");
    assert.strictEqual(deck.options.rays, 5000);
    assert.strictEqual(deck.surfaces.length, 7);

    // Check RECTANGLE + coating lookup + transforms
    const rad = deck.surfaces[0]!;
    assert.strictEqual(rad.id, "RAD1");
    assert.strictEqual(rad.kind, "RECTANGLE");
    assert.strictEqual(rad.nodeId, 101);
    assert.strictEqual(rad.dims["width"], 2.0);
    assert.strictEqual(rad.dims["height"], 1.5);
    assert.strictEqual(rad.prop.name, "WHITE_PAINT_Z93");
    assert.strictEqual(rad.prop.alpha, 0.17);
    assert.strictEqual(rad.prop.epsilon, 0.92);
    assert.strictEqual(rad.transform.tz, 0.5);
    assert.strictEqual(rad.transform.rotz, 90);
    assert.strictEqual(rad.active, "TOP");
    assert.strictEqual(rad.shade, true);

    // Check DISK with numeric PROP pair
    const baf = deck.surfaces[1]!;
    assert.strictEqual(baf.id, "BAF1");
    assert.strictEqual(baf.kind, "DISK");
    assert.strictEqual(baf.dims["radius"], 0.8);
    assert.strictEqual(baf.prop.alpha, 0.96);
    assert.strictEqual(baf.prop.epsilon, 0.9);
    assert.strictEqual(baf.active, "BOTH");

    // Check CYLINDER, CONE, SPHERE, PARABOLOID, POLYGON
    assert.strictEqual(deck.surfaces[2]!.kind, "CYLINDER");
    assert.strictEqual(deck.surfaces[3]!.kind, "CONE");
    assert.strictEqual(deck.surfaces[4]!.kind, "SPHERE");
    assert.strictEqual(deck.surfaces[5]!.kind, "PARABOLOID");
    assert.strictEqual(deck.surfaces[6]!.kind, "POLYGON");
    assert.strictEqual(deck.surfaces[6]!.vertices?.length, 3);

    // Check Orbit
    assert.ok(deck.orbit);
    assert.strictEqual(deck.orbit.planet, "EARTH");
    assert.strictEqual(deck.orbit.altitudeKm, 400.0);
    assert.strictEqual(deck.orbit.betaDeg, 23.5);
    assert.strictEqual(deck.orbit.solarFlux, 1361.0);
    assert.strictEqual(deck.orbit.albedo, 0.3);
    assert.strictEqual(deck.orbit.planetIr, 237.0);

    // Check Operations
    assert.deepStrictEqual(
      deck.operations.map((o) => o.kind),
      ["FFCAL", "RKCAL", "QCAL"],
    );
  });

  it("ignores column-1 C comments and inline $ comments", () => {
    const deck = parseTrasysDeck(`
C Full line Fortran comment
c Lowercase comment
HEADER SURFACE DATA $ inline comment
  S P1 SPHERE R=1.0 NODE=1 PROP=0.5, 0.5 $ another comment
END OF DATA
`);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.surfaces.length, 1);
    assert.strictEqual(deck.surfaces[0]!.id, "P1");
    assert.strictEqual(deck.hasEndOfData, true);
  });

  it("records syntax errors for statements outside HEADER blocks", () => {
    const deck = parseTrasysDeck(`
INVALID STATEMENT HERE
END OF DATA
`);
    assert.ok(deck.parseErrors.length > 0);
  });
});

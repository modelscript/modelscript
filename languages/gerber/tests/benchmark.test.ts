// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Analytical Benchmark Suite for `@modelscript/gerber`:
 * 1. 2-Layer PCB (Top Copper + Bottom Ground Plane) trace, pad, arc, and region copper area
 *    and trace-length analytical parity.
 * 2. Inch (`%MOIN*%`) vs Millimeter (`%MOMM*%`) coordinate conversion exact parity (25.4 mm/in).
 * 3. IPC-2221 copper trace DC resistance (20 C and 65 C) & parallel-plate capacitance parity
 *    with explicit `relErr` / `tolerance` assertions.
 */

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MM_PER_INCH, lowerGerberToGeometry } from "../src/cad/index.js";
import {
  COPPER_RESISTIVITY_20C_OHM_M,
  COPPER_TEMP_COEFF_PER_K,
  EPSILON_0_F_PER_M,
  lowerGerberToDae,
} from "../src/dae/index.js";
import { parseGerber } from "../src/parser/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

describe("@modelscript/gerber — Analytical Benchmarks (2-Layer PCB, Unit Parity, IPC-2221 Resistance)", () => {
  it("verifies 2-layer PCB trace/pad/arc/region copper area & trace-length analytical parity", () => {
    // Layer 1: Top Signal Layer (traces + 90 deg arc + circular/rect/obround/polygon pads + copper pour)
    const topCopperGerber = [
      "G04 Benchmark 2-Layer PCB - L1 Top Copper*",
      "%TF.FileFunction,Copper,L1,Top*%",
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.254*%", // 10 mil trace
      "%ADD11C,1.200X0.600*%", // Through-hole via pad (0.3 mm annular ring)
      "%ADD12R,2.000X1.200*%", // SMD rectangular pad
      "%ADD13O,2.400X1.000*%", // Obround pad
      "%ADD14P,1.600X6X0*%", // Hexagonal pad
      "%LPD*%",
      "G75*",
      "G01*",
      "D10*",
      // Horizontal trace: (0,0) -> (20,0), L = 20 mm
      "X0Y0D02*",
      "X200000Y0D01*",
      // 90 deg CCW arc: (20,0) -> (25,5), center (20,5), R = 5 mm, L = 2.5*pi mm
      "G03X250000Y50000I0J50000D01*",
      // Vertical trace: (25,5) -> (25,20), L = 15 mm
      "G01X250000Y200000D01*",
      // Flashed pads
      "D11*",
      "X0Y0D03*",
      "X250000Y200000D03*",
      "D12*",
      "X50000Y100000D03*",
      "D13*",
      "X100000Y100000D03*",
      "D14*",
      "X150000Y100000D03*",
      // Copper pour region: 10 mm x 5 mm rectangle = 50 mm^2
      "G36*",
      "G01*",
      "X0Y250000D02*",
      "X100000Y250000D01*",
      "X100000Y300000D01*",
      "X0Y300000D01*",
      "X0Y250000D01*",
      "G37*",
      "M02*",
    ].join("\n");

    // Layer 2: Bottom Ground Plane with clear-polarity thermal cutout
    const bottomGroundGerber = [
      "G04 Benchmark 2-Layer PCB - L2 Bottom Ground Plane*",
      "%TF.FileFunction,Copper,L2,Bot*%",
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,2.000*%", // 2 mm clear anti-pad cutout
      "%LPD*%",
      // 30 mm x 30 mm ground plane = 900 mm^2
      "G36*",
      "G01*",
      "X0Y0D02*",
      "X300000Y0D01*",
      "X300000Y300000D01*",
      "X0Y300000D01*",
      "X0Y0D01*",
      "G37*",
      // Clear polarity anti-pad: -pi * 1^2 mm^2
      "%LPC*%",
      "D10*",
      "X150000Y150000D03*",
      "M02*",
    ].join("\n");

    const topGeom = lowerGerberToGeometry(parseGerber(topCopperGerber, "L1_top.gtl"));
    const botGeom = lowerGerberToGeometry(parseGerber(bottomGroundGerber, "L2_bot.gbl"));

    const tolerance = 1e-6;

    // Analytical Layer 1 trace length: 20 + 2.5*pi + 15
    const expectedTopTraceLen = 20.0 + 2.5 * Math.PI + 15.0;
    assert.ok(
      relErr(topGeom.traceLengthMm, expectedTopTraceLen) < tolerance,
      `Top trace length relErr ${relErr(topGeom.traceLengthMm, expectedTopTraceLen)} >= ${tolerance}`,
    );

    // Analytical Layer 1 copper area
    const w = 0.254;
    const capArea = Math.PI * (0.5 * w) * (0.5 * w);
    const traceArea = 20.0 * w + capArea + (2.5 * Math.PI * w + capArea) + (15.0 * w + capArea);
    const viaPadsArea = 2 * Math.PI * (0.6 * 0.6 - 0.3 * 0.3);
    const rectPadArea = 2.0 * 1.2;
    const obroundPadArea = (2.4 - 1.0) * 1.0 + Math.PI * 0.5 * 0.5;
    const hexPadArea = 0.5 * 6 * 0.8 * 0.8 * Math.sin((2 * Math.PI) / 6);
    const topPourArea = 10.0 * 5.0;
    const expectedTopArea = traceArea + viaPadsArea + rectPadArea + obroundPadArea + hexPadArea + topPourArea;

    assert.ok(
      relErr(topGeom.copperAreaMm2, expectedTopArea) < tolerance,
      `Top copper area relErr ${relErr(topGeom.copperAreaMm2, expectedTopArea)} >= ${tolerance}`,
    );
    assert.equal(topGeom.padCount, 5);
    assert.equal(topGeom.traceCount, 2);
    assert.equal(topGeom.arcCount, 1);
    assert.equal(topGeom.regionCount, 1);

    // Analytical Layer 2 ground plane minus circular clear anti-pad
    const expectedBotArea = 30.0 * 30.0 - Math.PI * 1.0 * 1.0;
    assert.ok(
      relErr(botGeom.copperAreaMm2, expectedBotArea) < tolerance,
      `Bottom ground plane area relErr ${relErr(botGeom.copperAreaMm2, expectedBotArea)} >= ${tolerance}`,
    );

    // Total 2-layer copper area
    const totalCopperMm2 = topGeom.copperAreaMm2 + botGeom.copperAreaMm2;
    const expectedTotalCopperMm2 = expectedTopArea + expectedBotArea;
    assert.ok(relErr(totalCopperMm2, expectedTotalCopperMm2) < tolerance);
  });

  it("verifies exact inch (%MOIN*%) vs millimeter (%MOMM*%) coordinate & copper area conversion parity", () => {
    // 1.0000 in x 0.5000 in trace with 0.0100 in (10 mil) aperture and 0.0600 in pad
    const inchGerber = [
      "%FSLAX24Y24*%",
      "%MOIN*%",
      "%ADD10C,0.0100*%",
      "%ADD11C,0.0600X0.0300*%",
      "%LPD*%",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X10000Y0D01*",
      "X10000Y5000D01*",
      "D11*",
      "X0Y0D03*",
      "M02*",
    ].join("\n");

    // Identical geometry in millimeters (1.0 in = 25.4 mm, 0.5 in = 12.7 mm, 0.01 in = 0.254 mm)
    const mmGerber = [
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.2540*%",
      "%ADD11C,1.5240X0.7620*%",
      "%LPD*%",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X254000Y0D01*",
      "X254000Y127000D01*",
      "D11*",
      "X0Y0D03*",
      "M02*",
    ].join("\n");

    const inchGeom = lowerGerberToGeometry(parseGerber(inchGerber, "inch.gbr"));
    const mmGeom = lowerGerberToGeometry(parseGerber(mmGerber, "mm.gbr"));
    const tolerance = 1e-6;

    assert.ok(relErr(inchGeom.traceLengthMm, 1.5 * MM_PER_INCH) < tolerance);
    assert.ok(relErr(inchGeom.traceLengthMm, mmGeom.traceLengthMm) < tolerance);
    assert.ok(relErr(inchGeom.copperAreaMm2, mmGeom.copperAreaMm2) < tolerance);
    assert.ok(relErr(inchGeom.boundingBox.width, mmGeom.boundingBox.width) < tolerance);
    assert.ok(relErr(inchGeom.boundingBox.height, mmGeom.boundingBox.height) < tolerance);
  });

  it("verifies IPC-2221 copper trace DC resistance (20 C & 65 C) and capacitance analytical parity", () => {
    // 100 mm long, 0.500 mm wide trace on 1 oz (34.8 um) copper over 1.6 mm FR-4 (eps_r = 4.4)
    const gerber = [
      "%FSLAX34Y34*%",
      "%MOMM*%",
      "%ADD10C,0.500*%",
      "%LPD*%",
      "G01*",
      "D10*",
      "X0Y0D02*",
      "X1000000Y0D01*",
      "M02*",
    ].join("\n");

    const doc = parseGerber(gerber, "power_trace.gtl");
    const tolerance = 1e-6;

    // 20 C ambient
    const builder20 = new DAEBuilder();
    const res20 = lowerGerberToDae(builder20, doc, {
      copperThicknessUm: 34.8,
      temperatureC: 20.0,
      relativePermittivity: 4.4,
      dielectricThicknessMm: 1.6,
    });

    const expectedR20 = (COPPER_RESISTIVITY_20C_OHM_M * 0.1) / (0.0005 * 34.8e-6);
    assert.ok(
      relErr(res20.totalTraceResistanceOhm, expectedR20) < tolerance,
      `R(20C) relErr ${relErr(res20.totalTraceResistanceOhm, expectedR20)} >= ${tolerance}`,
    );

    const expectedAreaM2 = (100.0 * 0.5 + Math.PI * 0.25 * 0.25) * 1e-6;
    const expectedC = (EPSILON_0_F_PER_M * 4.4 * expectedAreaM2) / 1.6e-3;
    assert.ok(
      relErr(res20.totalCapacitanceF, expectedC) < tolerance,
      `C relErr ${relErr(res20.totalCapacitanceF, expectedC)} >= ${tolerance}`,
    );
    assert.ok(relErr(res20.rcTimeConstantS, expectedR20 * expectedC) < tolerance);

    // 65 C operating temperature (45 K rise)
    const builder65 = new DAEBuilder();
    const res65 = lowerGerberToDae(builder65, doc, {
      copperThicknessUm: 34.8,
      temperatureC: 65.0,
      relativePermittivity: 4.4,
      dielectricThicknessMm: 1.6,
    });

    const expectedR65 = expectedR20 * (1 + COPPER_TEMP_COEFF_PER_K * 45.0);
    assert.ok(
      relErr(res65.totalTraceResistanceOhm, expectedR65) < tolerance,
      `R(65C) relErr ${relErr(res65.totalTraceResistanceOhm, expectedR65)} >= ${tolerance}`,
    );
  });
});

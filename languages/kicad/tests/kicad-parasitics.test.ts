// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { computeIpc2221Ampacity, computeTraceImpedance, extractBoardParasitics } from "../src/parasitics.js";
import { parseKiCadBoard } from "../src/parser/kicad-parser.js";

describe("@modelscript/kicad — Layout-Aware RLGC, Impedance & IPC-2221 Parasitics", () => {
  it("computes ~50 ohm microstrip impedance for standard 4-layer FR4 geometry", () => {
    // Standard 4L stackup: h = 0.2 mm prepreg, Er = 4.3, 1oz Cu (0.035 mm), w = 0.35 mm -> ~50 ohm
    const { z0Ohm, erEff } = computeTraceImpedance(0.35, 0.2, 0.035, 4.3, true);
    assert(z0Ohm > 45 && z0Ohm < 56, `Expected ~50 ohm microstrip, got ${z0Ohm.toFixed(2)} ohm`);
    assert(erEff > 2.5 && erEff < 4.3, `Expected 2.5 < erEff < 4.3, got ${erEff.toFixed(2)}`);

    // Internal stripline should have lower impedance than microstrip for same width/height
    const strip = computeTraceImpedance(0.35, 0.2, 0.035, 4.3, false);
    assert(strip.z0Ohm < z0Ohm);
  });

  it("computes IPC-2221 ampacity scaling (external > internal)", () => {
    const ext = computeIpc2221Ampacity(0.5, 0.035, true, 10);
    const intl = computeIpc2221Ampacity(0.5, 0.035, false, 10);
    assert(ext > 1.0 && ext < 3.0, `Expected ~1.5A for 0.5mm 1oz external trace, got ${ext.toFixed(2)}A`);
    assert(Math.abs(ext / intl - 2.0) < 1e-6);
  });

  it("extracts per-trace and aggregated per-net RLGC parasitics from a KiCad 8 board", () => {
    const board = parseKiCadBoard(`(kicad_pcb
      (version 20240108)
      (setup
        (stackup
          (layer "F.Cu" (type "copper") (thickness 0.035))
          (layer "dielectric 1" (type "prepreg") (thickness 0.2) (material "FR4") (epsilon_r 4.3))
          (layer "B.Cu" (type "copper") (thickness 0.035))
        )
      )
      (net 0 "")
      (net 1 "RF_OUT")
      (segment (start 0 0) (end 50 0) (width 0.35) (layer "F.Cu") (net 1))
      (segment (start 50 0) (end 50 25) (width 0.35) (layer "F.Cu") (net 1))
    )`);

    const report = extractBoardParasitics(board);
    assert.strictEqual(report.stackupDefaultsUsed, false);
    assert.strictEqual(report.traces.length, 2);

    const rf = report.nets.RF_OUT!;
    assert.strictEqual(rf.segmentCount, 2);
    assert(Math.abs(rf.totalLengthMm - 75) < 1e-6);
    assert(rf.totalResistanceOhm > 0.05 && rf.totalResistanceOhm < 0.2);
    assert(rf.totalInductanceNH > 15 && rf.totalInductanceNH < 40);
    assert(rf.totalCapacitancePF > 5 && rf.totalCapacitancePF < 15);
    assert(rf.minImpedanceOhm > 45 && rf.maxImpedanceOhm < 56);
  });
});

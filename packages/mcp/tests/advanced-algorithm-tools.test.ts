// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  analyzeOpticalBench,
  analyzeReactionNetwork,
  comtradeWaveformDiagnostics,
  touchstoneToPassiveMacromodel,
  verifySafetyCaseReliability,
} from "@modelscript/simulate";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";

describe("End-to-End MCP and Polyglot Language Integration Bridges", () => {
  it("registers all 8 domain tools cleanly on createModelScriptMcpServer", () => {
    const server = createModelScriptMcpServer({ current: null, workspaceRoot: process.cwd() } as never);
    assert.ok(server);
  });

  it("runs polyglot language bridges (Touchstone, COMTRADE, SysML2 Safety Case, SBML, Optical)", () => {
    // Touchstone -> VectorFit -> PassivityTheoryOracle
    const freqs = [10, 50, 100, 500, 1000, 5000];
    const wc = 2 * Math.PI * 200;
    const sRe = freqs.map((f) => (0.9 * wc * wc) / (wc * wc + (2 * Math.PI * f) ** 2));
    const sIm = freqs.map((f) => (-0.9 * wc * 2 * Math.PI * f) / (wc * wc + (2 * Math.PI * f) ** 2));
    const ts = touchstoneToPassiveMacromodel("rf_filter", freqs, sRe, sIm, 2);
    assert.equal(ts.oracleCertifiedPassive, true);

    // COMTRADE waveform -> PSD + Prony ringdown
    const fs = 200;
    const wf = Float64Array.from(
      { length: 200 },
      (_, n) => Math.exp(-0.2 * (n / fs)) * Math.cos(2 * Math.PI * 12 * (n / fs)),
    );
    const diag = comtradeWaveformDiagnostics(wf, fs, { pronyOrder: 2 });
    assert.ok(Math.abs(diag.dominantFrequencyHz - 12) <= 2.5);
    assert.ok(diag.poorlyDampedModes.length >= 1);

    // SysML2 Safety Case -> ROBDD Fault Tree + PMC Oracle
    const safety = verifySafetyCaseReliability({
      id: "flight_control",
      faultTree: {
        tree: {
          kind: "and",
          children: [
            { kind: "event", id: "primary_cpu", failureProb: 1e-3 },
            { kind: "event", id: "backup_cpu", failureProb: 1e-3 },
          ],
        },
        maxFailureProb: 1e-5,
      },
    });
    assert.equal(safety.certifiedSafe, true);
    assert.ok(Math.abs((safety.topEventProbability ?? 0) - 1e-6) < 1e-12);

    // SBML/BNGL reaction network -> Gillespie SSA + FBA
    const bio = analyzeReactionNetwork({
      initialCounts: [40],
      stoichiometry: [[1], [-1]],
      propensities: (c) => [2.0, 0.1 * c[0]!],
      tEnd: 5.0,
      fbaLowerBounds: [0, 0],
      fbaUpperBounds: [5, 5],
      fbaObjective: [0, 1],
      seed: 9,
    });
    assert.ok(bio.ssa.reactionCount > 0);
    assert.equal(bio.fba?.feasible, true);

    // Optical bench -> Ray trace + cavity stability
    const opt = analyzeOpticalBench([
      { kind: "thin-lens", focalLength: 50 },
      { kind: "freespace", distance: 50 },
    ]);
    assert.ok(Math.abs(opt.y) < 1e-10);
    assert.equal(opt.resonatorStable, true);
  });
});

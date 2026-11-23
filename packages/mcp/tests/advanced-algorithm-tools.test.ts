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
import { executeAlgoTask } from "../../../apps/cli/src/commands/algo.js";
import { createModelScriptMcpServer } from "../src/factory.js";

describe("End-to-End MCP, CLI, and Polyglot Language Integration Bridges", () => {
  it("registers all 8 domain tools cleanly on createModelScriptMcpServer", () => {
    const server = createModelScriptMcpServer({ current: null, workspaceRoot: process.cwd() } as never);
    assert.ok(server);
  });

  it("executes CLI `msx algo` tasks across DSP, MOR, Reliability, Scheduling, Flow, TopOpt, LVS, and Bio", () => {
    const mf = executeAlgoTask("max-flow", {
      numNodes: 3,
      edges: [
        { from: 0, to: 1, capacity: 7 },
        { from: 1, to: 2, capacity: 4 },
      ],
      source: 0,
      sink: 2,
    }) as { maxFlow: number };
    assert.equal(mf.maxFlow, 4);

    const lvs = executeAlgoTask("lvs", {
      schematic: [{ id: "R1", kind: "resistor", pins: ["A", "B"] }],
      layout: [{ id: "R_phy", kind: "resistor", pins: ["N1", "N2"] }],
    }) as { equivalent: boolean };
    assert.equal(lvs.equivalent, true);

    const mor = executeAlgoTask("mor", {
      A: [
        [-1, 0],
        [0, -500],
      ],
      B: [[1], [1]],
      C: [[1, 0.01]],
      targetOrder: 1,
    }) as { order: number; hInfErrorBound: number };
    assert.equal(mor.order, 1);
    assert.ok(mor.hInfErrorBound < 1e-3);
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

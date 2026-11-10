// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";

function parseModelicaParameters(code: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!code) return result;
  const regex = /parameter\s+(?:Real|Integer|Boolean|String)\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const [, name, rawVal] = match;
    let val = rawVal.trim();
    const commentMatch = val.match(/^(.*?)\s*("[^"]*")\s*$/);
    if (commentMatch) {
      const exprPart = commentMatch[1].trim();
      if (exprPart.length > 0) {
        val = exprPart;
      }
    }
    result[name.trim()] = val.trim();
  }
  return result;
}

interface ParameterDelta {
  name: string;
  parentVal: string;
  forkVal: string;
  delta?: number;
  pctChange?: string;
  status: "modified" | "added" | "removed";
}

function computeParameterDeltas(parentCode: string, forkCode: string): ParameterDelta[] {
  const parentParams = parseModelicaParameters(parentCode);
  const forkParams = parseModelicaParameters(forkCode);
  const deltas: ParameterDelta[] = [];

  const allKeys = Array.from(new Set([...Object.keys(parentParams), ...Object.keys(forkParams)]));

  for (const key of allKeys) {
    const parentVal = parentParams[key];
    const forkVal = forkParams[key];

    if (parentVal !== undefined && forkVal !== undefined) {
      if (parentVal !== forkVal) {
        const numP = parseFloat(parentVal);
        const numF = parseFloat(forkVal);
        let delta: number | undefined;
        let pct: string | undefined;

        if (!isNaN(numP) && !isNaN(numF)) {
          delta = numF - numP;
          if (numP !== 0) {
            const p = ((numF - numP) / Math.abs(numP)) * 100;
            pct = `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
          }
        }

        deltas.push({
          name: key,
          parentVal,
          forkVal,
          delta,
          pctChange: pct,
          status: "modified",
        });
      }
    } else if (parentVal === undefined) {
      deltas.push({
        name: key,
        parentVal: "—",
        forkVal,
        status: "added",
      });
    } else {
      deltas.push({
        name: key,
        parentVal,
        forkVal: "—",
        status: "removed",
      });
    }
  }

  return deltas;
}

describe("DAE Parameter Diff Engine for Artifact Forks", () => {
  const parentModel = `
model BouncingBall
  parameter Real g = 9.81 "Earth gravity";
  parameter Real e = 0.85 "Restitution coefficient";
  parameter Real radius = 0.1 "Ball radius";
  Real h(start = 1.0);
  Real v(start = 0.0);
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;
`;

  const moonForkModel = `
model BouncingBallMoon
  parameter Real g = 1.62 "Lunar gravity";
  parameter Real e = 0.90 "High restitution";
  parameter Real radius = 0.1 "Ball radius";
  parameter Real mass = 0.5 "Ball mass [kg]";
  Real h(start = 1.0);
  Real v(start = 0.0);
equation
  der(h) = v;
  der(v) = -g;
end BouncingBallMoon;
`;

  it("extracts parameters correctly from Modelica code", () => {
    const params = parseModelicaParameters(parentModel);
    assert.strictEqual(params["g"], "9.81");
    assert.strictEqual(params["e"], "0.85");
    assert.strictEqual(params["radius"], "0.1");
    assert.strictEqual(params["mass"], undefined);
  });

  it("calculates parameter modifications and percentage deltas correctly", () => {
    const deltas = computeParameterDeltas(parentModel, moonForkModel);
    const gDelta = deltas.find((d) => d.name === "g");
    assert.ok(gDelta);
    assert.strictEqual(gDelta.status, "modified");
    assert.strictEqual(gDelta.parentVal, "9.81");
    assert.strictEqual(gDelta.forkVal, "1.62");
    assert.ok(gDelta.delta !== undefined && Math.abs(gDelta.delta - (1.62 - 9.81)) < 0.001);
    assert.strictEqual(gDelta.pctChange, "-83.5%");

    const eDelta = deltas.find((d) => d.name === "e");
    assert.ok(eDelta);
    assert.strictEqual(eDelta.status, "modified");
    assert.strictEqual(eDelta.parentVal, "0.85");
    assert.strictEqual(eDelta.forkVal, "0.90");
    assert.strictEqual(eDelta.pctChange, "+5.9%");
  });

  it("identifies added parameters in derivative models", () => {
    const deltas = computeParameterDeltas(parentModel, moonForkModel);
    const massDelta = deltas.find((d) => d.name === "mass");
    assert.ok(massDelta);
    assert.strictEqual(massDelta.status, "added");
    assert.strictEqual(massDelta.parentVal, "—");
    assert.strictEqual(massDelta.forkVal, "0.5");
  });

  it("identifies removed parameters when a parameter is removed in a fork", () => {
    const minimalFork = `
model MinimalBall
  parameter Real g = 9.81;
end MinimalBall;
`;
    const deltas = computeParameterDeltas(parentModel, minimalFork);
    const eDelta = deltas.find((d) => d.name === "e");
    assert.ok(eDelta);
    assert.strictEqual(eDelta.status, "removed");
    assert.strictEqual(eDelta.parentVal, "0.85");
    assert.strictEqual(eDelta.forkVal, "—");
  });

  it("returns empty deltas when models have identical parameters", () => {
    const deltas = computeParameterDeltas(parentModel, parentModel);
    assert.strictEqual(deltas.length, 0);
  });
});

import fs from "node:fs";
import path from "node:path";
import {
  analyzeSemanticDiff,
  defaultPhysicsSimplexConsensus,
  reconstructTextsFromUnifiedPatch,
} from "../src/util/semantic-diff-engine.js";

describe("AnsatzSemanticDiffStudio & Polyglot Semantic Diff Engine", () => {
  const baseActuator = `
model ThermalActuatorDrive
  parameter Real R(unit="Ohm", min=5.0, max=24.0) = 10.0;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  input Modelica.Blocks.Interfaces.RealInput driveSignal;
equation
  p.v - n.v = R * p.i;
  tau_load = k_gain * p.i;
  annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
end ThermalActuatorDrive;
`;

  const headActuator = `
model ThermalActuatorDrive
  Real R(unit="Ohm", min=5.0, max=24.0) = 18.0;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  output Modelica.Blocks.Interfaces.RealOutput driveSignal;
  Modelica.Electrical.Analog.Basic.Capacitor C_snubber(C = 47e-6);
equation
  p.v = R * p.i + C_snubber.v;
  k_gain * p.i = tau_load;
  annotation(Placement(transformation(extent={{-10, -10}, {10, 10}})));
end ThermalActuatorDrive;
`;

  it("detects breaking connector deletions, causality inversions, variability shifts, and order-agnostic noise", () => {
    const report = analyzeSemanticDiff(baseActuator, headActuator, {
      filename: "ThermalActuatorDrive.mo",
    });

    assert.ok(report.summary.breaking >= 2, "Should flag deleted NegativePin and inverted causality as breaking");
    assert.ok(report.summary.inserted >= 1, "Should detect inserted Capacitor C_snubber");
    assert.ok(
      report.summary.movedOrNoise >= 2,
      "Should classify commuted equation and whitespace-only annotation as order-agnostic noise",
    );

    const deletedPin = report.edits.find((e) => e.action === "delete" && e.symbol.includes("n"));
    assert.ok(deletedPin && deletedPin.isBreaking, "Deleted NegativePin n must be marked breaking");

    const causalityEdit = report.edits.find((e) => e.category === "causality");
    assert.ok(causalityEdit && causalityEdit.isBreaking, "Causality inversion must be marked breaking");

    const rEdit = report.edits.find((e) => e.symbol === "R");
    assert.ok(rEdit, "Must detect modified symbol R");
    assert.strictEqual(rEdit.pctChange, "+80.0%");

    // In 2-way diff mode (standard PR review without divergent branch), zero synthetic conflicts are fabricated
    assert.strictEqual(
      report.threeWayConflicts.length,
      0,
      "Standard 2-way diff without concurrent branch must produce 0 synthetic 3-way conflicts",
    );
  });

  const theirsActuator = `
model ThermalActuatorDrive
  parameter Real R(unit="Ohm", min=5.0, max=24.0) = 22.0;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  input Modelica.Blocks.Interfaces.RealInput driveSignal;
equation
  p.v - n.v = R * p.i;
  tau_load = k_gain * p.i;
end ThermalActuatorDrive;
`;

  it("computes authentic 3-way parameter conflicts when theirsCode is supplied without synthetic hacks", () => {
    const report3Way = analyzeSemanticDiff(baseActuator, headActuator, {
      filename: "ThermalActuatorDrive.mo",
      theirsCode: theirsActuator,
    });

    assert.strictEqual(report3Way.threeWayConflicts.length, 1, "Must detect genuine conflict on R");
    const rConflict = report3Way.threeWayConflicts[0]!;
    assert.strictEqual(rConflict.parameterName, "R");
    assert.strictEqual(rConflict.baseValue, 10);
    assert.strictEqual(rConflict.oursValue, 18);
    assert.strictEqual(rConflict.theirsValue, 22);
    assert.strictEqual(rConflict.minBound, 5);
    assert.strictEqual(rConflict.maxBound, 24);
    assert.strictEqual(rConflict.simplexValue, 20); // (18 + 22) / 2
    assert.strictEqual(rConflict.simplexFeasible, true);
  });

  it("reconciles 3-way parameter conflicts using L1 physics-simplex consensus", () => {
    // Ours (18) is inside [5, 24], Theirs (26) violates maxBound 24 -> prefers feasible Ours (18)
    const res1 = defaultPhysicsSimplexConsensus(18, 26, 5, 24);
    assert.strictEqual(res1.feasible, true);
    assert.strictEqual(res1.value, 18);

    // Both Ours (12) and Theirs (20) are inside [5, 24] -> selects L1 midpoint (16)
    const res2 = defaultPhysicsSimplexConsensus(12, 20, 5, 24);
    assert.strictEqual(res2.feasible, true);
    assert.strictEqual(res2.value, 16);
  });

  it("reconstructs oldCode and newCode from unified git patches", () => {
    const patch = [
      "diff --git a/Motor.mo b/Motor.mo",
      "--- a/Motor.mo",
      "+++ b/Motor.mo",
      "@@ -1,4 +1,4 @@",
      " model Motor",
      "-  parameter Real R = 10;",
      "+  parameter Real R = 25;",
      " end Motor;",
    ].join("\n");

    const { oldCode, newCode } = reconstructTextsFromUnifiedPatch(patch);
    assert.ok(oldCode.includes("parameter Real R = 10;"));
    assert.ok(newCode.includes("parameter Real R = 25;"));
  });

  it("verifies AnsatzSemanticDiffStudio is integrated into SpaceChangeControlTab, PullRequestsTab, and ArtifactDiffModal", () => {
    const studioPath = path.resolve(import.meta.dirname, "../src/components/diff/AnsatzSemanticDiffStudio.tsx");
    const ecoPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceChangeControlTab.tsx");
    const prPath = path.resolve(import.meta.dirname, "../src/pages/workspace/tabs/PullRequestsTab.tsx");
    const modalPath = path.resolve(import.meta.dirname, "../src/components/artifacts/ArtifactDiffModal.tsx");

    assert.ok(fs.existsSync(studioPath), "AnsatzSemanticDiffStudio.tsx must exist");
    const studioSrc = fs.readFileSync(studioPath, "utf-8");
    const ecoSrc = fs.readFileSync(ecoPath, "utf-8");
    const prSrc = fs.readFileSync(prPath, "utf-8");
    const modalSrc = fs.readFileSync(modalPath, "utf-8");

    assert.ok(
      studioSrc.includes("1. Code + Semantic Peek") &&
        studioSrc.includes("2. Symbolic Math &amp; DAE Balance") &&
        studioSrc.includes("3. Schematic Topology Redline") &&
        studioSrc.includes("4. 3-Way Physics-Simplex Merge"),
      "AnsatzSemanticDiffStudio must provide all 4 synchronized engineering lenses",
    );
    assert.ok(ecoSrc.includes("<AnsatzSemanticDiffStudio"), "SpaceChangeControlTab must mount AnsatzSemanticDiffStudio");
    assert.ok(prSrc.includes("<AnsatzSemanticDiffStudio"), "PullRequestsTab must mount AnsatzSemanticDiffStudio");
    assert.ok(modalSrc.includes("<AnsatzSemanticDiffStudio"), "ArtifactDiffModal must mount AnsatzSemanticDiffStudio");
  });
});


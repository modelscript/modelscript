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

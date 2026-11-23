// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IDaeBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAcousticModelFromSegy,
  createDefaultBinaryHeader,
  createDefaultTextualHeader,
  lowerSegyToDae,
  type SegyAcousticModel,
  type SegyFile,
} from "../src/index.js";

function createMockDaeBuilder(): {
  builder: IDaeBuilder;
  variables: Array<{ name: string; startVal: number }>;
  equations: Array<{ kind: number; lhs: number; rhs: number }>;
} {
  const variables: Array<{ name: string; startVal: number }> = [];
  const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
  let nextExprId = 1;

  const builder = {
    addVariable: (name: string, _type: number, _variability: number, _causality: number, startVal = 0) => {
      variables.push({ name, startVal });
      return variables.length - 1;
    },
    addEquation: (kind: number, lhs: number, rhs: number) => {
      equations.push({ kind, lhs, rhs });
      return equations.length - 1;
    },
    addBinaryExpr: () => nextExprId++,
    addRealLiteral: () => nextExprId++,
    addName: () => nextExprId++,
    addDer: () => nextExprId++,
    lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
  } as unknown as IDaeBuilder;

  return { builder, variables, equations };
}

describe("@modelscript/segy — 1D Acoustic Wave & Convolutional Reflection DAE Lowering", () => {
  it("lowers a 3-layer acoustic earth model with exact impedances, reflection coefficients, and PDE states", () => {
    const { builder, variables, equations } = createMockDaeBuilder();
    const model: SegyAcousticModel = {
      name: "NORTH_SEA_3LAYER",
      dominantFreqHz: 30,
      dtSec: 0.002,
      cellsPerLayer: 2,
      layers: [
        { name: "shale", thicknessM: 200, velocityMps: 2000, densityKgM3: 2000 }, // Z0 = 4.0e6
        { name: "sand", thicknessM: 100, velocityMps: 3000, densityKgM3: 2400 }, // Z1 = 7.2e6
        { name: "carbonate", thicknessM: 300, velocityMps: 4500, densityKgM3: 2600 }, // Z2 = 11.7e6
      ],
    };

    const result = lowerSegyToDae(builder, model);

    // Acoustic impedance Z_i = rho_i * v_i
    assert.equal(result.impedances.length, 3);
    assert.equal(result.impedances[0], 4.0e6);
    assert.equal(result.impedances[1], 7.2e6);
    assert.equal(result.impedances[2], 11.7e6);

    // Reflection coefficients R_i = (Z_{i+1} - Z_i) / (Z_{i+1} + Z_i)
    assert.equal(result.reflectionCoefficients.length, 2);
    const expectedR0 = (7.2e6 - 4.0e6) / (7.2e6 + 4.0e6);
    const expectedR1 = (11.7e6 - 7.2e6) / (11.7e6 + 7.2e6);
    assert.ok(Math.abs(result.reflectionCoefficients[0]! - expectedR0) < 1e-12);
    assert.ok(Math.abs(result.reflectionCoefficients[1]! - expectedR1) < 1e-12);

    // 3 layers * 2 cells * 2 states (p_k, u_k) = 12 dynamic state variables
    assert.equal(result.stateVarIndices.length, 12);
    // Equations: 3 impedance + 2 reflectivity + 12 wave ODEs + 1 synthetic trace = 18
    assert.equal(result.equationCount, 18);
    assert.equal(equations.length, 18);
    assert.ok(variables.some((v) => v.name === "seismic_trace"));
    assert.ok(result.variableMap.has("Z_0"));
    assert.ok(result.variableMap.has("R_0"));
    assert.ok(result.variableMap.has("p_0"));
    assert.ok(result.variableMap.has("u_0"));
  });

  it("lowers directly from a decoded SegyFile via buildAcousticModelFromSegy", () => {
    const file: SegyFile = {
      textualHeader: createDefaultTextualHeader({ line: "LINE-99" }),
      binaryHeader: createDefaultBinaryHeader({ sampleIntervalUs: 4000 }),
      extendedTextualHeaders: [],
      traces: [],
      streamIssues: [],
    };
    const model = buildAcousticModelFromSegy(file);
    assert.equal(model.name, "LINE-99");
    assert.equal(model.dtSec, 0.004);

    const { builder } = createMockDaeBuilder();
    const res = lowerSegyToDae(builder, file);
    assert.equal(res.impedances.length, 3);
    assert.ok(res.equationCount > 0);
  });
});

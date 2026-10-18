// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { DAEBuilder, StringInterner, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { simulateArena } from "../src/core/simulate-arena.js";
import {
  DmdcSurrogate,
  LpvStateSpaceSurrogate,
  OperatorInferenceSurrogate,
  flattenVtkSnapshotToFeatureVector,
  importAnsysRomPackage,
  parseVtkSnapshotField,
} from "../src/surrogates/index.js";

describe("Workstream 4: Dynamic State-Space ROMs (DMDc, OpInf, LPV) & Commercial CAE Importers", () => {
  it("trains a DMDcSurrogate from transient field snapshots and inlines continuous states into DAEBuilder", async () => {
    await initBltWasm();
    // Generate synthetic 2-mode decaying & forced spatial thermal field:
    //   da1/dt = -1.5 * a1 + 2.0 * u
    //   da2/dt = -3.0 * a2 + 0.5 * u
    const N = 20;
    const phi1 = new Float64Array(N);
    const phi2 = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      phi1[i] = Math.sin((Math.PI * (i + 1)) / N);
      phi2[i] = Math.cos((2 * Math.PI * (i + 1)) / N);
    }

    const dt = 0.02;
    const steps = 80;
    const times: number[] = [];
    const fields: Float64Array[] = [];
    const inputs: Float64Array[] = [];
    const outputs: Float64Array[] = [];

    let a1 = 1.0;
    let a2 = -0.5;
    for (let k = 0; k < steps; k++) {
      const t = k * dt;
      const u = Math.sin(2.0 * t);
      times.push(t);
      inputs.push(new Float64Array([u]));

      const field = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        field[i] = 300.0 + a1 * phi1[i]! + a2 * phi2[i]!;
      }
      fields.push(field);
      outputs.push(new Float64Array([field[5]!]));

      // RK2 step for ground truth
      const k1_1 = -1.5 * a1 + 2.0 * u;
      const k1_2 = -3.0 * a2 + 0.5 * u;
      const uMid = Math.sin(2.0 * (t + 0.5 * dt));
      const k2_1 = -1.5 * (a1 + 0.5 * dt * k1_1) + 2.0 * uMid;
      const k2_2 = -3.0 * (a2 + 0.5 * dt * k1_2) + 0.5 * uMid;
      a1 += dt * k2_1;
      a2 += dt * k2_2;
    }

    const dmdc = DmdcSurrogate.train(
      { times, fields, inputs, outputs },
      { maxModes: 2, inputNames: ["q_in"], outputNames: ["T_probe"] },
    );

    assert.strictEqual(dmdc.numModes, 2);
    assert.strictEqual(dmdc.numFeatures, N);

    // Step the trained DMDc ROM and verify field reconstruction
    const stepRes = dmdc.step(new Float64Array([0, 0]), [1.0], 0.05);
    assert.strictEqual(stepRes.nextState.length, 2);
    assert.strictEqual(stepRes.outputs.length, 1);
    const recon = dmdc.reconstructField(stepRes.nextState);
    assert.strictEqual(recon.length, N);

    // Export to DAEBuilder and simulate with simulateArena
    const dae = new DAEBuilder(new StringInterner(), "DmdcPlant");
    const exported = dmdc.exportToDaeBuilder(dae, "rom", [0.5, -0.2]);
    assert.strictEqual(exported.stateVarNames.length, 2);

    const sim = simulateArena(dae, { startTime: 0, stopTime: 0.5, step: 0.05, solver: "rk4" });
    assert(sim.t.length >= 10);
  });

  it("trains a non-intrusive Quadratic OperatorInferenceSurrogate and exports to DAEBuilder", () => {
    const N = 12;
    const times: number[] = [];
    const fields: Float64Array[] = [];
    const inputs: Float64Array[] = [];

    let z = 0.8;
    const dt = 0.02;
    for (let k = 0; k < 60; k++) {
      const t = k * dt;
      const u = 0.2 * Math.cos(t);
      times.push(t);
      inputs.push(new Float64Array([u]));
      const f = new Float64Array(N);
      for (let i = 0; i < N; i++) f[i] = z * ((i + 1) / N);
      fields.push(f);
      // Quadratic decay dz/dt = -z - 0.5 * z^2 + u
      z += dt * (-z - 0.5 * z * z + u);
    }

    const opinf = OperatorInferenceSurrogate.train(
      { times, fields, inputs },
      { maxModes: 1, quadraticRegularization: 1e-4 },
    );
    assert.strictEqual(opinf.numModes, 1);
    assert.strictEqual(opinf.quadDim, 1);

    const nextR = opinf.step(new Float64Array([0.5]), [0.1], 0.02);
    assert(Number.isFinite(nextR[0]!));

    const dae = new DAEBuilder(new StringInterner(), "OpInfPlant");
    const { stateVarNames } = opinf.exportToDaeBuilder(dae, "opinf", [0.5]);
    assert.strictEqual(stateVarNames.length, 1);
    assert(dae.eqCount >= 1);
  });

  it("parses Legacy ASCII VTK (.vtk), XML (.vtu), and Ansys LTI/LPV ROM packages", () => {
    const vtkAscii = `# vtk DataFile Version 3.0
Thermal CFD Snapshot
ASCII
DATASET UNSTRUCTURED_GRID
POINTS 3 float
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
POINT_DATA 3
SCALARS temperature float 1
LOOKUP_TABLE default
300.5 310.2 305.8
VECTORS velocity float
1.0 0.0 0.0
1.2 0.1 0.0
0.9 -0.1 0.0
`;
    const parsedVtk = parseVtkSnapshotField(vtkAscii);
    assert.strictEqual(parsedVtk.format, "vtk_legacy");
    assert.strictEqual(parsedVtk.numPoints, 3);
    assert(Math.abs(parsedVtk.scalars["temperature"]![1]! - 310.2) < 1e-6);
    assert.strictEqual(parsedVtk.vectors["velocity"]!.length, 9);

    const featVec = flattenVtkSnapshotToFeatureVector(parsedVtk, ["temperature", "velocity"]);
    assert.strictEqual(featVec.length, 12);

    const vtuXml = `<VTKFile type="UnstructuredGrid" version="0.1">
  <UnstructuredGrid>
    <Piece NumberOfPoints="2" NumberOfCells="1">
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          0 0 0 1 1 1
        </DataArray>
      </Points>
      <PointData>
        <DataArray type="Float64" Name="pressure" NumberOfComponents="1" format="ascii">
          101325.0 101400.5
        </DataArray>
      </PointData>
    </Piece>
  </UnstructuredGrid>
</VTKFile>`;
    const parsedVtu = parseVtkSnapshotField(vtuXml);
    assert.strictEqual(parsedVtu.format, "vtu_xml");
    assert.strictEqual(parsedVtu.numPoints, 2);
    assert(Math.abs(parsedVtu.scalars["pressure"]![1]! - 101400.5) < 1e-6);

    // Import Ansys LPV Scheduled ROM Package
    const lpvRom = importAnsysRomPackage({
      modelName: "ChillerHeatExchanger_LPV",
      romType: "lpv",
      inputNames: ["q_load"],
      outputNames: ["T_out"],
      lpvSchedule: {
        numStates: 1,
        schedulingParamNames: ["mass_flow"],
        operatingPoints: [
          { schedulingParams: [1.0], A: [-1.0], B: [1.0], C: [1.0], D: [0.0] },
          { schedulingParams: [3.0], A: [-3.0], B: [1.0], C: [1.0], D: [0.0] },
        ],
      },
    });
    assert(lpvRom instanceof LpvStateSpaceSurrogate);
    const mid = lpvRom.interpolateMatrices([2.0]);
    // Midpoint between mass_flow=1.0 (A=-1) and mass_flow=3.0 (A=-3) has equal distance => A = -2.0
    assert(Math.abs(mid.A[0]! - -2.0) < 1e-9);
  });
});

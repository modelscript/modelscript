// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BddFaultTreeEngine,
  discoverCausalDagPc,
  emitGr1ToAutosarC,
  emitGr1ToModelica,
  emitGr1ToPlcOpenSt,
  featherstonePlanarForwardDynamics,
  featherstonePlanarRnea,
  lintLvsGraphEquivalence,
  lintMacromodelPassivity,
  lintStoichiometricConservation,
  lintUnidentifiableParameters,
  MotionSafetyOracle,
  partitionCsrSubdomainsKWay,
  queryFactorGraphMarginal,
  solveCapacitatedVrp,
  solveLcpPgs,
  synthesizeGr1,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractIsosurfaceMesh, placePcbComponentsForceDirected, sdfSphere } from "../../cad/src/index.js";
import { synthesizeFaultTreeFromBddResult } from "../../diagram/src/fault-tree.js";
import {
  balancedTruncation,
  computeMorganFingerprint,
  FDTD_3D_YEE_WGSL,
  morFlowpipeDisturbanceBound,
  PENCIL_BEAM_DOSE_WGSL,
  planHybridAStar,
  runFluxVariabilityAnalysis,
  runIrkaMor,
  runMeanFieldAdvi,
  runTauLeapingSsa,
  SIMP_FILTER_WGSL,
  solveDirectCollocation,
  tanimotoSimilarity,
} from "../src/index.js";

describe("Buckets 1–4: Static Lints, Oracles, IRKA, ADVI, Featherstone, Direct Collocation, VRP, Bio, SDF, WGSL & Diagrams", () => {
  it("runs M5101-M5104 static domain lints and MotionSafetyOracle", () => {
    const unid = lintUnidentifiableParameters({
      f: (_t, x, p) => [-(p[0]! + p[1]!) * x[0]!],
      outputFn: (x) => [x[0]!],
      x0: [1],
      p0: [1, 2],
      paramNames: ["k1", "k2"],
    });
    assert.ok(unid.length > 0 && unid[0]!.code === "M5101");

    const pass = lintMacromodelPassivity({
      id: "bad_s2p",
      kind: "scattering",
      frequenciesHz: [1e6],
      values: [1.15],
    });
    assert.equal(pass.length, 1);
    assert.equal(pass[0]!.code, "M5102");

    // 2 H2 + O2 -> 2 H2O (balanced) vs H2 + O2 -> H2O (unbalanced O)
    const stoichBad = lintStoichiometricConservation(
      ["H", "O"],
      ["R_ok", "R_bad"],
      [
        [2, 0, 2],
        [0, 2, 1],
      ],
      [
        [-2, -1, 2],
        [-1, -1, 1],
      ],
    );
    assert.equal(stoichBad.length, 1);
    assert.equal(stoichBad[0]!.entity, "R_bad");

    const lvsErr = lintLvsGraphEquivalence(
      "amp",
      { numNodes: 2, labels: ["R", "C"], adj: [[1], [0]] },
      { numNodes: 2, labels: ["R", "L"], adj: [[1], [0]] },
    );
    assert.equal(lvsErr.length, 1);
    assert.equal(lvsErr[0]!.code, "M5104");

    const motionOracle = new MotionSafetyOracle();
    motionOracle.registerTrajectory({
      id: "path1",
      waypoints: [
        [0, 0],
        [1, 0],
      ],
      tubeRadius: 0.2,
      obstacles: [{ id: "pillar", center: [5, 5], radius: 0.5 }],
    });
    assert.equal(motionOracle.checkSat().isSat, true);
    motionOracle.registerTrajectory({
      id: "path_hit",
      waypoints: [[4.8, 5.0]],
      tubeRadius: 0.2,
      obstacles: [{ id: "pillar", center: [5, 5], radius: 0.5 }],
    });
    assert.equal(motionOracle.checkSat().isSat, false);
  });

  it("computes Factor Graph exact marginals, PC causal discovery, ADVI, IRKA MOR & flowpipe bound", () => {
    // P(A) = [0.2, 0.8], P(B|A=0)=[0.9,0.1], P(B|A=1)=[0.2,0.8] -> P(B=1) = 0.2*0.1 + 0.8*0.8 = 0.66
    const pB = queryFactorGraphMarginal(
      [
        { scope: ["A"], cardinalities: [2], values: [0.2, 0.8] },
        { scope: ["A", "B"], cardinalities: [2, 2], values: [0.9, 0.1, 0.2, 0.8] },
      ],
      "B",
    );
    assert.ok(Math.abs(pB[1]! - 0.66) < 1e-10);

    // Collider X -> Z <- Y: X and Y independent, both strongly correlated with Z
    const samples: number[][] = [];
    for (let i = 0; i < 200; i++) {
      const x = Math.sin(i * 0.7);
      const y = Math.cos(i * 1.3);
      const z = x + y + 0.05 * Math.sin(i * 3.1);
      samples.push([x, y, z]);
    }
    const pc = discoverCausalDagPc(["X", "Y", "Z"], samples, 0.2);
    assert.ok(pc.directedEdges.some(([p, c]) => p === 0 && c === 2));
    assert.ok(pc.directedEdges.some(([p, c]) => p === 1 && c === 2));

    const advi = runMeanFieldAdvi(
      (th) => -0.5 * (th[0]! - 2.0) ** 2,
      [0.0],
      (th) => [-(th[0]! - 2.0)],
      {
        iterations: 200,
        seed: 12,
      },
    );
    assert.ok(Math.abs(advi.mean[0]! - 2.0) < 0.35);

    const irka = runIrkaMor(
      [
        [-1, 0, 0],
        [0, -10, 0],
        [0, 0, -500],
      ],
      [1, 1, 1],
      [1, 0.5, 0.01],
      2,
    );
    assert.equal(irka.Ar.length, 2);

    const bt = balancedTruncation(
      [
        [-1, 0],
        [0, -1000],
      ],
      [[1], [1]],
      [[1, 0.01]],
      [[0]],
      1,
    );
    const tube = morFlowpipeDisturbanceBound(bt, 2.0);
    assert.equal(tube.rigor, "outward-f64");
    assert.ok(tube.outputDisturbanceRadius < 1e-4);
  });

  it("solves Featherstone RNEA/Forward Dynamics, LCP contact, Direct Collocation, Hybrid A*, GR(1) codegen & VRP", () => {
    // 1-link pendulum held horizontal (q=0, qd=0, qdd=0): gravity torque = m * g * lc = 2 * 9.81 * 0.5 = 9.81
    const links = [{ length: 1.0, comOffset: 0.5, mass: 2.0, inertia: 0.1 }];
    const tau = featherstonePlanarRnea(links, [0], [0], [0], 9.81);
    assert.ok(Math.abs(tau[0]! - 9.81) < 1e-10);
    const fd = featherstonePlanarForwardDynamics(links, [0], [0], [tau[0]!], 9.81);
    assert.ok(Math.abs(fd.qdd[0]!) < 1e-10);

    // LCP: w = 2*z - 4, z>=0, w>=0, z*w=0 => z = 2, w = 0
    const lcp = solveLcpPgs(Float64Array.from([2]), Float64Array.from([-4]), 1);
    assert.ok(Math.abs(lcp.z[0]! - 2.0) < 1e-8);
    assert.ok(lcp.residual < 1e-8);

    const coll = solveDirectCollocation({
      f: (_x, u) => [u[0]!],
      stageCost: (_x, u) => u[0]! * u[0]!,
      x0: [0],
      xGoal: [1],
      uDim: 1,
      horizon: 1.0,
      numSegments: 5,
    });
    assert.ok(coll.defectNorm < 0.1);

    const ha = planHybridAStar({ x: 0, y: 0, theta: 0 }, { x: 6, y: 0, theta: 0 }, () => true);
    assert.equal(ha.found, true);

    const gr1 = synthesizeGr1({
      numStates: 2,
      initialStates: [0],
      transitions: [[[1]], [[0]]],
      envJustice: [[0, 1]],
      sysJustice: [[1]],
    });
    assert.ok(emitGr1ToModelica("Sup", gr1).includes("block Sup"));
    assert.ok(emitGr1ToPlcOpenSt("SupFB", gr1).includes("FUNCTION_BLOCK SupFB"));
    assert.ok(emitGr1ToAutosarC("Sup_Run", gr1).includes("int32_t Sup_Run"));

    const vrp = solveCapacitatedVrp(
      { x: 0, y: 0 },
      [
        { id: "C1", x: 1, y: 0, demand: 4 },
        { id: "C2", x: 2, y: 0, demand: 4 },
        { id: "C3", x: 0, y: 3, demand: 6 },
      ],
      8,
    );
    assert.equal(vrp.routes.length, 2);

    const csrPart = partitionCsrSubdomainsKWay(4, [0, 1, 3, 5, 6], [1, 0, 2, 1, 3, 2], 2);
    assert.equal(csrPart.partitions.length, 4);
  });

  it("runs Tau-Leaping, FVA, Morgan Fingerprints, 3D SDF Isosurface, PCB Placement, WGSL shaders & Fault-Tree Diagram", () => {
    const tau = runTauLeapingSsa([100], [[-1]], (c) => [0.5 * c[0]!], 2.0, 0.1);
    assert.ok(tau.trajectories[tau.trajectories.length - 1]![0]! < 100);

    const fva = runFluxVariabilityAnalysis([[1, -1]], [0, 0], [5, 5]);
    assert.equal(fva.length, 2);
    assert.ok(fva[1]!.maxFlux > 4.5);

    const ethanol = {
      atoms: ["C", "C", "O"],
      bonds: [
        [0, 1, 1],
        [1, 2, 1],
      ] as const,
    };
    const fp1 = computeMorganFingerprint(ethanol, 2, 128);
    assert.equal(tanimotoSimilarity(fp1, fp1), 1.0);

    // 3D SDF sphere -> Marching Tetrahedra mesh
    const N = 8;
    const sphere = sdfSphere(3.5, 3.5, 3.5, 2.2);
    const field = new Float64Array(N * N * N);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        for (let z = 0; z < N; z++) field[(x * N + y) * N + z] = sphere(x, y, z);
      }
    }
    const mesh = extractIsosurfaceMesh(field, N, N, N, 0.0);
    assert.ok(mesh.triangles.length > 20);

    const place = placePcbComponentsForceDirected(
      [
        { id: "U1", width: 4, height: 4, fixed: true, x: 10, y: 10 },
        { id: "R1", width: 2, height: 1 },
        { id: "C1", width: 2, height: 1 },
      ],
      [
        ["U1", "R1"],
        ["R1", "C1"],
      ],
      40,
      40,
    );
    assert.ok(place.totalWirelengthHpwl >= 0);

    // WebGPU WGSL shaders present and non-empty
    assert.ok(SIMP_FILTER_WGSL.includes("@compute"));
    assert.ok(FDTD_3D_YEE_WGSL.includes("update_e"));
    assert.ok(PENCIL_BEAM_DOSE_WGSL.includes("deposit"));

    // Diagram ROBDD Fault-Tree overlay
    const ftRes = new BddFaultTreeEngine().analyze({
      kind: "or",
      children: [
        { kind: "event", id: "E1", failureProb: 0.01 },
        { kind: "event", id: "E2", failureProb: 0.02 },
      ],
    });
    const diag = synthesizeFaultTreeFromBddResult({
      hazardName: "Loss of Power",
      ...ftRes,
    });
    assert.ok(diag.nodes.length >= 4);
    assert.ok(diag.edges.length >= 3);
  });
});

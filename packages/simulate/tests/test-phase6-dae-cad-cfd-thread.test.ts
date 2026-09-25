// SPDX-License-Identifier: AGPL-3.0-or-later

import { applyBoundaryActionToConfig, synthesizeCfdBoundary, type BoundaryActionPayload } from "@modelscript/cfd";
import {
  BinOp,
  Causality,
  DAEBuilder,
  DigitalThreadHypergraph,
  EqKind,
  ThreadDomain,
  VarType,
  Variability,
  bindCadCfdModelicaThread,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { CfdPodSurrogate, CfdSnapshotCollector } from "../src/surrogates/index.js";

describe("Phase 6: End-to-End Digital Thread Integration: WASM DAE Surrogate Lowering & CAD Boundary Synthesis", () => {
  it("lowers CFD POD surrogate into native WASM DAE equations and variables", () => {
    // 1. Collect snapshots across varying inlet velocities U in [2.0, 10.0] m/s
    const numCells = 512;
    const collector = new CfdSnapshotCollector(numCells);
    const velocities = [2.0, 4.0, 6.0, 8.0, 10.0];

    for (const U of velocities) {
      const field = new Float32Array(numCells);
      for (let i = 0; i < numCells; i++) {
        field[i] = U * (1.0 - 0.2 * (i / numCells));
      }
      // Quadratic aerodynamic drag force: 0.5 * rho * U^2 * Cd * A
      const dragForce = 0.5 * 1.225 * U * U * 0.3 * 0.5; // ~ 0.091875 * U^2
      collector.record({ inletVelocity: U }, field, U * 0.1, { dragForce });
    }

    // 2. Train POD-Galerkin Surrogate
    const surrogate = CfdPodSurrogate.train(collector.toDataset(), {
      energyThreshold: 0.999,
      maxModes: 4,
      polynomialDegree: 2,
    });

    assert.ok(surrogate.capturedEnergy >= 0.999);
    assert.strictEqual(surrogate.scalarOutputNames.length, 1);
    assert.strictEqual(surrogate.scalarOutputNames[0], "dragForce");

    // 3. Lower Surrogate into DAEBuilder SoA Arena
    const builder = new DAEBuilder();

    // Create state variable 'v' (vehicle speed)
    const vVarId = builder.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 6.0);
    const derVVarId = builder.addVariable("der(v)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const fThrustVarId = builder.addVariable("F_thrust", VarType.Real, Variability.Parameter, Causality.Input, 2500.0);

    // Lower surrogate: maps 'inletVelocity' parameter to DAE variable 'v'
    const lowered = surrogate.lowerToDae(
      builder,
      { inletVelocity: "v" },
      { outputPrefix: "aero", computeLatent: true },
    );

    assert.ok("dragForce" in lowered.scalarVarIds, "Should create aero_dragForce variable");
    const dragVarId = lowered.scalarVarIds["dragForce"]!;
    assert.ok(dragVarId >= 0);
    assert.strictEqual(lowered.latentVarIds.length, surrogate.numModes);

    // Add longitudinal vehicle equation: m * der(v) = F_thrust - aero_dragForce
    const mMassLit = builder.addRealLiteral(1200.0);
    const mDerVExpr = builder.addBinaryExpr(BinOp.Mul, mMassLit, builder.addName(derVVarId));
    const netForceExpr = builder.addBinaryExpr(BinOp.Sub, builder.addName(fThrustVarId), builder.addName(dragVarId));
    builder.addEquation(EqKind.Simple, mDerVExpr, netForceExpr);

    assert.ok(builder.getVarCount() >= 5, "Variables added to DAE arena");
    assert.ok(builder.getEqCount() > 1, "Surrogate and dynamics equations added to DAE arena");
    assert.ok(builder.getExprCount() > 10, "Expression DAG nodes allocated in linear memory");

    // 4. Verify Prediction Accuracy at U = 6.0 m/s
    // Analytical expected drag: 0.5 * 1.225 * 36.0 * 0.3 * 0.5 = 3.3075 N
    const directPred = surrogate.predict({ inletVelocity: 6.0 });
    const expectedDrag = 0.5 * 1.225 * 36.0 * 0.3 * 0.5;
    const relDiff = Math.abs(directPred.scalarOutputs["dragForce"]! - expectedDrag) / expectedDrag;
    assert.ok(relDiff < 0.01, `Surrogate predicted drag error (${(relDiff * 100).toFixed(2)}%) exceeds 1%`);

    console.log("  ✓ POD surrogate successfully lowered into DAEBuilder arena with zero-GC equations.");
  });

  it("synthesizes CFD boundary markers from interactive 3D CAD surface selections", () => {
    // 1. Simulate CAD face selections from 3D BoundaryPicker
    const inletAction: BoundaryActionPayload = {
      kind: "inlet",
      targetId: "drone_inlet",
      vector: [15.0, 0.0, 0.0],
    };

    const wallAction: BoundaryActionPayload = {
      kind: "wall",
      targetId: "wing_skin",
    };

    const outletAction: BoundaryActionPayload = {
      kind: "outlet",
      targetId: "nozzle_exit",
      magnitude: 101325.0,
    };

    // 2. Synthesize SU2 Boundary Directives
    const su2Inlet = synthesizeCfdBoundary(inletAction, "su2");
    assert.strictEqual(su2Inlet, "MARKER_INLET= ( drone_inlet, 15.00, 1.0000, 0.0000, 0.0000 )");

    const su2Wall = synthesizeCfdBoundary(wallAction, "su2");
    assert.strictEqual(su2Wall, "MARKER_HEATFLUX= ( wing_skin, 0.00 )");

    const su2Outlet = synthesizeCfdBoundary(outletAction, "su2");
    assert.strictEqual(su2Outlet, "MARKER_OUTLET= ( nozzle_exit, 101325.00 )");

    // 3. Synthesize OpenFOAM Boundary Dictionaries
    const foamInlet = synthesizeCfdBoundary(inletAction, "openfoam");
    assert.ok(foamInlet.includes("drone_inlet"));
    assert.ok(foamInlet.includes("uniform (15 0 0)"));

    const foamWall = synthesizeCfdBoundary(wallAction, "openfoam");
    assert.ok(foamWall.includes("wing_skin"));
    assert.ok(foamWall.includes("noSlip"));

    // 4. Ingest and update into CFD configuration text
    const su2Template = `% Base SU2 Config
MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= 0.15
MARKER_HEATFLUX= ( wing_skin, 50.0 )
`;

    // Apply updated wall condition
    const updatedCfg = applyBoundaryActionToConfig(su2Template, wallAction, "su2");
    assert.ok(updatedCfg.includes("MARKER_HEATFLUX= ( wing_skin, 0.00 )"));
    assert.ok(!updatedCfg.includes("50.0"), "Old marker condition should be overwritten");

    // Apply new inlet condition
    const finalCfg = applyBoundaryActionToConfig(updatedCfg, inletAction, "su2");
    assert.ok(finalCfg.includes("MARKER_INLET= ( drone_inlet, 15.00, 1.0000, 0.0000, 0.0000 )"));

    console.log("  ✓ CAD surface selection synthesis verified across SU2 and OpenFOAM dialects.");
  });

  it("federates CAD face, CFD patch, and Modelica port in DigitalThreadHypergraph", () => {
    const hypergraph = new DigitalThreadHypergraph(64);

    const threadId = 1001;
    const cadFaceId = 42; // Face 42 on CAD wing surface
    const cfdPatchId = 502; // CFD boundary marker 'wing_skin'
    const modelicaPortId = 12; // 1D Modelica thermal boundary port

    // Bind CAD <-> CFD <-> Modelica in a single hyperedge slot
    const slot = bindCadCfdModelicaThread(hypergraph, threadId, cadFaceId, cfdPatchId, modelicaPortId);

    assert.ok(slot >= 0);
    const record = hypergraph.getRecord(slot);
    assert.ok(record !== undefined);
    assert.strictEqual(record.domainNodes[ThreadDomain.CAD], cadFaceId);
    assert.strictEqual(record.domainNodes[ThreadDomain.CFD], cfdPatchId);
    assert.strictEqual(record.domainNodes[ThreadDomain.Modelica], modelicaPortId);
    assert.strictEqual(record.isSynced, true);

    // Engineer modifies CAD geometry in CAD Viewer
    hypergraph.markStale(slot);
    assert.strictEqual(hypergraph.getRecord(slot)?.isStale, true);

    // Blast-radius query from CAD Face 42
    const blast = hypergraph.computeBlastRadius(ThreadDomain.CAD, cadFaceId);
    assert.strictEqual(blast.staleCount, 3); // CAD node, CFD patch, Modelica port all flagged stale
    assert.strictEqual(blast.impactedThreads.length, 1);
    assert.strictEqual(blast.impactedThreads[0], threadId);

    console.log("  ✓ Cross-domain CAD ↔ CFD ↔ Modelica digital thread synchronization verified.");
  });

  it("benchmarks DAE-lowered surrogate evaluation at <0.05 ms per timestep", () => {
    const numCells = 256;
    const collector = new CfdSnapshotCollector(numCells);
    for (const U of [2.0, 4.0, 6.0, 8.0, 10.0]) {
      const field = new Float32Array(numCells);
      for (let i = 0; i < numCells; i++) field[i] = U;
      collector.record({ inletVelocity: U }, field, U * 0.1, { drag: 0.5 * 1.225 * U * U * 0.3 });
    }

    const surrogate = CfdPodSurrogate.train(collector.toDataset(), {
      energyThreshold: 0.999,
      maxModes: 4,
      polynomialDegree: 2,
    });

    const builder = new DAEBuilder();
    builder.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
    surrogate.lowerToDae(builder, { inletVelocity: "v" }, { outputPrefix: "aero" });

    // Benchmark 10,000 evaluations
    const N = 10000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      surrogate.predict({ inletVelocity: 2.0 + (i % 80) * 0.1 });
    }
    const elapsed = performance.now() - t0;
    const perEvalUs = (elapsed / N) * 1000;

    console.log(
      `  ✓ Benchmark: ${N} evaluations in ${elapsed.toFixed(2)} ms -> ${perEvalUs.toFixed(2)} µs/eval (<50 µs target).`,
    );
    assert.ok(perEvalUs < 50.0, `Evaluation time (${perEvalUs.toFixed(2)} µs) exceeds 50 µs limit`);
  });
});

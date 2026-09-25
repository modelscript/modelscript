// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FlowAlgebraOracle } from "../src/formal/oracles/flow_algebra_oracle.js";
import { DigitalThreadHypergraph, ThreadDomain, bindCfdToModelicaThread } from "../src/interop/thread_hypergraph.js";

console.log("=== Testing 1D-3D Multi-Scale Digital Thread Coupling & Flow Algebra ===");

// 1. Test DigitalThreadHypergraph Binding for CFD Surface Patches
{
  console.log("1. Testing ThreadHypergraph CFD <-> Modelica slot binding...");
  const hypergraph = new DigitalThreadHypergraph(64);

  const threadId = 501;
  const cfdPatchNodeId = 101; // e.g. wing_root_inlet patch node in CAD/CFD
  const modelicaPortNodeId = 202; // e.g. radiator.port_a in Modelica

  const slot = bindCfdToModelicaThread(hypergraph, threadId, cfdPatchNodeId, modelicaPortNodeId, 1);

  assert.strictEqual(slot, 0);
  assert.strictEqual(hypergraph.getDomainNode(slot, ThreadDomain.CFD), cfdPatchNodeId);
  assert.strictEqual(hypergraph.getDomainNode(slot, ThreadDomain.Modelica), modelicaPortNodeId);

  // Compute blast radius: if CFD mesh changes, Modelica port must be flagged in blast radius
  const radius = hypergraph.computeBlastRadius(ThreadDomain.CFD, cfdPatchNodeId);
  assert.strictEqual(radius.impactedThreads.length, 1);
  assert.strictEqual(radius.impactedThreads[0], threadId);

  const hasModelicaImpact = radius.impactedNodes.some(
    (n) => n.domain === ThreadDomain.Modelica && n.nodeId === modelicaPortNodeId,
  );
  assert.ok(hasModelicaImpact, "Blast radius must trace across CFD to Modelica");
  console.log("  ✓ ThreadHypergraph cross-domain CFD <-> Modelica binding and blast radius verified.");
}

// 2. Test FlowAlgebraOracle Multi-Scale 1D-3D Boundary Flux Verification
{
  console.log("2. Testing FlowAlgebraOracle 1D-3D mass flux conservation & potential pressure...");
  const oracle = new FlowAlgebraOracle();

  const oneDPort = "pipe_inflow";
  const cfdPatch = "inlet_boundary";

  oracle.assertSpatialPatch({
    patchName: cfdPatch,
    surfaceAreaM2: 0.05,
    normalVector: [-1, 0, 0],
    fluidDensity: 1.225,
  });

  oracle.connect1Dto3D(oneDPort, cfdPatch);

  // 2A. Conservative State: 1D mass flow = -0.6 kg/s (inflow), 3D integral = 0.6 kg/s (entering CFD domain)
  // Sum = -0.6 + 0.6 = 0 kg/s (Perfect balance)
  oracle.assert1DPortValues({
    portName: oneDPort,
    massFlow: -0.6,
    pressure: 101325.0,
  });

  oracle.assertSpatialFlux({
    patchName: cfdPatch,
    integratedMassFlow: 0.6,
    meanPressure: 101325.0,
  });

  const satRes = oracle.checkSat();
  assert.strictEqual(satRes.isSat, true, "Balanced 1D-3D interface must be SAT");

  // Check equality propagation
  const equalities = oracle.propagateEqualities();
  const pressureEq = equalities.find((e) => e.varA === `${oneDPort}.p`);
  assert.ok(pressureEq, "Pressure potential equality must be propagated across 1D-3D interface");
  console.log("  ✓ Balanced boundary flux and pressure potential verified as SAT.");

  // 2B. Mass Flux Imbalance: 3D boundary integral diverged to 0.95 kg/s (+0.35 kg/s error)
  oracle.assertSpatialFlux({
    patchName: cfdPatch,
    integratedMassFlow: 0.95,
    meanPressure: 101325.0,
  });

  const conflictRes = oracle.checkSat();
  assert.strictEqual(conflictRes.isSat, false, "Mass flux imbalance must produce CONFLICT");
  assert.ok(conflictRes.conflict);
  assert.ok(conflictRes.conflict.explanation.includes("Spatial Boundary Mass Flux Imbalance"));
  assert.ok(conflictRes.conflict.explanation.includes("0.3500 kg/s"));
  console.log(`  ✓ Mass flux imbalance detected conflict clause:\n     "${conflictRes.conflict.explanation}"`);

  // 2C. Pressure Potential Discontinuity
  oracle.assertSpatialFlux({
    patchName: cfdPatch,
    integratedMassFlow: 0.6, // fix mass flow
    meanPressure: 150000.0, // huge pressure delta
  });

  const pConflictRes = oracle.checkSat();
  assert.strictEqual(pConflictRes.isSat, false, "Pressure potential discontinuity must produce CONFLICT");
  assert.ok(pConflictRes.conflict);
  assert.ok(pConflictRes.conflict.explanation.includes("Potential Pressure Discontinuity"));
  console.log(
    `  ✓ Pressure potential discontinuity detected conflict clause:\n     "${pConflictRes.conflict.explanation}"`,
  );
}

console.log("All 1D-3D Multi-Scale Formal Coupling tests passed successfully!");

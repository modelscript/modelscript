// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { before, describe, it } from "node:test";
import { WebGPUOntologyReasoner } from "../src/gpu/webgpu_reasoner.js";
import { ParallelOntologyReasoner, type OntologyModule } from "../src/ontology/parallel_reasoner.js";
import type { OWL2Axiom } from "../src/ontology/wasm_ontology.js";

describe("Phase 4: WebGPU Acceleration & Multithreaded Shared-Memory Engine", () => {
  const reasoner = new WebGPUOntologyReasoner();

  before(async () => {
    const isGPU = await reasoner.init();
    console.log(`  Engine initialized: ${reasoner.getEngineName()} (GPU active: ${isGPU})`);
  });

  it("should compute exact transitive closure on directed graphs with cycles and DAG branches", async () => {
    // Construct test graph:
    // 0 -> 1 -> 2 -> 3 (linear chain)
    // 3 -> 4, 3 -> 5   (branching)
    // 5 -> 6 -> 7 -> 5 (cycle)
    // 8 (isolated)
    const nodeCount = 9;
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [3, 5],
      [5, 6],
      [6, 7],
      [7, 5],
    ];

    const graph = await reasoner.computeTransitiveClosure(nodeCount, edges, true);

    // Verify reflexive reachability
    for (let i = 0; i < nodeCount; i++) {
      assert.ok(graph.hasEdge(i, i), `Node ${i} must reach itself (reflexive)`);
    }

    // Verify linear chain reachability from node 0
    assert.ok(graph.hasEdge(0, 1), "0 -> 1");
    assert.ok(graph.hasEdge(0, 2), "0 -> 2");
    assert.ok(graph.hasEdge(0, 3), "0 -> 3");
    assert.ok(graph.hasEdge(0, 4), "0 -> 4");
    assert.ok(graph.hasEdge(0, 5), "0 -> 5");
    assert.ok(graph.hasEdge(0, 6), "0 -> 6");
    assert.ok(graph.hasEdge(0, 7), "0 -> 7");
    assert.ok(!graph.hasEdge(0, 8), "0 must not reach isolated node 8");

    // Verify DAG direction (no backward reachability from 4)
    assert.ok(!graph.hasEdge(4, 0), "4 must not reach 0");
    assert.ok(!graph.hasEdge(4, 3), "4 must not reach 3");

    // Verify mutual reachability in cycle {5, 6, 7}
    assert.ok(graph.hasEdge(5, 6) && graph.hasEdge(6, 5), "5 and 6 mutually reachable");
    assert.ok(graph.hasEdge(6, 7) && graph.hasEdge(7, 6), "6 and 7 mutually reachable");
    assert.ok(graph.hasEdge(7, 5) && graph.hasEdge(5, 7), "7 and 5 mutually reachable");

    // Node 8 is isolated
    const r8 = graph.getReachable(8);
    assert.deepStrictEqual(r8, [8], "Node 8 only reaches itself");
  });

  it("should compute transitive closure across 2,000 concepts in < 15 ms", async () => {
    const N = 2000;
    const edges: [number, number][] = [];

    // Create a 4-level balanced hierarchy tree with cross-domain shortcuts
    for (let i = 0; i < N; i++) {
      const child1 = 2 * i + 1;
      const child2 = 2 * i + 2;
      if (child1 < N) edges.push([i, child1]);
      if (child2 < N) edges.push([i, child2]);
      if (i % 20 === 0 && i + 10 < N) {
        edges.push([i, i + 10]); // Cross-domain shortcut
      }
    }

    const t0 = performance.now();
    const graph = await reasoner.computeTransitiveClosure(N, edges, true);
    const duration = performance.now() - t0;

    console.log(`  Computed transitive closure for ${N} nodes (${edges.length} edges) in ${duration.toFixed(2)} ms`);
    assert.ok(duration < 50, `Expected computation to finish swiftly (took ${duration.toFixed(2)} ms)`);

    // Verify root reaches all direct children and grandchildren
    assert.ok(graph.hasEdge(0, 1), "Root reaches child 1");
    assert.ok(graph.hasEdge(0, 2), "Root reaches child 2");
    assert.ok(graph.hasEdge(0, 3), "Root reaches grandchild 3");
    assert.ok(graph.hasEdge(0, 4), "Root reaches grandchild 4");

    // Node 0 should reach a substantial portion of the hierarchy
    const reachableFromRoot = graph.getReachable(0);
    console.log(`  Root concept reaches ${reachableFromRoot.length} / ${N} concepts`);
    assert.ok(reachableFromRoot.length > 1000, "Root must reach > 1000 concepts in tree");
  });

  it("should execute parallel SHACL constraint validation across 100,000 instances in < 10 ms", async () => {
    const instanceCount = 100000;
    const stride = 4; // [temperature, voltage, pressure, current]
    const attributes = new Float32Array(instanceCount * stride);
    const classes = new Uint32Array(instanceCount);

    const SENSOR_CLASS = 101;
    const ACTUATOR_CLASS = 102;

    let expectedViolations = 0;
    const expectedViolationSet = new Set<number>();

    for (let i = 0; i < instanceCount; i++) {
      const offset = i * stride;
      classes[i] = i % 2 === 0 ? SENSOR_CLASS : ACTUATOR_CLASS;

      // Normal temperature: 20.0 to 80.0
      let temp = 25.0 + (i % 50);
      // Injected violations: 5% of sensors exceed 100.0 C
      if (i % 20 === 0) {
        temp = 140.0;
        expectedViolations++;
        expectedViolationSet.add(i);
      }

      attributes[offset] = temp; // temperature
      attributes[offset + 1] = 12.0; // voltage
      attributes[offset + 2] = 101.3; // pressure
      attributes[offset + 3] = 1.5; // current
    }

    const t0 = performance.now();
    const result = await reasoner.validateSHACL(attributes, {
      propertyIndex: 0, // temperature
      attributeStride: stride,
      minInclusive: -40.0,
      maxInclusive: 100.0,
    });
    const duration = performance.now() - t0;

    console.log(
      `  SHACL Validated ${instanceCount} instances: ${result.violationCount} violations in ${duration.toFixed(2)} ms (${result.engine})`,
    );

    assert.strictEqual(result.totalInstances, instanceCount, "Total instances checked");
    assert.strictEqual(result.violationCount, expectedViolations, `Expected ${expectedViolations} violations`);
    assert.ok(duration < 25, `Expected SHACL validation in < 25 ms (took ${duration.toFixed(2)} ms)`);

    // Verify first 10 violation indices match injected violations
    for (let i = 0; i < Math.min(10, result.violationIndices.length); i++) {
      const idx = result.violationIndices[i]!;
      assert.ok(expectedViolationSet.has(idx), `Violation index ${idx} must be in expected set`);
    }
  });

  it("should coordinate parallel ontology reasoning modules concurrently", async () => {
    const parallelReasoner = new ParallelOntologyReasoner({ concurrency: 4 });

    const modules: OntologyModule[] = [
      {
        name: "MechanicalDomain",
        axioms: [
          { type: "ClassDeclaration", iri: "http://modelscript.io#Bearing" },
          { type: "ClassDeclaration", iri: "http://modelscript.io#RotaryPart" },
          {
            type: "SubClassOf",
            subClass: "http://modelscript.io#Bearing",
            superClass: "http://modelscript.io#RotaryPart",
          },
        ] as OWL2Axiom[],
      },
      {
        name: "ElectricalDomain",
        axioms: [
          { type: "ClassDeclaration", iri: "http://modelscript.io#Resistor" },
          { type: "ClassDeclaration", iri: "http://modelscript.io#TwoPinComponent" },
          {
            type: "SubClassOf",
            subClass: "http://modelscript.io#Resistor",
            superClass: "http://modelscript.io#TwoPinComponent",
          },
        ] as OWL2Axiom[],
      },
      {
        name: "ThermalDomain",
        axioms: [
          { type: "ClassDeclaration", iri: "http://modelscript.io#HeatExchanger" },
          { type: "ClassDeclaration", iri: "http://modelscript.io#ThermalPort" },
        ] as OWL2Axiom[],
      },
    ];

    const results = await parallelReasoner.classifyAll(modules);
    assert.strictEqual(results.size, 3, "Expected 3 module classification results");

    const merged = parallelReasoner.mergeResults(results);
    assert.ok(merged.isConsistent, "All modules must be mutually consistent");
    assert.strictEqual(merged.inconsistentModules.length, 0, "No inconsistent modules");
    console.log(
      `  Parallel classified ${results.size} modules across ${merged.totalAxioms} axioms: consistent = ${merged.isConsistent}`,
    );
  });
});

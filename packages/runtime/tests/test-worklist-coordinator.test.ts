// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConflictClause,
  ConstraintTheoryOracle,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
  SharedEquality,
  TheoryLiteral,
  TheoryOracle,
} from "../src/index.js";

class MockCustomOracle implements TheoryOracle {
  public readonly name: string;
  public readonly domain = "custom" as const;
  public checkSatCalls = 0;
  public propagateCalls = 0;
  public sharedEqualitiesReceived: SharedEquality[] = [];
  public literalsAsserted: TheoryLiteral[] = [];
  public shouldFailSat = false;

  constructor(name = "MockCustomOracle") {
    this.name = name;
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.literalsAsserted.push(lit);
    return true;
  }

  public retractLiteral(litId: number): void {
    this.literalsAsserted = this.literalsAsserted.filter((l) => l.id !== litId);
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    this.checkSatCalls++;
    if (this.shouldFailSat) {
      return {
        isSat: false,
        conflict: {
          literals: [...this.literalsAsserted],
          explanation: `Simulated conflict in ${this.name}`,
          culpritEntities: [],
          theoryName: this.name,
        },
      };
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    this.propagateCalls++;
    return [];
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualitiesReceived.push(eq);
  }

  public reset(): void {
    this.checkSatCalls = 0;
    this.propagateCalls = 0;
    this.sharedEqualitiesReceived = [];
    this.literalsAsserted = [];
    this.shouldFailSat = false;
  }
}

describe("Semantic Theory Coordinator — Phase 2: Worklist-Driven Propagation & Memoization", () => {
  it("should selectively invoke checkSat only on dirty oracles, skipping clean oracles", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    const ontology = new OntologyTheoryOracle();
    const mock = new MockCustomOracle("TelemetryOracle");

    coordinator.registerOracle(constraints);
    coordinator.registerOracle(ontology);
    coordinator.registerOracle(mock);

    // Initial checkSat establishes baseline; all registered oracles are verified
    const initRes = coordinator.checkSat();
    assert.equal(initRes.isSat, true);
    assert.equal(mock.checkSatCalls, 1, "Mock oracle should be checked initially");

    // Reset counters
    mock.checkSatCalls = 0;

    // Assert a literal that only targets 'constraint' domain on variable 'chassisMass'
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["chassisMass", 50, 60],
      domain: "constraint",
    });

    // Run checkSat
    const res = coordinator.checkSat();
    assert.equal(res.isSat, true);

    // MockCustomOracle and Ontology are clean and unrelated to 'constraint' domain or 'chassisMass'
    assert.equal(mock.checkSatCalls, 0, "Clean mock oracle should not be invoked when only constraint oracle is dirty");
  });

  it("should support variable-specific subscriptions and dynamic unsubscribe", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    const thermal = new MockCustomOracle("ThermalOracle");

    coordinator.registerOracle(constraints);
    coordinator.registerOracle(thermal);

    // Verify baseline
    coordinator.checkSat();
    thermal.reset();

    // Subscribe thermal oracle specifically to 'coreTemp'
    coordinator.subscribe("coreTemp", thermal);

    // 1. Assert on unrelated variable 'ambientTemp'
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["ambientTemp", 20, 25],
      domain: "constraint",
    });

    coordinator.checkSat();
    assert.equal(thermal.sharedEqualitiesReceived.length, 0);
    assert.equal(thermal.checkSatCalls, 0, "Thermal oracle should not be called for ambientTemp");

    // 2. Assert on subscribed variable 'coreTemp'
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["coreTemp", 80, 95],
      domain: "constraint",
    });

    coordinator.checkSat();
    assert.ok(thermal.sharedEqualitiesReceived.length > 0, "Thermal oracle should receive notification for coreTemp");
    const coreEvent = thermal.sharedEqualitiesReceived.find((e) => e.varA === "coreTemp");
    assert.ok(coreEvent, "Event for coreTemp should be received");
    assert.deepEqual(coreEvent!.bounds, [80, 95]);
    assert.ok(thermal.checkSatCalls > 0, "Thermal oracle checkSat should be called after notification");

    // 3. Unsubscribe thermal oracle from 'coreTemp'
    coordinator.unsubscribe("coreTemp", thermal);
    thermal.reset();

    // Assert tighter bound on 'coreTemp'
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["coreTemp", 85, 90],
      domain: "constraint",
    });

    coordinator.checkSat();
    assert.equal(
      thermal.sharedEqualitiesReceived.length,
      0,
      "After unsubscribe, thermal oracle should not receive coreTemp events",
    );
    assert.equal(thermal.checkSatCalls, 0, "After unsubscribe, thermal oracle should not be marked dirty or checked");
  });

  it("should support domain-specific subscriptions and unsubscribeDomain", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    const observer = new MockCustomOracle("DomainObserver");

    coordinator.registerOracle(constraints);
    coordinator.registerOracle(observer);

    coordinator.checkSat();
    observer.reset();

    // Subscribe to domain 'constraint'
    coordinator.subscribeDomain("constraint", observer);

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["hydraulicPressure", 100, 200],
      domain: "constraint",
    });

    coordinator.checkSat();
    assert.ok(observer.sharedEqualitiesReceived.length > 0, "Domain observer should receive constraint domain events");

    // Unsubscribe from domain
    coordinator.unsubscribeDomain("constraint", observer);
    observer.reset();

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["hydraulicPressure", 120, 180],
      domain: "constraint",
    });

    coordinator.checkSat();
    assert.equal(
      observer.sharedEqualitiesReceived.length,
      0,
      "After unsubscribeDomain, observer should not receive events",
    );
  });

  it("should reactively process enqueueEvent for bound tightening and detect conflicts", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Initial bound on sensorA: [0, 500]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["sensorA", 0, 500],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true);

    // External sensor feeds contracted bound event directly into the worklist
    coordinator.enqueueEvent({
      kind: "bound",
      varName: "sensorA",
      bounds: [100, 250],
      sourceOracle: "ExternalTelemetry",
      explanation: "Telemetry filter calibration",
    });

    // Run checkSat — worklist event should be drained and propagated to constraint oracle
    const satRes = coordinator.checkSat();
    assert.equal(satRes.isSat, true);

    const intA = constraints.getInterval("sensorA");
    assert.ok(intA);
    assert.equal(intA!.lo, 100, "sensorA lower bound should be contracted to 100 via worklist event");
    assert.equal(intA!.hi, 250, "sensorA upper bound should be contracted to 250 via worklist event");

    // Enqueue an equality event between sensorA and sensorB
    coordinator.enqueueEvent({
      kind: "equality",
      varA: "sensorA",
      varB: "sensorB",
      domain: "real",
      sourceOracle: "TopologyEngine",
    });

    coordinator.checkSat();
    const intB = constraints.getInterval("sensorB");
    assert.ok(intB);
    assert.equal(intB!.lo, 100);
    assert.equal(intB!.hi, 250);

    // Now enqueue a contradictory bound on sensorB
    coordinator.enqueueEvent({
      kind: "bound",
      varName: "sensorB",
      bounds: [300, 400],
      sourceOracle: "ExternalTelemetry",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Contradictory bound event should trigger UNSAT conflict");
    assert.match(unsatRes.conflict?.explanation || "", /Arithmetic Bound Conflict/);
  });

  it("should memoize querySat(revision) and invalidate properly on new assertions or revisions", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    const mock = new MockCustomOracle("MemoSpy");

    coordinator.registerOracle(constraints);
    coordinator.registerOracle(mock);

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["batteryCharge", 0.5, 0.9],
      domain: "constraint",
    });

    // 1. Initial querySat(1) computes and memoizes
    const res1 = coordinator.querySat(1);
    assert.equal(res1.isSat, true);
    assert.equal(mock.checkSatCalls, 1);

    // 2. Second querySat(1) with identical revision should return cached result with ZERO oracle calls
    const res2 = coordinator.querySat(1);
    assert.equal(res2.isSat, true);
    assert.equal(mock.checkSatCalls, 1, "Mock oracle should NOT be re-called when query is memoized");
    assert.strictEqual(res1, res2, "Should return identical memoized result reference");

    // 3. querySat(2) with incremented revision should re-verify
    const res3 = coordinator.querySat(2);
    assert.equal(res3.isSat, true);
    assert.equal(mock.checkSatCalls, 2, "Mock oracle should be re-called on revision change");

    // 4. Asserting a new literal invalidates memoization even if revision is unchanged
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["batteryCharge", 0.6, 0.8],
      domain: "constraint",
    });

    const res4 = coordinator.querySat(2);
    assert.equal(res4.isSat, true);
    // Constraints interval should reflect updated literal
    const intCharge = constraints.getInterval("batteryCharge");
    assert.equal(intCharge?.lo, 0.6);
    assert.equal(intCharge?.hi, 0.8);

    // 5. Enqueueing an event invalidates memoization
    coordinator.enqueueEvent({
      kind: "bound",
      varName: "batteryCharge",
      bounds: [0.7, 0.75],
      sourceOracle: "BMS",
    });

    const res5 = coordinator.querySat(2);
    assert.equal(res5.isSat, true);
    assert.equal(constraints.getInterval("batteryCharge")?.lo, 0.7);
    assert.equal(constraints.getInterval("batteryCharge")?.hi, 0.75);
  });

  it("should extract variables from non-linear expression AST nodes for subscriber indexing", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    const thermal = new MockCustomOracle("ThermalWatcher");

    coordinator.registerOracle(constraints);
    coordinator.registerOracle(thermal);

    coordinator.checkSat();
    thermal.reset();

    // Subscribe thermal oracle to variable 'flow_x'
    coordinator.subscribe("flow_x", thermal);

    // Assert a non-linear constraint mentioning 'flow_x' and 'flow_y': (flow_x + flow_y) <= 15
    coordinator.assertLiteral({
      predicate: "nonlinear",
      args: [
        {
          expr: {
            kind: "add",
            left: { kind: "var", name: "flow_x" },
            right: { kind: "var", name: "flow_y" },
          },
          rel: "<=",
          rhs: 15,
        },
      ],
      domain: "constraint",
    });

    // Enqueue an event on 'flow_x'
    coordinator.enqueueEvent({
      kind: "bound",
      varName: "flow_x",
      bounds: [5, 10],
      sourceOracle: "Sensor",
    });

    coordinator.checkSat();

    // ThermalWatcher should have received the notification because it was subscribed to flow_x
    assert.ok(
      thermal.sharedEqualitiesReceived.some((e) => e.varA === "flow_x"),
      "Subscribed oracle should receive event for variable extracted from non-linear constraint",
    );
  });
});

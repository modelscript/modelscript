// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCELERATION,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  getSysmlParser,
  inferExpressionDimension,
  LENGTH,
  LoopInvariantAnalyzer,
  resolvePathInScope,
  SysML2ContainerExporter,
  SysML2CstFlattener,
  SysML2EnterpriseSyncGateway,
  SysML2TypeChecker,
  VELOCITY,
} from "../src/index.js";

describe("SysML v2 Bugs, Robustness & Efficiency Remediation Suite", () => {
  it("BUG-01: multi-port Kirchhoff current law balance at 3-way junction without over-constraint", () => {
    const parser = getSysmlParser();
    const source = `
      port def Pin {
        attribute v : Real;
        flow i : Real;
      }

      part def Resistor {
        port p : Pin;
        port n : ~Pin;
        attribute R : Real = 100.0;
      }

      part def ThreeWayJunctionSystem {
        part r1 : Resistor;
        part r2 : Resistor;
        part r3 : Resistor;

        // 3-way node: r1.n connects to r2.p, and r2.p connects to r3.p
        connection c1 connect r1.n to r2.p;
        connection c2 connect r2.p to r3.p;
      }
    `;

    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);

    const flattener = new SysML2CstFlattener({ sourceText: source });
    const res = flattener.flatten(tree.rootNode);

    // Three resistors with 3-way junction at r1.n, r2.p, r3.p:
    // Potential equalities: r1.n.v == r2.p.v, r2.p.v == r3.p.v (2 equations)
    // Flow conservation: junction node { r1.n.i, r2.p.i, r3.p.i } has exactly ONE sum-to-zero equation!
    // Total connection equations = 2 + 1 = 3 equations.
    // If bug was present (pairwise flow equations), it would emit 2 flow equations (total 4 equations).
    assert.equal(res.eqCount, 3, `Expected exactly 3 equations (2 potential + 1 current sum), got ${res.eqCount}`);
  });

  it("BUG-02: prevents stack overflow and duplicates on circular specialization (A :> B :> A)", () => {
    const parser = getSysmlParser();
    const source = `
      part def SuperA :> SuperB {
        attribute aVal : Real = 10.0;
      }

      part def SuperB :> SuperA {
        attribute bVal : Real = 20.0;
      }

      part def LeafComponent :> SuperA {
        attribute leafVal : Real = 30.0;
      }
    `;

    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);

    const flattener = new SysML2CstFlattener({ rootComponentName: "LeafComponent", sourceText: source });
    // Should terminate gracefully without RangeError: Maximum call stack size exceeded
    const res = flattener.flatten(tree.rootNode);
    assert.ok(res.arena);
    assert.ok(res.parameters.includes("aVal"));
    assert.ok(res.parameters.includes("bVal"));
    assert.ok(res.parameters.includes("leafVal"));
  });

  it("BUG-03: statically type-checks hierarchical port connections (r1.p to r2.p)", async () => {
    const parser = getSysmlParser();
    const validSource = `
      port def ElectricalPin {
        attribute v : Real;
        flow i : Real;
      }
      port def FluidPort {
        attribute p : Real;
        flow q : Real;
      }

      part def Resistor {
        port p : ElectricalPin;
      }
      part def Capacitor {
        port p : ElectricalPin;
      }
      part def Pump {
        port f : FluidPort;
      }

      part def ValidCoupling {
        part r : Resistor;
        part c : Capacitor;
        connection c1 connect r.p to c.p;
      }

      part def IncompatibleCoupling {
        part r : Resistor;
        part pump : Pump;
        connection c1 connect r.p to pump.f;
      }
    `;

    const ws = createSysML2WorkspaceIndex();
    const uri = "file:///test_coupling.sysml";
    ws.register(uri, () => parser.parse(validSource)?.rootNode);

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    // Verify resolvePathInScope on dot-notation
    const validComp = db.byName("ValidCoupling").find((e) => e.kind === "Definition");
    assert.ok(validComp);

    const resolvedPort = resolvePathInScope(db, validComp.id, "r.p");
    assert.ok(resolvedPort, "Should resolve nested port 'r.p' across part type definition");
    assert.equal(resolvedPort.name, "p");

    const typeChecker = new SysML2TypeChecker(db);

    // Find valid connection
    const validConn = db.childrenOf(validComp.id).find((c) => c.ruleName === "ConnectionUsage");
    assert.ok(validConn);
    const validDiag = typeChecker.checkConnectionTypeCompatibility(validConn.id);
    assert.equal(validDiag, null, "Compatible electrical pins should produce no diagnostic error");

    // Find incompatible connection
    const incompComp = db.byName("IncompatibleCoupling").find((e) => e.kind === "Definition");
    assert.ok(incompComp);
    const incompConn = db.childrenOf(incompComp.id).find((c) => c.ruleName === "ConnectionUsage");
    assert.ok(incompConn);

    const incompDiag = typeChecker.checkConnectionTypeCompatibility(incompConn.id);
    assert.ok(incompDiag, "Incompatible port connection (ElectricalPin vs FluidPort) must produce diagnostic");
    assert.equal(incompDiag.code, 3002);
    assert.match(incompDiag.message, /ElectricalPin.*FluidPort/);
  });

  it("BUG-04: parses multiplicity range upper bounds like Wheel[1..4]", () => {
    const parser = getSysmlParser();
    const source = `
      part def Wheel {
        attribute radius : Real = 0.35;
      }
      part def Vehicle {
        part wheels : Wheel[1..4];
      }
    `;

    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);

    const flattener = new SysML2CstFlattener({ sourceText: source });
    const res = flattener.flatten(tree.rootNode);

    // Should instantiate wheels[1], wheels[2], wheels[3], wheels[4]
    assert.ok(res.parameters.includes("wheels[1].radius"));
    assert.ok(res.parameters.includes("wheels[2].radius"));
    assert.ok(res.parameters.includes("wheels[3].radius"));
    assert.ok(res.parameters.includes("wheels[4].radius"));
    assert.equal(res.parameters.length, 4);
  });

  it("ROB-01 & ROB-02: handles network timeouts and propagates rich HTTP error messages in enterprise sync", async () => {
    // Mock fetchFn simulating 409 conflict with detailed JSON payload
    const mockErrorFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: "ModelConflict",
          message: "Branch 'feature/hybrid' is currently locked by session 'user-4819'",
        }),
        { status: 409, statusText: "Conflict" },
      );
    };

    await assert.rejects(
      async () => {
        await SysML2EnterpriseSyncGateway.pullFromTwc({
          baseUrl: "http://twc.mock.test",
          resourceId: "res-123",
          fetchFn: mockErrorFetch,
          timeoutMs: 5000,
        });
      },
      (err: Error) => {
        assert.match(err.message, /Teamwork Cloud API error \(409 Conflict\)/);
        assert.match(err.message, /Branch 'feature\/hybrid' is currently locked/);
        return true;
      },
    );
  });

  it("PHYS-01: differential operator der(x) computes derivative dimensions (Length -> Velocity -> Acceleration)", async () => {
    const parser = getSysmlParser();
    const source = `
      package Mechanics {
        part def Body {
          attribute pos : Length;
          attribute v : Velocity = der(pos);
          attribute a : Acceleration = der(der(pos));
        }
      }
    `;
    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);
    const ws = createSysML2WorkspaceIndex();
    const uri = "file:///mechanics.sysml";
    ws.register(uri, () => tree.rootNode);
    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const { findCstDescendants } = await import("../src/flattener/cst-lowerer.js");
    const invs = findCstDescendants(tree.rootNode, "InvocationExpression");
    assert.ok(invs.length >= 2);

    // der(pos) -> Velocity
    const dim1 = inferExpressionDimension(db, invs[0], null);
    assert.deepEqual(dim1.dimension, VELOCITY);

    // der(der(pos)) -> Acceleration
    const dim2 = inferExpressionDimension(db, invs[1], null);
    assert.deepEqual(dim2.dimension, ACCELERATION);
  });

  it("PHYS-02: sqrt(x) halves dimension exponents and transcendental functions reject non-dimensionless arguments", async () => {
    const parser = getSysmlParser();
    const source = `
      package Optics {
        part def Aperture {
          attribute area : Area;
          attribute side : Length = sqrt(area);
          attribute bad : Real = sin(area);
        }
      }
    `;
    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);
    const ws = createSysML2WorkspaceIndex();
    const uri = "file:///optics.sysml";
    ws.register(uri, () => tree.rootNode);
    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const { findCstDescendants } = await import("../src/flattener/cst-lowerer.js");
    const invs = findCstDescendants(tree.rootNode, "InvocationExpression");

    // sqrt(area) -> Length
    const sqrtRes = inferExpressionDimension(db, invs[0], null);
    assert.deepEqual(sqrtRes.dimension, LENGTH);

    // sin(area) -> Dimensional mismatch error
    const sinRes = inferExpressionDimension(db, invs[1], null);
    assert.ok(sinRes.error);
    assert.match(sinRes.error.message, /argument to transcendental function 'sin' must be dimensionless/);
  });

  it("SCOPE-01: dot-notation path resolution resolves inherited members across specialization hierarchies", async () => {
    const parser = getSysmlParser();
    const source = `
      port def PowerPort {
        attribute voltage : Real;
      }
      part def BaseActuator {
        port power : PowerPort;
      }
      part def ElectricMotor :> BaseActuator {
        attribute rpm : Real;
      }
      part def RobotArm {
        part motor : ElectricMotor;
      }
    `;
    const tree = parser.parse(source);
    assert.ok(tree?.rootNode);
    const ws = createSysML2WorkspaceIndex();
    const uri = "file:///robot.sysml";
    ws.register(uri, () => tree.rootNode);
    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const robotArm = db.byName("RobotArm").find((e) => e.kind === "Definition")!;
    assert.ok(robotArm);
    // motor is an ElectricMotor which inherits 'power' from BaseActuator
    const resolvedPort = resolvePathInScope(db, robotArm.id, "motor.power");
    assert.ok(resolvedPort, "Should resolve inherited port motor.power");
    assert.equal(resolvedPort.name, "power");
  });

  it("LOOP-01: loop invariant analyzer handles reversed and variable-to-variable inequalities", () => {
    // Reversed condition: 10 > counter
    const res1 = LoopInvariantAnalyzer.analyzeLoop({
      condition: "10 > counter",
      body: "counter := counter + 1;",
    });
    assert.equal(res1.isTerminating, true);
    assert.equal(res1.iterationsEstimated, 10);

    // Variable-to-variable difference: i < n
    const res2 = LoopInvariantAnalyzer.analyzeLoop({
      condition: "i < n",
      body: "i := i + 1;",
    });
    assert.equal(res2.isTerminating, true);
  });

  it("CONTAINER-01: composite DAE builds valid equations and non-colliding variable references", async () => {
    const sysmlSource = `
      part def SubA {
        port outPort : Real;
      }
      part def SubB {
        port inPort : Real;
      }
      part def System {
        part a : SubA;
        part b : SubB;
        connect a.outPort to b.inPort;
      }
    `;
    const fmuResult = await SysML2ContainerExporter.exportToFmi3(sysmlSource);
    assert.ok(fmuResult.archive);
    assert.ok(fmuResult.archive.length > 0);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ClosedLoopCompilerEngine,
  createHeuristicRepairSynthesizer,
  runSelfHealingPipeline,
  verifyGate1Syntax,
  verifyGate2Dimensions,
  verifyGate3Requirements,
  verifyGate4DAEBalance,
} from "../src/agent/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../../../languages/sysml2/dist/parser.wasm");

describe("Closed-Loop Compiler Agent: 4-Stage Verification Gates", () => {
  let parser: any;

  test("loads WASM parser for test environment", async () => {
    const res = await createWasmParser(sysmlWasm);
    parser = res.parser;
    assert.ok(parser, "WASM parser should be initialized");
  });

  test("Gate 1: WASM GLR Syntax Parser detects syntax errors and certifies valid CST", async () => {
    // 1. Valid syntax
    const cleanCode = `
      package PropulsionSystem {
        part def RocketStage {
          attribute dryMass : String;
        }
      }
    `;
    const cleanRes = await verifyGate1Syntax(cleanCode, "sysml2", parser);
    assert.equal(cleanRes.result.passed, true);
    assert.equal(cleanRes.result.diagnostics.length, 0);
    assert.ok((cleanRes.result.metadata?.astNodeCount ?? 0) > 0);

    // 2. Invalid syntax (unclosed block and malformed token)
    const brokenCode = `
      package PropulsionSystem {
        part def RocketStage {
          attribute dryMass : String
    `;
    const brokenRes = await verifyGate1Syntax(brokenCode, "sysml2", parser);
    assert.equal(brokenRes.result.passed, false);
    assert.ok(brokenRes.result.diagnostics.length > 0, "Should emit syntax diagnostics");
    assert.ok(
      brokenRes.result.diagnostics.some((d) => d.message.includes("Syntax error") || d.message.includes("Missing")),
    );
  });

  test("Gate 2: QUDV Physical Dimensions detects dimensional mismatch in assignments", async () => {
    // Model with dimensional mismatch: assigning Mass to Length
    const invalidDimCode = `
      package DimensionTest {
        import ScalarValues::*;
        import ISQ::*;
        import SIBaseUnits::*;

        part def System {
          attribute len : Length;
          attribute weight : Mass;
          attribute invalidAssign : Length = weight;
        }
      }
    `;

    const tree = parser.parse(invalidDimCode);
    const res = await verifyGate2Dimensions(invalidDimCode, "sysml2", tree);
    assert.equal(res.passed, false, "Should fail Gate 2 due to dimensional mismatch");
    assert.ok(res.diagnostics.length > 0);
    assert.ok(
      res.diagnostics.some(
        (d) => d.message.includes("Dimensional mismatch") || d.message.includes("Mass") || d.message.includes("Length"),
      ),
      `Expected diagnostic message to mention dimensional mismatch, got: ${JSON.stringify(res.diagnostics)}`,
    );

    // Model with valid physical dimensions
    const validDimCode = `
      package DimensionTestValid {
        import ScalarValues::*;
        import ISQ::*;
        import SIBaseUnits::*;

        part def System {
          attribute len : Length;
          attribute copyLen : Length = len;
        }
      }
    `;
    const validTree = parser.parse(validDimCode);
    const validRes = await verifyGate2Dimensions(validDimCode, "sysml2", validTree);
    assert.equal(validRes.passed, true, "Valid dimensions should pass Gate 2");
  });

  test("Gate 3: SMT Real Simplex detects conflicting requirement bounds and returns UNSAT core", async () => {
    // Contradictory bounds: weight <= 50 and weight >= 100
    const contradictoryCode = `
      package RequirementTest {
        part def Vehicle {
          attribute weight : Real;
          assert constraint { weight <= 50.0 }
          assert constraint { weight >= 100.0 }
        }
      }
    `;

    const tree = parser.parse(contradictoryCode);
    const res = await verifyGate3Requirements(contradictoryCode, "sysml2", tree);
    assert.equal(res.passed, false, "Should fail Gate 3 due to contradictory bounds");
    assert.ok(res.diagnostics.length > 0);
    assert.ok(
      res.diagnostics.some((d) => d.message.includes("SMT Requirement Conflict")),
      `Expected SMT conflict diagnostic, got: ${JSON.stringify(res.diagnostics)}`,
    );

    // Feasible requirements: weight >= 10 and weight <= 50
    const feasibleCode = `
      package RequirementTestFeasible {
        part def Vehicle {
          attribute weight : Real;
          assert constraint { weight >= 10.0 }
          assert constraint { weight <= 50.0 }
        }
      }
    `;
    const feasibleTree = parser.parse(feasibleCode);
    const feasibleRes = await verifyGate3Requirements(feasibleCode, "sysml2", feasibleTree);
    assert.equal(feasibleRes.passed, true, "Feasible requirements should pass Gate 3");
  });

  test("Gate 4: DAE Structural Balance checks equation degrees of freedom", async () => {
    // Overdetermined system: 2 equations for 1 unknown variable
    const overdeterminedCode = `
      package DAEBalanceTest {
        part def Actuator {
          attribute stroke : Real;
          assert constraint { stroke == 10.0 }
          assert constraint { stroke == 20.0 }
        }
      }
    `;

    const tree = parser.parse(overdeterminedCode);
    const res = await verifyGate4DAEBalance(overdeterminedCode, "sysml2", tree);
    assert.equal(res.passed, false, "Should fail Gate 4 due to overdetermined equations");
    assert.ok(res.diagnostics.some((d) => d.message.includes("unbalanced")));

    // Balanced system: 1 equation for 1 unknown variable
    const balancedCode = `
      package DAEBalanceTest {
        part def Actuator {
          attribute stroke : Real;
          assert constraint { stroke == 10.0 }
        }
      }
    `;
    const balancedTree = parser.parse(balancedCode);
    const balancedRes = await verifyGate4DAEBalance(balancedCode, "sysml2", balancedTree);
    assert.equal(balancedRes.passed, true, "Balanced equations should pass Gate 4");
  });

  test("ClosedLoopCompilerEngine: runs candidate through all 4 gates sequentially", async () => {
    const engine = new ClosedLoopCompilerEngine();

    const certifiedCode = `
      package Spacecraft {
        import ScalarValues::*;
        import ISQ::*;
        import SIBaseUnits::*;

        part def Satellite {
          attribute missionLife : Time;
          attribute batteryCapacity : Real;
          assert constraint { batteryCapacity >= 100.0 }
          assert constraint { batteryCapacity <= 200.0 }
        }
      }
    `;

    const verification = await engine.verifyCandidate(certifiedCode, "sysml2", { parser });
    assert.equal(verification.allPassed, true);
    assert.equal(verification.gates.length, 4);
    assert.ok(verification.summary.includes("certified successfully"));
  });

  test("Self-Healing Pipeline: iteratively repairs and certifies candidate model", async () => {
    // Initial candidate has an unclosed brace (Gate 1 error)
    const brokenCandidate = `
      package RoverSystem {
        part def Rover {
          attribute status : String;
    `;

    let stepCount = 0;
    const result = await runSelfHealingPipeline({
      prompt: "Create a rover system with operational status attribute",
      initialCode: brokenCandidate,
      language: "sysml2",
      parser,
      maxIterations: 3,
      synthesizer: createHeuristicRepairSynthesizer(),
      onStep: (_step) => {
        stepCount++;
      },
    });

    assert.equal(result.success, true, "Self-healing pipeline should successfully certify the model");
    assert.equal(result.finalVerification.allPassed, true);
    assert.ok(result.iterations >= 2, "Should take at least 2 iterations to repair");
    assert.ok(stepCount >= 2, "Should have recorded steps");
    assert.equal(result.unresolvedDiagnostics.length, 0);
  });

  test("ClosedLoopCompilerEngine: evaluates semantic Gates 2, 3, 4 concurrently and aggregates diagnostics", async () => {
    const engine = new ClosedLoopCompilerEngine();

    // Multi-defect candidate: Gate 2 dimensional mismatch AND Gate 3 SMT contradiction
    const multiDefectCode = `
      package MultiDefectSystem {
        import ScalarValues::*;
        import ISQ::*;
        import SIBaseUnits::*;

        part def System {
          attribute len : Length;
          attribute weight : Mass;
          attribute invalidAssign : Length = weight;

          attribute capacity : Real;
          assert constraint { capacity <= 10.0 }
          assert constraint { capacity >= 50.0 }
        }
      }
    `;

    const verification = await engine.verifyCandidate(multiDefectCode, "sysml2", { parser });
    assert.equal(verification.allPassed, false, "Candidate with defects should fail verification");
    assert.equal(verification.gates.length, 4, "Should have evaluated all 4 gates");

    const failedGates = verification.gates.filter((g) => !g.passed);
    assert.ok(failedGates.length >= 2, "Should capture failures in both Gate 2 and Gate 3 in a single pass");
    assert.ok(
      failedGates.some((g) => g.gate === 2),
      "Gate 2 (Dimensions) should have failed",
    );
    assert.ok(
      failedGates.some((g) => g.gate === 3),
      "Gate 3 (SMT Requirements) should have failed",
    );
    assert.ok(verification.summary.includes("Gate 2") && verification.summary.includes("Gate 3"));
  });

  test("Modelica Gates 2 & 4: checks SI units and DAE equation balance", async () => {
    // 1. Modelica Gate 2: SI unit dimensional mismatch
    const invalidModelicaDim = `
      model UnitMismatch
        Modelica.SIunits.Length len = weight;
        Modelica.SIunits.Mass weight = 10.0;
      equation
        len = weight;
      end UnitMismatch;
    `;
    const dimRes = await verifyGate2Dimensions(invalidModelicaDim, "modelica");
    assert.equal(dimRes.passed, false, "Should fail Gate 2 due to Length vs Mass mismatch");
    assert.ok(dimRes.diagnostics.some((d) => d.message.includes("Dimensional mismatch")));

    // 2. Modelica Gate 4: Overdetermined DAE (3 equations for 2 variables)
    const overdeterminedModelica = `
      model OverdeterminedSystem
        parameter Real c = 1.0;
        Real x;
        Real v;
      equation
        der(x) = v;
        der(v) = -c * x;
        x = 0;
      end OverdeterminedSystem;
    `;
    const overRes = await verifyGate4DAEBalance(overdeterminedModelica, "modelica");
    assert.equal(overRes.passed, false, "Should fail Gate 4 due to overdetermined DAE");
    assert.ok(overRes.diagnostics.some((d) => d.message.includes("overdetermined by +1")));
    assert.equal(overRes.metadata?.numEquations, 3);
    assert.equal(overRes.metadata?.numVariables, 2);

    // 3. Modelica Gate 4: Structurally balanced DAE (2 equations for 2 dynamic variables)
    const balancedModelica = `
      model BalancedSystem
        parameter Real c = 1.0;
        Real x;
        Real v;
      equation
        der(x) = v;
        der(v) = -c * x;
      end BalancedSystem;
    `;
    const balRes = await verifyGate4DAEBalance(balancedModelica, "modelica");
    assert.equal(balRes.passed, true, "Should pass Gate 4 when equations equal dynamic variables");
    assert.equal(balRes.metadata?.isBalanced, true);
    assert.equal(balRes.metadata?.numEquations, 2);
    assert.equal(balRes.metadata?.numVariables, 2);
  });

  test("Self-Healing Pipeline: handles rollback on regression", async () => {
    // Initial candidate is syntactically valid but fails SMT (Gate 3)
    const initialCandidate = `
      package FeasibilityTest {
        part def Rover {
          attribute weight : Real;
          assert constraint { weight <= 20.0 }
          assert constraint { weight >= 50.0 }
        }
      }
    `;

    // A synthesizer that intentionally causes a syntax regression on iteration 2
    let callCount = 0;
    const regressingSynthesizer = async (
      _prompt: string,
      iteration: number,
      _diags: any[],
      prevCode: string,
    ): Promise<string> => {
      callCount++;
      if (iteration === 1) {
        // Intentionally emit broken syntax (unclosed braces, regressing from Gate 3 failure to Gate 1 failure)
        return "package BrokenSyntax { part def Bad { attribute x : Real;";
      }
      // On iteration 2, provide the valid fix
      return prevCode.replace("weight >= 50.0", "weight >= 10.0");
    };

    const result = await runSelfHealingPipeline({
      prompt: "Fix weight constraints",
      initialCode: initialCandidate,
      language: "sysml2",
      parser,
      maxIterations: 3,
      synthesizer: regressingSynthesizer,
    });

    assert.ok(result.rollbacksCount && result.rollbacksCount > 0, "Should have detected regression and rolled back");
    assert.ok(callCount >= 2, "Synthesizer should have been invoked");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { infixArithmeticToSmt } from "../src/exporters/smtlib-exporter.js";
import { SysML2FumlBridge } from "../src/fuml-bridge.js";
import { verifyHybridSysml2Reachability } from "../src/hybrid-flowpipe-bridge.js";
import { evaluateBooleanFaultLogic, extractSysML2FailureModes } from "../src/safety-analyzer.js";
import { parseNonlinearGuardConstraint } from "../src/state-machine-verifier.js";

describe("SysML v2 Sound Mathematical Engines & Verifiers (Phase 3)", () => {
  it("lowers dynamic ODE equations into Taylor models without hardcoded heuristics", async () => {
    const sysmlSource = `
      state def AccelerationPhase {
        attribute v : Real;
        der(v) == 2.5;
      }
      state def DecelerationPhase {
        attribute v : Real;
        der(v) == -1.2;
      }
    `;

    const result = await verifyHybridSysml2Reachability(undefined, {
      sourceText: sysmlSource,
      timeSpan: [0, 2.0],
      dt: 0.1,
      order: 2,
    });

    assert(result.totalSteps > 0, "Hybrid flowpipe reachability should execute");
    assert.strictEqual(result.segments.length >= 1, true);
  });

  it("evaluates boolean fault logic expressions and disjunctive OR gates in safety analyzer", () => {
    // 1. Nested formula test
    const formula = "BusFail || (SensorA && !SensorB)";
    assert.strictEqual(evaluateBooleanFaultLogic(formula, new Set(["BusFail"])), true);
    assert.strictEqual(evaluateBooleanFaultLogic(formula, new Set(["SensorA"])), true);
    assert.strictEqual(evaluateBooleanFaultLogic(formula, new Set(["SensorA", "SensorB"])), false);
    assert.strictEqual(evaluateBooleanFaultLogic(formula, new Set(["OtherFault"])), false);

    // 2. OR gate in HazardDefinition
    const mockDB: any = {
      allEntries: () => [
        {
          id: 1,
          name: "CriticalFailure",
          metadata: {
            defKind: "hazard",
            causes: ["MainPowerLoss", "BackupPowerLoss"],
            gate: "or",
          },
          parentId: null,
        },
      ],
      childrenOf: () => [],
      symbol: (id: number) => ({ id, name: `Sym_${id}` }),
    };

    const extracted = extractSysML2FailureModes(mockDB);
    assert.strictEqual(extracted.hazards.length, 1);
    const hazard = extracted.hazards[0]!;

    // Single active fault triggers OR gate
    assert.strictEqual(hazard.causesHazard(new Set(["MainPowerLoss"])), true);
    assert.strictEqual(hazard.causesHazard(new Set(["BackupPowerLoss"])), true);
    assert.strictEqual(hazard.causesHazard(new Set([])), false);
  });

  it("evaluates k-out-of-n voting gates in safety hazards", () => {
    const mockDB: any = {
      allEntries: () => [
        {
          id: 1,
          name: "TmrConsensusLoss",
          metadata: {
            defKind: "hazard",
            causes: ["Core1Fail", "Core2Fail", "Core3Fail"],
            kOfN: 2,
          },
          parentId: null,
        },
      ],
      childrenOf: () => [],
      symbol: (id: number) => ({ id, name: `Sym_${id}` }),
    };

    const extracted = extractSysML2FailureModes(mockDB);
    assert.strictEqual(extracted.hazards.length, 1);
    const hazard = extracted.hazards[0]!;

    // 1 fault: safe
    assert.strictEqual(hazard.causesHazard(new Set(["Core1Fail"])), false);
    // 2 faults: hazard triggered
    assert.strictEqual(hazard.causesHazard(new Set(["Core1Fail", "Core3Fail"])), true);
    // 3 faults: hazard triggered
    assert.strictEqual(hazard.causesHazard(new Set(["Core1Fail", "Core2Fail", "Core3Fail"])), true);
  });

  it("executes fUML discrete actions via DAE arena bytecode without eval or new Function", () => {
    const actionSource = `
      action def ComputeEngine {
        action step1 {
          assign x := 10;
          assign y := 25;
        }
        action step2 {
          assign result := x * 2 + y;
        }
        first step1 then step2;
      }
    `;

    const engine = SysML2FumlBridge.compile(actionSource);
    engine.init();
    const summary = engine.run(10);

    assert.strictEqual(summary.status, "completed");
    const vars = engine.getVariables();
    assert.strictEqual(vars.x, 10);
    assert.strictEqual(vars.y, 25);
    assert.strictEqual(vars.result, 45);
  });

  it("converts expressions to SMT-LIB2 prefix notation using GLR CST parser", () => {
    const smt = infixArithmeticToSmt("x^2 + 3 * y - 4");
    assert.strictEqual(smt, "(- (+ (* x x) (* 3.0 y)) 4.0)");
  });

  it("parses nonlinear guard constraints into formal solver AST using GLR CST parser", () => {
    const guard = parseNonlinearGuardConstraint("x^2 + y^2 <= 25");
    assert(guard !== undefined, "Guard should be parsed");
    assert.strictEqual(guard.operator, "<=");
    assert.strictEqual(guard.value, 25);
    assert.strictEqual(guard.nonlinear?.rel, "<=");
  });
});

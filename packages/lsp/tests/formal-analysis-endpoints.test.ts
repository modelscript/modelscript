// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanonicalTraceRecord } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

test("LSP Analysis Endpoints: Formal MC/DC, Counterexample Diff, and Contract Hierarchy", async (t) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const docUri = "file:///workspace/Governor.sysml";
  const docContent = `
action def SpeedGovernor {
  in item speed : Real;
  out item brakePower : Real;
  if (speed <= 50.0) {
    assign brakePower := 0.0;
  } else {
    assign brakePower := 1.0;
  }
}
`;

  const doc = TextDocument.create(docUri, "sysml2", 1, docContent);
  const mockDocuments: any = {
    get: (uri: string) => (uri === docUri ? doc : undefined),
  };

  const mockContext: any = {
    connection: mockConnection,
    documents: mockDocuments,
    workspaceManager: {},
    validationService: {
      validateTextDocument: async () => {},
    },
  };

  registerAnalysisEndpoints(mockContext);

  await t.test("should execute modelscript/runMcdcTests endpoint and produce execution report", async () => {
    const handler = handlers.get("modelscript/runMcdcTests");
    assert.ok(handler, "modelscript/runMcdcTests handler must be registered");

    const result = await handler({
      uri: docUri,
      actionName: "SpeedGovernor",
      domainBounds: { speed: [0, 100] },
      outputVarName: "brakePower",
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.report, "Must return execution report");
    assert.ok(result.report.totalTests > 0, "Must have synthesized test cases");
    assert.strictEqual(result.report.failed, 0, "All tests should pass");
    assert.strictEqual(result.report.passed, result.report.totalTests);
    assert.ok(result.coverageMetrics.totalRegions >= 2);
  });

  await t.test(
    "should compute counterexample divergence and sync traces in modelscript/getCounterexampleDiff",
    async () => {
      const handler = handlers.get("modelscript/getCounterexampleDiff");
      assert.ok(handler, "modelscript/getCounterexampleDiff handler must be registered");

      const times = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
      const cexTrace: CanonicalTraceRecord = {
        id: "cex-01",
        source: "falsification",
        status: "FALSIFIED",
        times,
        continuousSignals: {
          speed: [10, 20, 30, 42, 65, 88, 110], // Diverges past t = 1.5
        },
        violatingTimeIndex: 4, // t = 2.0s
        violatingProperty: "speed <= 50.0",
      };

      const nomTrace: CanonicalTraceRecord = {
        id: "nom-01",
        source: "falsification",
        status: "CERTIFIED_SAFE",
        times,
        continuousSignals: {
          speed: [10, 20, 30, 40, 45, 48, 50],
        },
      };

      const result = await handler({
        counterexample: cexTrace,
        nominal: nomTrace,
        tolerance: 1.0,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.divergingVariable, "speed");
      assert.ok(result.divergenceTime !== undefined && result.divergenceTime >= 1.5);
      assert.ok(result.maxDivergence.delta >= 60.0);
      assert.ok(result.diffSignals["speed"].length === times.length);
    },
  );

  await t.test(
    "should compute compositional contract refinement tree in modelscript/getContractHierarchy",
    async () => {
      const handler = handlers.get("modelscript/getContractHierarchy");
      assert.ok(handler, "modelscript/getContractHierarchy handler must be registered");

      const result = await handler({
        uri: docUri,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.hierarchy, "Must return hierarchy");
      assert.strictEqual(result.hierarchy.isRefined, true);
      assert.strictEqual(result.hierarchy.isCompatible, true);
      assert.ok(result.hierarchy.system.name.includes("Powertrain"));
      assert.strictEqual(result.hierarchy.components.length, 2);
    },
  );

  await t.test(
    "should synthesize quadratic SOS barrier certificate in modelscript/checkBarrierCertificate",
    async () => {
      const handler = handlers.get("modelscript/checkBarrierCertificate");
      assert.ok(handler, "modelscript/checkBarrierCertificate handler must be registered");

      const result = await handler({
        uri: docUri,
        initialRadius: 1.0,
        unsafeRadius: 3.0,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isCertifiedSafe, true);
      assert.strictEqual(result.degree, 2);
      assert.ok(result.summary.includes("SOS Barrier Certificate"));
    },
  );

  await t.test("should verify assume-guarantee contract algebra in modelscript/checkSymbolicContracts", async () => {
    const handler = handlers.get("modelscript/checkSymbolicContracts");
    assert.ok(handler, "modelscript/checkSymbolicContracts handler must be registered");

    const contractA = {
      name: "Sensor",
      assumptions: ["v >= 0.0"],
      guarantees: ["out <= 100.0"],
    };
    const contractB = {
      name: "Controller",
      assumptions: ["out <= 100.0"],
      guarantees: ["actuator >= 0.0"],
    };

    const pairResult = await handler({
      pair: {
        guaranteeContract: contractA,
        assumptionContract: contractB,
      },
    });

    assert.strictEqual(pairResult.success, true);
    assert.ok(pairResult.summary !== undefined);
  });

  await t.test(
    "should verify decision logic coverage and disjointness in modelscript/verifyDecisionLogic",
    async () => {
      const handler = handlers.get("modelscript/verifyDecisionLogic");
      assert.ok(handler, "modelscript/verifyDecisionLogic handler must be registered");

      const result = await handler({
        branches: [
          { id: "b1", guardText: "speed <= 50.0" },
          { id: "b2", guardText: "speed > 50.0" },
        ],
        domainBounds: { speed: [0, 120] },
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.result !== undefined);
    },
  );

  await t.test("should decompose input space into regions in modelscript/decomposeRegions", async () => {
    const handler = handlers.get("modelscript/decomposeRegions");
    assert.ok(handler, "modelscript/decomposeRegions handler must be registered");

    const condition = {
      expr: { kind: "var", name: "speed" },
      rel: "<=",
      rhs: 50,
    };

    const result = await handler({
      conditions: [condition],
      domainBounds: { speed: [0, 100] },
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.result !== undefined);
    assert.strictEqual(result.result.totalRegions, 2);
  });

  await t.test(
    "should synthesize boundary test suite with CTRF, JUnit, and Modelica formats in modelscript/generateBoundaryTests",
    async () => {
      const handler = handlers.get("modelscript/generateBoundaryTests");
      assert.ok(handler, "modelscript/generateBoundaryTests handler must be registered");

      const decompHandler = handlers.get("modelscript/decomposeRegions");
      const decompRes = await decompHandler!({
        conditions: [{ expr: { kind: "var", name: "speed" }, rel: "<=", rhs: 50 }],
        domainBounds: { speed: [0, 100] },
      });

      const ctrfRes = await handler({
        decomposition: decompRes.result,
        suiteName: "GovernorBoundarySuite",
        format: "ctrf",
      });
      assert.strictEqual(ctrfRes.success, true);
      assert.ok(ctrfRes.formattedOutput?.includes('"report"'));

      const junitRes = await handler({
        decomposition: decompRes.result,
        format: "junit",
      });
      assert.strictEqual(junitRes.success, true);
      assert.ok(junitRes.formattedOutput?.includes("<testsuite"));

      const mosRes = await handler({
        decomposition: decompRes.result,
        format: "modelica",
        modelName: "GovernorModel",
      });
      assert.strictEqual(mosRes.success, true);
      assert.ok(mosRes.formattedOutput?.includes("simulate(GovernorModel"));
    },
  );

  await t.test("should verify system-level contract composition in modelscript/checkSymbolicContracts", async () => {
    const handler = handlers.get("modelscript/checkSymbolicContracts");
    assert.ok(handler, "modelscript/checkSymbolicContracts handler must be registered");

    const systemContract = {
      name: "VehicleSystem",
      assumptions: ["v >= 0.0"],
      guarantees: ["power <= 200.0"],
    };
    const comp1 = {
      name: "PedalSensor",
      assumptions: ["v >= 0.0"],
      guarantees: ["cmd <= 100.0"],
    };
    const comp2 = {
      name: "MotorController",
      assumptions: ["cmd <= 100.0"],
      guarantees: ["power <= 200.0"],
    };

    const result = await handler({
      systemContract,
      componentContracts: [comp1, comp2],
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.summary !== undefined);
  });

  await t.test("should extract multi-FMU participants and couplings in modelscript/extractCosimGraph", async () => {
    const handler = handlers.get("modelscript/extractCosimGraph");
    assert.ok(handler, "modelscript/extractCosimGraph handler must be registered");

    const wrapperSource = `
model TwoBodyCoupled
  SineGenerator gen(fileName="Sine.fmu");
  Actuator act(fileName="Actuator.fmu");
equation
  connect(gen.y, act.u);
end TwoBodyCoupled;
`;

    const result = await handler({
      uri: "file:///workspace/TwoBodyCoupled.mo",
      text: wrapperSource,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.participants.length, 2);
    assert.strictEqual(result.participants[0].id, "gen");
    assert.strictEqual(result.participants[0].type, "fmu");
    assert.strictEqual(result.participants[0].fileName, "Sine.fmu");
    assert.strictEqual(result.couplings.length, 1);
    assert.strictEqual(result.couplings[0].from.participantId, "gen");
    assert.strictEqual(result.couplings[0].from.variable, "y");
    assert.strictEqual(result.couplings[0].to.participantId, "act");
    assert.strictEqual(result.couplings[0].to.variable, "u");
  });
});

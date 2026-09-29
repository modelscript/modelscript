// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { analyzeInterproceduralCfa, extractActivityGraphsFromText } from "../src/activity-cfa.js";

describe("SysML v2 Inter-procedural Activity CFA & Pin Contracts", () => {
  it("verifies sound hierarchical sub-activity invocation with fulfilled pin contracts", () => {
    const sysml = `
      action def FilterData {
        in item raw : Real;
        out item filtered : Real;
        assign filtered := raw * 0.5;
      }

      action def ProcessData {
        in item val : Real;
        out item result : Real;
        assign result := val + 10.0;
      }

      action def Pipeline {
        in item inputData : Real;
        out item outputData : Real;

        action f : FilterData;
        action p : ProcessData;

        first f then p;
        flow from inputData to f.raw;
        flow from f.filtered to p.val;
        flow from p.result to outputData;
      }
    `;

    const graphs = extractActivityGraphsFromText(sysml);
    assert.strictEqual(graphs.size, 3);
    assert(graphs.has("FilterData"));
    assert(graphs.has("ProcessData"));
    assert(graphs.has("Pipeline"));

    const res = analyzeInterproceduralCfa(graphs, "Pipeline");
    assert.strictEqual(
      res.isSound,
      true,
      `Expected sound inter-procedural CFA, got: ${JSON.stringify(res.diagnostics)}`,
    );
    assert.strictEqual(res.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Call graph checks
    const pipelineCallees = res.callGraph.get("Pipeline") || [];
    assert(pipelineCallees.includes("FilterData"));
    assert(pipelineCallees.includes("ProcessData"));
  });

  it("detects unfulfilled required callee input pin", () => {
    const sysml = `
      action def FilterData {
        in item raw : Real;
        in item threshold : Real;
        out item filtered : Real;
        assign filtered := raw;
      }

      action def Pipeline {
        in item inputData : Real;
        out item outputData : Real;

        action f : FilterData;
        flow from inputData to f.raw;
        // Missing flow to f.threshold!
        flow from f.filtered to outputData;
      }
    `;

    const graphs = extractActivityGraphsFromText(sysml);
    const res = analyzeInterproceduralCfa(graphs);

    assert.strictEqual(res.isSound, false);
    const missingInputDiag = res.diagnostics.find(
      (d) => d.rule === "unfulfilled-callee-input" && d.message.includes("threshold"),
    );
    assert(missingInputDiag, "Should detect unfulfilled required input pin 'threshold'");
  });

  it("detects reference to non-existent callee pin", () => {
    const sysml = `
      action def SimpleWorker {
        in item taskIn : Real;
        out item taskOut : Real;
      }

      action def MainPipeline {
        in item startVal : Real;
        out item finalVal : Real;

        action w : SimpleWorker;
        flow from startVal to w.taskIn;
        flow from w.bogusOutput to finalVal;
      }
    `;

    const graphs = extractActivityGraphsFromText(sysml);
    const res = analyzeInterproceduralCfa(graphs);

    assert.strictEqual(res.isSound, false);
    const invalidPinDiag = res.diagnostics.find(
      (d) => d.rule === "unresolved-callee-pin" && d.message.includes("bogusOutput"),
    );
    assert(invalidPinDiag, "Should flag flow reading non-existent pin 'bogusOutput'");
  });

  it("detects cyclic activity invocations in call graph", () => {
    const sysml = `
      action def ActivityA {
        in item x : Real;
        out item y : Real;
        action callB : ActivityB;
        flow from x to callB.inB;
        flow from callB.outB to y;
      }

      action def ActivityB {
        in item inB : Real;
        out item outB : Real;
        action callA : ActivityA;
        flow from inB to callA.x;
        flow from callA.y to outB;
      }
    `;

    const graphs = extractActivityGraphsFromText(sysml);
    const res = analyzeInterproceduralCfa(graphs);

    assert.strictEqual(res.isSound, false);
    const cycleDiag = res.diagnostics.find((d) => d.rule === "cyclic-activity-invocation");
    assert(cycleDiag, "Should flag cyclic activity invocation cycle ActivityA <-> ActivityB");
  });

  it("propagates callee unsoundness to caller activity", () => {
    const sysml = `
      action def BrokenWorker {
        in item x : Real;
        out item y : Real;
        decide d1;
        action pathA;
        action pathB;
        join j1;
        // Decision to join deadlock inside BrokenWorker!
        first d1 then pathA;
        first d1 then pathB;
        first pathA then j1;
        first pathB then j1;
      }

      action def MasterPipeline {
        in item inVal : Real;
        out item outVal : Real;

        action worker : BrokenWorker;
        flow from inVal to worker.x;
        flow from worker.y to outVal;
      }
    `;

    const graphs = extractActivityGraphsFromText(sysml);
    const res = analyzeInterproceduralCfa(graphs);

    assert.strictEqual(res.isSound, false);
    const depDiag = res.diagnostics.find((d) => d.rule === "unsound-callee-dependency" && d.nodeName === "worker");
    assert(depDiag, "Should flag dependency on unsound activity BrokenWorker");
  });
});

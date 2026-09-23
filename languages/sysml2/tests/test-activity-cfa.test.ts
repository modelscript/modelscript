// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeActivityCfa,
  extractActivityGraphFromQueryDB,
  extractActivityGraphFromText,
} from "../src/activity-cfa.js";
import { checkActivitySoundness } from "../src/activity-soundness.js";

describe("SysML v2 Comprehensive Activity Control & Data Flow Analysis (CFA/DFA)", () => {
  it("should pass CFA for a valid concurrent workflow with fork and join", () => {
    const sysml = `
      action def DataProcessingPipeline {
        action IngestData {
          out payload : Real;
          assign payload := 100.0;
        }
        fork f1;
        action FilterAlpha {
          in payload : Real;
          out alphaScore : Real;
          assign alphaScore := payload * 0.5;
        }
        action FilterBeta {
          in payload : Real;
          out betaScore : Real;
          assign betaScore := payload * 0.8;
        }
        join j1;
        action AggregateMetrics {
          out totalResult : Real;
          assign totalResult := 150.0;
        }

        first IngestData then f1;
        first f1 then FilterAlpha;
        first f1 then FilterBeta;
        first FilterAlpha then j1;
        first FilterBeta then j1;
        first j1 then AggregateMetrics;
      }
    `;

    const graph = extractActivityGraphFromText(sysml);
    assert.strictEqual(graph.nodes.length, 6);
    assert.strictEqual(graph.flows.length, 6);

    const res = analyzeActivityCfa(graph);
    assert.strictEqual(res.isSound, true);
    assert.strictEqual(res.deadlockNodes.length, 0);
    assert.strictEqual(res.unreachableActions.length, 0);
    assert.strictEqual(res.unassignedOutputs.length, 0);
  });

  it("should detect path-sensitive unassigned output variables", () => {
    const sysml = `
      action def SensorCalibration {
        action ReadRaw;
        decide d1;
        action FastPath {
          out calibratedTemp : Real;
          assign calibratedTemp := 25.0;
        }
        action SlowPath {
          // Missing assignment to calibratedTemp!
        }
        merge m1;

        first ReadRaw then d1;
        first d1 then FastPath;
        first d1 then SlowPath;
        first FastPath then m1;
        first SlowPath then m1;
      }
    `;

    const res = checkActivitySoundness(sysml);
    assert.strictEqual(res.isSound, false);
    assert.ok(res.unassignedOutputs.includes("calibratedTemp"));
    assert.ok(res.diagnostics.some((d) => d.rule === "definite-output-assignment"));
  });

  it("should detect use-before-def / uninitialized variable reads", () => {
    const sysml = `
      action def ComputeEngine {
        action Step1 {
          out finalMetric : Real;
          // Reading finalMetric before it was assigned!
          assign result := finalMetric + 10.0;
        }
      }
    `;

    const graph = extractActivityGraphFromText(sysml);
    const res = analyzeActivityCfa(graph);
    assert.ok(res.uninitializedReads.length > 0);
    assert.strictEqual(res.uninitializedReads[0]?.variable, "finalMetric");
    assert.ok(res.diagnostics.some((d) => d.rule === "use-before-def"));
  });

  it("should detect join-decide deadlock without intervening merge", () => {
    const sysml = `
      action def RouteOptimizer {
        action Start;
        decide dRoute;
        action RouteA;
        action RouteB;
        join jSync;
        action End;

        first Start then dRoute;
        first dRoute then RouteA;
        first dRoute then RouteB;
        first RouteA then jSync;
        first RouteB then jSync;
        first jSync then End;
      }
    `;

    const res = checkActivitySoundness(sysml);
    assert.strictEqual(res.isSound, false);
    assert.ok(res.deadlockNodes.includes("jSync"));
    assert.ok(res.diagnostics.some((d) => d.rule === "join-decide-deadlock"));
  });

  it("should detect unreachable actions disconnected from control flow", () => {
    const sysml = `
      action def Worker {
        action ActiveTask;
        action OrphanTask;

        first ActiveTask then ActiveTask;
      }
    `;

    const res = checkActivitySoundness(sysml);
    assert.ok(res.unreachableActions.includes("OrphanTask"));
    assert.ok(res.diagnostics.some((d) => d.rule === "unreachable-action"));
  });

  it("should evaluate activity soundness directly on QueryDB symbol entries", () => {
    // Mock QueryDB with action and control node children
    const rootSymbol = {
      id: 1,
      name: "PipelineDef",
      ruleName: "ActionDefinition",
      kind: "Definition",
      startByte: 0,
      endByte: 100,
    } as any;

    const children: any[] = [
      { id: 2, parentId: 1, name: "Step1", ruleName: "ActionUsage", kind: "Usage", startByte: 10, endByte: 30 },
      { id: 3, parentId: 1, name: "Step2", ruleName: "ActionUsage", kind: "Usage", startByte: 35, endByte: 55 },
      {
        id: 4,
        parentId: 1,
        name: "first Step1 then Step2",
        ruleName: "SuccessionAsUsage",
        kind: "Usage",
        startByte: 60,
        endByte: 85,
      },
    ];

    const mockDb: any = {
      childrenOf: (id: number) => (id === 1 ? children : []),
      cstText: (_s: number, _e: number, sym: any) => sym?.name || "",
      cstNode: () => null,
      allEntries: () => [rootSymbol, ...children],
      byName: (name: string) => (name === "PipelineDef" ? [rootSymbol] : children.filter((c) => c.name === name)),
    };

    const graph = extractActivityGraphFromQueryDB(mockDb, rootSymbol);
    assert.strictEqual(graph.nodes.length, 2);
    assert.strictEqual(graph.flows.length, 1);
    assert.strictEqual(graph.flows[0]?.source, "Step1");
    assert.strictEqual(graph.flows[0]?.target, "Step2");

    const res = analyzeActivityCfa(graph);
    assert.strictEqual(res.isSound, true);
    assert.strictEqual(res.deadlockNodes.length, 0);
  });
});

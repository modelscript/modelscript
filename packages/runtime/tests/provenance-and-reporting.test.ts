// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { ProvenanceGraph } from "../src/interop/provenance.js";
import { generateHtmlReport, type HtmlReportInput } from "../src/util/html_reporter.js";

test("ProvenanceGraph & Verification HTML Dashboard Reporter", async (t) => {
  await t.test("ProvenanceGraph: entity, activity, and agent lifecycle", () => {
    const graph = new ProvenanceGraph();

    const hash1 = ProvenanceGraph.hashContent("model AircraftEngine end AircraftEngine;");
    const hash2 = ProvenanceGraph.hashContent(new TextEncoder().encode("binary content payload"));
    assert.ok(hash1.startsWith("sha256:"));
    assert.ok(hash2.startsWith("sha256:"));

    graph.addAgent({
      id: "agent:analyst-01",
      type: "Person",
      name: "Lead Flight Systems Engineer",
      actedOnBehalfOf: "agent:aero-corp",
    });

    graph.addEntity({
      id: "req:thrust-01",
      type: "SystemRequirement",
      label: "Takeoff Thrust >= 120kN",
      contentHash: hash1,
      attributes: { safetyLevel: "DAL-A" },
    });

    graph.addEntity({
      id: "model:engine-flown",
      type: "SimulationModel",
      label: "AircraftEngine.mo",
      contentHash: hash2,
      wasAttributedTo: "agent:analyst-01",
    });

    assert.strictEqual(graph.getAgent("agent:analyst-01")?.name, "Lead Flight Systems Engineer");
    assert.strictEqual(graph.getEntity("req:thrust-01")?.type, "SystemRequirement");

    graph.recordActivity(
      "act:flown-simulation",
      "DynamicSimulation",
      "agent:analyst-01",
      ["req:thrust-01"],
      ["model:engine-flown"],
      { solver: "SundialsCVODE", tolerance: 1e-6 },
    );

    const activity = graph.getActivity("act:flown-simulation");
    assert.ok(activity);
    assert.strictEqual(activity.type, "DynamicSimulation");
    assert.deepStrictEqual(activity.used, ["req:thrust-01"]);

    const derivedEntity = graph.getEntity("model:engine-flown");
    assert.strictEqual(derivedEntity?.wasGeneratedBy, "act:flown-simulation");
    assert.ok(derivedEntity?.wasDerivedFrom?.includes("req:thrust-01"));

    const lineage = graph.verifyLineage("model:engine-flown");
    assert.strictEqual(lineage.isValid, true);
    assert.ok(lineage.chain.includes("model:engine-flown"));
    assert.ok(lineage.chain.includes("req:thrust-01"));
    assert.deepStrictEqual(lineage.rootEntities, ["req:thrust-01"]);

    const jsonLd = graph.toJsonLd();
    assert.ok(jsonLd.includes("http://www.w3.org/ns/prov#"));
    assert.ok(jsonLd.includes("agent:analyst-01"));
    assert.ok(jsonLd.includes("act:flown-simulation"));
    assert.ok(jsonLd.includes("model:engine-flown"));
  });

  await t.test("generateHtmlReport: generates comprehensive verification dashboard", () => {
    const reportData: HtmlReportInput = {
      timestamp: "2026-10-08T18:00:00Z",
      target: "Modelica.Fluid.Examples.HeatExchanger",
      summary: {
        totalStages: 3,
        passedStages: 2,
        failedStages: 1,
        certifiedStages: 1,
        skippedStages: 0,
        totalViolations: 1,
        durationMs: 4520,
        overallPassed: false,
      },
      stages: {
        stage1: {
          stage: "units",
          name: "Dimensional Consistency Verification",
          passed: true,
          certified: true,
          durationMs: 320,
          summary: "All 142 algebraic equations dimensionally coherent.",
        },
        stage2: {
          stage: "reachability",
          name: "Flowpipe Reachability & Envelope Invariant",
          passed: false,
          certified: false,
          durationMs: 2400,
          summary: "Peak temperature exceeded safety corridor by 4.2K.",
          violations: [
            {
              id: "VIOL-HEAT-01",
              message: "Max fluid temperature 377.2K violates corridor ceiling 373.0K",
              severity: "error",
              location: { uri: "file:///models/HeatExchanger.mo", line: 42, column: 15 },
              witness: { time: 1.45, state: { T: 377.2, p: 101325 } },
            },
          ],
        },
        stage3: {
          stage: "tearing",
          name: "Algebraic Loop Solvability",
          passed: true,
          certified: false,
          durationMs: 1800,
          summary: "BLT blocks 1-14 partitioned cleanly with zero singular Jacobians.",
        },
      },
    };

    const html = generateHtmlReport(reportData, "Thermal Safety Certification");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Thermal Safety Certification"));
    assert.ok(html.includes("VIOLATIONS DETECTED"));
    assert.ok(html.includes("Dimensional Consistency Verification"));
    assert.ok(html.includes("CERTIFIED"));
    assert.ok(html.includes("Max fluid temperature"));
    assert.ok(html.includes("377.2K"));

    // Also test all-pass condition
    reportData.summary.overallPassed = true;
    reportData.summary.failedStages = 0;
    reportData.summary.totalViolations = 0;
    reportData.stages["stage2"]!.passed = true;
    reportData.stages["stage2"]!.violations = [];
    const htmlPass = generateHtmlReport(reportData);
    assert.ok(htmlPass.includes("ALL CERTIFIED / PASSED"));
  });

  await t.test("IndexedDbSnapshotStore: in-memory and indexedDB fallback", async () => {
    const { IndexedDbSnapshotStore } = await import("../src/config/indexeddb_snapshot.js");
    const store = new IndexedDbSnapshotStore("test_db", "test_store");

    const sampleData = new Uint8Array([1, 2, 3, 4, 5]);
    await store.saveSnapshot("snapshot_1", sampleData, { workspaceFqnMap: { "Modelica.Blocks": 42 } });

    const loaded = await store.loadSnapshot("snapshot_1");
    assert.ok(loaded);
    assert.strictEqual(loaded.version, 2);
    assert.deepStrictEqual(loaded.data, sampleData);
    assert.strictEqual(loaded.workspaceFqnMap?.["Modelica.Blocks"], 42);

    const nonExistent = await store.loadSnapshot("does_not_exist");
    assert.strictEqual(nonExistent, null);

    await store.deleteSnapshot("snapshot_1");
    const afterDelete = await store.loadSnapshot("snapshot_1");
    assert.strictEqual(afterDelete, null);

    // Test with mock globalThis.indexedDB
    const fakeStore = new Map<string, any>();
    const mockDb = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({
          put: (rec: any, k: string) => fakeStore.set(k, rec),
          get: (k: string) => ({
            onsuccess: null as any,
            onerror: null as any,
            result: fakeStore.get(k),
          }),
          delete: (k: string) => fakeStore.delete(k),
        }),
      }),
    };

    const originalIdb = (globalThis as any).indexedDB;
    try {
      (globalThis as any).indexedDB = {
        open: () => {
          const req: any = {
            onsuccess: null,
            onerror: null,
            result: mockDb,
          };
          setTimeout(() => {
            if (req.onupgradeneeded) req.onupgradeneeded();
            if (req.onsuccess) req.onsuccess();
          }, 0);
          return req;
        },
      };

      const idbStore = new IndexedDbSnapshotStore("idb_test", "idb_store");
      await idbStore.saveSnapshot("k1", sampleData);
      assert.ok(fakeStore.has("k1"));

      // Bypass in-memory cache to test IDB read
      (idbStore as any).memoryCache.clear();
      // Since fake IDB get handler triggers synchronously or asynchronously:
      mockDb.transaction = () =>
        ({
          objectStore: () => ({
            put: (rec: any, k: string) => fakeStore.set(k, rec),
            get: (k: string) => {
              const req: any = { result: fakeStore.get(k) };
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            delete: (k: string) => fakeStore.delete(k),
          }),
        }) as any;

      const loadedFromIdb = await idbStore.loadSnapshot("k1");
      assert.ok(loadedFromIdb);
      assert.deepStrictEqual(loadedFromIdb.data, sampleData);

      await idbStore.deleteSnapshot("k1");
      assert.strictEqual(fakeStore.has("k1"), false);
    } finally {
      (globalThis as any).indexedDB = originalIdb;
    }
  });
});

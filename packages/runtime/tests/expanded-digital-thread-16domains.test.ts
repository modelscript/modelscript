// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  bindBomToManufacturingThread,
  bindGdtToCadThread,
  bindSafetyToRequirementThread,
  bindTelemetryToSimulationThread,
  DigitalThreadHypergraph,
  MAX_THREAD_DOMAINS,
  THREAD_STRIDE,
  ThreadDomain,
  ThreadRelation,
} from "../src/interop/thread_hypergraph.js";
import { ThreadSerializer } from "../src/interop/thread_serializer.js";

describe("Expanded 16-Domain Digital Thread Hypergraph & Typed Relations", () => {
  it("verifies linear-memory constants: 16 domains, 22-word stride", () => {
    assert.strictEqual(MAX_THREAD_DOMAINS, 16);
    assert.strictEqual(THREAD_STRIDE, 22);
  });

  it("binds and retrieves across all 16 lifecycle domains", () => {
    const hg = new DigitalThreadHypergraph(32);
    const slot = hg.createThread(1001, 1, ThreadRelation.Aligned, 0);

    // Bind every domain 0..15
    for (let d = 0; d < 16; d++) {
      hg.bindDomainNode(slot, d, (d + 1) * 100);
    }

    // Verify all 16 domain nodes
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.SysML2), 100);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Modelica), 200);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.CAD), 300);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Requirements), 400);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.FEA), 500);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.CFD), 600);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.BOM), 700);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.FMU), 800);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.GDT), 900);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Telemetry), 1000);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Safety), 1100);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Surrogate), 1200);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Manufacturing), 1300);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.CostCarbon), 1400);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Verification), 1500);
    assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Software), 1600);

    const rec = hg.getRecord(slot);
    assert.ok(rec);
    assert.strictEqual(rec.domainMask, 0xffff); // All 16 bits set
    assert.strictEqual(Object.keys(rec.domainNodes).length, 16);
  });

  it("manages typed relational edges across thread slots", () => {
    const hg = new DigitalThreadHypergraph();

    const s1 = hg.createThread(1, 0, ThreadRelation.Verifies);
    const s2 = hg.createThread(2, 0, ThreadRelation.Calibrates);
    const s3 = hg.createThread(3, 0, ThreadRelation.Manufactures);

    assert.strictEqual(hg.getRelation(s1), ThreadRelation.Verifies);
    assert.strictEqual(hg.getRelation(s2), ThreadRelation.Calibrates);
    assert.strictEqual(hg.getRelation(s3), ThreadRelation.Manufactures);

    hg.setRelation(s1, ThreadRelation.Satisfies);
    assert.strictEqual(hg.getRelation(s1), ThreadRelation.Satisfies);
  });

  it("supports branch forking and variant merging for trade studies", () => {
    const hg = new DigitalThreadHypergraph();

    // Main baseline branch (branchId = 0)
    const s0 = hg.createThread(10, 1, ThreadRelation.Aligned, 0);
    hg.bindDomainNode(s0, ThreadDomain.SysML2, 101);
    hg.bindDomainNode(s0, ThreadDomain.CAD, 201);
    hg.bindDomainNode(s0, ThreadDomain.FEA, 301);

    // Fork to branch 1 (e.g. Titanium variant)
    const clonedCount = hg.forkBranch(0, 1);
    assert.strictEqual(clonedCount, 1);

    const branch1Slot = hg.findSlotByThreadId(10 + 1_000_000);
    assert.notStrictEqual(branch1Slot, undefined);
    assert.strictEqual(hg.getBranch(branch1Slot!), 1);
    assert.strictEqual(hg.getDomainNode(branch1Slot!, ThreadDomain.FEA), 301);

    // Update branch 1 FEA deck to new titanium mesh (node 399)
    hg.bindDomainNode(branch1Slot!, ThreadDomain.FEA, 399);
    hg.setRelation(branch1Slot!, ThreadRelation.Verifies);

    // Merge branch 1 back into branch 0
    const mergeRes = hg.mergeBranch(1, 0);
    assert.strictEqual(mergeRes.mergedCount, 1);
    assert.strictEqual(mergeRes.conflictCount, 0);

    // Baseline slot now has updated node and relation
    assert.strictEqual(hg.getDomainNode(s0, ThreadDomain.FEA), 399);
    assert.strictEqual(hg.getRelation(s0), ThreadRelation.Verifies);
  });

  it("calculates blast radius filtered by branch and relation", () => {
    const hg = new DigitalThreadHypergraph();

    // Thread 1 on Branch 0: SysML -> CAD
    const s1 = hg.createThread(1, 0, ThreadRelation.DerivesFrom, 0);
    hg.bindDomainNode(s1, ThreadDomain.SysML2, 10);
    hg.bindDomainNode(s1, ThreadDomain.CAD, 20);

    // Thread 2 on Branch 0: CAD -> FEA
    const s2 = hg.createThread(2, 0, ThreadRelation.Verifies, 0);
    hg.bindDomainNode(s2, ThreadDomain.CAD, 20);
    hg.bindDomainNode(s2, ThreadDomain.FEA, 30);

    // Thread 3 on Branch 1 (Variant): CAD -> CFD
    const s3 = hg.createThread(3, 0, ThreadRelation.Verifies, 1);
    hg.bindDomainNode(s3, ThreadDomain.CAD, 20);
    hg.bindDomainNode(s3, ThreadDomain.CFD, 40);

    // Blast radius on Branch 0 should NOT include Thread 3 (Branch 1)
    const resBranch0 = hg.computeBlastRadius(ThreadDomain.SysML2, 10, { branchId: 0 });
    assert.strictEqual(resBranch0.impactedThreads.includes(1), true);
    assert.strictEqual(resBranch0.impactedThreads.includes(2), true);
    assert.strictEqual(resBranch0.impactedThreads.includes(3), false);

    // Blast radius without branch filter includes all
    const resAll = hg.computeBlastRadius(ThreadDomain.SysML2, 10);
    assert.strictEqual(resAll.impactedThreads.length, 3);

    // Blast radius with relation filter (only Verifies)
    const resVerifies = hg.computeBlastRadius(ThreadDomain.SysML2, 10, { filterRelation: ThreadRelation.Verifies });
    assert.strictEqual(resVerifies.impactedThreads.includes(1), false);
    assert.strictEqual(resVerifies.impactedThreads.includes(2), true);
  });

  it("serializes and deserializes 16-domain threads with relations and branches", () => {
    const hg = new DigitalThreadHypergraph();

    const slot = hg.createThread(777, 3, ThreadRelation.Calibrates, 2);
    hg.bindDomainNode(slot, ThreadDomain.Telemetry, 100);
    hg.bindDomainNode(slot, ThreadDomain.Modelica, 200);
    hg.bindDomainNode(slot, ThreadDomain.GDT, 300);
    hg.bindDomainNode(slot, ThreadDomain.Safety, 400);

    const json = ThreadSerializer.serialize(hg, { project: "AeroTelemetry" });
    assert.ok(json.includes("Calibrates"));
    assert.ok(json.includes("telemetry"));
    assert.ok(json.includes("gdt"));
    assert.ok(json.includes("safety"));

    const restored = ThreadSerializer.deserialize(json);
    assert.strictEqual(restored.getThreadCount(), 1);

    const restoredSlot = restored.findSlotByThreadId(777);
    assert.notStrictEqual(restoredSlot, undefined);
    assert.strictEqual(restored.getRelation(restoredSlot!), ThreadRelation.Calibrates);
    assert.strictEqual(restored.getBranch(restoredSlot!), 2);
    assert.strictEqual(restored.getDomainNode(restoredSlot!, ThreadDomain.Telemetry), 100);
    assert.strictEqual(restored.getDomainNode(restoredSlot!, ThreadDomain.Modelica), 200);
    assert.strictEqual(restored.getDomainNode(restoredSlot!, ThreadDomain.GDT), 300);
    assert.strictEqual(restored.getDomainNode(restoredSlot!, ThreadDomain.Safety), 400);
  });

  it("verifies specialized domain helper binding functions", () => {
    const hg = new DigitalThreadHypergraph();

    const gdtSlot = bindGdtToCadThread(hg, 501, 10, 20, 1, 0);
    assert.strictEqual(hg.getRelation(gdtSlot), ThreadRelation.Manufactures);
    assert.strictEqual(hg.getDomainNode(gdtSlot, ThreadDomain.GDT), 10);
    assert.strictEqual(hg.getDomainNode(gdtSlot, ThreadDomain.CAD), 20);

    const telemSlot = bindTelemetryToSimulationThread(hg, 502, 30, 40, 1, 0);
    assert.strictEqual(hg.getRelation(telemSlot), ThreadRelation.Calibrates);
    assert.strictEqual(hg.getDomainNode(telemSlot, ThreadDomain.Telemetry), 30);
    assert.strictEqual(hg.getDomainNode(telemSlot, ThreadDomain.Modelica), 40);

    const safetySlot = bindSafetyToRequirementThread(hg, 503, 50, 60, 1, 0);
    assert.strictEqual(hg.getRelation(safetySlot), ThreadRelation.Verifies);
    assert.strictEqual(hg.getDomainNode(safetySlot, ThreadDomain.Safety), 50);
    assert.strictEqual(hg.getDomainNode(safetySlot, ThreadDomain.Requirements), 60);

    const bomSlot = bindBomToManufacturingThread(hg, 504, 70, 80, 90, 1, 0);
    assert.strictEqual(hg.getRelation(bomSlot), ThreadRelation.AllocatesTo);
    assert.strictEqual(hg.getDomainNode(bomSlot, ThreadDomain.SysML2), 70);
    assert.strictEqual(hg.getDomainNode(bomSlot, ThreadDomain.BOM), 80);
    assert.strictEqual(hg.getDomainNode(bomSlot, ThreadDomain.Manufacturing), 90);
  });
});

import assert from "node:assert";
import { describe, it } from "node:test";
import { DigitalThreadHypergraph, ThreadDomain } from "../src/index.js";

describe("DigitalThreadHypergraph: Transitive Blast-Radius Impact Analysis", () => {
  it("should calculate blast radius across 4-domain chain", () => {
    const hg = new DigitalThreadHypergraph();

    // Slot 0: Subsystem A (Requirement <-> SysML <-> Modelica <-> CAD)
    const s0 = hg.createThread(1001);
    hg.bindDomainNode(s0, ThreadDomain.Requirements, 101);
    hg.bindDomainNode(s0, ThreadDomain.SysML2, 201);
    hg.bindDomainNode(s0, ThreadDomain.Modelica, 301);
    hg.bindDomainNode(s0, ThreadDomain.CAD, 401);

    // Slot 1: Subsystem B sharing the CAD chassis part 401 with FEA mesh 501 and BOM 601
    const s1 = hg.createThread(1002);
    hg.bindDomainNode(s1, ThreadDomain.CAD, 401); // Shared CAD node
    hg.bindDomainNode(s1, ThreadDomain.FEA, 501);
    hg.bindDomainNode(s1, ThreadDomain.BOM, 601);

    // Compute blast radius starting from editing the CAD chassis node (401)
    const result = hg.computeBlastRadius(ThreadDomain.CAD, 401);

    assert.strictEqual(result.root.domain, ThreadDomain.CAD);
    assert.strictEqual(result.root.nodeId, 401);
    assert.strictEqual(result.impactedThreads.length, 2);
    assert.ok(result.impactedThreads.includes(1001));
    assert.ok(result.impactedThreads.includes(1002));

    // Impacted nodes should include all domains in both threads
    const impactedDomains = result.impactedNodes.map((n) => n.domain);
    assert.ok(impactedDomains.includes(ThreadDomain.Requirements));
    assert.ok(impactedDomains.includes(ThreadDomain.SysML2));
    assert.ok(impactedDomains.includes(ThreadDomain.Modelica));
    assert.ok(impactedDomains.includes(ThreadDomain.CAD));
    assert.ok(impactedDomains.includes(ThreadDomain.FEA));
    assert.ok(impactedDomains.includes(ThreadDomain.BOM));

    // Mark blast radius stale
    const marked = hg.markBlastRadiusStale(ThreadDomain.CAD, 401);
    assert.strictEqual(marked, 2);
    assert.strictEqual(hg.isStale(s0), true);
    assert.strictEqual(hg.isStale(s1), true);

    // Re-computing blast radius should now report staleCount
    const staleResult = hg.computeBlastRadius(ThreadDomain.CAD, 401);
    assert.strictEqual(staleResult.staleCount > 0, true);
  });
});

import { DigitalThreadHypergraph, ThreadDomain } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { ThreadExplorerProvider } from "../src/providers/threadExplorerProvider.js";

test("ThreadExplorerProvider: Graph Generation and Blast Radius", async (t) => {
  const hg = new DigitalThreadHypergraph();

  // Create two connected threads
  const s0 = hg.createThread(201);
  hg.bindDomainNode(s0, ThreadDomain.Requirements, 101);
  hg.bindDomainNode(s0, ThreadDomain.SysML2, 201);
  hg.bindDomainNode(s0, ThreadDomain.Modelica, 301);
  hg.bindDomainNode(s0, ThreadDomain.CAD, 401);

  const s1 = hg.createThread(202);
  hg.bindDomainNode(s1, ThreadDomain.CAD, 401); // Shared CAD part
  hg.bindDomainNode(s1, ThreadDomain.FEA, 501);
  hg.markStale(s1);

  const metadata = new Map<string, any>();
  metadata.set("requirements:101", { name: "REQ-01", line: 10, column: 1 });
  metadata.set("sysml2:201", { name: "ChassisPart", line: 20, column: 1 });
  metadata.set("modelica:301", { name: "ChassisDynamics", line: 30, column: 1, properties: { mass: 1.0 } });
  metadata.set("cad:401", { name: "Chassis.step", line: 1, column: 1, properties: { mass: 1.25 } });
  metadata.set("fea:501", { name: "ChassisStress.inp", line: 1, column: 1 });

  await t.test("should build multi-domain thread graph with diagnostics", () => {
    const graph = ThreadExplorerProvider.buildThreadGraph(hg, metadata);

    assert.strictEqual(graph.threads.length, 2);
    assert.strictEqual(graph.summary.totalThreads, 2);
    assert.strictEqual(graph.summary.synced, 1);
    assert.strictEqual(graph.summary.stale, 1);

    const t0 = graph.threads.find((th) => th.threadId === 201);
    assert.ok(t0);
    assert.strictEqual(t0.nodes.length, 4);

    // Verify mass divergence diagnostic was triggered
    assert.ok(t0.diagnostics.length > 0);
    assert.ok(t0.diagnostics.some((d) => d.message.includes("Mass divergence")));
  });

  await t.test("should compute blast radius from domain node", () => {
    const radius = ThreadExplorerProvider.getBlastRadius(hg, "cad", 401);

    assert.strictEqual(radius.root.domain, ThreadDomain.CAD);
    assert.strictEqual(radius.root.nodeId, 401);
    assert.strictEqual(radius.impactedThreads.length, 2);
    assert.ok(radius.impactedNodes.some((n) => n.domain === ThreadDomain.Modelica));
    assert.ok(radius.impactedNodes.some((n) => n.domain === ThreadDomain.FEA));
  });
});

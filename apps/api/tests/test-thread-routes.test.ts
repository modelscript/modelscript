// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import request from "supertest";
process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";

test("Digital Thread Hypergraph Explorer REST Endpoints", async (t) => {
  const app = createApp();

  await t.test("GET /api/v1/threads/graph returns multi-domain thread topology", async () => {
    const res = await request(app).get("/api/v1/threads/graph").expect(200);

    assert.ok(res.body.threads);
    assert.ok(Array.isArray(res.body.threads));
    assert.ok(res.body.threads.length >= 3, "Should include 3 seeded threads");
    assert.ok(res.body.domains);
    assert.ok(res.body.summary);
    assert.strictEqual(res.body.summary.totalThreads, res.body.threads.length);

    // Verify thread 101 has nodes in requirements, sysml2, modelica, cad, fea, bom
    const t101 = res.body.threads.find((th: any) => th.threadId === 101);
    assert.ok(t101);
    assert.strictEqual(t101.status, "synced");
    assert.strictEqual(t101.nodes.length, 6);

    const domains = t101.nodes.map((n: any) => n.domain);
    assert.ok(domains.includes("requirements"));
    assert.ok(domains.includes("sysml2"));
    assert.ok(domains.includes("modelica"));
    assert.ok(domains.includes("cad"));
    assert.ok(domains.includes("fea"));
    assert.ok(domains.includes("bom"));
  });

  await t.test("GET /api/v1/threads/blast-radius computes affected downstream nodes", async () => {
    const res = await request(app).get("/api/v1/threads/blast-radius?domain=sysml2&nodeId=2001").expect(200);

    assert.ok(res.body.root);
    assert.ok(Array.isArray(res.body.impactedNodes));
    assert.ok(Array.isArray(res.body.impactedThreads));
    assert.ok(res.body.domainNames);
  });

  await t.test("POST /api/v1/threads/conflicts/diagnose inspects conflict slot with physics-simplex", async () => {
    const res = await request(app)
      .post("/api/v1/threads/conflicts/diagnose")
      .send({ conflictId: "conflict_bus_voltage" })
      .expect(200);

    assert.strictEqual(res.body.conflictId, "conflict_bus_voltage");
    assert.strictEqual(res.body.status, "conflicted");
    assert.strictEqual(res.body.strategy, "physics-simplex");
    assert.strictEqual(res.body.sourceProposal.value, 24.0);
    assert.strictEqual(res.body.targetProposal.value, 12.0);
    assert.strictEqual(res.body.simplexConsensus, 18.0);
    assert.deepStrictEqual(res.body.physicsEnvelope, { min: 10.0, max: 48.0 });
  });

  await t.test("POST /api/v1/threads/conflicts/reconcile resolves conflict and updates hypergraph", async () => {
    const res = await request(app)
      .post("/api/v1/threads/conflicts/reconcile")
      .send({ conflictId: "conflict_bus_voltage", strategy: "physics-simplex" })
      .expect(200);

    assert.strictEqual(res.body.conflictId, "conflict_bus_voltage");
    assert.strictEqual(res.body.status, "resolved");
    assert.strictEqual(res.body.resolvedValue, 18.0);
    assert.strictEqual(res.body.isSynchronized, true);

    // Verify conflict diagnosed is now cleared
    const diagRes = await request(app)
      .post("/api/v1/threads/conflicts/diagnose")
      .send({ conflictId: "conflict_bus_voltage" })
      .expect(200);

    assert.strictEqual(diagRes.body.status, "synced");
  });
});

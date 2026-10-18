// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { WebSocket } from "ws";

process.env["NODE_ENV"] = "test";

import { LibraryDatabase } from "../src/database.js";
import { attachCollabWebSocket } from "../src/routes/collab-ws.js";
import { sysml2OmgRouter } from "../src/routes/sysml2-omg.js";
import { threadRouter } from "../src/routes/thread.js";
import { SysML2OmgService } from "../src/services/sysml2-omg-service.js";

test("Concurrent Engineering: SysML v2 Branching, Diff, 3-Way Merge & Persistent Digital Thread", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-concurrent-eng-test-"));
  const db = new LibraryDatabase(tmpDir);

  const omgService = new SysML2OmgService(db);
  const app = express();
  app.use(express.json());
  app.use("/api/v1/sysml2", sysml2OmgRouter(omgService));
  app.use("/api/v1/threads", threadRouter(db));

  const server = http.createServer(app);
  attachCollabWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  t.after(() => {
    try {
      server.close();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  let projectId = "";
  let baseCommitId = "";
  let thermalBranchCommitId = "";
  let controlsBranchCommitId = "";

  await t.test("Phase 2.1: Create SysML v2 project and ingest base commit on main branch", async () => {
    const createRes = await request(app)
      .post("/api/v1/sysml2/projects")
      .send({
        name: "Concurrent-eVTOL-Propulsion",
        description: "Multi-branch concurrent engineering test project",
      })
      .expect(201);

    projectId = createRes.body["@id"];
    assert.ok(projectId);

    const baseSource = `
part def PropulsionUnit {
  attribute busVoltage : Real = 400.0;
  attribute maxTemp : Real = 85.0;
}
`;
    const ingestRes = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/ingest`)
      .send({
        description: "Base PropulsionUnit architecture",
        source: baseSource,
        branchName: "main",
      })
      .expect(201);

    baseCommitId = ingestRes.body["@id"];
    assert.ok(baseCommitId);
  });

  await t.test("Phase 2.2: Create branches and tags via OMG SysML v2 REST endpoints", async () => {
    const branch1Res = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/branches`)
      .send({
        name: "feature/thermal",
        headCommitId: baseCommitId,
      })
      .expect(201);

    assert.equal(branch1Res.body["@type"], "Branch");
    assert.equal(branch1Res.body.name, "feature/thermal");
    assert.equal(branch1Res.body.headCommitId, baseCommitId);

    const branch2Res = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/branches`)
      .send({
        name: "feature/controls",
        headCommitId: baseCommitId,
      })
      .expect(201);

    assert.equal(branch2Res.body.name, "feature/controls");

    const listBranchesRes = await request(app).get(`/api/v1/sysml2/projects/${projectId}/branches`).expect(200);

    const names = listBranchesRes.body.members.map((b: any) => b.name);
    assert.ok(names.includes("main"));
    assert.ok(names.includes("feature/thermal"));
    assert.ok(names.includes("feature/controls"));

    const tagRes = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/tags`)
      .send({
        name: "v1.0-baseline",
        taggedCommitId: baseCommitId,
      })
      .expect(201);

    assert.equal(tagRes.body["@type"], "Tag");
    assert.equal(tagRes.body.name, "v1.0-baseline");
    assert.equal(tagRes.body.taggedCommit["@id"], baseCommitId);
  });

  await t.test("Phase 2.3: Concurrent commits on feature/thermal and feature/controls", async () => {
    // Thermal team updates maxTemp to 95.0 and proposes busVoltage = 420.0
    const thermalSource = `
part def PropulsionUnit {
  attribute busVoltage : Real = 420.0;
  attribute maxTemp : Real = 95.0;
  attribute coolantFlow : Real = 12.5;
}
`;
    const tRes = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/ingest`)
      .send({
        description: "Thermal team updates maxTemp, adds coolantFlow, proposes 420V",
        source: thermalSource,
        branchName: "feature/thermal",
      })
      .expect(201);
    thermalBranchCommitId = tRes.body["@id"];

    // Controls team proposes busVoltage = 460.0 and adds pwmFrequency
    const controlsSource = `
part def PropulsionUnit {
  attribute busVoltage : Real = 460.0;
  attribute maxTemp : Real = 85.0;
  attribute pwmFrequency : Real = 20000.0;
}
`;
    const cRes = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/ingest`)
      .send({
        description: "Controls team proposes 460V and adds pwmFrequency",
        source: controlsSource,
        branchName: "feature/controls",
      })
      .expect(201);
    controlsBranchCommitId = cRes.body["@id"];
  });

  await t.test("Phase 2.4: GET /diff computes element-level changes between commits", async () => {
    const diffRes = await request(app)
      .get(`/api/v1/sysml2/projects/${projectId}/diff`)
      .query({
        baseCommitId,
        targetCommitId: thermalBranchCommitId,
      })
      .expect(200);

    assert.equal(diffRes.body["@type"], "CommitDiff");
    assert.equal(diffRes.body.baseCommitId, baseCommitId);
    assert.equal(diffRes.body.targetCommitId, thermalBranchCommitId);
    assert.ok(diffRes.body.addedElements.length >= 1, "Expected coolantFlow to be detected as added");
    assert.ok(diffRes.body.modifiedElements.length >= 1, "Expected busVoltage/maxTemp to be detected as modified");
  });

  await t.test("Phase 2.5: POST /merge with strict strategy reports conflict on busVoltage", async () => {
    const mergeStrictRes = await request(app)
      .post(`/api/v1/sysml2/projects/${projectId}/merge`)
      .send({
        sourceBranch: "feature/thermal",
        targetBranch: "feature/controls",
        strategy: "strict",
      })
      .expect(409);

    assert.equal(mergeStrictRes.body["@type"], "BranchMergeResult");
    assert.equal(mergeStrictRes.body.status, "conflicted");
    assert.equal(mergeStrictRes.body.lcaCommitId, baseCommitId);
    assert.ok(mergeStrictRes.body.conflicts.length >= 1);
    const busVoltageConflict = mergeStrictRes.body.conflicts.find((c: any) =>
      String(c.qualifiedName).includes("busVoltage"),
    );
    assert.ok(busVoltageConflict, "Expected conflict on PropulsionUnit::busVoltage");
  });

  await t.test(
    "Phase 2.6: POST /merge with physics-simplex reconciles numeric conflict and creates merge commit",
    async () => {
      const mergeSimplexRes = await request(app)
        .post(`/api/v1/sysml2/projects/${projectId}/merge`)
        .send({
          sourceBranch: "feature/thermal",
          targetBranch: "feature/controls",
          strategy: "physics-simplex",
          description: "Merge thermal into controls with physics-simplex reconciliation",
        })
        .expect(200);

      assert.equal(mergeSimplexRes.body["@type"], "BranchMergeResult");
      assert.equal(mergeSimplexRes.body.status, "reconciled");
      assert.ok(mergeSimplexRes.body.mergeCommit);
      assert.equal(mergeSimplexRes.body.mergeCommit.mergedCommit["@id"], thermalBranchCommitId);

      // Verify merged commit contains both coolantFlow and pwmFrequency, plus reconciled busVoltage (440.0)
      const mergeCommitId = mergeSimplexRes.body.mergeCommit["@id"];
      const elementsRes = await request(app)
        .get(`/api/v1/sysml2/projects/${projectId}/commits/${mergeCommitId}/elements`)
        .expect(200);

      const names = elementsRes.body.members.map((e: any) => e.name);
      assert.ok(names.includes("coolantFlow"), "Merged commit must include coolantFlow from thermal branch");
      assert.ok(names.includes("pwmFrequency"), "Merged commit must include pwmFrequency from controls branch");

      const busVoltElem = elementsRes.body.members.find((e: any) => e.name === "busVoltage");
      assert.ok(busVoltElem);
      assert.equal(
        Number(busVoltElem.attributes?.defaultValue),
        440,
        "Expected simplex consensus midpoint 440.0 between 420.0 and 460.0",
      );
    },
  );

  await t.test(
    "Phase 3.1: Persistent Digital Thread Hypergraph & Conflict Registry survives router restart",
    async () => {
      // 1. Verify initial seeded graph has 3 threads and 1 conflict
      const graph1 = await request(app).get("/api/v1/threads/graph").expect(200);
      assert.equal(graph1.body.summary.totalThreads, 3);
      assert.equal(graph1.body.summary.conflict, 1);

      // 2. Register a new thread alignment node (Thread 104) via POST /api/v1/threads/nodes
      const nodeRes = await request(app)
        .post("/api/v1/threads/nodes")
        .send({
          threadId: 104,
          revision: 1,
          status: "synced",
          domains: {
            sysml2: 2004,
            modelica: 3004,
            cad: 4004,
          },
          metadata: {
            "sysml2:2004": { name: "part def RotorAssembly", line: 10, column: 1 },
          },
        })
        .expect(201);

      assert.equal(nodeRes.body.threadId, 104);
      assert.equal(nodeRes.body.status, "synced");

      // 3. Reconcile conflict_bus_voltage (Thread 103) via POST /api/v1/threads/conflicts/reconcile
      const reconcileRes = await request(app)
        .post("/api/v1/threads/conflicts/reconcile")
        .send({
          conflictId: "conflict_bus_voltage",
          strategy: "physics-simplex",
        })
        .expect(200);

      assert.equal(reconcileRes.body.status, "resolved");
      assert.equal(reconcileRes.body.resolvedValue, 18.0);

      // 4. Mount a fresh Express app and threadRouter backed by the SAME SQLite database (simulating process restart)
      const restartedApp = express();
      restartedApp.use(express.json());
      restartedApp.use("/api/v1/threads", threadRouter(db));

      const graphAfterRestart = await request(restartedApp).get("/api/v1/threads/graph").expect(200);
      assert.equal(graphAfterRestart.body.summary.totalThreads, 4, "Thread 104 should persist across router restart");
      assert.equal(
        graphAfterRestart.body.summary.conflict,
        0,
        "Reconciled conflict on Thread 103 should remain resolved after restart",
      );

      const thread104 = graphAfterRestart.body.threads.find((th: any) => th.threadId === 104);
      assert.ok(thread104, "Thread 104 must be present in hydrated hypergraph");
      const sysmlNode = thread104.nodes.find((n: any) => n.domain === "sysml2");
      assert.equal(sysmlNode?.name, "part def RotorAssembly");
    },
  );

  await t.test("Phase 4.1: WebSocket Co-Editing & Symbol Collision Broadcast (/api/v1/collab/stream)", async () => {
    const wsUrl = `ws://127.0.0.1:${port}/api/v1/collab/stream`;
    const wsAlice = new WebSocket(wsUrl);
    const wsBob = new WebSocket(wsUrl);

    const aliceMessages: any[] = [];
    const bobMessages: any[] = [];

    wsAlice.on("message", (data) => aliceMessages.push(JSON.parse(data.toString())));
    wsBob.on("message", (data) => bobMessages.push(JSON.parse(data.toString())));

    await Promise.all([
      new Promise<void>((resolve) => wsAlice.once("open", () => resolve())),
      new Promise<void>((resolve) => wsBob.once("open", () => resolve())),
    ]);

    const docText = "model Inverter\n  parameter Real V = 400.0;\nend Inverter;";
    wsAlice.send(
      JSON.stringify({
        type: "join",
        documentUri: "file:///workspace/Inverter.mo",
        peerId: "alice",
        displayName: "Alice",
        initialContent: docText,
        cursorOffset: 10,
        symbolSpans: [{ name: "Inverter", kind: "model", startByte: 0, endByte: docText.length }],
      }),
    );

    await new Promise((r) => setTimeout(r, 40));

    wsBob.send(
      JSON.stringify({
        type: "join",
        documentUri: "file:///workspace/Inverter.mo",
        peerId: "bob",
        displayName: "Bob",
        cursorOffset: 20,
      }),
    );

    await new Promise((r) => setTimeout(r, 40));

    // Bob should have received sync_state with a symbol collision on 'Inverter'
    const bobSync = bobMessages.find((m) => m.type === "sync_state");
    assert.ok(bobSync, "Bob should receive sync_state");
    assert.equal(bobSync.peers.length, 2);
    assert.equal(bobSync.collisions.length, 1);
    assert.equal(bobSync.collisions[0].symbolName, "Inverter");

    // Alice sends a text_operation replacing 400.0 with 800.0
    const vIdx = docText.indexOf("400.0");
    wsAlice.send(
      JSON.stringify({
        type: "text_operation",
        id: "op-1",
        baseVersion: 0,
        startOffset: vIdx,
        endOffset: vIdx + 5,
        insertText: "800.0",
      }),
    );

    await new Promise((r) => setTimeout(r, 40));

    const bobOp = bobMessages.find((m) => m.type === "operation_broadcast");
    assert.ok(bobOp, "Bob should receive operation_broadcast from Alice");
    assert.equal(bobOp.version, 1);
    assert.equal(bobOp.operation.insertText, "800.0");

    wsAlice.close();
    wsBob.close();
  });
});

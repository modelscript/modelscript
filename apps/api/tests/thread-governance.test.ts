// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert";
import http from "node:http";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { threadRouter } from "../src/routes/thread.js";

test("Digital Twin Merge Request Governance & Regulatory Audit Trail API", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/threads", threadRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  t.after(() => {
    server.close();
  });

  let createdProposalId: number;

  await t.test("1. POST /proposals creates a proposal and records ISO 26262 audit log", async () => {
    const res = await request(app)
      .post("/api/v1/threads/proposals")
      .send({
        threadId: "thread_bus_103",
        title: "Reconcile Bus Voltage to 24.0V for ASIL-D Inverter",
        description: "Update Modelica electrical parameter to match SysML allocation.",
        proposedBy: "systems_engineer_alice",
        diffSummary: {
          domain: "modelica",
          file: "InverterDrive.mo",
          parameter: "V_bus",
          oldValue: 12.0,
          newValue: 24.0,
          unit: "V",
        },
        safetyStandard: "ISO-26262",
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.proposal);
    assert.strictEqual(res.body.proposal.thread_id, "thread_bus_103");
    assert.strictEqual(res.body.proposal.status, "open");
    assert.strictEqual(res.body.proposal.proposed_by, "systems_engineer_alice");
    createdProposalId = res.body.proposal.id;
    assert.ok(createdProposalId > 0);
  });

  await t.test("2. GET /proposals returns the list of open proposals", async () => {
    const res = await request(app).get("/api/v1/threads/proposals").query({ threadId: "thread_bus_103" });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.proposals));
    assert.strictEqual(res.body.proposals.length, 1);
    assert.strictEqual(res.body.proposals[0].id, createdProposalId);
  });

  await t.test("3. POST /proposals/:id/review updates status to approved with reviewer comment", async () => {
    const res = await request(app).post(`/api/v1/threads/proposals/${createdProposalId}/review`).send({
      status: "approved",
      resolvedBy: "safety_officer_bob",
      comment: "Reviewed and validated against ISO 26262 Part 4 System Design verification.",
      safetyStandard: "ISO-26262",
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.proposal);
    assert.strictEqual(res.body.proposal.status, "approved");
    assert.strictEqual(res.body.proposal.resolved_by, "safety_officer_bob");
    assert.ok(res.body.proposal.review_comment.includes("ISO 26262"));
  });

  await t.test("4. GET /audit-log returns cryptographic hash-chained audit trail", async () => {
    const res = await request(app).get("/api/v1/threads/audit-log").query({ threadId: "thread_bus_103" });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.auditLogs));
    // At least proposal_created and proposal_approved
    assert.ok(res.body.auditLogs.length >= 2);

    const log1 = res.body.auditLogs[0];
    const log2 = res.body.auditLogs[1];

    assert.strictEqual(log1.action, "proposal_created");
    assert.strictEqual(log2.action, "proposal_approved");
    assert.ok(typeof log1.checksum === "string" && log1.checksum.length === 64);
    assert.ok(typeof log2.checksum === "string" && log2.checksum.length === 64);
    assert.notStrictEqual(log1.checksum, log2.checksum);

    // Cryptographic audit chain verification
    assert.strictEqual(res.body.verification.valid, true);
    assert.strictEqual(res.body.verification.totalEntries, 2);
  });

  await t.test("5. Real-time SSE stream receives proposal and review events", async () => {
    const receivedEvents: { event: string; data: any }[] = [];

    const req = http.get(`http://localhost:${port}/api/v1/threads/stream`, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n\n");
        while (lines.length > 1) {
          const rawMessage = lines.shift()!;
          const matchEvent = rawMessage.match(/^event:\s*(.+)$/m);
          const matchData = rawMessage.match(/^data:\s*(.+)$/m);
          if (matchEvent && matchData) {
            receivedEvents.push({
              event: matchEvent[1].trim(),
              data: JSON.parse(matchData[1].trim()),
            });
          }
        }
        buffer = lines[0];
      });
    });

    // Wait for connection
    await new Promise((r) => setTimeout(r, 50));

    // Submit new proposal via REST
    const postRes = await request(app)
      .post("/api/v1/threads/proposals")
      .send({
        threadId: "thread_thermal_102",
        title: "Adjust cooling plate fin spacing for DO-178C avionics cooling",
        proposedBy: "thermal_engineer",
        diffSummary: { spacing: 2.5 },
        safetyStandard: "DO-178C",
      });
    assert.strictEqual(postRes.status, 201);
    const newPropId = postRes.body.proposal.id;

    // Review proposal
    await request(app).post(`/api/v1/threads/proposals/${newPropId}/review`).send({
      status: "applied",
      resolvedBy: "lead_architect",
      comment: "Applied to baseline.",
    });

    // Wait for SSE delivery
    await new Promise((r) => setTimeout(r, 60));
    req.destroy();

    const createdEvent = receivedEvents.find((e) => e.event === "proposal_created");
    assert.ok(createdEvent, "SSE received proposal_created event");
    assert.strictEqual(createdEvent.data.proposal.thread_id, "thread_thermal_102");

    const reviewedEvent = receivedEvents.find((e) => e.event === "proposal_reviewed");
    assert.ok(reviewedEvent, "SSE received proposal_reviewed event");
    assert.strictEqual(reviewedEvent.data.proposal.status, "applied");
  });
});

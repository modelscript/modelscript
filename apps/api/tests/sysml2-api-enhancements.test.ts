// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { sysml2OmgRouter } from "../src/routes/sysml2-omg.js";
import { sysml2EventBus } from "../src/services/sysml2-event-bus.js";
import { SysML2OmgService } from "../src/services/sysml2-omg-service.js";

test("SysML v2 API Enhancements: GraphQL & Real-Time Collaboration (SSE)", async (t) => {
  const service = new SysML2OmgService();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/sysml2", sysml2OmgRouter(service));

  let createdProjectId = "";

  await t.test("GraphQL Query: lists seeded OMG SysML v2 projects", async () => {
    const query = `
      query {
        projects {
          id
          name
          defaultBranch {
            name
          }
        }
      }
    `;

    const res = await request(app).post("/api/v1/sysml2/graphql").send({ query }).expect(200);

    assert.ok(res.body.data, "Should return GraphQL data");
    assert.ok(Array.isArray(res.body.data.projects), "Should return projects list");
    assert.ok(res.body.data.projects.length >= 1, "Should contain seeded projects");
    const drone = res.body.data.projects.find((p: any) => p.name === "AutonomousDrone-SysML2");
    assert.ok(drone, "Seeded AutonomousDrone-SysML2 should be present");
  });

  await t.test("GraphQL Mutation: creates new SysML v2 project", async () => {
    const mutation = `
      mutation {
        createProject(name: "LunarRoverArchitecture", description: "Autonomous Lunar Rover System") {
          id
          name
          description
          defaultBranch {
            name
          }
        }
      }
    `;

    const res = await request(app).post("/api/v1/sysml2/graphql").send({ query: mutation }).expect(200);

    assert.ok(res.body.data?.createProject);
    assert.equal(res.body.data.createProject.name, "LunarRoverArchitecture");
    assert.equal(res.body.data.createProject.defaultBranch.name, "main");
    createdProjectId = res.body.data.createProject.id;
    assert.ok(createdProjectId, "Project ID should be returned");
  });

  await t.test("GraphQL Mutation: ingests SysML v2 model into project commit", async () => {
    const sysmlCode = `
      package RoverPowerSubsystem {
        part def Battery {
          attribute capacity : Real = 5000 [Wh];
        }
      }
    `;

    const mutation = `
      mutation Ingest($projectId: ID!, $source: String!) {
        ingestModel(projectId: $projectId, sourceText: $source, message: "Initial battery spec") {
          id
          description
          elements {
            id
            name
            type
          }
        }
      }
    `;

    const res = await request(app)
      .post("/api/v1/sysml2/graphql")
      .send({
        query: mutation,
        variables: {
          projectId: createdProjectId,
          source: sysmlCode,
        },
      })
      .expect(200);

    assert.ok(res.body.data?.ingestModel);
    assert.equal(res.body.data.ingestModel.description, "Initial battery spec");
    assert.ok(Array.isArray(res.body.data.ingestModel.elements));
    const batteryElem = res.body.data.ingestModel.elements.find((e: any) => e.name === "Battery");
    assert.ok(batteryElem, "Battery part definition should be parsed into commit elements");
  });

  await t.test("Real-time SSE event bus dispatches events on model changes", async () => {
    let receivedEvent: any = null;

    const unsubscribe = sysml2EventBus.onProjectEvent(createdProjectId, (event) => {
      receivedEvent = event;
    });

    try {
      // Ingest another model update via REST API
      const res = await request(app)
        .post(`/api/v1/sysml2/projects/${createdProjectId}/ingest`)
        .send({
          source: "package RoverThermal { part def Radiator; }",
          description: "Add radiator specification",
        })
        .expect(201);

      assert.ok(res.body["@id"], "Commit ID should be returned");
      assert.ok(receivedEvent, "Event bus should receive emitted event");
      assert.equal(receivedEvent.type, "commit.created");
      assert.equal(receivedEvent.projectId, createdProjectId);
      assert.equal(receivedEvent.data.description, "Add radiator specification");
    } finally {
      unsubscribe();
    }
  });

  await t.test("GET /projects/:projectId/events sets SSE headers", async () => {
    const res = await request(app)
      .get(`/api/v1/sysml2/projects/${createdProjectId}/events`)
      .timeout(200)
      .catch((err) => {
        // Supertest closes after first chunk/timeout, returning partial response
        return err.response;
      });

    if (res) {
      assert.equal(res.status, 200);
      assert.ok(res.headers["content-type"]?.includes("text/event-stream"));
      assert.ok(res.text.includes("event: connected"));
    }
  });
});

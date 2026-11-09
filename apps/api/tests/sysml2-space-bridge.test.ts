// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createSpaceSysml2Router } from "../src/routes/spaces-sysml2.js";

test("Ansatz Space-Scoped SysML v2 OMG Bridge & GraphQL", async (t) => {
  const app = express();
  app.use(express.json());
  // Mount space-scoped router under /api/v1/spaces
  app.use("/api/v1/spaces/:namespace/:slug/sysml2", createSpaceSysml2Router(null));

  await t.test("GET /:namespace/:slug/sysml2 lazily initializes and returns OMG project", async () => {
    const res = await request(app).get("/api/v1/spaces/@nasa/artemis-lander/sysml2").expect(200);

    assert.equal(res.body["@type"], "Project");
    assert.equal(res.body["@id"], "urn:ansatz:space:nasa:artemis-lander");
    assert.equal(res.body.defaultBranch.name, "main");
  });

  await t.test("POST /:namespace/:slug/sysml2/ingest commits SysML v2 model into Space", async () => {
    const sysmlSource = `
      package ArtemisLanderArchitecture {
        port def FuelPort;

        part def DescentStage {
          attribute dryMass : Real = 4500 [kg];
          attribute propellantMass : Real = 9000 [kg];
          port fuelOut : FuelPort;
        }

        part def AscentStage {
          attribute crewCapacity : Integer = 4;
        }

        part def Lander {
          part descent : DescentStage;
          part ascent : AscentStage;
        }
      }
    `;

    const res = await request(app).post("/api/v1/spaces/@nasa/artemis-lander/sysml2/ingest").send({
      source: sysmlSource,
      description: "Initial Artemis Lander baseline architecture",
    });

    if (res.status !== 201) {
      console.error("INGEST ERROR BODY:", res.body);
    }
    assert.equal(res.status, 201);

    assert.equal(res.body["@type"], "Commit");
    assert.equal(res.body.description, "Initial Artemis Lander baseline architecture");
  });

  await t.test("GET /:namespace/:slug/sysml2/elements returns elements from Space HEAD commit", async () => {
    const res = await request(app).get("/api/v1/spaces/@nasa/artemis-lander/sysml2/elements").expect(200);

    assert.equal(res.body["@type"], "Collection");
    assert.ok(Array.isArray(res.body.members));
    assert.ok(res.body.members.length >= 1);

    const lander = res.body.members.find((m: any) => m.name === "Lander");
    assert.ok(lander, "Lander should be indexed in Space OMG store");
    assert.equal(lander["@type"], "PartDefinition");
  });

  await t.test("POST /:namespace/:slug/sysml2/graphql queries Space elements via GraphQL", async () => {
    const query = `
      query {
        projects {
          id
          name
          commits {
            id
            description
            elements {
              name
              type
            }
          }
        }
      }
    `;

    const res = await request(app)
      .post("/api/v1/spaces/@nasa/artemis-lander/sysml2/graphql")
      .send({ query })
      .expect(200);

    assert.ok(res.body.data?.projects);
    const spaceProj = res.body.data.projects.find((p: any) => p.id === "urn:ansatz:space:nasa:artemis-lander");
    assert.ok(spaceProj, "Space project should be resolved in GraphQL");
    assert.ok(spaceProj.commits.length >= 1);
    const commit = spaceProj.commits.find((c: any) => c.elements.length > 0);
    assert.ok(commit, "Non-empty commit should be found");
    assert.ok(commit.elements.some((e: any) => e.name === "Lander"));
  });
});

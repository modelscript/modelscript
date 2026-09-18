// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import request from "supertest";
process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";

test("OMG Systems Modeling REST API Gateway (ptc/2024-02-03)", async (t) => {
  const app = createApp();

  let evProjectId = "";
  let evCommitId = "";
  let batteryPackElementId = "";

  await t.test("GET /projects returns pre-seeded projects with JSON-LD @context", async () => {
    const res = await request(app).get("/projects").expect(200);

    assert.ok(res.headers["content-type"].includes("json"));
    assert.strictEqual(res.body["@context"], "https://www.omg.org/spec/SysML/20240201/context.jsonld");
    assert.strictEqual(res.body["@type"], "Collection");
    assert.ok(Array.isArray(res.body.members));
    assert.ok(res.body.members.length >= 2, "Should include seeded stdlib and sample drone projects");

    const stdlibProject = res.body.members.find((p: any) => p.name === "KerML-Standard-Library");
    assert.ok(stdlibProject, "KerML-Standard-Library project should be present");

    const droneProject = res.body.members.find((p: any) => p.name === "AutonomousDrone-SysML2");
    assert.ok(droneProject, "AutonomousDrone-SysML2 project should be present");
  });

  await t.test("GET /api/v1/sysml2/projects operates identically at canonical namespace", async () => {
    const res = await request(app).get("/api/v1/sysml2/projects").set("Accept", "application/ld+json").expect(200);

    assert.ok(res.headers["content-type"].includes("application/ld+json"));
    assert.strictEqual(res.body["@type"], "Collection");
    assert.ok(Array.isArray(res.body.members));
  });

  await t.test("POST /projects creates a new project", async () => {
    const res = await request(app)
      .post("/projects")
      .send({
        name: "ElectricVehicle-Powertrain",
        description: "EV High Voltage Battery & Inverter Subsystem",
      })
      .expect(201);

    assert.strictEqual(res.body["@type"], "Project");
    assert.strictEqual(res.body.name, "ElectricVehicle-Powertrain");
    assert.ok(res.body["@id"]);
    assert.ok(res.body.defaultBranch);
    assert.strictEqual(res.body.defaultBranch.name, "main");

    evProjectId = res.body["@id"];
  });

  await t.test("GET /projects/:projectId fetches project details", async () => {
    const res = await request(app).get(`/projects/${evProjectId}`).expect(200);

    assert.strictEqual(res.body["@id"], evProjectId);
    assert.strictEqual(res.body.name, "ElectricVehicle-Powertrain");
  });

  await t.test("POST /projects/:projectId/ingest parses SysML v2 source into a new commit", async () => {
    const evModel = `
part def BatteryPack {
  attribute capacityKwh : Real = 75.0;
  attribute voltage : Real = 400.0;
  port posTerminal : Pin;
  port ~negTerminal : Pin;
  assert constraint { capacityKwh >= 60.0 }
}
`;

    const res = await request(app)
      .post(`/projects/${evProjectId}/ingest`)
      .send({
        description: "Initial BatteryPack definition with terminals and constraint",
        source: evModel,
        uri: "sysml2://workspace/Battery.sysml",
      })
      .expect(201);

    assert.strictEqual(res.body["@type"], "Commit");
    assert.strictEqual(res.body.projectId, evProjectId);
    assert.strictEqual(res.body.description, "Initial BatteryPack definition with terminals and constraint");
    assert.ok(res.body["@id"]);

    evCommitId = res.body["@id"];
  });

  await t.test("GET /projects/:projectId/commits lists commits", async () => {
    const res = await request(app).get(`/projects/${evProjectId}/commits`).expect(200);

    assert.strictEqual(res.body["@type"], "Collection");
    assert.strictEqual(res.body.members.length, 2); // Initial commit + ingested commit
  });

  await t.test("GET /projects/:projectId/commits/:commitId/elements lists elements with filtering", async () => {
    // 1. All elements in commit
    const allRes = await request(app).get(`/projects/${evProjectId}/commits/${evCommitId}/elements`).expect(200);

    assert.strictEqual(allRes.body["@type"], "Collection");
    assert.ok(allRes.body.members.length >= 5); // BatteryPack, 2 attributes, 2 ports, 1 constraint

    const batteryPack = allRes.body.members.find((e: any) => e.name === "BatteryPack");
    assert.ok(batteryPack);
    assert.strictEqual(batteryPack["@type"], "PartDefinition");
    batteryPackElementId = batteryPack["@id"];

    // 2. Filter by @type=PartDefinition
    const typeRes = await request(app)
      .get(`/projects/${evProjectId}/commits/${evCommitId}/elements?type=PartDefinition`)
      .expect(200);

    assert.strictEqual(typeRes.body.members.length, 1);
    assert.strictEqual(typeRes.body.members[0].name, "BatteryPack");

    // 3. Filter by @type=PortUsage
    const portRes = await request(app)
      .get(`/projects/${evProjectId}/commits/${evCommitId}/elements?type=PortUsage`)
      .expect(200);

    assert.strictEqual(portRes.body.members.length, 2);
    const pos = portRes.body.members.find((p: any) => p.name === "posTerminal");
    const neg = portRes.body.members.find((p: any) => p.name === "negTerminal");
    assert.ok(pos);
    assert.ok(neg);
    assert.strictEqual(neg.attributes.isConjugated, true, "negTerminal should be tagged as conjugated");
  });

  await t.test("GET /projects/:projectId/commits/:commitId/elements with pagination", async () => {
    const page1 = await request(app)
      .get(`/projects/${evProjectId}/commits/${evCommitId}/elements?pageSize=2`)
      .expect(200);

    assert.strictEqual(page1.body.members.length, 2);
    assert.ok(page1.body.nextCursor, "Should provide nextCursor");

    const page2 = await request(app)
      .get(`/projects/${evProjectId}/commits/${evCommitId}/elements?pageSize=2&pageAfter=${page1.body.nextCursor}`)
      .expect(200);

    assert.strictEqual(page2.body.members.length, 2);
    assert.notStrictEqual(page1.body.members[0]["@id"], page2.body.members[0]["@id"]);
  });

  await t.test(
    "GET /projects/:projectId/commits/:commitId/elements/:elementId retrieves individual element",
    async () => {
      const res = await request(app)
        .get(`/projects/${evProjectId}/commits/${evCommitId}/elements/${batteryPackElementId}`)
        .expect(200);

      assert.strictEqual(res.body["@id"], batteryPackElementId);
      assert.strictEqual(res.body["@type"], "PartDefinition");
      assert.strictEqual(res.body.name, "BatteryPack");
      assert.strictEqual(res.body.qualifiedName, "BatteryPack");
      assert.ok(Array.isArray(res.body.ownedElement));
      assert.ok(res.body.ownedElement.length >= 4);
    },
  );

  await t.test("POST /projects/:projectId/commits/:commitId/queries executes structured query", async () => {
    const res = await request(app)
      .post(`/projects/${evProjectId}/commits/${evCommitId}/queries`)
      .send({
        where: {
          "@type": "AttributeUsage",
        },
      })
      .expect(200);

    assert.strictEqual(res.body["@type"], "Collection");
    assert.strictEqual(res.body.members.length, 2);
    const names = res.body.members.map((m: any) => m.name);
    assert.ok(names.includes("capacityKwh"));
    assert.ok(names.includes("voltage"));
  });

  await t.test("DELETE /projects/:projectId removes project cleanly", async () => {
    await request(app).delete(`/projects/${evProjectId}`).expect(204);

    await request(app).get(`/projects/${evProjectId}`).expect(404);
  });

  t.after(() => {
    process.exit(0);
  });
});

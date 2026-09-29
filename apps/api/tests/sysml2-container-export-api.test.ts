// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import request from "supertest";
process.env["NODE_ENV"] = "test";

import { parseSspArchive } from "@modelscript/exchange/ssp";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../src/app.js";

function binaryParser(res: any, callback: (err: Error | null, data: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
}

test("SysML v2 Multi-Physics Container Export REST API", async (t) => {
  const app = createApp();

  let droneProjectId = "";
  let droneCommitId = "";
  let sspBuffer: Buffer | null = null;

  await t.test("Fetch seeded AutonomousDrone-SysML2 project metadata", async () => {
    const res = await request(app).get("/projects").expect(200);
    const droneProject = res.body.members.find((p: any) => p.name === "AutonomousDrone-SysML2");
    assert.ok(droneProject, "AutonomousDrone-SysML2 project should be seeded");
    droneProjectId = droneProject["@id"];

    const commitRes = await request(app).get(`/projects/${droneProjectId}/commits`).expect(200);
    assert.ok(commitRes.body.members.length > 0);
    droneCommitId = commitRes.body.members[0]["@id"];
  });

  await t.test("POST /projects/:id/export/ssp exports valid SSP archive", async () => {
    const res = await request(app)
      .post(`/projects/${droneProjectId}/export/ssp`)
      .send({ description: "Test Drone SSP Export" })
      .buffer()
      .parse(binaryParser)
      .expect(200);

    assert.ok(res.headers["content-type"].includes("application/octet-stream"));
    assert.ok(res.headers["content-disposition"].includes(".ssp"));

    sspBuffer = res.body as Buffer;
    assert.ok(sspBuffer.length > 0, "SSP buffer should not be empty");

    // Verify SystemStructure.ssd and bundled FMUs
    const parsed = parseSspArchive(new Uint8Array(sspBuffer));
    assert.ok(parsed, "Parsed SSP metadata should exist");
    assert.strictEqual(parsed.systemName, "AutonomousDrone");
    assert.ok(parsed.componentNames.includes("battery"));
    assert.ok(parsed.componentNames.includes("fc"));
    assert.ok(parsed.componentNames.includes("motor1"));
    assert.ok(parsed.componentNames.includes("motor2"));

    const zipFiles = unzipSync(new Uint8Array(sspBuffer));
    assert.ok(zipFiles["SystemStructure.ssd"], "Should contain SystemStructure.ssd");
    assert.ok(zipFiles["resources/fc.fmu"], "Should contain flight controller FMU");
    assert.ok(zipFiles["resources/battery.fmu"], "Should contain battery FMU");
    assert.ok(zipFiles["resources/motor1.fmu"], "Should contain motor1 FMU");
    assert.ok(zipFiles["resources/motor2.fmu"], "Should contain motor2 FMU");
  });

  await t.test("GET /projects/:id/commits/:commitId/ssp exports SSP by commit", async () => {
    const res = await request(app)
      .get(`/projects/${droneProjectId}/commits/${droneCommitId}/ssp`)
      .buffer()
      .parse(binaryParser)
      .expect(200);

    assert.ok(res.headers["content-disposition"].includes(".ssp"));
    assert.ok((res.body as Buffer).length > 0);
  });

  await t.test("POST /projects/:id/export/fmu3 exports monolithic FMI 3.0 FMU", async () => {
    const res = await request(app)
      .post(`/projects/${droneProjectId}/export/fmu3`)
      .send({ fmiVersion: "3" })
      .buffer()
      .parse(binaryParser)
      .expect(200);

    assert.ok(res.headers["content-type"].includes("application/octet-stream"));
    assert.ok(res.headers["content-disposition"].includes(".fmu"));

    const fmuBuffer = res.body as Buffer;
    assert.ok(fmuBuffer.length > 0, "FMU buffer should not be empty");

    const files = unzipSync(new Uint8Array(fmuBuffer));
    assert.ok(files["modelDescription.xml"], "Must include modelDescription.xml");
    const descXml = strFromU8(files["modelDescription.xml"]);
    assert.ok(descXml.includes('fmiVersion="3.0"'), "modelDescription.xml must declare fmiVersion='3.0'");

    assert.ok(
      files["terminalsAndIcons/terminalsAndIcons.xml"],
      "Must include FMI 3.0 Terminals and Icons layered standard",
    );
    const terminalsXml = strFromU8(files["terminalsAndIcons/terminalsAndIcons.xml"]);
    assert.ok(terminalsXml.includes("<fmiTerminalsAndIcons"), "Must contain fmiTerminalsAndIcons tag");
    assert.ok(terminalsXml.includes("<Terminal"), "Must contain Terminal declarations");
  });

  await t.test("GET /projects/:id/commits/:commitId/fmu3 exports FMU by commit", async () => {
    const res = await request(app)
      .get(`/projects/${droneProjectId}/commits/${droneCommitId}/fmu3`)
      .buffer()
      .parse(binaryParser)
      .expect(200);

    assert.ok(res.headers["content-disposition"].includes(".fmu"));
  });

  await t.test("POST /api/v1/cosim/ssp/import imports SSP and creates active session", async () => {
    assert.ok(sspBuffer, "sspBuffer from earlier test should exist");

    const res = await request(app)
      .post("/api/v1/cosim/ssp/import")
      .set("Content-Type", "application/octet-stream")
      .send(sspBuffer);

    if (res.status !== 201) {
      console.error("ssp import failed:", res.status, res.body);
    }
    assert.strictEqual(res.status, 201);

    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.sessionId, "Should return generated sessionId");
    assert.ok(res.body.participants >= 4, `Should enroll at least 4 participants (found: ${res.body.participants})`);
    assert.ok(res.body.couplings >= 3, `Should wire at least 3 couplings (found: ${res.body.couplings})`);

    // Verify session retrieval via cosim API
    const sessionRes = await request(app).get(`/api/v1/cosim/sessions/${res.body.sessionId}`).expect(200);

    assert.strictEqual(sessionRes.body.sessionId, res.body.sessionId);
    assert.strictEqual(sessionRes.body.state, "created");
  });
});

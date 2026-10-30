// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

function createDataPackageZip(name: string, version: string, dependencies?: Record<string, string>): Buffer {
  const zip = new AdmZip();

  const datapackageJson = {
    $schema: "https://datapackage.org/profiles/2.0/datapackage.json",
    profile: "engineering-data-package",
    name,
    version,
    description: "Wind turbine rotor telemetry & blade load dataset",
    license: "CC-BY-4.0",
    dependencies: dependencies ?? {},
    resources: [
      {
        name: "rotor-telemetry",
        path: "data/rotor_telemetry.csv",
        format: "csv",
        mediatype: "text/csv",
        schema: {
          fields: [
            { name: "time", type: "number", unit: "s", description: "Simulation timestamp" },
            { name: "rotor_speed", type: "number", unit: "rad/s", description: "Angular velocity" },
            { name: "blade_temp", type: "number", unit: "K", description: "Root temperature" },
          ],
        },
      },
      {
        name: "high-freq-parquet",
        path: "s3://modelscript-datasets/wind-turbine/run-001.parquet",
        format: "parquet",
        storage: "s3",
        bytes: 10485760,
        hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        schema: {
          fields: [
            { name: "time", type: "number", unit: "s" },
            { name: "root_bending_moment", type: "number", unit: "N.m" },
          ],
        },
      },
    ],
  };

  zip.addFile("datapackage.json", Buffer.from(JSON.stringify(datapackageJson, null, 2), "utf-8"));

  // CSV with physical unit annotations in header as well
  const csvContent = [
    "time [s],rotor_speed [rad/s],blade_temp (K),torque [N.m]",
    "0.0,1.20,293.15,4500.0",
    "0.5,1.35,294.00,4850.5",
    "1.0,1.50,295.20,5100.0",
  ].join("\n");
  zip.addFile("data/rotor_telemetry.csv", Buffer.from(csvContent, "utf-8"));

  return zip.toBuffer();
}

test("Frictionless Engineering Data Package & Reproducible Lockfile Pipeline", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "datapackage-lock-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const jobQueue = new JobQueue();
  const app = createApp({ database: db, storage, jobQueue });

  t.after(() => {
    try {
      jobQueue.clear();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const alice = db.createUser("alice", "alice@example.com", "hash", { emailVerified: true });
  const aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);

  // 1. Publish a base dataset package (@alice/wind-blade-loads@1.0.0)
  const baseName = "@alice/wind-blade-loads";
  const baseVersion = "1.0.0";
  const baseZip = createDataPackageZip(baseName, baseVersion);

  const pubBaseRes = await request(app)
    .post(`/api/v1/libraries/@alice/wind-blade-loads/${baseVersion}`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .attach("file", baseZip, "wind-blade-loads.zip");

  assert.strictEqual(
    pubBaseRes.status,
    201,
    `Expected 201 on base publish, got ${pubBaseRes.status}: ${JSON.stringify(pubBaseRes.body)}`,
  );

  // 2. Publish a dependent package (@alice/wind-turbine-twin@2.1.0) depending on @alice/wind-blade-loads@^1.0.0
  const twinName = "@alice/wind-turbine-twin";
  const twinVersion = "2.1.0";
  const twinZip = createDataPackageZip(twinName, twinVersion, {
    [baseName]: "^1.0.0",
  });

  const pubTwinRes = await request(app)
    .post(`/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}`)
    .set("Authorization", `Bearer ${aliceToken}`)
    .attach("file", twinZip, "wind-turbine-twin.zip");

  assert.strictEqual(pubTwinRes.status, 201, `Expected 201 on twin publish, got ${pubTwinRes.status}`);

  // 3. Verify GET /api/v1/libraries lists the Data Package under the "dataset" domain with resourcesCount
  const listRes = await request(app).get("/api/v1/libraries");
  assert.strictEqual(listRes.status, 200);
  const listedTwin = (listRes.body.packages as Array<Record<string, unknown>>).find((p) => p["name"] === twinName);
  assert.ok(listedTwin, "Expected @alice/wind-turbine-twin in library catalog");
  assert.ok(
    Array.isArray(listedTwin["domains"]) && (listedTwin["domains"] as string[]).includes("dataset"),
    `Expected 'dataset' in domains, got ${JSON.stringify(listedTwin["domains"])}`,
  );
  assert.strictEqual(listedTwin["profile"], "engineering-data-package");
  assert.ok(Number(listedTwin["resourcesCount"]) >= 2, `Expected >=2 resources, got ${listedTwin["resourcesCount"]}`);

  // 4. Verify GET /api/v1/libraries/:scope/:name/:version returns resources with physical units & external S3 pointer
  const detailRes = await request(app).get(`/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}`);
  assert.strictEqual(detailRes.status, 200);
  assert.strictEqual(detailRes.body.profile, "engineering-data-package");
  assert.ok(Array.isArray(detailRes.body.resources), "Expected resources array on package detail");

  const csvRes = detailRes.body.resources.find((r: { name: string }) => r.name === "rotor-telemetry");
  assert.ok(csvRes, "Expected rotor-telemetry resource");
  assert.strictEqual(csvRes.storage, "inline");
  assert.strictEqual(csvRes.rowCount, 3);
  assert.ok(typeof csvRes.hash === "string" && csvRes.hash.startsWith("sha256:"), "Expected sha256 hash on inline CSV");

  const speedField = csvRes.schema?.fields?.find((f: { name: string }) => f.name === "rotor_speed");
  assert.ok(speedField, "Expected rotor_speed column in schema.fields");
  assert.strictEqual(speedField.unit, "rad/s");
  assert.strictEqual(speedField.min, 1.2);
  assert.strictEqual(speedField.max, 1.5);

  const torqueField = csvRes.schema?.fields?.find((f: { name: string }) => f.name === "torque");
  assert.ok(torqueField, "Expected torque column inferred from CSV header 'torque [N.m]'");
  assert.strictEqual(torqueField.unit, "N.m");

  const parquetRes = detailRes.body.resources.find((r: { name: string }) => r.name === "high-freq-parquet");
  assert.ok(parquetRes, "Expected external S3 parquet resource");
  assert.strictEqual(parquetRes.storage, "s3");
  assert.strictEqual(parquetRes.bytes, 10485760);

  // 5. Verify ?lens=datapackage and /export/datapackage projection
  const lensRes = await request(app).get(
    `/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}/manifest?lens=datapackage`,
  );
  assert.strictEqual(lensRes.status, 200);
  assert.strictEqual(lensRes.body.profile, "engineering-data-package");
  assert.strictEqual(lensRes.body.name, twinName);
  assert.ok(Array.isArray(lensRes.body.resources) && lensRes.body.resources.length >= 2);

  const exportDpRes = await request(app).get(
    `/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}/export/datapackage`,
  );
  assert.strictEqual(exportDpRes.status, 200);
  assert.match(String(exportDpRes.headers["content-disposition"]), /\.datapackage\.json/);

  // 6. Verify deterministic transitive lockfile resolution (/lockfile & POST /resolve-lockfile)
  const lockRes1 = await request(app).get(`/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}/lockfile`);
  const lockRes2 = await request(app).get(`/api/v1/libraries/@alice/wind-turbine-twin/${twinVersion}/lockfile`);
  assert.strictEqual(lockRes1.status, 200);
  assert.strictEqual(lockRes1.body.lockfileVersion, 1);
  assert.strictEqual(
    lockRes1.body.lockfileIntegrity,
    lockRes2.body.lockfileIntegrity,
    "Lockfile integrity digest must be deterministic across invocations",
  );
  assert.ok(lockRes1.body.packages[`${twinName}@${twinVersion}`], "Expected root package in lockfile packages map");
  assert.ok(
    lockRes1.body.packages[`${baseName}@${baseVersion}`],
    "Expected transitive dependency @alice/wind-blade-loads@1.0.0 in lockfile packages map",
  );
  assert.ok(
    lockRes1.body.packages[`${baseName}@${baseVersion}`].resources["rotor-telemetry"]?.hash.startsWith("sha256:"),
    "Expected dataset resource SHA-256 hash pinned inside lockfile",
  );

  // 7. Verify Cloud Simulation dispatch attaches a reproducible datapackage.lock.json
  const cloudRes = await request(app)
    .post("/api/v1/cloud/dispatch")
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({
      domain: "modelica",
      name: "WindTurbineTwinSim",
      libraryName: twinName,
      libraryVersion: twinVersion,
      experiment: {
        stopTime: 10,
        interval: 0.05,
        tolerance: 1e-6,
      },
    });

  assert.strictEqual(cloudRes.status, 202, `Expected 202 from /cloud/dispatch, got ${cloudRes.status}`);
  assert.ok(cloudRes.body.lockfile, "Expected lockfile attached to cloud dispatch response");
  assert.strictEqual(cloudRes.body.lockfile.lockfileVersion, 1);
  assert.ok(
    cloudRes.body.lockfile.packages[`${baseName}@${baseVersion}`],
    "Expected transitive data package locked in cloud simulation job lockfile",
  );

  const cloudLockEndpointRes = await request(app)
    .get(`/api/v1/cloud/jobs/${cloudRes.body.jobId}/lockfile`)
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.strictEqual(cloudLockEndpointRes.status, 200);
  assert.strictEqual(cloudLockEndpointRes.body.lockfileIntegrity, cloudRes.body.lockfile.lockfileIntegrity);
});

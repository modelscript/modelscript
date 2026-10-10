// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";

test("Server-Side CAD Mesh Caching and Version Compare API", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-mesh-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const pkgName = "DroneChassis";
  const user = db.createUser("cad_engineer", "cad@example.com", "hash", { emailVerified: true });
  const { id: pkgId } = db.getOrCreatePackage(pkgName, user.id);

  // Setup versions 1.0.0 and 1.1.0
  const v1Id = db.storePackageVersion(
    pkgId,
    "1.0.0",
    "DroneChassis-1.0.0.zip",
    "sha1.0.0",
    null,
    50000,
    "{}",
    null,
    user.id,
  );
  const v2Id = db.storePackageVersion(
    pkgId,
    "1.1.0",
    "DroneChassis-1.1.0.zip",
    "sha1.1.0",
    null,
    52000,
    "{}",
    null,
    user.id,
  );

  // Add classes for 1.0.0
  db.storeClassMetadata(pkgName, "1.0.0", {
    className: "OldSensor",
    classKind: "model",
    description: "Old sensor model",
    documentation: null,
    baseClasses: [],
    components: [],
  });
  db.storeClassMetadata(pkgName, "1.0.0", {
    className: "Motor",
    classKind: "model",
    description: "Electric motor",
    documentation: null,
    baseClasses: [],
    components: [
      {
        name: "tau_max",
        typeName: "Real",
        description: null,
        causality: null,
        variability: null,
        modifiers: [{ name: "tau_max", value: "250" }],
      },
      {
        name: "speed_sensor",
        typeName: "Modelica.SIunits.Angle",
        description: null,
        causality: null,
        variability: null,
        modifiers: [],
      },
    ],
  });

  // Add classes for 1.1.0
  db.storeClassMetadata(pkgName, "1.1.0", {
    className: "Motor",
    classKind: "model",
    description: "Electric motor v2",
    documentation: null,
    baseClasses: [],
    components: [
      {
        name: "tau_max",
        typeName: "Real",
        description: null,
        causality: null,
        variability: null,
        modifiers: [{ name: "tau_max", value: "320" }],
      },
      {
        name: "speed_sensor",
        typeName: "Modelica.SIunits.Frequency",
        description: null,
        causality: null,
        variability: null,
        modifiers: [],
      },
    ],
  });
  db.storeClassMetadata(pkgName, "1.1.0", {
    className: "Inverter",
    classKind: "model",
    description: "Power electronics inverter",
    documentation: null,
    baseClasses: [],
    components: [
      {
        name: "v_dc",
        typeName: "Real",
        description: null,
        causality: null,
        variability: null,
        modifiers: [{ name: "v_dc", value: "400" }],
      },
    ],
  });

  // Add CAD artifacts
  db.storeArtifact(v1Id, "cad", "cad/casing.step", null);
  db.storeArtifact(v2Id, "cad", "cad/casing.step", null);

  // Pre-cache CAD mesh in storage for 1.0.0 and 1.1.0
  const meshData1 = {
    meshes: [
      {
        attributes: {
          position: { array: [0, 0, 0, 10, 0, 0, 10, 10, 0] },
          normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
        },
        index: { array: [0, 1, 2] },
      },
    ],
    properties: { volume: 100.0, surfaceArea: 50.0 },
  };

  const meshData2 = {
    meshes: [
      {
        attributes: {
          position: { array: [0, 0, 0, 10.5, 0, 0, 10.5, 10, 0] },
          normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
        },
        index: { array: [0, 1, 2] },
      },
    ],
    properties: { volume: 105.0, surfaceArea: 52.5 },
  };

  storage.storeCadMesh(pkgName, "1.0.0", "cad/casing.step", JSON.stringify(meshData1));
  storage.storeCadMesh(pkgName, "1.1.0", "cad/casing.step", JSON.stringify(meshData2));

  await t.test("1. Serves pre-cached CAD mesh directly with fast-path", async () => {
    const res = await request(app).get(`/api/v1/libraries/${pkgName}/1.0.0/cad-mesh/cad/casing.step`).expect(200);

    assert.strictEqual(res.headers["content-type"].includes("application/json"), true);
    assert.strictEqual(res.body.meshes.length, 1);
    assert.strictEqual(res.body.properties.volume, 100.0);
  });

  await t.test("2. Returns 404 for nonexistent CAD mesh", async () => {
    await request(app).get(`/api/v1/libraries/${pkgName}/1.0.0/cad-mesh/cad/missing.step`).expect(404);
  });

  await t.test("3. Version Compare API detects physical class, parameter, CAD, and unit parity drift", async () => {
    const res = await request(app).get(`/api/v1/libraries/${pkgName}/compare?base=1.0.0&head=1.1.0`).expect(200);

    assert.strictEqual(res.body.versionDelta.base, "1.0.0");
    assert.strictEqual(res.body.versionDelta.head, "1.1.0");

    // Added class: Inverter
    assert.strictEqual(res.body.classes.added.length, 1);
    assert.strictEqual(res.body.classes.added[0].name, "Inverter");

    // Removed class: OldSensor
    assert.strictEqual(res.body.classes.removed.length, 1);
    assert.strictEqual(res.body.classes.removed[0].name, "OldSensor");

    // Modified class: Motor with tau_max change (250 -> 320)
    assert.strictEqual(res.body.classes.modified.length, 1);
    assert.strictEqual(res.body.classes.modified[0].name, "Motor");
    const tauChange = res.body.classes.modified[0].parameterChanges.find((p: any) => p.name === "tau_max");
    assert.ok(tauChange);
    assert.strictEqual(tauChange.old, "250");
    assert.strictEqual(tauChange.new, "320");

    // CAD changes: volume delta +5.0%
    assert.strictEqual(res.body.cadChanges.length, 1);
    assert.strictEqual(res.body.cadChanges[0].file, "cad/casing.step");
    assert.strictEqual(res.body.cadChanges[0].status, "modified");
    assert.strictEqual(res.body.cadChanges[0].volumeDeltaPercent, 5.0);

    // Parity drift: unit shift detected
    assert.strictEqual(res.body.parityDrift.length, 1);
    assert.strictEqual(res.body.parityDrift[0].parameter, "speed_sensor");
    assert.strictEqual(res.body.parityDrift[0].oldUnit, "Modelica.SIunits.Angle");
    assert.strictEqual(res.body.parityDrift[0].newUnit, "Modelica.SIunits.Frequency");
  });

  await t.test("4. Version Compare API validates required query params", async () => {
    await request(app).get(`/api/v1/libraries/${pkgName}/compare?base=1.0.0`).expect(400);

    await request(app).get(`/api/v1/libraries/${pkgName}/compare?head=1.1.0`).expect(400);

    await request(app).get(`/api/v1/libraries/${pkgName}/compare?base=1.0.0&head=9.9.9`).expect(404);
  });
});

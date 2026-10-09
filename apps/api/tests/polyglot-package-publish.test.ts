// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { ingestSalsaIndex } from "../../../packages/lsp/src/vfs/salsa-index-ingester.js";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

function createMockPolyglotZip(name: string, version: string): Buffer {
  const zip = new AdmZip();

  // package.json manifest (no package.mo!)
  const pkgJson = {
    name,
    version,
    description: "Multi-domain drone chassis with CAD, SysML, and simulation results",
    author: "Alice Engineer",
  };
  zip.addFile("package.json", Buffer.from(JSON.stringify(pkgJson, null, 2), "utf-8"));

  // CAD STEP artifact
  const stepContent = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Sample Frame'),'2;1');
FILE_NAME('frame.step','2026-10-09',('Author'),('Org'),'Preprocessor','OriginatingSystem','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('DroneFrame','DroneFrame','',(#2));
#2=MANIFOLD_SOLID_BREP('SolidArm',#3);
ENDSEC;
END-21;`;
  zip.addFile("cad/frame.step", Buffer.from(stepContent, "utf-8"));

  // SysML v2 artifact
  const sysmlContent = `package DroneArchitecture {
  part def Chassis {
    attribute mass : Real;
  }
}`;
  zip.addFile("sysml/chassis.sysml", Buffer.from(sysmlContent, "utf-8"));

  // CSV table artifact
  const csvContent = "time,thrust,voltage\n0.0,0.0,12.0\n0.5,15.2,11.8\n1.0,30.5,11.5\n";
  zip.addFile("data/telemetry.csv", Buffer.from(csvContent, "utf-8"));

  return zip.toBuffer();
}

test("Polyglot Package Publishing & Extensible Artifact Indexing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polyglot-test-"));
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

  const pkgName = "@alice/drone-chassis";
  const pkgVersion = "1.0.0";
  const zipBuffer = createMockPolyglotZip(pkgName, pkgVersion);

  await t.test("Alice publishes polyglot package with package.json (no package.mo)", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", zipBuffer, "library.zip");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(storage.exists(pkgName, pkgVersion), true);

    const releases = db.getLibraryReleases(pkgName);
    assert.strictEqual(releases.length, 1);
    assert.strictEqual(releases[0]?.library_name, pkgName);
  });

  await t.test("Extracted directory contains package.json and polyglot files", async () => {
    const extPath = storage.getExtractedPath(pkgName, pkgVersion);
    assert.strictEqual(fs.existsSync(extPath), true);
    assert.strictEqual(fs.existsSync(path.join(extPath, "package.json")), true);
    assert.strictEqual(fs.existsSync(path.join(extPath, "cad/frame.step")), true);
    assert.strictEqual(fs.existsSync(path.join(extPath, "sysml/chassis.sysml")), true);
    assert.strictEqual(fs.existsSync(path.join(extPath, "data/telemetry.csv")), true);
  });

  await t.test("Background publish worker completes polyglot indexing into salsa-index.db", async () => {
    const jobKey = `${pkgName}@${pkgVersion}`;
    for (let i = 0; i < 40; i++) {
      const status = jobQueue.getStatus(jobKey);
      if (status?.status === "completed" || status?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const finalStatus = jobQueue.getStatus(jobKey);
    assert.strictEqual(finalStatus?.status, "completed", `Job should complete without error: ${finalStatus?.error}`);

    // Verify salsa-index.db exists
    const indexPath = storage.getIndexPath(pkgName, pkgVersion);
    assert.strictEqual(fs.existsSync(indexPath), true);

    // Verify lsp-bundle.zip exists
    const bundlePath = path.join(path.dirname(indexPath), "lsp-bundle.zip");
    assert.strictEqual(fs.existsSync(bundlePath), true);

    // Verify SQLite contains symbols from both CAD and SysML2
    const sqlite = new Database(indexPath);
    const rows = sqlite.prepare("SELECT id, data FROM symbols").all();
    assert.ok(rows.length > 0, "Symbols table in salsa-index.db must contain symbols");
    const symbols = rows.map((r: any) => JSON.parse(r.data));

    const hasDroneFrame = symbols.some((s: any) => s.name === "DroneFrame");
    const hasSolidArm = symbols.some((s: any) => s.name === "SolidArm");
    const hasDroneArch = symbols.some((s: any) => s.name === "DroneArchitecture");
    const hasChassis = symbols.some((s: any) => s.name === "Chassis");

    assert.strictEqual(hasDroneFrame, true, "salsa-index.db should contain CAD product DroneFrame");
    assert.strictEqual(hasSolidArm, true, "salsa-index.db should contain CAD shape SolidArm");
    assert.strictEqual(hasDroneArch, true, "salsa-index.db should contain SysML package DroneArchitecture");
    assert.strictEqual(hasChassis, true, "salsa-index.db should contain SysML part def Chassis");
    sqlite.close();
  });

  await t.test("GET /api/v1/libraries/:scope/:name/:version/salsa-index.db serves database", async () => {
    const res = await request(app)
      .get(`/api/v1/libraries/${pkgName}/${pkgVersion}/salsa-index.db`)
      .responseType("blob");

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.length > 0, "Response body must contain binary SQLite db");

    // Verify client can hydrate symbols directly from downloaded buffer
    const mockCacheStore = { setMemos: async () => {} } as any;
    const mockEngine = {
      index: {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      },
    };

    const { symbols: hydratedCount } = await ingestSalsaIndex(res.body.buffer, mockCacheStore, mockEngine);
    assert.ok(hydratedCount > 0, "Hydrated symbols should be > 0");
    assert.ok(mockEngine.index.byName.has("DroneFrame"), "Should hydrate DroneFrame");
    assert.ok(mockEngine.index.byName.has("Chassis"), "Should hydrate Chassis");
  });

  await t.test(
    "GET /api/v1/libraries/:scope/:name/:version/logs/stream provides SSE stream with init event",
    async () => {
      const res = await request(app)
        .get(`/api/v1/libraries/${pkgName}/${pkgVersion}/logs/stream`)
        .expect(200)
        .expect("Content-Type", /^text\/event-stream/);

      assert.ok(res.text.includes("event: init"), "Stream must include init event");
      assert.ok(res.text.includes('"status":"completed"'), "Init event must include completed status");
    },
  );
});

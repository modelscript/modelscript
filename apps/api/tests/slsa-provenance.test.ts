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

const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-slsa-uploads-"));
process.env["UPLOAD_TEMP_DIR"] = testUploadDir;

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";
import { generateSlsaProvenance } from "../src/util/slsa-provenance.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

test("SLSA Level 3 Provenance & in-toto Build Attestation Generator", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slsa-test-"));
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
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Unit: generateSlsaProvenance builds valid in-toto Statement & DSSE Envelope", () => {
    const rawContentHash = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const result = generateSlsaProvenance({
      packageName: "@acme/flight-control",
      version: "2.1.0",
      contentHash: rawContentHash,
      manifest: {
        name: "@acme/flight-control",
        version: "2.1.0",
        license: "Apache-2.0",
        main: "FlightControl.mo",
        repository: "https://github.com/acme/flight-control",
      },
      release: {
        id: 1,
        library_name: "@acme/flight-control",
        library_version: "2.1.0",
        content_hash: rawContentHash,
        signature: "ed25519-mock-sig-base64",
        published_by: 42,
        published_at: new Date().toISOString(),
      },
      dependencies: {
        "Modelica@4.0.0": {
          version: "4.0.0",
          integrity: "sha256:01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
        },
      },
    });

    assert.strictEqual(result.slsaLevel, "SLSA_BUILD_LEVEL_3");
    assert.strictEqual(result.statement._type, "https://in-toto.io/Statement/v1");
    assert.strictEqual(result.statement.predicateType, "https://slsa.dev/provenance/v1");

    // Subject
    assert.strictEqual(result.statement.subject.length, 1);
    assert.strictEqual(result.statement.subject[0]?.name, "@acme/flight-control");
    assert.strictEqual(
      result.statement.subject[0]?.digest["sha256"],
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

    // Build Definition
    const bDef = result.statement.predicate.buildDefinition;
    assert.strictEqual(bDef.buildType, "https://modelscript.org/attestations/package-build/v1");
    assert.strictEqual(bDef.externalParameters["package"], "@acme/flight-control");
    assert.strictEqual(bDef.externalParameters["version"], "2.1.0");
    assert.strictEqual(bDef.externalParameters["entryPoint"], "FlightControl.mo");
    assert.strictEqual(bDef.externalParameters["license"], "Apache-2.0");

    // Dependencies
    assert.strictEqual(bDef.resolvedDependencies.length, 1);
    assert.strictEqual(bDef.resolvedDependencies[0]?.uri, "pkg:modelscript/Modelica@4.0.0");
    assert.strictEqual(
      bDef.resolvedDependencies[0]?.digest["sha256"],
      "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
    );

    // DSSE Envelope
    assert.ok(result.dsseEnvelope);
    assert.strictEqual(result.dsseEnvelope.payloadType, "application/vnd.in-toto+json");
    assert.strictEqual(result.dsseEnvelope.signatures[0]?.sig, "ed25519-mock-sig-base64");
    assert.strictEqual(result.dsseEnvelope.signatures[0]?.keyid, "account:42");

    // Verify DSSE payload is base64 JSON of statement
    const decodedPayload = JSON.parse(Buffer.from(result.dsseEnvelope.payload, "base64").toString("utf8"));
    assert.strictEqual(decodedPayload._type, "https://in-toto.io/Statement/v1");
  });

  await t.test("HTTP API: GET /api/v1/libraries/:name/:version/provenance.json and .jsonl", async () => {
    const user = db.createUser("carol", "carol@modelscript.test", "hashed_pwd", { emailVerified: true });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    const pkgZip = createZipWithFiles({
      "package.json": JSON.stringify({
        name: "@carol/SensorKit",
        version: "1.0.0",
        description: "High-precision IMU sensor library",
        license: "MIT",
        dependencies: {},
      }),
      "package.mo": "package SensorKit\nend SensorKit;\n",
    });

    // Publish package
    const pubRes = await request(app)
      .post("/api/v1/libraries/@carol/SensorKit/1.0.0")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", pkgZip, "sensorkit-1.0.0.zip");

    assert.strictEqual(pubRes.status, 201);

    // 1. Fetch provenance.json
    const provRes = await request(app).get("/api/v1/libraries/@carol/SensorKit/1.0.0/provenance.json");

    assert.strictEqual(provRes.status, 200);
    assert.strictEqual(provRes.body._type, "https://in-toto.io/Statement/v1");
    assert.strictEqual(provRes.body.predicateType, "https://slsa.dev/provenance/v1");
    assert.strictEqual(provRes.body.subject[0].name, "@carol/SensorKit");
    assert.ok(provRes.body.subject[0].digest.sha256);

    // 2. Fetch provenance.intoto.jsonl
    const jsonlRes = await request(app).get("/api/v1/libraries/@carol/SensorKit/1.0.0/provenance.intoto.jsonl");

    assert.strictEqual(jsonlRes.status, 200);
    assert.ok(jsonlRes.headers["content-type"].includes("application/x-ndjson"));
    const parsedLine = JSON.parse(jsonlRes.text.trim());
    assert.strictEqual(parsedLine._type, "https://in-toto.io/Statement/v1");

    // 3. Fetch full provenance (format=full)
    const fullRes = await request(app).get("/api/v1/libraries/@carol/SensorKit/1.0.0/provenance.json?format=full");

    assert.strictEqual(fullRes.status, 200);
    assert.ok(fullRes.body.statement);
    assert.ok(fullRes.body.slsaLevel);
  });
});

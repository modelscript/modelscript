// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-proxy-uploads-"));
process.env["UPLOAD_TEMP_DIR"] = testUploadDir;

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

test("Multi-Tier Private Registry Proxy, Upstream Fallback & Write-Through Local CAS Caching", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const jobQueue = new JobQueue();

  // Create upstream mock servers
  // 1. Primary Upstream (Tier 1: returns 404 for test package)
  const server1 = http.createServer((req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found on primary hub" }));
  });

  const pkgZip = createZipWithFiles({
    "package.json": JSON.stringify({
      name: "UpstreamThermalLib",
      version: "3.2.0",
      description: "Upstream thermal systems modeling library",
      license: "BSD-3-Clause",
    }),
    "package.mo": 'package UpstreamThermalLib\n  annotation(version="3.2.0");\nend UpstreamThermalLib;\n',
  });

  // 2. Secondary Upstream (Tier 2: has UpstreamThermalLib@3.2.0)
  const server2 = http.createServer((req, res) => {
    if (req.url === "/api/v1/libraries/UpstreamThermalLib") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          name: "UpstreamThermalLib",
          versions: ["3.2.0"],
          releases: [{ version: "3.2.0", isYanked: false, isDeprecated: false }],
        }),
      );
      return;
    }

    if (req.url === "/api/v1/libraries/UpstreamThermalLib/3.2.0/download") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(pkgZip.length),
        "Content-Disposition": 'attachment; filename="UpstreamThermalLib-3.2.0.zip"',
      });
      res.end(pkgZip);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => server1.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));

  const port1 = (server1.address() as import("node:net").AddressInfo).port;
  const port2 = (server2.address() as import("node:net").AddressInfo).port;

  // Configure multiple upstreams: Tier 1 then Tier 2
  process.env["UPSTREAM_REGISTRIES"] = `http://127.0.0.1:${port1}, http://127.0.0.1:${port2}`;

  const app = createApp({ database: db, storage, jobQueue });

  t.after(() => {
    try {
      jobQueue.clear();
      db.db.close();
      server1.close();
      server2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Proxies package metadata from secondary upstream when primary returns 404", async () => {
    // UpstreamThermalLib does not exist in local database/storage
    assert.strictEqual(Boolean(storage.read("UpstreamThermalLib", "3.2.0")), false);

    const res = await request(app).get("/api/v1/libraries/UpstreamThermalLib");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, "UpstreamThermalLib");
    assert.deepStrictEqual(res.body.versions, ["3.2.0"]);
  });

  await t.test("Proxies package download, writes through to local CAS store, and serves cached copy", async () => {
    // 1. Initial proxy download
    const res = await request(app).get("/api/v1/libraries/UpstreamThermalLib/3.2.0/download");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "application/zip");
    assert.strictEqual(Number(res.headers["content-length"]), pkgZip.length);

    // 2. Verify write-through caching in local CAS storage
    const localFile = storage.read("UpstreamThermalLib", "3.2.0");
    assert.ok(localFile);
    assert.strictEqual(localFile.buffer.length, pkgZip.length);

    // 3. Stop upstream servers to guarantee local cache hit on subsequent requests
    server1.close();
    server2.close();

    const cachedRes = await request(app).get("/api/v1/libraries/UpstreamThermalLib/3.2.0/download");
    assert.strictEqual(cachedRes.status, 200);
    assert.strictEqual(Number(cachedRes.headers["content-length"]), pkgZip.length);
  });
});

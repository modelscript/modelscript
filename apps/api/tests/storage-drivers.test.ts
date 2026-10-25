// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConflictError, FilesystemStorageDriver, LibraryStorage, S3StorageDriver } from "../src/storage.js";

test("Pluggable Storage Drivers (Filesystem, S3/MinIO, and LibraryStorage)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-driver-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test("FilesystemStorageDriver: write, read, exists, list, and delete", async () => {
    const fsDriver = new FilesystemStorageDriver(path.join(tmpDir, "fs-driver"));
    assert.strictEqual(fsDriver.driverName, "filesystem");

    const sampleBuffer = Buffer.from("Hello ModelScript Storage");
    await fsDriver.write("packages/test/1.0.0.zip", sampleBuffer);

    const exists = await fsDriver.exists("packages/test/1.0.0.zip");
    assert.strictEqual(exists, true);

    const notExists = await fsDriver.exists("packages/test/2.0.0.zip");
    assert.strictEqual(notExists, false);

    const readBuf = await fsDriver.read("packages/test/1.0.0.zip");
    assert.ok(readBuf);
    assert.strictEqual(readBuf.toString("utf-8"), "Hello ModelScript Storage");

    const meta = await fsDriver.getMetadata("packages/test/1.0.0.zip");
    assert.ok(meta);
    assert.strictEqual(meta.size, sampleBuffer.length);
    assert.ok(meta.contentHash.startsWith("sha256:"));

    const keys = await fsDriver.list("packages");
    assert.ok(keys.includes("packages/test/1.0.0.zip"));

    const deleted = await fsDriver.delete("packages/test/1.0.0.zip");
    assert.strictEqual(deleted, true);
    assert.strictEqual(await fsDriver.exists("packages/test/1.0.0.zip"), false);
  });

  await t.test("LibraryStorage: pluggable driver delegation and multi-version management", async () => {
    const libStorage = new LibraryStorage(path.join(tmpDir, "lib-storage"));
    assert.strictEqual(libStorage.driver.driverName, "filesystem");

    const dummyZip = Buffer.from("PK\x03\x04DummyZipContent");
    const storedPath = await libStorage.store("ModelicaLib", "1.0.0", dummyZip);
    assert.ok(fs.existsSync(storedPath));

    assert.strictEqual(libStorage.exists("ModelicaLib", "1.0.0"), true);
    assert.strictEqual(libStorage.exists("ModelicaLib", "2.0.0"), false);

    // Storing duplicate throws ConflictError
    await assert.rejects(async () => {
      await libStorage.store("ModelicaLib", "1.0.0", dummyZip);
    }, ConflictError);

    // Read back
    const file = libStorage.read("ModelicaLib", "1.0.0");
    assert.ok(file);
    assert.strictEqual(file.buffer.toString(), dummyZip.toString());

    // Content hash
    const hash = libStorage.getContentHash("ModelicaLib", "1.0.0");
    assert.ok(hash && hash.startsWith("sha256:"));

    // Delete
    const deleted = libStorage.delete("ModelicaLib", "1.0.0");
    assert.strictEqual(deleted, true);
    assert.strictEqual(libStorage.exists("ModelicaLib", "1.0.0"), false);
  });

  await t.test("S3StorageDriver: SigV4 generation and S3 REST protocol against mock S3 server", async () => {
    const s3Objects = new Map<string, Buffer>();

    // Spin up lightweight mock S3 HTTP server
    const mockS3 = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const key = url.pathname.replace(/^\/test-bucket\/?/, "");

      // Verify SigV4 header present
      const auth = req.headers["authorization"];
      if (!auth || !auth.startsWith("AWS4-HMAC-SHA256")) {
        res.writeHead(403, { "Content-Type": "application/xml" });
        res.end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }

      if (req.method === "HEAD") {
        if (!s3Objects.has(key)) {
          res.writeHead(404).end();
          return;
        }
        const buf = s3Objects.get(key)!;
        res
          .writeHead(200, {
            "Content-Length": String(buf.length),
            ETag: `"${buf.length}"`,
          })
          .end();
        return;
      }

      if (req.method === "GET") {
        if (url.searchParams.get("list-type") === "2") {
          // ListBucket
          const prefix = url.searchParams.get("prefix") || "";
          const matching = Array.from(s3Objects.keys()).filter((k) => k.startsWith(prefix));
          const keysXml = matching.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("");
          res.writeHead(200, { "Content-Type": "application/xml" });
          res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${keysXml}</ListBucketResult>`);
          return;
        }

        if (!s3Objects.has(key)) {
          res.writeHead(404).end();
          return;
        }
        const buf = s3Objects.get(key)!;
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(buf);
        return;
      }

      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          s3Objects.set(key, Buffer.concat(chunks));
          res.writeHead(200).end();
        });
        return;
      }

      if (req.method === "DELETE") {
        s3Objects.delete(key);
        res.writeHead(204).end();
        return;
      }

      res.writeHead(405).end();
    });

    await new Promise<void>((resolve) => mockS3.listen(0, "127.0.0.1", resolve));
    const addr = mockS3.address() as any;
    const mockEndpoint = `http://127.0.0.1:${addr.port}`;

    try {
      const s3Driver = new S3StorageDriver({
        bucket: "test-bucket",
        endpoint: mockEndpoint,
        region: "us-east-1",
        accessKeyId: "TEST_AKID",
        secretAccessKey: "TEST_SECRET",
        forcePathStyle: true,
      });

      assert.strictEqual(s3Driver.driverName, "s3");

      const testPayload = Buffer.from("S3 Upload Payload for ModelScript");
      await s3Driver.write("packages/s3test/1.0.0.zip", testPayload);

      const exists = await s3Driver.exists("packages/s3test/1.0.0.zip");
      assert.strictEqual(exists, true);

      const readBack = await s3Driver.read("packages/s3test/1.0.0.zip");
      assert.ok(readBack);
      assert.strictEqual(readBack.toString("utf-8"), "S3 Upload Payload for ModelScript");

      const list = await s3Driver.list("packages/s3test");
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0], "packages/s3test/1.0.0.zip");

      const deleted = await s3Driver.delete("packages/s3test/1.0.0.zip");
      assert.strictEqual(deleted, true);
      assert.strictEqual(await s3Driver.exists("packages/s3test/1.0.0.zip"), false);
    } finally {
      mockS3.close();
    }
  });
});

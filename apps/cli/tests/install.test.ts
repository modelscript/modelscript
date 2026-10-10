// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Install } from "../src/commands/install.js";

describe("msx install CLI command", () => {
  let server: http.Server;
  let serverUrl: string;
  const testDir = path.join(process.cwd(), "apps/cli/tests/.tmp-install-test");

  // Create a dummy zip archive
  const zip = new AdmZip();
  zip.addFile("package.mo", Buffer.from("package TestPkg\nend TestPkg;\n"));
  zip.addFile("TestPkg/Model.mo", Buffer.from("model Model\nend Model;\n"));
  const zipBuffer = zip.toBuffer();
  const zipHash = `sha256:${crypto.createHash("sha256").update(zipBuffer).digest("hex")}`;

  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWrite: typeof process.stdout.write;

  before(async () => {
    origLog = console.log;
    origError = console.error;
    origWrite = process.stdout.write;
    console.log = () => {};
    console.error = () => {};
    (process.stdout as any).write = () => true;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/api/v1/libraries/TestPkg") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "TestPkg",
            latestVersion: "1.2.0",
            versions: [{ version: "1.2.0" }],
          }),
        );
        return;
      }

      if (pathname === "/api/v1/libraries/TestPkg/1.2.0/download") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "x-content-sha256": zipHash,
        });
        res.end(zipBuffer);
        return;
      }

      if (pathname === "/api/v1/libraries/@scope/scoped-pkg") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "@scope/scoped-pkg",
            latestVersion: "0.5.0",
            versions: [{ version: "0.5.0" }],
          }),
        );
        return;
      }

      if (pathname === "/api/v1/libraries/@scope/scoped-pkg/0.5.0/download") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "x-content-sha256": zipHash,
        });
        res.end(zipBuffer);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origWrite;
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("installs a package by name and verifies CAS checksum", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      // Create initial package.json
      writeFileSync("package.json", JSON.stringify({ name: "my-project", dependencies: {} }, null, 2));

      await (Install.handler as any)({
        package: "TestPkg",
        save: true,
      });

      // Check extracted directory
      assert.ok(existsSync(path.join(testDir, "libraries", "TestPkg", "package.mo")));
      assert.ok(existsSync(path.join(testDir, "libraries", "TestPkg", "TestPkg", "Model.mo")));

      // Check package.json was updated
      const updatedPkg = JSON.parse(readFileSync("package.json", "utf-8"));
      assert.equal(updatedPkg.dependencies["TestPkg"], "^1.2.0");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("installs a scoped package and normalizes directory", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      await (Install.handler as any)({
        package: "@scope/scoped-pkg@0.5.0",
        save: false,
      });

      assert.ok(existsSync(path.join(testDir, "libraries", "@scope__scoped-pkg", "package.mo")));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

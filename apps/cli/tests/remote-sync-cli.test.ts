// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(__dirname, "../dist/main.js");

describe("msx CLI: modelscript.yaml + modelscript.lock + .modelscript/packages/ + ALM sync", () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpDir: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-cli-alm-"));
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/rm/modules/MOD-1") {
        res.writeHead(200, { "Content-Type": "application/ld+json" });
        res.end(
          JSON.stringify({
            "trs:cursor": "trs:100",
            "rdfs:member": [
              {
                "@id": `${baseUrl}/rm/resources/REQ-001`,
                "dcterms:identifier": "REQ-001",
                "dcterms:title": "Voltage Limit",
                "dcterms:description": "Bus voltage shall not exceed 850 V.",
                "oslc_rm:status": "Approved",
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ title: "Mock OSLC Server", version: "3.0" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs msx init -> msx remote add -> msx sync pull -> msx sync status end-to-end", async () => {
    const runCli = async (args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync(process.execPath, [cliBin, ...args], {
        cwd: tmpDir,
        encoding: "utf-8",
      });
      return stdout;
    };

    // 1. msx init -y -> creates modelscript.yaml and .gitignore with .modelscript/
    await runCli(["init", "-y"]);
    const manifestPath = path.join(tmpDir, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath));
    assert.ok(!fs.existsSync(path.join(tmpDir, "package.json")));
    assert.ok(fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8").includes(".modelscript/"));

    // 2. msx remote add -> updates modelscript.yaml
    await runCli([
      "remote",
      "add",
      "@reqs/hv-bus",
      `oslc+${baseUrl}/rm/modules/MOD-1`,
      "--baseline",
      "Rel-1.0",
      "--materialize",
      "requirements/doors",
    ]);
    const yamlContent = fs.readFileSync(manifestPath, "utf-8");
    assert.ok(yamlContent.includes("@reqs/hv-bus"));
    assert.ok(yamlContent.includes("requirements/doors"));

    // 3. msx remote list
    const listOut = await runCli(["remote", "list"]);
    assert.ok(listOut.includes("@reqs/hv-bus"));

    // 4. msx sync pull -> writes materialized .sysml + modelscript.lock
    const pullOut = await runCli(["sync", "pull"]);
    assert.ok(pullOut.includes("Synced @reqs/hv-bus"));

    const lockPath = path.join(tmpDir, "modelscript.lock");
    assert.ok(fs.existsSync(lockPath));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    assert.equal(lock.lockfileVersion, 2);
    assert.equal(lock.packages["@reqs/hv-bus"].remote.connector, "oslc");
    assert.equal(lock.packages["@reqs/hv-bus"].remote.cursor, "trs:100");

    const sysmlFile = path.join(tmpDir, "requirements", "doors", "reqs_hv_bus.sysml");
    assert.ok(fs.existsSync(sysmlFile));
    assert.ok(fs.readFileSync(sysmlFile, "utf-8").includes("Bus voltage shall not exceed 850 V."));

    // 5. msx sync status -> reports up to date
    const statusOut = await runCli(["sync", "status"]);
    assert.ok(statusOut.includes("up to date"));
  });
});

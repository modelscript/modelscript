// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { Mirror } from "../src/commands/mirror.js";
import { Vendor } from "../src/commands/vendor.js";
import { defaultPackageStore } from "../src/util/store.js";

describe("Air-Gap Offline Tooling: msx vendor & msx mirror", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-mirror-test-"));
  const workspaceDir = path.join(tmpDir, "workspace");
  const vendorOutDir = path.join(workspaceDir, "vendor");
  const mirrorDir = path.join(tmpDir, "mirror-output");
  const mirrorBundleZip = path.join(tmpDir, "airgap-bundle.zip");

  fs.mkdirSync(workspaceDir, { recursive: true });

  // Create mock package zip archives
  const powerGridZip = new AdmZip();
  powerGridZip.addFile(
    "package.json",
    Buffer.from(
      JSON.stringify({
        name: "@org/power-grid",
        version: "1.2.0",
        description: "Power grid simulation components",
        dependencies: {
          "@org/substation": "1.0.0",
        },
      }),
    ),
  );
  powerGridZip.addFile(
    "package.mo",
    Buffer.from('package power_grid\n  annotation(version="1.2.0");\nend power_grid;\n'),
  );
  powerGridZip.addFile("Grid.mo", Buffer.from("model Grid\n  parameter Real voltage = 400e3;\nend Grid;\n"));
  const powerGridBuffer = powerGridZip.toBuffer();

  const substationZip = new AdmZip();
  substationZip.addFile(
    "package.json",
    Buffer.from(
      JSON.stringify({
        name: "@org/substation",
        version: "1.0.0",
        description: "Substation components",
      }),
    ),
  );
  substationZip.addFile(
    "package.mo",
    Buffer.from('package substation\n  annotation(version="1.0.0");\nend substation;\n'),
  );
  const substationBuffer = substationZip.toBuffer();

  const mockSalsaBuffer = Buffer.from("SQLITE3_MOCK_SALSA_MEMOIZATION_DATABASE_INDEX_PAYLOAD");

  let server: http.Server;
  let serverUrl: string;

  test.before(async () => {
    // Start a mock registry HTTP server
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const p = url.pathname;

        // @org/power-grid versions
        if (p === "/api/v1/libraries/%40org/power-grid" || p === "/api/v1/libraries/@org/power-grid") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ versions: ["1.2.0"], version: "1.2.0" }));
          return;
        }

        // @org/power-grid manifest
        if (p === "/api/v1/libraries/%40org/power-grid/1.2.0" || p === "/api/v1/libraries/@org/power-grid/1.2.0") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              name: "@org/power-grid",
              version: "1.2.0",
              dependencies: { "@org/substation": "1.0.0" },
            }),
          );
          return;
        }

        // @org/power-grid download
        if (
          p === "/api/v1/libraries/%40org/power-grid/1.2.0/download" ||
          p === "/api/v1/libraries/@org/power-grid/1.2.0/download"
        ) {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Length": powerGridBuffer.length,
          });
          res.end(powerGridBuffer);
          return;
        }

        // @org/power-grid salsa db
        if (
          p === "/api/v1/libraries/%40org/power-grid/1.2.0/salsa-index.db" ||
          p === "/api/v1/libraries/@org/power-grid/1.2.0/salsa-index.db"
        ) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(mockSalsaBuffer);
          return;
        }

        // @org/substation versions
        if (p === "/api/v1/libraries/%40org/substation" || p === "/api/v1/libraries/@org/substation") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ versions: ["1.0.0"], version: "1.0.0" }));
          return;
        }

        // @org/substation manifest
        if (p === "/api/v1/libraries/%40org/substation/1.0.0" || p === "/api/v1/libraries/@org/substation/1.0.0") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: "@org/substation", version: "1.0.0", dependencies: {} }));
          return;
        }

        // @org/substation download
        if (
          p === "/api/v1/libraries/%40org/substation/1.0.0/download" ||
          p === "/api/v1/libraries/@org/substation/1.0.0/download"
        ) {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Length": substationBuffer.length,
          });
          res.end(substationBuffer);
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Not found: ${p}` }));
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${address.port}`;
        process.env["MODELSCRIPT_API_URL"] = serverUrl;
        resolve();
      });
    });

    // Create package.json in workspace referencing @org/power-grid
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "test-workspace",
        version: "0.1.0",
        dependencies: {
          "@org/power-grid": "^1.2.0",
        },
      }),
      "utf-8",
    );
  });

  test.after(() => {
    try {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test("msx vendor vendors workspace dependencies and archives into local vendor directory", async () => {
    await (Vendor.handler as (args: any) => Promise<void>)({
      path: workspaceDir,
      out: "vendor",
      cache: true,
      json: true,
    });

    // Check that vendor directory exists
    assert.ok(fs.existsSync(vendorOutDir), "Vendor directory must exist");

    // Check extracted package files
    const powerGridDir = path.join(vendorOutDir, "org-power-grid/1.2.0");
    assert.ok(fs.existsSync(powerGridDir), "org-power-grid/1.2.0 must be extracted");
    assert.ok(fs.existsSync(path.join(powerGridDir, "Grid.mo")));
    assert.ok(fs.existsSync(path.join(powerGridDir, "package.json")));

    // Check transitive dependency was also vendored
    const substationDir = path.join(vendorOutDir, "org-substation/1.0.0");
    assert.ok(fs.existsSync(substationDir), "org-substation/1.0.0 must be vendored transitively");
    assert.ok(fs.existsSync(path.join(substationDir, "package.json")));

    // Check raw zip archives in vendor/archives/
    const archivesDir = path.join(vendorOutDir, "archives");
    assert.ok(fs.existsSync(archivesDir));
    const powerGridZipPath = path.join(archivesDir, "org-power-grid-1.2.0.zip");
    const substationZipPath = path.join(archivesDir, "org-substation-1.0.0.zip");
    assert.ok(fs.existsSync(powerGridZipPath), "Raw archive for @org/power-grid must be cached");
    assert.ok(fs.existsSync(substationZipPath), "Raw archive for @org/substation must be cached");

    // Check vendor-manifest.json
    const manifestPath = path.join(vendorOutDir, "vendor-manifest.json");
    assert.ok(fs.existsSync(manifestPath), "vendor-manifest.json must exist");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.strictEqual(manifest.version, "1.0.0");
    assert.ok(manifest.packages["@org/power-grid"]);
    assert.strictEqual(manifest.packages["@org/power-grid"].version, "1.2.0");
    assert.ok(manifest.packages["@org/power-grid"].integrity.startsWith("sha256:"));
    assert.ok(manifest.packages["@org/substation"]);
    assert.strictEqual(manifest.packages["@org/substation"].version, "1.0.0");

    // Verify global package store received the packages
    assert.ok(
      defaultPackageStore.hasPackage("@org/power-grid", "1.2.0", manifest.packages["@org/power-grid"].integrity),
      "GlobalPackageStore must be populated by msx vendor",
    );
  });

  test("msx mirror exports packages and Salsa DBs to an air-gap directory", async () => {
    await (Mirror.handler as (args: any) => Promise<void>)({
      packages: ["@org/power-grid@1.2.0"],
      out: mirrorDir,
      includeSalsa: true,
      json: true,
    });

    assert.ok(fs.existsSync(mirrorDir), "Mirror directory must exist");
    const archivesDir = path.join(mirrorDir, "archives");
    assert.ok(fs.existsSync(archivesDir));

    // Verify archives
    assert.ok(fs.existsSync(path.join(archivesDir, "org-power-grid-1.2.0.zip")));
    assert.ok(fs.existsSync(path.join(archivesDir, "org-substation-1.0.0.zip")));

    // Verify Salsa DB was downloaded
    const salsaDbPath = path.join(archivesDir, "org-power-grid-1.2.0.salsa-index.db");
    assert.ok(fs.existsSync(salsaDbPath), "Salsa index DB must be mirrored");
    assert.strictEqual(fs.readFileSync(salsaDbPath, "utf-8"), "SQLITE3_MOCK_SALSA_MEMOIZATION_DATABASE_INDEX_PAYLOAD");

    // Verify mirror-manifest.json
    const manifestPath = path.join(mirrorDir, "mirror-manifest.json");
    assert.ok(fs.existsSync(manifestPath), "mirror-manifest.json must exist");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.strictEqual(manifest.version, "1.0.0");
    assert.ok(manifest.packages["@org/power-grid"]);
    assert.strictEqual(manifest.packages["@org/power-grid"].version, "1.2.0");
    assert.ok(manifest.packages["@org/power-grid"].salsaDb?.includes("salsa-index.db"));
    assert.ok(manifest.packages["@org/substation"]);
  });

  test("msx mirror packages a self-contained air-gap .zip bundle", async () => {
    await (Mirror.handler as (args: any) => Promise<void>)({
      packages: ["@org/power-grid@1.2.0"],
      out: mirrorBundleZip,
      includeSalsa: false,
      json: true,
    });

    assert.ok(fs.existsSync(mirrorBundleZip), "Air-gap .zip bundle must exist");

    // Inspect the generated bundle zip
    const bundleZip = new AdmZip(mirrorBundleZip);
    const entries = bundleZip.getEntries().map((e) => e.entryName);

    assert.ok(entries.includes("mirror-manifest.json"), "Bundle must contain mirror-manifest.json");
    assert.ok(
      entries.some((e) => e.includes("org-power-grid-1.2.0.zip")),
      "Bundle must contain power-grid archive",
    );
    assert.ok(
      entries.some((e) => e.includes("org-substation-1.0.0.zip")),
      "Bundle must contain substation archive",
    );

    const manifestEntry = bundleZip.getEntry("mirror-manifest.json");
    assert.ok(manifestEntry);
    const bundleManifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
    assert.ok(bundleManifest.packages["@org/power-grid"]);
    assert.ok(bundleManifest.packages["@org/substation"]);
  });
});

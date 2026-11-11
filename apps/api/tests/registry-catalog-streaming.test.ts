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
import { JobQueue } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";

test("Ansatz Registry Streaming Catalog: /api/v1/components & /api/v1/models", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-registry-stream-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const jobQueue = new JobQueue();
  const app = createApp({ database: db, storage, jobQueue, enableWorkers: false, seedStdlibOnBoot: false });

  t.after(() => {
    try {
      jobQueue.clear();
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Seed Buildings@10.0.0 (older) and Buildings@11.0.0 (latest) + @acme/drives@1.2.0 (scoped with dependencies)
  db.storeLibraryMetadata("Buildings", "10.0.0", [
    {
      className: "Buildings.Fluid.Movers.LegacyMover",
      classKind: "model",
      description: "Legacy hydronic mover",
      documentation: null,
      baseClasses: [],
      components: [],
    },
  ]);

  db.storeLibraryMetadata("Buildings", "11.0.0", [
    {
      className: "Buildings",
      classKind: "package",
      description: "LBNL Buildings Library",
      documentation: null,
      baseClasses: [],
      components: [],
    },
    {
      className: "Buildings.Fluid",
      classKind: "package",
      description: "Fluid subpackage",
      documentation: null,
      baseClasses: [],
      components: [],
    },
    {
      className: "Buildings.Fluid.Interfaces.PartialTwoPort",
      classKind: "model",
      description: "Partial base interface",
      documentation: null,
      baseClasses: [],
      components: [],
    },
    {
      className: "Buildings.Fluid.Movers.FlowControlled_m_flow",
      classKind: "model",
      description: "Centrifugal hydronic pump with prescribed mass flow rate",
      documentation: null,
      baseClasses: ["Buildings.Fluid.Movers.BaseIcon"],
      components: [],
      iconHash: "sha256:pump-icon",
    },
    {
      className: "Buildings.Fluid.Actuators.TwoWayEqualPercentage",
      classKind: "model",
      description: "Equal-percentage modulating hydronic control valve",
      documentation: null,
      baseClasses: [],
      components: [],
      iconHash: "sha256:valve-icon",
    },
    {
      className: "Buildings.Fluid.Examples.HydronicHeatingLoop",
      classKind: "model",
      description: "Complete hydronic district heating loop example",
      documentation: null,
      baseClasses: [],
      components: [],
      diagramHash: "sha256:hydronic-diagram",
    },
  ]);

  storage.storeSvg(
    "Buildings",
    "11.0.0",
    "Buildings.Fluid.Movers.BaseIcon",
    '<svg viewBox="0 0 100 100"><script>alert(1)</script><circle cx="50" cy="50" r="36" onload="evil()" stroke="#0ea5e9"/></svg>',
    null,
  );
  storage.storeSvg(
    "Buildings",
    "11.0.0",
    "Buildings.Fluid.Actuators.TwoWayEqualPercentage",
    '<svg viewBox="0 0 100 100"><polygon points="20,30 80,70 80,30 20,70" stroke="#0ea5e9"/></svg>',
    null,
  );
  storage.storeSvg(
    "Buildings",
    "11.0.0",
    "Buildings.Fluid.Examples.HydronicHeatingLoop",
    null,
    '<svg viewBox="0 0 240 140"><rect x="20" y="30" width="60" height="40" stroke="#38bdf8"/><line x1="80" y1="50" x2="160" y2="50" stroke="#38bdf8"/></svg>',
  );

  // Register scoped package with dependencies in packages + package_versions
  const scopedPkg = db.getOrCreatePackage("@acme/drives");
  db.updatePackageMeta(scopedPkg.id, {
    description: "Field-oriented electric drive library",
    license: "Apache-2.0",
  });
  db.storePackageVersion(
    scopedPkg.id,
    "1.2.0",
    "@acme__drives/1.2.0.zip",
    "shasum-test",
    null,
    1024,
    JSON.stringify({
      name: "@acme/drives",
      version: "1.2.0",
      dependencies: {
        Modelica: ">=4.1.0",
      },
    }),
    null,
    null,
  );
  db.storeLibraryMetadata("@acme/drives", "1.2.0", [
    {
      className: "Drives.Motors.PermanentMagnetDrive",
      classKind: "model",
      description: "Permanent magnet synchronous motor drive",
      documentation: null,
      baseClasses: [],
      components: [],
      iconHash: "sha256:pmsm-icon",
    },
    {
      className: "Drives.Examples.TractionBench",
      classKind: "model",
      description: "EV traction inverter & PMSM test bench",
      documentation: null,
      baseClasses: [],
      components: [],
      diagramHash: "sha256:traction-diag",
    },
  ]);
  storage.storeSvg(
    "@acme/drives",
    "1.2.0",
    "Drives.Motors.PermanentMagnetDrive",
    '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="32" stroke="#f59e0b"/></svg>',
    null,
  );
  storage.storeSvg(
    "@acme/drives",
    "1.2.0",
    "Drives.Examples.TractionBench",
    null,
    '<svg viewBox="0 0 240 140"><circle cx="90" cy="70" r="28" stroke="#f59e0b"/><line x1="30" y1="70" x2="62" y2="70" stroke="#f59e0b"/></svg>',
  );

  // 1. Stream all components with inline sanitized SVGs
  const compRes = await request(app).get("/api/v1/components?includeSvg=1&limit=10").expect(200);
  assert.strictEqual(compRes.body.total, 3);
  assert.strictEqual(compRes.body.hasMore, false);
  const fqns = compRes.body.components.map((c: { fqn: string }) => c.fqn);
  assert.ok(fqns.includes("Buildings.Fluid.Movers.FlowControlled_m_flow"));
  assert.ok(fqns.includes("Buildings.Fluid.Actuators.TwoWayEqualPercentage"));
  assert.ok(fqns.includes("Drives.Motors.PermanentMagnetDrive"));
  // Excluded: legacy 10.0.0, package containers, Partial*, and .Examples.
  assert.ok(!fqns.includes("Buildings.Fluid.Movers.LegacyMover"));
  assert.ok(!fqns.includes("Buildings.Fluid.Interfaces.PartialTwoPort"));
  assert.ok(!fqns.includes("Buildings.Fluid.Examples.HydronicHeatingLoop"));

  // Check inherited icon resolution & XSS sanitization
  const pump = compRes.body.components.find(
    (c: { fqn: string }) => c.fqn === "Buildings.Fluid.Movers.FlowControlled_m_flow",
  );
  assert.ok(pump.iconSvg?.includes("<circle"));
  assert.ok(!pump.iconSvg?.includes("<script"));
  assert.ok(!pump.iconSvg?.includes("onload="));

  // Check scoped package URL & peer dependencies map
  const pmsm = compRes.body.components.find((c: { fqn: string }) => c.fqn === "Drives.Motors.PermanentMagnetDrive");
  assert.strictEqual(pmsm.packageName, "@acme/drives");
  assert.ok(pmsm.iconUrl.startsWith("/api/v1/libraries/%40acme/drives/1.2.0/classes/"));
  assert.deepStrictEqual(compRes.body.packageDependencies["@acme/drives"], { Modelica: ">=4.1.0" });

  // 2. Pagination (limit=2, offset=0 -> hasMore=true; offset=2 -> remaining 1)
  const page1 = await request(app).get("/api/v1/registry/components?limit=2&offset=0").expect(200);
  assert.strictEqual(page1.body.components.length, 2);
  assert.strictEqual(page1.body.hasMore, true);
  const page2 = await request(app).get("/api/v1/registry/components?limit=2&offset=2").expect(200);
  assert.strictEqual(page2.body.components.length, 1);
  assert.strictEqual(page2.body.hasMore, false);

  // 3. Domain + subpackage + query filtering
  const filtered = await request(app)
    .get("/api/v1/components?domain=fluids-thermal&subpackage=Fluid.Movers&q=pump")
    .expect(200);
  assert.strictEqual(filtered.body.total, 1);
  assert.strictEqual(filtered.body.components[0].fqn, "Buildings.Fluid.Movers.FlowControlled_m_flow");

  // 4. Stream runnable models with diagramSvg
  const modelsRes = await request(app).get("/api/v1/models?includeSvg=1").expect(200);
  assert.strictEqual(modelsRes.body.total, 2);
  const modelFqns = modelsRes.body.models.map((m: { fqn: string }) => m.fqn);
  assert.ok(modelFqns.includes("Buildings.Fluid.Examples.HydronicHeatingLoop"));
  assert.ok(modelFqns.includes("Drives.Examples.TractionBench"));
  const hydronic = modelsRes.body.models.find(
    (m: { fqn: string }) => m.fqn === "Buildings.Fluid.Examples.HydronicHeatingLoop",
  );
  assert.ok(hydronic.diagramSvg?.includes("<rect"));

  // 5. Yanked version falls back cleanly to previous non-yanked version
  db.saveLibraryRelease({ libraryName: "Buildings", libraryVersion: "10.0.0", contentHash: "sha256:v10" });
  db.saveLibraryRelease({ libraryName: "Buildings", libraryVersion: "11.0.0", contentHash: "sha256:v11" });
  db.yankLibraryRelease("Buildings", "11.0.0", "Regression in 11.0.0");

  const afterYank = await request(app).get("/api/v1/components?package=Buildings").expect(200);
  assert.strictEqual(afterYank.body.total, 1);
  assert.strictEqual(afterYank.body.components[0].fqn, "Buildings.Fluid.Movers.LegacyMover");
  assert.strictEqual(afterYank.body.components[0].packageVersion, "10.0.0");
});

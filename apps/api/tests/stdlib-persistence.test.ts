// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";

import { getStdlibCatalog } from "@modelscript/exchange";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";
import { seedPrepackagedLibraries } from "../src/util/seed-examples.js";

describe("Standard Library Persistence, Self-Healing & Registry Parity", () => {
  let tmpDir: string;
  let db: LibraryDatabase;
  let storage: LibraryStorage;
  let jobQueue: JobQueue;
  let app: any;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-stdlib-persist-"));
    const dbPath = path.join(tmpDir, "persist.db");
    const dataDir = path.join(tmpDir, "libraries");
    fs.mkdirSync(dataDir, { recursive: true });

    db = new LibraryDatabase(dbPath);
    storage = new LibraryStorage(dataDir);
    jobQueue = new JobQueue();

    // Create Express app with isolated storage & DB
    app = createApp({
      database: db,
      storage,
      jobQueue,
    });
  });

  after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. Dual-Source Aggregation: packages in SQLite database appear in GET /api/v1/libraries even if storage is empty", async () => {
    // Simulate a database dump restored onto a server before any storage download occurred
    const { id: pkgId } = db.getOrCreatePackage("Simulated-Restored-Package");
    db.updatePackageMeta(pkgId, {
      description: "Package restored from a database snapshot",
      license: "MIT",
    });
    db.storePackageVersion(
      pkgId,
      "1.0.0",
      "file:///tmp/dummy.zip",
      "dummy-shasum",
      null,
      1000,
      JSON.stringify({
        name: "Simulated-Restored-Package",
        version: "1.0.0",
        modelscript: { domains: ["power-energy"] },
      }),
      null,
      null,
    );
    db.setDistTag(pkgId, "latest", "1.0.0");

    // Verify Simulated-Restored-Package is not present in storage on disk
    assert.equal(storage.exists("Simulated-Restored-Package", "1.0.0"), false);
    assert.equal(storage.list().includes("Simulated-Restored-Package"), false);

    // Query /api/v1/libraries
    const res = await request(app).get("/api/v1/libraries").expect(200);
    assert.ok(Array.isArray(res.body.packages));

    const found = res.body.packages.find((p: any) => p.name === "Simulated-Restored-Package");
    assert.ok(found, "Restored database package must appear in /libraries even if storage disk is empty");
    assert.equal(found.latestVersion, "1.0.0");
    assert.deepEqual(found.domains, ["power-energy"]);
    assert.equal(found.description, "Package restored from a database snapshot");
  });

  it("2. Non-Destructive Reconciliation: seeder adds missing standard libraries while preserving user data from restored dump", async () => {
    const catalog = getStdlibCatalog();
    assert.ok(catalog.libraries.length >= 12, "Catalog must define at least 12 standard libraries");

    // Pre-create dummy pre-indexed bundles for fast O(1) ingestion without network downloads
    for (const lib of catalog.libraries) {
      const libDir = path.join(storage.dataDir, lib.packageName);
      fs.mkdirSync(libDir, { recursive: true });
      const extractedDir = path.join(libDir, `${lib.version}-extracted`);
      fs.mkdirSync(extractedDir, { recursive: true });

      const metaPath = path.join(extractedDir, "metadata.json");
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          name: lib.packageName,
          version: lib.version,
          classes: [
            {
              className: `${lib.packageName}.RootClass`,
              classKind: "class",
              description: `Root class for ${lib.packageName}`,
              baseClasses: [],
              components: [],
            },
          ],
        }),
        "utf-8",
      );

      const zipPath = path.join(libDir, `${lib.version}.zip`);
      if (!fs.existsSync(zipPath)) {
        // Create minimal valid zip
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip();
        zip.addFile("metadata.json", Buffer.from(fs.readFileSync(metaPath)));
        zip.writeZip(zipPath);
      }
    }

    // Run seeder with all packs
    process.env["STDLIB_PACKS"] = "all";
    await seedPrepackagedLibraries(storage, db, jobQueue);

    // Query /api/v1/libraries
    const res = await request(app).get("/api/v1/libraries").expect(200);
    const names = res.body.packages.map((p: any) => p.name);

    // Verify user package from restored dump is still present
    assert.ok(names.includes("Simulated-Restored-Package"), "User package must be preserved");

    // Verify standard libraries are present
    for (const lib of catalog.libraries) {
      assert.ok(names.includes(lib.packageName), `Catalog library ${lib.packageName} must be present`);
      const pkg = res.body.packages.find((p: any) => p.name === lib.packageName);
      assert.ok(pkg.domains.includes(lib.domain), `Package ${lib.packageName} must have domain ${lib.domain}`);
      assert.ok(pkg.description, `Package ${lib.packageName} must have description`);
    }
  });

  it("3. Database Wipe / Reset dev data resilience: re-seeding restores all standard libraries", async () => {
    // Simulate database wipe
    db.resetDevData();

    // Verify packages table is now empty
    assert.equal(db.listPackages().length, 0);

    // Re-seed
    await seedPrepackagedLibraries(storage, db, jobQueue);

    // Query /api/v1/libraries
    const res = await request(app).get("/api/v1/libraries").expect(200);
    assert.ok(res.body.packages.length >= 12, "Re-seeding after wipe must restore all standard libraries");

    const catalog = getStdlibCatalog();
    for (const lib of catalog.libraries) {
      const match = res.body.packages.find((p: any) => p.name === lib.packageName);
      assert.ok(match, `Library ${lib.packageName} must be restored after DB reset`);
      assert.ok(
        Array.isArray(match.versions) && match.versions.includes(lib.version),
        `Library ${lib.packageName}@${lib.version} must be present in versions list`,
      );
    }

    const modelicaPkg = res.body.packages.find((p: any) => p.name === "Modelica");
    assert.ok(modelicaPkg, "Modelica package must exist");
    assert.equal(modelicaPkg.latestVersion, "4.1.0");
    assert.match(modelicaPkg.description, /v4\.1\.0/);
    assert.doesNotMatch(modelicaPkg.description, /v3\.2\.3/);
  });

  it("4. Self-Healing: database initialization heals mismatched description and readme from outdated version", () => {
    const pkg = db.getPackage("Modelica");
    assert.ok(pkg);
    // Artificially corrupt description to 3.2.3 to simulate legacy corrupted DB
    db.updatePackageMeta(pkg.id, {
      description: "Modelica Standard Library v3.2.3 (MSL)",
    });
    assert.equal(db.getPackage("Modelica")?.description, "Modelica Standard Library v3.2.3 (MSL)");

    // Reopen database to trigger #initialize() self-healing
    const healedDb = new LibraryDatabase(path.join(tmpDir, "persist.db"));
    const healedPkg = healedDb.getPackage("Modelica");
    assert.ok(healedPkg);
    assert.match(healedPkg.description!, /v4\.1\.0/);
    assert.doesNotMatch(healedPkg.description!, /v3\.2\.3/);
    healedDb.close();
  });

  it("5. Flagship DigitalOcean preset only seeds Modelica MSL standard libraries by default", async () => {
    db.resetDevData();
    assert.equal(db.listPackages().length, 0);

    const prevPreset = process.env["DEPLOYMENT_PRESET"];
    const prevPacks = process.env["STDLIB_PACKS"];
    try {
      process.env["DEPLOYMENT_PRESET"] = "tier3_flagship";
      delete process.env["STDLIB_PACKS"];

      // Clean out test dummy directories for non-Modelica libraries
      for (const entry of fs.readdirSync(storage.dataDir)) {
        if (entry !== "Modelica" && entry !== "Complex" && entry !== "ModelicaServices" && entry !== "OpenIPSL") {
          fs.rmSync(path.join(storage.dataDir, entry), { recursive: true, force: true });
        }
      }

      await seedPrepackagedLibraries(storage, db, jobQueue);

      const dbPackages = db.listPackages().map((p) => p.name);
      assert.ok(dbPackages.includes("Modelica"), "Modelica MSL must be in DB");
      assert.ok(dbPackages.includes("Complex"), "Complex must be in DB");
      assert.ok(dbPackages.includes("ModelicaServices"), "ModelicaServices must be in DB");
      assert.ok(dbPackages.includes("OpenIPSL"), "OpenIPSL must be in DB");

      assert.equal(dbPackages.includes("SysML"), false, "SysML should not be seeded in DB in flagship");
      assert.equal(dbPackages.includes("SPICE-Standard"), false, "SPICE should not be seeded in DB in flagship");
      assert.equal(dbPackages.includes("AUTOSAR-Metamodels"), false, "AUTOSAR should not be seeded in DB in flagship");
      assert.equal(
        dbPackages.includes("EPANET-Benchmark-Networks"),
        false,
        "EPANET should not be seeded in DB in flagship",
      );
      assert.equal(dbPackages.includes("STEP-Fasteners"), false, "STEP should not be seeded in DB in flagship");
      assert.equal(
        dbPackages.includes("BioModels-Curated-Core"),
        false,
        "BioModels should not be seeded in DB in flagship",
      );

      const res = await request(app).get("/api/v1/libraries").expect(200);
      const names = res.body.packages.map((p: any) => p.name);

      // Modelica standard libraries MUST be present
      assert.ok(names.includes("Modelica"), "Modelica MSL must be seeded in flagship");
      assert.ok(names.includes("Complex"), "Complex must be seeded in flagship");
      assert.ok(names.includes("ModelicaServices"), "ModelicaServices must be seeded in flagship");
      assert.ok(names.includes("OpenIPSL"), "OpenIPSL must be seeded in flagship");

      // Non-Modelica polyglot packages must NOT be seeded in flagship
      assert.equal(names.includes("SysML"), false, "SysML should not be seeded in flagship");
      assert.equal(names.includes("SPICE-Standard"), false, "SPICE should not be seeded in flagship");
      assert.equal(names.includes("AUTOSAR-Metamodels"), false, "AUTOSAR should not be seeded in flagship");
      assert.equal(names.includes("EPANET-Benchmark-Networks"), false, "EPANET should not be seeded in flagship");
      assert.equal(names.includes("STEP-Fasteners"), false, "STEP should not be seeded in flagship");
      assert.equal(names.includes("BioModels-Curated-Core"), false, "BioModels should not be seeded in flagship");
    } finally {
      if (prevPreset !== undefined) process.env["DEPLOYMENT_PRESET"] = prevPreset;
      else delete process.env["DEPLOYMENT_PRESET"];
      if (prevPacks !== undefined) process.env["STDLIB_PACKS"] = prevPacks;
      else delete process.env["STDLIB_PACKS"];
    }
  });
});

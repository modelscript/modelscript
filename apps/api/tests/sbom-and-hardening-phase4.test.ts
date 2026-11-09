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

const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-sbom-uploads-"));
process.env["UPLOAD_TEMP_DIR"] = testUploadDir;

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

test("Phase 3 & 4 Hardening: SBOM Generation (CycloneDX 1.6 & SPDX 2.3), Breaking Change Detection & CDN Caching", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbom-hardening-test-"));
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

  const alice = db.createUser("alice", "alice@modelscript.test", "hashed_pwd", { emailVerified: true });
  const aliceToken = jwt.sign({ id: alice.id, username: alice.username, email: alice.email }, JWT_SECRET, {
    expiresIn: "1h",
  });

  // 1. Publish dependency package: @alice/CoreUtils@1.0.0
  const depZip = createZipWithFiles({
    "package.json": JSON.stringify({
      name: "@alice/CoreUtils",
      version: "1.0.0",
      description: "Core utility helpers",
      license: "Apache-2.0",
    }),
    "package.mo": 'package CoreUtils\n  annotation(version="1.0.0");\nend CoreUtils;\n',
  });
  await request(app)
    .post("/api/v1/libraries/@alice/CoreUtils/1.0.0")
    .set("Authorization", `Bearer ${aliceToken}`)
    .attach("file", depZip, "CoreUtils.zip")
    .expect(201);

  // 2. Publish root package: @alice/RootLib@1.0.0 depending on @alice/CoreUtils
  const rootZip = createZipWithFiles({
    "package.json": JSON.stringify({
      name: "@alice/RootLib",
      version: "1.0.0",
      description: "Root engineering assembly",
      license: "MIT",
      dependencies: {
        "@alice/CoreUtils": "1.0.0",
      },
    }),
    "package.mo": 'package RootLib\n  annotation(version="1.0.0", uses(CoreUtils(version="1.0.0")));\nend RootLib;\n',
  });
  await request(app)
    .post("/api/v1/libraries/@alice/RootLib/1.0.0")
    .set("Authorization", `Bearer ${aliceToken}`)
    .attach("file", rootZip, "RootLib.zip")
    .expect(201);

  await t.test("Generates compliant CycloneDX 1.6 SBOM JSON", async () => {
    const res = await request(app).get("/api/v1/libraries/@alice/RootLib/1.0.0/sbom.json").expect(200);

    const sbom = res.body;
    assert.strictEqual(sbom.bomFormat, "CycloneDX");
    assert.strictEqual(sbom.specVersion, "1.6");
    assert.strictEqual(sbom.version, 1);
    assert.ok(typeof sbom.serialNumber === "string" && sbom.serialNumber.startsWith("urn:uuid:"));

    // Check metadata component
    assert.ok(sbom.metadata?.component);
    assert.strictEqual(sbom.metadata.component.name, "@alice/RootLib");
    assert.strictEqual(sbom.metadata.component.version, "1.0.0");
    assert.strictEqual(sbom.metadata.component.purl, "pkg:modelscript/@alice/RootLib@1.0.0");
    assert.strictEqual(sbom.metadata.component.licenses?.[0]?.license?.id, "MIT");
    assert.ok(Array.isArray(sbom.metadata.component.hashes));
    assert.strictEqual(sbom.metadata.component.hashes[0]?.alg, "SHA-256");

    // Check dependency components
    assert.ok(Array.isArray(sbom.components));
    const depComp = sbom.components.find((c: { name: string }) => c.name === "@alice/CoreUtils");
    assert.ok(depComp, "Dependencies must include @alice/CoreUtils");
    assert.strictEqual(depComp.version, "1.0.0");
    assert.strictEqual(depComp.purl, "pkg:modelscript/@alice/CoreUtils@1.0.0");
    assert.strictEqual(depComp.hashes?.[0]?.alg, "SHA-256");

    // Check dependency graph
    assert.ok(Array.isArray(sbom.dependencies));
    const rootDep = sbom.dependencies.find((d: { ref: string }) => d.ref === "pkg:modelscript/@alice/RootLib@1.0.0");
    assert.ok(rootDep, "Root component must be connected in dependency graph");
    assert.ok(rootDep.dependsOn.includes("pkg:modelscript/@alice/CoreUtils@1.0.0"));
  });

  await t.test("CycloneDX SBOM export sets Content-Disposition attachment header", async () => {
    const res = await request(app).get("/api/v1/libraries/@alice/RootLib/1.0.0/sbom.json?export=true").expect(200);

    const disposition = res.headers["content-disposition"];
    assert.ok(disposition);
    assert.match(disposition, /attachment;\s*filename="@alice-RootLib-1\.0\.0\.cyclonedx\.json"/i);
  });

  await t.test("Generates compliant SPDX 2.3 SBOM JSON with checksums and relationships", async () => {
    const res = await request(app).get("/api/v1/libraries/@alice/RootLib/1.0.0/sbom.json?format=spdx").expect(200);

    const spdx = res.body;
    assert.strictEqual(spdx.spdxVersion, "SPDX-2.3");
    assert.strictEqual(spdx.dataLicense, "CC0-1.0");
    assert.strictEqual(spdx.SPDXID, "SPDXRef-DOCUMENT");
    assert.ok(spdx.documentNamespace?.startsWith("https://ansatz.social/spdx/"));

    // Check packages
    assert.ok(Array.isArray(spdx.packages));
    const rootPkg = spdx.packages.find((p: { name: string }) => p.name === "@alice/RootLib");
    assert.ok(rootPkg, "Root package must exist in SPDX packages");
    assert.strictEqual(rootPkg.versionInfo, "1.0.0");
    assert.strictEqual(rootPkg.licenseDeclared, "MIT");
    assert.strictEqual(rootPkg.checksums?.[0]?.algorithm, "SHA256");
    assert.strictEqual(rootPkg.externalRefs?.[0]?.referenceType, "purl");
    assert.strictEqual(rootPkg.externalRefs?.[0]?.referenceLocator, "pkg:modelscript/@alice/RootLib@1.0.0");

    const depPkg = spdx.packages.find((p: { name: string }) => p.name === "@alice/CoreUtils");
    assert.ok(depPkg, "Dependency package must exist in SPDX packages");
    assert.strictEqual(depPkg.versionInfo, "1.0.0");
    assert.strictEqual(depPkg.checksums?.[0]?.algorithm, "SHA256");

    // Check relationships
    assert.ok(Array.isArray(spdx.relationships));
    const describesRel = spdx.relationships.find(
      (r: { relationshipType: string; spdxElementId: string }) =>
        r.relationshipType === "DESCRIBES" && r.spdxElementId === "SPDXRef-DOCUMENT",
    );
    assert.ok(describesRel, "Document must describe root package");

    const dependsRel = spdx.relationships.find(
      (r: { relationshipType: string; relatedSpdxElement: string }) =>
        r.relationshipType === "DEPENDS_ON" && r.relatedSpdxElement === depPkg.SPDXID,
    );
    assert.ok(dependsRel, "Root package must have DEPENDS_ON relationship to dependency");
  });

  await t.test("SPDX export sets Content-Disposition attachment header", async () => {
    const res = await request(app)
      .get("/api/v1/libraries/@alice/RootLib/1.0.0/sbom.json?format=spdx&export=true")
      .expect(200);

    const disposition = res.headers["content-disposition"];
    assert.ok(disposition);
    assert.match(disposition, /attachment;\s*filename="@alice-RootLib-1\.0\.0\.spdx\.json"/i);
  });

  await t.test("Immutable CDN caching headers and ETag 304 handling on archive downloads", async () => {
    const res = await request(app).get("/api/v1/libraries/@alice/RootLib/1.0.0/archive.zip").expect(200);

    assert.strictEqual(res.headers["cache-control"], "public, max-age=31536000, immutable");
    const etag = res.headers["etag"];
    assert.ok(etag, "ETag header must be returned");

    // Re-request with If-None-Match matching the ETag -> 304 Not Modified
    const notModifiedRes = await request(app)
      .get("/api/v1/libraries/@alice/RootLib/1.0.0/archive.zip")
      .set("If-None-Match", etag)
      .expect(304);

    assert.strictEqual(notModifiedRes.text, "");
  });

  await t.test("Compare endpoint detects breaking changes and physical unit drift", async () => {
    // Setup a package with v1.0.0 and v2.0.0 having breaking changes
    const pkgName = "@alice/DriftLib";

    // 1. Publish v1.0.0
    const v1Zip = createZipWithFiles({
      "package.json": JSON.stringify({ name: pkgName, version: "1.0.0" }),
      "package.mo": 'package DriftLib\n  annotation(version="1.0.0");\nend DriftLib;\n',
    });
    await request(app)
      .post(`/api/v1/libraries/${pkgName}/1.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", v1Zip, "DriftLib1.zip")
      .expect(201);

    // 2. Publish v2.0.0
    const v2Zip = createZipWithFiles({
      "package.json": JSON.stringify({ name: pkgName, version: "2.0.0" }),
      "package.mo": 'package DriftLib\n  annotation(version="2.0.0");\nend DriftLib;\n',
    });
    await request(app)
      .post(`/api/v1/libraries/${pkgName}/2.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", v2Zip, "DriftLib2.zip")
      .expect(201);

    // Populate class metadata in database for v1.0.0 and v2.0.0
    db.storeLibraryMetadata(pkgName, "1.0.0", [
      {
        className: "Pump",
        classKind: "model",
        description: "Hydraulic pump",
        documentation: null,
        baseClasses: [],
        components: [
          {
            name: "inlet",
            typeName: "Modelica.Fluid.Interfaces.FluidPort_a",
            description: "Fluid inlet port",
            causality: "input",
            variability: null,
            modifiers: [],
          },
          {
            name: "outlet",
            typeName: "Modelica.Fluid.Interfaces.FluidPort_b",
            description: "Fluid outlet port",
            causality: "output",
            variability: null,
            modifiers: [],
          },
          {
            name: "p_nom",
            typeName: "Modelica.SIunits.Pressure",
            description: "Nominal operating pressure",
            causality: null,
            variability: "parameter",
            modifiers: [{ name: "p_nom", value: "100000" }],
          },
        ],
      },
      {
        className: "LegacyMotor",
        classKind: "model",
        description: "Legacy DC motor to be deleted",
        documentation: null,
        baseClasses: [],
        components: [],
      },
    ]);

    db.storeLibraryMetadata(pkgName, "2.0.0", [
      {
        className: "Pump",
        classKind: "model",
        description: "Hydraulic pump updated",
        documentation: null,
        baseClasses: [],
        components: [
          // inlet connector was REMOVED (connector_incompatible)
          {
            name: "outlet",
            typeName: "Modelica.Fluid.Interfaces.FluidPort_b",
            description: "Fluid outlet port",
            causality: "input", // CAUSALITY DRIFT (output -> input)
            variability: null,
            modifiers: [],
          },
          {
            name: "p_nom",
            typeName: "Modelica.SIunits.Bar", // UNIT DRIFT (Pressure -> Bar)
            description: "Nominal operating pressure",
            causality: null,
            variability: "parameter",
            modifiers: [{ name: "p_nom", value: "1.0" }],
          },
        ],
      },
      // LegacyMotor was DELETED (class_removed)
    ]);

    const res = await request(app).get(`/api/v1/libraries/${pkgName}/compare?base=1.0.0&head=2.0.0`).expect(200);

    const comp = res.body;
    assert.ok(Array.isArray(comp.breakingChanges));

    // 1. Verify connector_incompatible for removed inlet port
    const connectorBreak = comp.breakingChanges.find(
      (b: { category: string; componentName?: string }) =>
        b.category === "connector_incompatible" && b.componentName === "inlet",
    );
    assert.ok(connectorBreak, "Must flag removed inlet port as connector_incompatible");
    assert.match(connectorBreak.message, /inlet.*removed in v2\.0\.0/i);

    // 2. Verify causality_drift for inverted outlet port
    const causalityBreak = comp.breakingChanges.find(
      (b: { category: string; componentName?: string }) =>
        b.category === "causality_drift" && b.componentName === "outlet",
    );
    assert.ok(causalityBreak, "Must flag inverted outlet port as causality_drift");
    assert.match(causalityBreak.message, /outlet.*changed from 'output' to 'input'/i);

    // 3. Verify class_removed for deleted LegacyMotor
    const classBreak = comp.breakingChanges.find(
      (b: { category: string; className: string }) => b.category === "class_removed" && b.className === "LegacyMotor",
    );
    assert.ok(classBreak, "Must flag deleted LegacyMotor as class_removed");

    // 4. Verify parityDrift with unit conversion hint
    assert.ok(Array.isArray(comp.parityDrift));
    const unitDrift = comp.parityDrift.find(
      (d: { className: string; parameter: string }) => d.className === "Pump" && d.parameter === "p_nom",
    );
    assert.ok(unitDrift, "Must flag p_nom unit drift in parityDrift");
    assert.strictEqual(unitDrift.oldUnit, "Modelica.SIunits.Pressure");
    assert.strictEqual(unitDrift.newUnit, "Modelica.SIunits.Bar");
    assert.strictEqual(unitDrift.conversionHint, "1 bar = 100,000 Pa (1e5 scale factor)");
  });

  await t.test("CAD geometry diff and cad-mesh WebGL endpoints", async () => {
    const cadPkg = "@alice/CadDrone";

    const meshJson1 = JSON.stringify({
      meshes: [
        {
          attributes: {
            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
            normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
          },
          index: { array: [0, 1, 2] },
        },
      ],
      properties: { volume: 100.0, surfaceArea: 50.0 },
    });

    const meshJson2 = JSON.stringify({
      meshes: [
        {
          attributes: {
            position: { array: [0, 0, 0, 1.2, 0, 0, 0, 1.2, 0] },
            normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
          },
          index: { array: [0, 1, 2] },
        },
      ],
      properties: { volume: 120.0, surfaceArea: 60.0 }, // +20% volume expansion
    });

    const v1Zip = createZipWithFiles({
      "package.json": JSON.stringify({ name: cadPkg, version: "1.0.0" }),
      "package.mo": 'package CadDrone\n  annotation(version="1.0.0");\nend CadDrone;\n',
      "cad/chassis.step": "ISO-10303-21; HEADER; ENDSEC; DATA; ENDSEC; END-ISO-10303-21;\n",
    });
    await request(app)
      .post(`/api/v1/libraries/${cadPkg}/1.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", v1Zip, "CadDrone1.zip")
      .expect(201);

    const v2Zip = createZipWithFiles({
      "package.json": JSON.stringify({ name: cadPkg, version: "2.0.0" }),
      "package.mo": 'package CadDrone\n  annotation(version="2.0.0");\nend CadDrone;\n',
      "cad/chassis.step": "ISO-10303-21; HEADER; ENDSEC; DATA; ENDSEC; END-ISO-10303-21;\n",
      "cad/propeller.step": "ISO-10303-21; HEADER; ENDSEC; DATA; ENDSEC; END-ISO-10303-21;\n",
    });
    await request(app)
      .post(`/api/v1/libraries/${cadPkg}/2.0.0`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", v2Zip, "CadDrone2.zip")
      .expect(201);

    // Cache pre-tessellated mesh JSON in storage for chassis.step
    storage.storeCadMesh(cadPkg, "1.0.0", "cad/chassis.step", meshJson1);
    storage.storeCadMesh(cadPkg, "2.0.0", "cad/chassis.step", meshJson2);

    // 1. Verify GET /cad-mesh/:path endpoint
    const meshRes = await request(app).get(`/api/v1/libraries/${cadPkg}/2.0.0/cad-mesh/cad/chassis.step`).expect(200);

    assert.strictEqual(meshRes.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.strictEqual(meshRes.body.properties?.volume, 120.0);

    // 2. Verify compare endpoint returns CAD changes and volume delta
    const compRes = await request(app).get(`/api/v1/libraries/${cadPkg}/compare?base=1.0.0&head=2.0.0`).expect(200);

    assert.ok(Array.isArray(compRes.body.cadChanges));
    const chassisChange = compRes.body.cadChanges.find((c: { file: string }) => c.file === "cad/chassis.step");
    assert.ok(chassisChange, "cadChanges must include cad/chassis.step");
    assert.strictEqual(chassisChange.status, "modified");
    assert.strictEqual(chassisChange.volumeDeltaPercent, 20.0);

    const propChange = compRes.body.cadChanges.find((c: { file: string }) => c.file === "cad/propeller.step");
    assert.ok(propChange, "cadChanges must include newly added cad/propeller.step");
    assert.strictEqual(propChange.status, "added");
  });
});

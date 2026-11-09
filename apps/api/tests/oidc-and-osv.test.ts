// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-oidc-uploads-"));
process.env["UPLOAD_TEMP_DIR"] = testUploadDir;

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { LibraryStorage } from "../src/storage.js";
import { createTestOidcToken, verifyOidcPackageAuthorization, verifyOidcToken } from "../src/util/oidc-verifier.js";
import {
  comparePackageVulnerabilities,
  registerOsvAdvisory,
  scanPackageVulnerabilities,
} from "../src/util/osv-scanner.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

test("Keyless OIDC CI/CD Signing & OSV Vulnerability Database Feed", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oidc-osv-test-"));
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

  await t.test("1. OIDC Token Unit Verification & Namespace Authorization", async () => {
    const validToken = createTestOidcToken({
      issuer: "https://token.actions.githubusercontent.com",
      repository: "octocat/sensors",
      repositoryOwner: "octocat",
      workflow: "Release Package",
      ref: "refs/tags/v1.0.0",
      runId: "12345678",
      actor: "octocat",
    });

    const verifyResult = await verifyOidcToken(validToken);
    assert.strictEqual(verifyResult.valid, true);
    assert.strictEqual(verifyResult.attestation?.repository, "octocat/sensors");
    assert.strictEqual(verifyResult.attestation?.workflow, "Release Package");
    assert.strictEqual(verifyResult.attestation?.provider, "github");

    // Test authorization against package namespace
    const authSuccess = verifyOidcPackageAuthorization(verifyResult.attestation!, "@octocat/sensors", db);
    assert.strictEqual(authSuccess.authorized, true);

    // Test rejection against unauthorized package namespace
    const authFailure = verifyOidcPackageAuthorization(verifyResult.attestation!, "@mallory/malicious-pkg", db);
    assert.strictEqual(authFailure.authorized, false);
    assert.ok(authFailure.reason?.includes("not authorized"));

    // Test expired token
    const expiredToken = createTestOidcToken(
      {
        issuer: "https://token.actions.githubusercontent.com",
        repository: "octocat/sensors",
      },
      { expired: true },
    );
    const expiredResult = await verifyOidcToken(expiredToken);
    assert.strictEqual(expiredResult.valid, false);
    assert.ok(expiredResult.error?.includes("expired"));
  });

  await t.test("2. Keyless OIDC Package Publishing without API Token", async () => {
    const oidcToken = createTestOidcToken({
      issuer: "https://token.actions.githubusercontent.com",
      repository: "octocat/sensors",
      repositoryOwner: "octocat",
      workflow: "CI Release",
      runId: "99887766",
      actor: "octocat",
    });

    const pkgZip = createZipWithFiles({
      "package.json": JSON.stringify({
        name: "@octocat/sensors",
        version: "1.0.0",
        description: "Hardened physical sensors package published via Keyless CI/CD",
        license: "Apache-2.0",
      }),
      "Sensors.mo": "package Sensors end Sensors;",
    });

    // Publish using X-Package-OIDC-Token header with NO Authorization header
    const res = await request(app)
      .post("/api/v1/libraries/@octocat/sensors/1.0.0")
      .set("X-Package-OIDC-Token", oidcToken)
      .attach("file", pkgZip, "sensors.zip");

    assert.ok(res.status === 200 || res.status === 201, `Status should be 200 or 201, got ${res.status}`);
    assert.ok(res.body.message?.includes("published successfully") || res.body.message?.includes("Queued"));

    // Verify release metadata in database
    const release = db.getLibraryRelease("@octocat/sensors", "1.0.0");
    assert.ok(release, "Release record must be persisted");
    assert.strictEqual(release.oidc_issuer, "https://token.actions.githubusercontent.com");
    assert.strictEqual(release.oidc_repository, "octocat/sensors");
    assert.strictEqual(release.oidc_run_id, "99887766");
    assert.ok(release.content_hash.startsWith("sha256:"));

    // Verify library details endpoint exposes OIDC provenance
    const detailsRes = await request(app).get("/api/v1/libraries/@octocat/sensors/1.0.0");
    assert.strictEqual(detailsRes.status, 200);
    assert.strictEqual(detailsRes.body.oidcRepository, "octocat/sensors");
    assert.strictEqual(detailsRes.body.oidcRunId, "99887766");
  });

  await t.test("3. Reject Keyless OIDC Publishing from Unauthorized Repository", async () => {
    const maliciousOidcToken = createTestOidcToken({
      issuer: "https://token.actions.githubusercontent.com",
      repository: "evil-org/pwn-sensors",
      repositoryOwner: "evil-org",
      workflow: "Hijack Attack",
    });

    const pkgZip = createZipWithFiles({
      "package.json": JSON.stringify({
        name: "@octocat/sensors",
        version: "1.0.1",
        description: "Attempted supply chain namespace squatting",
      }),
      "Sensors.mo": "package Sensors end Sensors;",
    });

    const res = await request(app)
      .post("/api/v1/libraries/@octocat/sensors/1.0.1")
      .set("X-Package-OIDC-Token", maliciousOidcToken)
      .attach("file", pkgZip, "sensors.zip");

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, "M4012");
    assert.ok(res.body.error?.includes("not authorized"));
  });

  await t.test("4. OSV Vulnerability Scanner: Detection & Delta Comparison", async () => {
    // Check known advisory for @modelica/electrical < 4.0.0
    const scanOld = await scanPackageVulnerabilities("@modelica/electrical", "3.2.0");
    assert.strictEqual(scanOld.clean, false);
    assert.ok(scanOld.vulnerabilities.some((v) => v.id === "GHSA-mod-2024-0001"));
    assert.strictEqual(scanOld.hasCriticalOrHigh, true);

    // Check fixed version @modelica/electrical @ 4.0.0
    const scanFixed = await scanPackageVulnerabilities("@modelica/electrical", "4.0.0");
    assert.strictEqual(scanFixed.clean, true);
    assert.strictEqual(scanFixed.vulnerabilities.length, 0);

    // Check comparePackageVulnerabilities
    const delta = await comparePackageVulnerabilities("@modelica/electrical", "3.2.0", "4.0.0");
    assert.ok(delta.fixed.some((v) => v.id === "GHSA-mod-2024-0001"));
    assert.strictEqual(delta.introduced.length, 0);
  });

  await t.test("5. CycloneDX 1.6 & SPDX 2.3 SBOM with Embedded OSV Advisories & Keyless Attestation", async () => {
    // Publish a package that has a registered dependency with a vulnerability
    // Register custom test vulnerability for @octocat/sensors < 1.1.0
    registerOsvAdvisory({
      id: "GHSA-octo-2024-0099",
      aliases: ["CVE-2024-99881"],
      summary: "Null pointer dereference during optical encoder pulse integration",
      severity: "HIGH",
      cvssScore: 7.5,
      packageName: "@octocat/sensors",
      affectedRange: "< 1.1.0",
      fixedVersion: "1.1.0",
      published: "2024-11-01T00:00:00Z",
    });

    // Request CycloneDX SBOM
    const cdxRes = await request(app).get("/api/v1/libraries/@octocat/sensors/1.0.0/sbom.json?format=cyclonedx");

    assert.strictEqual(cdxRes.status, 200);
    assert.strictEqual(cdxRes.body.bomFormat, "CycloneDX");
    assert.strictEqual(cdxRes.body.specVersion, "1.6");

    // Verify OIDC keyless evidence in component metadata
    assert.strictEqual(cdxRes.body.metadata?.component?.evidence?.identity?.methods?.[0]?.technique, "oidc-keyless-ci");
    assert.strictEqual(cdxRes.body.metadata?.component?.evidence?.identity?.methods?.[0]?.value, "octocat/sensors");

    // Verify OSV vulnerabilities array in CycloneDX root
    assert.ok(Array.isArray(cdxRes.body.vulnerabilities));
    assert.ok(cdxRes.body.vulnerabilities.some((v: any) => v.id === "GHSA-octo-2024-0099"));
    const vuln = cdxRes.body.vulnerabilities.find((v: any) => v.id === "GHSA-octo-2024-0099");
    assert.strictEqual(vuln.ratings[0].severity, "high");
    assert.strictEqual(vuln.ratings[0].score, 7.5);

    // Request SPDX 2.3 SBOM
    const spdxRes = await request(app).get("/api/v1/libraries/@octocat/sensors/1.0.0/sbom.json?format=spdx");

    assert.strictEqual(spdxRes.status, 200);
    assert.strictEqual(spdxRes.body.spdxVersion, "SPDX-2.3");

    // Verify OIDC annotation in SPDX root
    assert.ok(Array.isArray(spdxRes.body.annotations));
    assert.ok(
      spdxRes.body.annotations[0].comment.includes("Verified Keyless CI build from repository octocat/sensors"),
    );

    // Verify SPDX externalRefs contains security advisory
    const rootPkg = spdxRes.body.packages[0];
    const secRef = rootPkg.externalRefs.find((r: any) => r.referenceCategory === "SECURITY");
    assert.ok(secRef, "SPDX externalRefs must contain SECURITY advisory category");
    assert.ok(secRef.comment.includes("GHSA-octo-2024-0099"));
  });

  await t.test("6. OSV Vulnerability Direct Audit & Version Compare Endpoints", async () => {
    // 1. Direct Audit Endpoint: GET /api/v1/libraries/:name/:version/audit
    const auditRes = await request(app).get("/api/v1/libraries/@octocat/sensors/1.0.0/audit");
    assert.strictEqual(auditRes.status, 200);
    assert.strictEqual(auditRes.body.package, "@octocat/sensors");
    assert.strictEqual(auditRes.body.clean, false);
    assert.ok(auditRes.body.rootVulnerabilities.some((v: any) => v.id === "GHSA-octo-2024-0099"));
    assert.strictEqual(auditRes.body.summary.high, 1);

    // 2. Version Compare Endpoint: GET /api/v1/libraries/:name/compare
    const compareRes = await request(app).get("/api/v1/libraries/@octocat/sensors/compare?base=1.0.0&head=1.0.0");
    assert.strictEqual(compareRes.status, 200);
    assert.ok(compareRes.body.vulnerabilities, "Compare response must include vulnerabilities delta");
    assert.ok(Array.isArray(compareRes.body.vulnerabilities.current));
    assert.ok(compareRes.body.vulnerabilities.current.some((v: any) => v.id === "GHSA-octo-2024-0099"));
  });
});

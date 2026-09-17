// SPDX-License-Identifier: AGPL-3.0-or-later

import { OpcAasxPackager } from "@modelscript/exchange";
import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

process.env["NODE_ENV"] = "production";
process.env["SEED_EXAMPLES"] = "false";

async function run() {
  console.log("Starting PLM & Multi-Projection integration tests...");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-plm-test-"));
  const tempDbDir = path.join(tempDir, "db");
  const tempStorageDir = path.join(tempDir, "storage");

  try {
    const database = new LibraryDatabase(tempDbDir);
    const storage = new LibraryStorage(tempStorageDir);

    const app = createApp({ database, storage });

    // 1. Create test user and token
    const testUser = database.createUser("tester", "tester@acme.com", "hashpassword");
    const token = jwt.sign({ id: testUser.id, username: "tester", email: "tester@acme.com" }, JWT_SECRET);

    // 2. Seed a package in database and storage
    const { id: pkgId } = database.getOrCreatePackage("@acme/smart-pump");
    database.updatePackageMeta(pkgId, {
      description: "Smart BLDC Pump P300",
      license: "Apache-2.0",
      homepage: "https://example.com/pump",
    });

    const version = "1.0.0";
    database.storePackageVersion(
      pkgId,
      version,
      "dummy.zip",
      "shasum123",
      "integrity123",
      1000,
      JSON.stringify({ name: "@acme/smart-pump", version }),
      null,
      testUser.id,
    );

    // Create extracted dir with modelscript.json & sample files
    const extractedDir = storage.getExtractedPath("@acme/smart-pump", version);
    fs.mkdirSync(path.join(extractedDir, "cad"), { recursive: true });
    fs.mkdirSync(path.join(extractedDir, "physics"), { recursive: true });

    const modelscriptJson = {
      globalAssetId: "urn:acme:pump:p300",
      idShort: "smart-pump",
      title: "ACME Smart BLDC Pump P300",
      version: "1.0.0",
      scope: "@acme",
      description: "Variable-speed BLDC pump with integrated pressure sensor",
      author: { name: "ACME Robotics", email: "engineering@acme.com", organization: "ACME Corp" },
      license: "Apache-2.0",
      bom: [
        {
          name: "Brushless DC Motor",
          partNumber: "BLDC-42 [variant:high-flow]",
          quantity: 1,
          packageDependency: "@suppliers/bldc-motor@^1.2.0",
          category: "actuator",
        },
        {
          name: "Standard DC Motor",
          partNumber: "DC-42 [variant:standard]",
          quantity: 1,
          packageDependency: "@suppliers/dc-motor@^1.0.0",
          category: "actuator",
        },
      ],
      variants: {
        "high-flow": { description: "High Flow Rate 24V", overrides: { voltage: 24 } },
        standard: { description: "Standard Flow Rate 12V", overrides: { voltage: 12 } },
      },
    };

    fs.writeFileSync(path.join(extractedDir, "modelscript.json"), JSON.stringify(modelscriptJson, null, 2));
    fs.writeFileSync(path.join(extractedDir, "cad", "housing.step"), "ISO-10303-21; HEADER; ENDSEC; DATA; ENDSEC;");
    fs.writeFileSync(path.join(extractedDir, "physics", "pump.mo"), "model Pump ... end Pump;");

    // ── Test 1: NPM Manifest Projection ────────────────────────────
    console.log("Testing GET /manifest?lens=npm...");
    const npmRes = await request(app).get("/api/v1/libraries/@acme/smart-pump/1.0.0/manifest?lens=npm");
    assert.strictEqual(npmRes.status, 200);
    assert.strictEqual(npmRes.body.name, "@acme/smart-pump");
    assert.strictEqual(npmRes.body.version, "1.0.0");
    assert.strictEqual(npmRes.body.license, "Apache-2.0");
    assert.strictEqual(npmRes.body.dependencies["@suppliers/bldc-motor"], "^1.2.0");

    // ── Test 2: AAS JSON Manifest Projection ───────────────────────
    console.log("Testing GET /manifest?lens=aas...");
    const aasRes = await request(app).get("/api/v1/libraries/@acme/smart-pump/1.0.0/manifest?lens=aas");
    assert.strictEqual(aasRes.status, 200);
    assert.strictEqual(aasRes.body.assetAdministrationShells[0].idShort, "smart-pump");
    assert.strictEqual(aasRes.body.assetAdministrationShells[0].assetInformation.globalAssetId, "urn:acme:pump:p300");
    const nameplate = aasRes.body.submodels.find((s: { idShort: string }) => s.idShort === "Nameplate");
    assert(nameplate);

    // ── Test 3: OKH JSON Manifest Projection ───────────────────────
    console.log("Testing GET /manifest?lens=okh...");
    const okhRes = await request(app).get("/api/v1/libraries/@acme/smart-pump/1.0.0/manifest?lens=okh");
    assert.strictEqual(okhRes.status, 200);
    assert.strictEqual(okhRes.body.name, "smart-pump");
    assert.strictEqual(okhRes.body["standard-version"], "OKH-LOSH-v1.0");

    // ── Test 4: Variant Resolution ─────────────────────────────────
    console.log("Testing Variant filtering (?variant=high-flow)...");
    const variantRes = await request(app).get(
      "/api/v1/libraries/@acme/smart-pump/1.0.0/manifest?lens=npm&variant=high-flow",
    );
    assert.strictEqual(variantRes.status, 200);
    assert.strictEqual(variantRes.body.name, "@acme/smart-pump-high-flow");
    assert(variantRes.body.dependencies["@suppliers/bldc-motor"]);
    assert.strictEqual(variantRes.body.dependencies["@suppliers/dc-motor"], undefined);

    // ── Test 5: AASX Container Export ──────────────────────────────
    console.log("Testing GET /export/aasx...");
    const aasxRes = await request(app)
      .get("/api/v1/libraries/@acme/smart-pump/1.0.0/export/aasx")
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    assert.strictEqual(aasxRes.status, 200);
    assert.strictEqual(aasxRes.headers["content-type"], "application/asset-administration-shell-package");
    assert(aasxRes.body.length > 0);

    // Verify the exported AASX is a valid OPC container
    const extractedAasx = OpcAasxPackager.extractAasx(new Uint8Array(aasxRes.body));
    assert(extractedAasx.aasJson);
    assert.strictEqual(extractedAasx.aasJson.assetAdministrationShells[0].idShort, "smart-pump");
    assert(extractedAasx.files.has("aasx/files/cad/housing.step"));

    // ── Test 6: Instance Registration (Birth Certificate) ──────────
    console.log("Testing POST /api/v1/instances...");
    const instanceRes = await request(app)
      .post("/api/v1/instances")
      .set("Authorization", `Bearer ${token}`)
      .send({
        serialNumber: "SN-PUMP-9001",
        packageName: "@acme/smart-pump",
        version: "1.0.0",
        commitSha: "c0ffee1",
        variant: "high-flow",
        birthData: {
          hipotVoltage_V: 1500,
          leakage_mA: 0.8,
          torque_Nm: 3.5,
          result: "PASS",
        },
      });

    assert.strictEqual(instanceRes.status, 201);
    assert.strictEqual(instanceRes.body.instance.serial_number, "SN-PUMP-9001");
    assert.strictEqual(instanceRes.body.instance.variant, "high-flow");

    // ── Test 7: Instance Lookup ────────────────────────────────────
    console.log("Testing GET /api/v1/instances/:serialNumber...");
    const getInstRes = await request(app).get("/api/v1/instances/SN-PUMP-9001");
    assert.strictEqual(getInstRes.status, 200);
    assert.strictEqual(getInstRes.body.serial_number, "SN-PUMP-9001");
    assert.strictEqual(getInstRes.body.birth_data.hipotVoltage_V, 1500);

    // ── Test 8: Digital Twin Joined View ───────────────────────────
    console.log("Testing GET /api/v1/instances/:serialNumber/twin...");
    const twinRes = await request(app).get("/api/v1/instances/SN-PUMP-9001/twin");
    assert.strictEqual(twinRes.status, 200);
    assert.strictEqual(twinRes.body.instance.serial_number, "SN-PUMP-9001");
    assert.strictEqual(twinRes.body.design.package_name, "@acme/smart-pump");
    assert.strictEqual(twinRes.body.design.variant, "high-flow");
    assert.strictEqual(twinRes.body.design.commit_sha, "c0ffee1");

    console.log("🎉 All PLM, Multi-Projection, AASX, and Digital Twin API tests passed!");
    process.exit(0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("❌ Integration test failed:", err);
  process.exit(1);
});

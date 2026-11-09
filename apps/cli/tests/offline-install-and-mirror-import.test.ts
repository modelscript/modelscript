// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { Install } from "../src/commands/install.js";
import { importMirrorBundle } from "../src/commands/mirror.js";
import { computeBufferIntegrity, readLockfile } from "../src/util/lockfile.js";
import { defaultPackageStore, GlobalPackageStore } from "../src/util/store.js";

describe("Air-Gap Offline Tooling: msx install --offline & msx mirror import", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "offline-test-"));
  const customStoreDir = path.join(tmpDir, "custom-store");
  const testStore = new GlobalPackageStore(customStoreDir);

  // Helper to create a zip buffer for a package
  function createPackageZip(name: string, version: string, deps: Record<string, string> = {}, moBody = ""): Buffer {
    const zip = new AdmZip();
    zip.addFile(
      "package.json",
      Buffer.from(
        JSON.stringify(
          {
            name,
            version,
            dependencies: deps,
          },
          null,
          2,
        ),
      ),
    );
    const cleanName = name.replace(/^@/, "").replace(/[/\\]/g, "_");
    zip.addFile(
      "package.mo",
      Buffer.from(`package ${cleanName}\n  annotation(version="${version}");\n${moBody}\nend ${cleanName};\n`),
    );
    return zip.toBuffer();
  }

  test("importMirrorBundle imports air-gap .zip bundle and pre-computed Salsa DBs into store", async () => {
    const bundleZipPath = path.join(tmpDir, "airgap-bundle.zip");

    const pkgABuffer = createPackageZip("Modelica", "4.0.0", {}, "model Resistor parameter Real R=1; end Resistor;");
    const pkgAHash = computeBufferIntegrity(pkgABuffer);

    const pkgBBuffer = createPackageZip("@ansatz/hydraulics", "2.1.0", { Modelica: "^4.0.0" });
    const pkgBHash = computeBufferIntegrity(pkgBBuffer);

    const mockSalsaBuffer = Buffer.from("SQLITE3_MOCK_PRECOMPUTED_SALSA_CACHE_INDEX");

    // Construct air-gap bundle
    const bundleZip = new AdmZip();
    bundleZip.addFile("archives/Modelica-4.0.0.zip", pkgABuffer);
    bundleZip.addFile("archives/Modelica-4.0.0.salsa-index.db", mockSalsaBuffer);
    bundleZip.addFile("archives/ansatz-hydraulics-2.1.0.zip", pkgBBuffer);

    const mirrorManifest = {
      version: "1.0.0",
      mirroredAt: new Date().toISOString(),
      packages: {
        Modelica: {
          version: "4.0.0",
          integrity: pkgAHash,
          archive: "archives/Modelica-4.0.0.zip",
          salsaDb: "archives/Modelica-4.0.0.salsa-index.db",
          dependencies: {},
        },
        "@ansatz/hydraulics": {
          version: "2.1.0",
          integrity: pkgBHash,
          archive: "archives/ansatz-hydraulics-2.1.0.zip",
          dependencies: { Modelica: "^4.0.0" },
        },
      },
    };
    bundleZip.addFile("mirror-manifest.json", Buffer.from(JSON.stringify(mirrorManifest, null, 2)));
    bundleZip.writeZip(bundleZipPath);

    const targetRegistry = path.join(tmpDir, "target-registry");

    // Execute bundle import
    const result = await importMirrorBundle(bundleZipPath, {
      targetStore: testStore,
      targetRegistry,
    });

    assert.strictEqual(result.status, "success");
    assert.strictEqual(result.importedCount, 2);
    assert.strictEqual(result.isBundleArchive, true);

    // Verify packages exist in store
    assert.ok(testStore.hasPackage("Modelica", "4.0.0", pkgAHash), "Modelica must be in test store");
    assert.ok(
      testStore.hasPackage("@ansatz/hydraulics", "2.1.0", pkgBHash),
      "@ansatz/hydraulics must be in test store",
    );

    // Verify Salsa DB was extracted into store
    const modelicaStoreDir = testStore.getCachedPackageDir("Modelica", "4.0.0");
    assert.ok(modelicaStoreDir);
    const salsaDbPath = path.join(modelicaStoreDir, ".modelscript", "salsa-index.db");
    assert.ok(fs.existsSync(salsaDbPath), "Salsa index DB must be extracted to store");
    assert.strictEqual(fs.readFileSync(salsaDbPath, "utf-8"), "SQLITE3_MOCK_PRECOMPUTED_SALSA_CACHE_INDEX");

    // Verify target registry export
    const regPkgA = path.join(targetRegistry, "Modelica", "4.0.0", "library.zip");
    assert.ok(fs.existsSync(regPkgA), "Target registry should receive Modelica library.zip");
    assert.ok(
      fs.existsSync(path.join(targetRegistry, "Modelica", "4.0.0", "salsa-index.db")),
      "Target registry should receive salsa-index.db",
    );
  });

  test("importMirrorBundle imports from an unpacked mirror directory", async () => {
    const mirrorDir = path.join(tmpDir, "unpacked-mirror");
    const archivesDir = path.join(mirrorDir, "archives");
    fs.mkdirSync(archivesDir, { recursive: true });

    const pkgCBuffer = createPackageZip("Thermal", "1.5.0");
    const pkgCHash = computeBufferIntegrity(pkgCBuffer);
    fs.writeFileSync(path.join(archivesDir, "Thermal-1.5.0.zip"), pkgCBuffer);

    const manifest = {
      version: "1.0.0",
      mirroredAt: new Date().toISOString(),
      packages: {
        Thermal: {
          version: "1.5.0",
          integrity: pkgCHash,
          archive: "archives/Thermal-1.5.0.zip",
          dependencies: {},
        },
      },
    };
    fs.writeFileSync(path.join(mirrorDir, "mirror-manifest.json"), JSON.stringify(manifest, null, 2));

    const result = await importMirrorBundle(mirrorDir, {
      targetStore: testStore,
    });

    assert.strictEqual(result.importedCount, 1);
    assert.strictEqual(result.isBundleArchive, false);
    assert.ok(testStore.hasPackage("Thermal", "1.5.0", pkgCHash));
  });

  test("importMirrorBundle throws on CAS integrity tampering", async () => {
    const tamperedBundlePath = path.join(tmpDir, "tampered-bundle.zip");
    const buf = createPackageZip("TamperedPkg", "1.0.0");
    const zip = new AdmZip();
    zip.addFile("archives/TamperedPkg-1.0.0.zip", buf);
    zip.addFile(
      "mirror-manifest.json",
      Buffer.from(
        JSON.stringify({
          version: "1.0.0",
          mirroredAt: new Date().toISOString(),
          packages: {
            TamperedPkg: {
              version: "1.0.0",
              integrity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
              archive: "archives/TamperedPkg-1.0.0.zip",
            },
          },
        }),
      ),
    );
    zip.writeZip(tamperedBundlePath);

    await assert.rejects(async () => {
      await importMirrorBundle(tamperedBundlePath, { targetStore: testStore });
    }, /CAS integrity verification failed/);
  });

  test("msx install --offline resolves and installs strictly from local ./vendor", async () => {
    const workspaceDir = path.join(tmpDir, "offline-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Workspace package.json
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify(
        {
          name: "my-airgap-subsystem",
          version: "1.0.0",
          dependencies: {
            "@ansatz/actuators": "^1.0.0",
          },
        },
        null,
        2,
      ),
    );

    // Setup ./vendor directory with vendored package
    const vendorDir = path.join(workspaceDir, "vendor");
    const pkgDir = path.join(vendorDir, "actuators", "1.0.0");
    fs.mkdirSync(pkgDir, { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@ansatz/actuators",
        version: "1.0.0",
        dependencies: {},
      }),
    );
    fs.writeFileSync(path.join(pkgDir, "Actuator.mo"), "model Actuator parameter Real force = 100; end Actuator;\n");

    const vendorZip = new AdmZip();
    vendorZip.addLocalFolder(pkgDir);
    const vendorZipBuf = vendorZip.toBuffer();
    const vendorIntegrity = computeBufferIntegrity(vendorZipBuf);

    const archivesDir = path.join(vendorDir, "archives");
    fs.mkdirSync(archivesDir, { recursive: true });
    fs.writeFileSync(path.join(archivesDir, "actuators-1.0.0.zip"), vendorZipBuf);

    // Setup vendor-manifest.json
    const vendorManifest = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceWorkspace: workspaceDir,
      packages: {
        "@ansatz/actuators": {
          version: "1.0.0",
          integrity: vendorIntegrity,
          directory: "actuators/1.0.0",
          archive: "archives/actuators-1.0.0.zip",
          dependencies: {},
        },
      },
    };
    fs.writeFileSync(path.join(vendorDir, "vendor-manifest.json"), JSON.stringify(vendorManifest, null, 2));

    // Save old cwd and switch to workspaceDir
    const prevCwd = process.cwd();
    process.chdir(workspaceDir);

    try {
      await (Install.handler as (args: any) => Promise<void>)({
        offline: true,
        save: true,
      });

      // Verify installed into libraries/@ansatz__actuators/
      const installedDir = path.join(workspaceDir, "libraries", "@ansatz__actuators");
      assert.ok(fs.existsSync(installedDir), "Libraries directory must contain installed package");
      assert.ok(fs.existsSync(path.join(installedDir, "Actuator.mo")));
      assert.ok(fs.existsSync(path.join(installedDir, "package.json")));

      // Verify msx.lock was written with vendor: resolution
      const lockfile = readLockfile(workspaceDir);
      assert.ok(lockfile, "msx.lock must exist");
      const lockedPkg = lockfile.packages["@ansatz/actuators"];
      assert.ok(lockedPkg, "@ansatz/actuators must be in msx.lock");
      assert.strictEqual(lockedPkg.version, "1.0.0");
      assert.ok(lockedPkg.resolved.startsWith("vendor:"));
      assert.strictEqual(lockedPkg.integrity, vendorIntegrity);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("msx install --offline falls back to CAS store when vendor directory is absent", async () => {
    // Populate defaultPackageStore with a test package
    const batteryBuffer = createPackageZip("Battery", "3.0.0", {}, "model Cell parameter Real capacity=50; end Cell;");
    const batteryHash = computeBufferIntegrity(batteryBuffer);
    defaultPackageStore.extractToStore("Battery", "3.0.0", batteryHash, batteryBuffer);

    assert.ok(
      defaultPackageStore.hasPackage("Battery", "3.0.0", batteryHash),
      "Battery must be pre-loaded in default store",
    );

    const workspaceDir = path.join(tmpDir, "cas-only-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify(
        {
          name: "cas-consumer",
          version: "1.0.0",
          dependencies: {
            Battery: "3.0.0",
          },
        },
        null,
        2,
      ),
    );

    const prevCwd = process.cwd();
    process.chdir(workspaceDir);

    try {
      await (Install.handler as (args: any) => Promise<void>)({
        offline: true,
        save: true,
      });

      // Verify installed into libraries/Battery/
      const installedDir = path.join(workspaceDir, "libraries", "Battery");
      assert.ok(fs.existsSync(installedDir), "Libraries directory must contain installed Battery");
      assert.ok(fs.existsSync(path.join(installedDir, "package.mo")));

      // Verify msx.lock references store:
      const lockfile = readLockfile(workspaceDir);
      assert.ok(lockfile);
      const lockedPkg = lockfile.packages["Battery"];
      assert.ok(lockedPkg);
      assert.strictEqual(lockedPkg.version, "3.0.0");
      assert.strictEqual(lockedPkg.resolved, "store:Battery@3.0.0");
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("msx install --offline fails with clear error when package is missing locally", async () => {
    const workspaceDir = path.join(tmpDir, "missing-pkg-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify(
        {
          name: "unresolvable",
          version: "1.0.0",
          dependencies: {
            NonExistentOfflineLib: "9.9.9",
          },
        },
        null,
        2,
      ),
    );

    const prevCwd = process.cwd();
    process.chdir(workspaceDir);

    let exitCalled = false;
    let exitCode: number | undefined;
    const origExit = process.exit;
    process.exit = ((code?: number) => {
      exitCalled = true;
      exitCode = code;
      throw new Error(`process.exit called with ${code}`);
    }) as any;

    try {
      await assert.rejects(async () => {
        await (Install.handler as (args: any) => Promise<void>)({
          offline: true,
        });
      }, /process\.exit called with 1/);
      assert.strictEqual(exitCalled, true);
      assert.strictEqual(exitCode, 1);
    } finally {
      process.exit = origExit;
      process.chdir(prevCwd);
    }
  });
});

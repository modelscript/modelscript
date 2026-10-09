// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Install } from "../src/commands/install.js";
import { formatArchiveFilename, Pack } from "../src/commands/pack.js";

describe("msx pack & local archive install CLI commands", () => {
  const testRoot = path.join(process.cwd(), "apps/cli/tests/.tmp-pack-test");
  const pkgDir = path.join(testRoot, "sample-pkg");
  const scopedPkgDir = path.join(testRoot, "scoped-pkg");
  const consumerDir = path.join(testRoot, "consumer-project");

  before(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(scopedPkgDir, { recursive: true });
    mkdirSync(consumerDir, { recursive: true });

    // Setup sample package
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "offline-pkg",
          version: "1.0.0",
          description: "Offline package for testing msx pack",
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(pkgDir, "package.mo"), "package offline_pkg\nend offline_pkg;\n");
    writeFileSync(path.join(pkgDir, ".env"), "SECRET_KEY=leaked_secret");
    mkdirSync(path.join(pkgDir, "src"), { recursive: true });
    writeFileSync(path.join(pkgDir, "src", "Model.mo"), "model Model\nend Model;\n");

    // Setup scoped package
    writeFileSync(
      path.join(scopedPkgDir, "package.json"),
      JSON.stringify(
        {
          name: "@flight/autopilot",
          version: "2.1.0",
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(scopedPkgDir, "package.mo"), "package autopilot\nend autopilot;\n");

    // Setup consumer project
    writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify({ name: "consumer-app", dependencies: {} }, null, 2),
    );
  });

  after(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test("formatArchiveFilename formats unscoped and scoped package names correctly", () => {
    assert.equal(formatArchiveFilename("offline-pkg", "1.0.0"), "offline-pkg-1.0.0.msx.zip");
    assert.equal(formatArchiveFilename("@flight/autopilot", "2.1.0"), "flight-autopilot-2.1.0.msx.zip");
  });

  test("msx pack --dry-run inspects package without creating archive", async () => {
    const originalCwd = process.cwd();
    process.chdir(pkgDir);
    try {
      await (Pack.handler as any)({
        path: ".",
        dryRun: true,
      });

      assert.ok(!existsSync(path.join(pkgDir, "offline-pkg-1.0.0.msx.zip")));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("msx pack creates zip archive excluding sensitive files (.env)", async () => {
    const originalCwd = process.cwd();
    process.chdir(pkgDir);
    try {
      await (Pack.handler as any)({
        path: ".",
        out: pkgDir,
      });

      const archivePath = path.join(pkgDir, "offline-pkg-1.0.0.msx.zip");
      assert.ok(existsSync(archivePath));

      const zip = new AdmZip(archivePath);
      const entryNames = zip.getEntries().map((e) => e.entryName);

      assert.ok(entryNames.includes("package.json"));
      assert.ok(entryNames.includes("package.mo"));
      assert.ok(entryNames.includes("src/Model.mo"));
      assert.ok(!entryNames.includes(".env"), ".env must be excluded from archive");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("msx pack creates scoped archive", async () => {
    const originalCwd = process.cwd();
    process.chdir(scopedPkgDir);
    try {
      await (Pack.handler as any)({
        path: ".",
        out: scopedPkgDir,
      });

      const archivePath = path.join(scopedPkgDir, "flight-autopilot-2.1.0.msx.zip");
      assert.ok(existsSync(archivePath));

      const zip = new AdmZip(archivePath);
      const entryNames = zip.getEntries().map((e) => e.entryName);
      assert.ok(entryNames.includes("package.json"));
      assert.ok(entryNames.includes("package.mo"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("msx install installs from local archive and updates package.json", async () => {
    const originalCwd = process.cwd();
    process.chdir(consumerDir);
    try {
      const archivePath = path.join(pkgDir, "offline-pkg-1.0.0.msx.zip");

      await (Install.handler as any)({
        package: archivePath,
        save: true,
      });

      // Verify files installed in libraries/offline-pkg
      const installedPkgMo = path.join(consumerDir, "libraries", "offline-pkg", "package.mo");
      const installedModelMo = path.join(consumerDir, "libraries", "offline-pkg", "src", "Model.mo");
      assert.ok(existsSync(installedPkgMo));
      assert.ok(existsSync(installedModelMo));

      // Verify package.json updated with file: dependency
      const consumerPkgJson = JSON.parse(readFileSync(path.join(consumerDir, "package.json"), "utf-8"));
      assert.ok(consumerPkgJson.dependencies["offline-pkg"]);
      assert.ok(consumerPkgJson.dependencies["offline-pkg"].startsWith("file:"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("msx install installs from local scoped archive", async () => {
    const originalCwd = process.cwd();
    process.chdir(consumerDir);
    try {
      const archivePath = path.join(scopedPkgDir, "flight-autopilot-2.1.0.msx.zip");

      await (Install.handler as any)({
        package: archivePath,
        save: true,
      });

      // Verify files installed in libraries/@flight__autopilot
      const installedPkgMo = path.join(consumerDir, "libraries", "@flight__autopilot", "package.mo");
      assert.ok(existsSync(installedPkgMo));

      const consumerPkgJson = JSON.parse(readFileSync(path.join(consumerDir, "package.json"), "utf-8"));
      assert.ok(consumerPkgJson.dependencies["@flight/autopilot"]);
      assert.ok(consumerPkgJson.dependencies["@flight/autopilot"].startsWith("file:"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("msx install resolves file: dependencies from package.json", async () => {
    const originalCwd = process.cwd();
    process.chdir(consumerDir);
    try {
      // Remove libraries directory
      rmSync(path.join(consumerDir, "libraries"), { recursive: true, force: true });
      assert.ok(!existsSync(path.join(consumerDir, "libraries")));

      // Run msx install with no arguments (reads package.json)
      await (Install.handler as any)({});

      // Verify both packages were reinstalled
      assert.ok(existsSync(path.join(consumerDir, "libraries", "offline-pkg", "package.mo")));
      assert.ok(existsSync(path.join(consumerDir, "libraries", "@flight__autopilot", "package.mo")));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { GlobalPackageStore } from "../src/util/store.js";

describe("GlobalPackageStore (CAS & Hardlink Cache)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  const storeRoot = path.join(tmpDir, "store");
  const workspaceDir = path.join(tmpDir, "workspace");

  const store = new GlobalPackageStore(storeRoot);

  test.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const zip = new AdmZip();
  zip.addFile("package.mo", Buffer.from('package StoredPkg\n  annotation(version="2.1.0");\nend StoredPkg;\n'));
  zip.addFile("Models/Motor.mo", Buffer.from("model Motor\n  parameter Real V = 24.0;\nend Motor;\n"));
  zip.addFile("data/spec.csv", Buffer.from("id,rpm,torque\n1,3000,0.5\n2,6000,1.2\n"));
  const zipBuffer = zip.toBuffer();
  const contentHash = `sha256:${crypto.createHash("sha256").update(zipBuffer).digest("hex")}`;

  test("extracts package archive atomically to store and caches archive", () => {
    assert.strictEqual(store.hasPackage("@org/StoredPkg", "2.1.0", contentHash), false);
    assert.strictEqual(store.hasCachedArchive(contentHash), false);

    const storePkgDir = store.extractToStore("@org/StoredPkg", "2.1.0", contentHash, zipBuffer);

    assert.ok(fs.existsSync(storePkgDir));
    assert.ok(fs.existsSync(path.join(storePkgDir, "package.mo")));
    assert.ok(fs.existsSync(path.join(storePkgDir, "Models/Motor.mo")));
    assert.ok(fs.existsSync(path.join(storePkgDir, "data/spec.csv")));
    assert.ok(fs.existsSync(path.join(storePkgDir, ".msx-store-complete")));

    assert.strictEqual(store.hasPackage("@org/StoredPkg", "2.1.0", contentHash), true);
    assert.strictEqual(store.hasCachedArchive(contentHash), true);

    const cachedArchive = store.getCachedArchive(contentHash);
    assert.ok(cachedArchive);
    assert.strictEqual(cachedArchive.length, zipBuffer.length);
  });

  test("subsequent extraction is a no-op returning existing store directory", () => {
    const storePkgDir = store.extractToStore("@org/StoredPkg", "2.1.0", contentHash, zipBuffer);
    assert.ok(fs.existsSync(storePkgDir));
    assert.strictEqual(store.hasPackage("@org/StoredPkg", "2.1.0", contentHash), true);
  });

  test("links package files into workspace directory using hardlinks", () => {
    const storePkgDir = store.getPackageStorePath("@org/StoredPkg", "2.1.0", contentHash);
    const destDir = path.join(workspaceDir, "libraries/@org__StoredPkg");

    const linkResult = store.linkToWorkspace(storePkgDir, destDir);

    assert.strictEqual(linkResult.totalFiles, 3);
    assert.ok(linkResult.hardlinks > 0 || linkResult.copies > 0);

    const destMo = path.join(destDir, "package.mo");
    const storeMo = path.join(storePkgDir, "package.mo");
    assert.ok(fs.existsSync(destMo));
    assert.strictEqual(fs.readFileSync(destMo, "utf8"), fs.readFileSync(storeMo, "utf8"));

    // If hardlinks are supported by filesystem, stat.ino must match
    if (linkResult.hardlinks > 0) {
      const destStat = fs.statSync(destMo);
      const storeStat = fs.statSync(storeMo);
      assert.strictEqual(destStat.ino, storeStat.ino);
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computeBufferIntegrity,
  readLockfile,
  updateLockfilePackage,
  verifyIntegrity,
  writeLockfile,
  type ModelScriptLockfile,
} from "../src/util/lockfile.js";

test("Multi-Domain Lockfile (msx.lock) Management & Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-lock-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  await t.test("Generates deterministic msx.lock file with sorted packages", () => {
    const lockfile: ModelScriptLockfile = {
      lockfileVersion: 1,
      packages: {
        Modelica: {
          version: "4.1.0",
          resolved: "https://registry.modelscript.org/api/v1/libraries/Modelica/4.1.0/download",
          integrity: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          domains: {
            modelica: { files: ["package.mo", "Electrical.mo"] },
          },
        },
        "@acme/chassis": {
          version: "1.0.0",
          resolved: "file:./chassis.zip",
          integrity: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          domains: {
            cad: { files: ["cad/frame.step"] },
            sysml2: { files: ["sysml/chassis.sysml"] },
          },
        },
      },
    };

    writeLockfile(tmpDir, lockfile);
    const read = readLockfile(tmpDir);
    assert.ok(read);
    assert.strictEqual(read.lockfileVersion, 1);

    // Verify sorted keys
    const keys = Object.keys(read.packages);
    assert.strictEqual(keys[0], "@acme/chassis");
    assert.strictEqual(keys[1], "Modelica");

    const chassis = read.packages["@acme/chassis"]!;
    assert.strictEqual(chassis.version, "1.0.0");
    assert.ok(chassis.domains?.["cad"]);
    assert.ok(chassis.domains?.["sysml2"]);
  });

  await t.test("updateLockfilePackage updates existing lockfile incrementally", () => {
    updateLockfilePackage(tmpDir, "@acme/powertrain", {
      version: "2.0.0",
      resolved: "https://registry.modelscript.org/api/v1/libraries/@acme/powertrain/2.0.0/download",
      integrity: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      domains: {
        modelica: { files: ["Inverter.mo"] },
        cad: { files: ["Inverter.step"] },
      },
    });

    const read = readLockfile(tmpDir);
    assert.ok(read);
    assert.strictEqual(Object.keys(read.packages).length, 3);
    assert.ok(read.packages["@acme/powertrain"]);
  });

  await t.test("verifyIntegrity detects tampered binary content", () => {
    const originalBuf = Buffer.from("Modelica Standard Library 4.1.0 Simulation Equations");
    const integrity = computeBufferIntegrity(originalBuf);
    assert.ok(integrity.startsWith("sha256:"));

    assert.strictEqual(verifyIntegrity(originalBuf, integrity), true);

    const tamperedBuf = Buffer.from("Tampered Modelica Standard Library with Malicious Payload");
    assert.strictEqual(verifyIntegrity(tamperedBuf, integrity), false);
  });
});

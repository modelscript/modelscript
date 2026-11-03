// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Stdlib } from "../src/commands/stdlib.js";

describe("msx stdlib CLI command suite", () => {
  const testDir = path.join(process.cwd(), "apps/cli/tests/.tmp-stdlib-test");
  const exportPackFile = path.join(testDir, "test-core-appliance.msxpack");
  const importDestDir = path.join(testDir, "imported-stdlibs");

  before(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("msx stdlib list outputs available libraries in JSON format", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      await (Stdlib.handler as any)({
        action: "list",
        pack: "core",
        json: true,
      });

      assert.ok(logs.length > 0);
      const parsed = JSON.parse(logs[0]!);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length >= 2);
      assert.ok(parsed.some((lib: { packageName: string }) => lib.packageName === "Modelica"));
      assert.ok(parsed.some((lib: { packageName: string }) => lib.packageName === "SysML"));
    } finally {
      console.log = origLog;
    }
  });

  test("msx stdlib info retrieves catalog metadata", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      await (Stdlib.handler as any)({
        action: "info",
        pack: "modelica-msl-4.1.0",
        json: true,
      });

      assert.ok(logs.length > 0);
      const parsed = JSON.parse(logs[0]!);
      assert.equal(parsed.id, "modelica-msl-4.1.0");
      assert.equal(parsed.packageName, "Modelica");
      assert.equal(parsed.version, "4.1.0");
      assert.equal(parsed.language, "modelica");
      assert.equal(parsed.pack, "core");
    } finally {
      console.log = origLog;
    }
  });

  test("msx stdlib export creates .msxpack with manifest and CAS hashes", async () => {
    await (Stdlib.handler as any)({
      action: "export",
      pack: "core",
      out: exportPackFile,
    });

    assert.ok(fs.existsSync(exportPackFile), "Exported .msxpack should exist");
    assert.ok(fs.statSync(exportPackFile).size > 1000, "Exported bundle should contain payload");
  });

  test("msx stdlib import unpacks and verifies CAS hashes", async () => {
    await (Stdlib.handler as any)({
      action: "import",
      file: exportPackFile,
      dest: importDestDir,
    });

    assert.ok(fs.existsSync(importDestDir));
    const files = fs.readdirSync(importDestDir);
    assert.ok(files.some((f) => f.includes("Modelica")));
    assert.ok(files.some((f) => f.includes("SysML")));

    // Verify registry format packageName/version.zip
    const modelicaVerZip = path.join(importDestDir, "Modelica", "4.1.0.zip");
    assert.ok(fs.existsSync(modelicaVerZip));
    const sysmlVerZip = path.join(importDestDir, "SysML", "2026.3.0.zip");
    assert.ok(fs.existsSync(sysmlVerZip));
  });
});

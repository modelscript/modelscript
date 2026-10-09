// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Publish } from "../src/commands/publish.js";
import { collectPackageFiles, formatBytes, isFileIgnored, validatePackageManifest } from "../src/util/package-files.js";

describe("CLI Packaging Safety, Ignore Rules & Dry-Run", () => {
  const testDir = path.join(process.cwd(), "apps/cli/tests/.tmp-publish-safety");

  before(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Create a realistic project structure with sensitive and ignored files
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "@acme/drone-flight",
          version: "1.2.0",
          files: ["src", "models", "data/measurements.csv"],
        },
        null,
        2,
      ),
    );

    // Valid files
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "src", "index.ts"), "export const flight = true;");

    fs.mkdirSync(path.join(testDir, "models"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "models", "Flight.mo"), "model Flight end Flight;");

    fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "data", "measurements.csv"), "time,voltage\n0,12.4\n1,12.3");

    fs.writeFileSync(path.join(testDir, "README.md"), "# Drone Flight Package");
    fs.writeFileSync(path.join(testDir, "LICENSE"), "Apache-2.0");

    // SENSITIVE & JUNK FILES that MUST be ignored
    fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".git", "config"), "[core]\nrepositoryformatversion = 0");

    fs.mkdirSync(path.join(testDir, "node_modules", "leftpad"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "node_modules", "leftpad", "package.json"), "{}");

    fs.writeFileSync(path.join(testDir, ".env"), "DATABASE_PASSWORD=supersecret");
    fs.writeFileSync(path.join(testDir, ".env.production"), "API_KEY=live_xyz123");
    fs.writeFileSync(path.join(testDir, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----");
    fs.writeFileSync(path.join(testDir, "server.key"), "-----BEGIN PRIVATE KEY-----");
    fs.writeFileSync(path.join(testDir, ".DS_Store"), "junk");

    // Un-whitelisted directory
    fs.mkdirSync(path.join(testDir, "internal-notes"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "internal-notes", "roadmap.txt"), "Internal only");
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("isFileIgnored identifies sensitive patterns and system files", () => {
    assert.equal(isFileIgnored(".git/HEAD"), true);
    assert.equal(isFileIgnored("node_modules/foo/index.js"), true);
    assert.equal(isFileIgnored(".env"), true);
    assert.equal(isFileIgnored(".env.local"), true);
    assert.equal(isFileIgnored("id_rsa"), true);
    assert.equal(isFileIgnored("certs/domain.key"), true);
    assert.equal(isFileIgnored(".DS_Store"), true);
    assert.equal(isFileIgnored("src/index.ts"), false);
    assert.equal(isFileIgnored("models/Motor.mo"), false);
  });

  test("collectPackageFiles filters out sensitive files and respects files whitelist", () => {
    const files = collectPackageFiles(testDir);
    const relPaths = files.map((f) => f.relPath);

    // Should include whitelisted and root metadata
    assert.ok(relPaths.includes("package.json"));
    assert.ok(relPaths.includes("README.md"));
    assert.ok(relPaths.includes("LICENSE"));
    assert.ok(relPaths.includes("src/index.ts"));
    assert.ok(relPaths.includes("models/Flight.mo"));
    assert.ok(relPaths.includes("data/measurements.csv"));

    // MUST NOT include sensitive files
    assert.ok(!relPaths.some((p) => p.startsWith(".git")));
    assert.ok(!relPaths.some((p) => p.startsWith("node_modules")));
    assert.ok(!relPaths.some((p) => p.includes(".env")));
    assert.ok(!relPaths.some((p) => p.includes("id_rsa")));
    assert.ok(!relPaths.some((p) => p.includes("server.key")));
    assert.ok(!relPaths.some((p) => p.includes(".DS_Store")));

    // MUST NOT include non-whitelisted directories
    assert.ok(!relPaths.some((p) => p.startsWith("internal-notes")));
  });

  test("validatePackageManifest detects invalid semver and name formats", () => {
    const valid = validatePackageManifest("@acme/drone-flight", "1.2.0", testDir);
    assert.equal(valid.valid, true);

    const invalidSemver = validatePackageManifest("my-pkg", "invalid-version");
    assert.equal(invalidSemver.valid, false);
    assert.ok(invalidSemver.errors[0]?.includes("Invalid semantic version"));

    const invalidName = validatePackageManifest("Invalid Name With Spaces", "1.0.0");
    assert.equal(invalidName.valid, false);
    assert.ok(invalidName.errors[0]?.includes("Invalid package name"));
  });

  test("msx publish --dry-run executes successfully without requiring auth or network", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (Publish.handler as any)({
        path: testDir,
        dryRun: true,
        tag: "beta",
      });

      const output = logs.join("\n");
      assert.ok(output.includes("Packaging @acme/drone-flight@1.2.0"));
      assert.ok(output.includes("package.json"));
      assert.ok(output.includes("src/index.ts"));
      assert.ok(output.includes("Tarball Details:"));
      assert.ok(output.includes("Dist-Tag: beta"));
      assert.ok(output.includes("Notice: Dry run complete. No network requests made."));
    } finally {
      console.log = originalLog;
    }
  });

  test("formatBytes produces legible units", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(1048576), "1.0 MB");
  });
});

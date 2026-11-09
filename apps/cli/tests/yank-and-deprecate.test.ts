// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  DependencySolver,
  type PackageManifest,
  type PackageReleaseMetadata,
  type PackageVersionProvider,
} from "../src/solver/solver.js";

test("Package Lifecycle: Deprecate, Yank, and Solver Tombstone Filtering", async (t) => {
  const versions: Record<string, string[]> = {
    TelemetryLib: ["1.0.0", "1.1.0", "1.2.0", "2.0.0"],
    CoreSensors: ["0.9.0", "1.0.0"],
  };

  const releases: Record<string, PackageReleaseMetadata[]> = {
    TelemetryLib: [
      { version: "1.0.0" },
      { version: "1.1.0", isDeprecated: true, deprecationReason: "Superseded by 1.2.0" },
      { version: "1.2.0" },
      { version: "2.0.0", isYanked: true, yankReason: "Critical security CVE-2026-9999 remote memory corruption" },
    ],
    CoreSensors: [
      { version: "0.9.0", isDeprecated: true, deprecationReason: "Alpha preview release" },
      { version: "1.0.0", isYanked: true, yankReason: "Faulty calibration matrix" },
    ],
  };

  const manifests: Record<string, Record<string, PackageManifest>> = {
    TelemetryLib: {
      "1.0.0": { name: "TelemetryLib", version: "1.0.0", dependencies: {} },
      "1.1.0": {
        name: "TelemetryLib",
        version: "1.1.0",
        dependencies: {},
        isDeprecated: true,
        deprecationReason: "Superseded by 1.2.0",
      },
      "1.2.0": { name: "TelemetryLib", version: "1.2.0", dependencies: {} },
      "2.0.0": {
        name: "TelemetryLib",
        version: "2.0.0",
        dependencies: {},
        isYanked: true,
        yankReason: "Critical security CVE-2026-9999 remote memory corruption",
      },
    },
    CoreSensors: {
      "0.9.0": { name: "CoreSensors", version: "0.9.0", dependencies: {}, isDeprecated: true },
      "1.0.0": { name: "CoreSensors", version: "1.0.0", dependencies: {}, isYanked: true },
    },
  };

  const provider: PackageVersionProvider = {
    async getVersions(name: string): Promise<string[]> {
      return versions[name] || [];
    },
    async getManifest(name: string, ver: string): Promise<PackageManifest | null> {
      return manifests[name]?.[ver] || { name, version: ver };
    },
    async getReleases(name: string): Promise<PackageReleaseMetadata[]> {
      return releases[name] || [];
    },
  };

  await t.test("Solver excludes yanked 2.0.0 when resolving range ^1.0.0 or *", async () => {
    const solver = new DependencySolver(provider);
    const result = await solver.solve([{ name: "TelemetryLib", range: "^1.0.0" }]);

    assert.strictEqual(result.success, true);
    // Should choose 1.2.0, skipping yanked 2.0.0
    assert.strictEqual(result.packages["TelemetryLib"]?.version, "1.2.0");
    assert.strictEqual(result.yanked, undefined);
  });

  await t.test("Solver fails when all matching versions in range are yanked", async () => {
    const solver = new DependencySolver(provider);
    // 2.0.0 is the only version matching ^2.0.0, and it is yanked
    const result = await solver.solve([{ name: "TelemetryLib", range: "^2.0.0" }]);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Version conflict for 'TelemetryLib'"));
  });

  await t.test("Solver allows yanked version when explicitly pinned", async () => {
    const solver = new DependencySolver(provider);
    // Exact pin
    const resultExact = await solver.solve([{ name: "TelemetryLib", range: "2.0.0" }]);
    assert.strictEqual(resultExact.success, true);
    assert.strictEqual(resultExact.packages["TelemetryLib"]?.version, "2.0.0");
    assert.ok(resultExact.yanked);
    assert.strictEqual(resultExact.yanked["TelemetryLib"]?.version, "2.0.0");
    assert.ok(resultExact.yanked["TelemetryLib"]?.reason.includes("CVE-2026-9999"));

    // Cleaned exact pin (=2.0.0)
    const resultCleaned = await solver.solve([{ name: "TelemetryLib", range: "=2.0.0" }]);
    assert.strictEqual(resultCleaned.success, true);
    assert.strictEqual(resultCleaned.packages["TelemetryLib"]?.version, "2.0.0");
  });

  await t.test("Solver allows yanked versions when allowYanked option is enabled", async () => {
    const solver = new DependencySolver(provider);
    const result = await solver.solve([{ name: "TelemetryLib", range: "^2.0.0" }], { allowYanked: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.packages["TelemetryLib"]?.version, "2.0.0");
    assert.ok(result.yanked);
    assert.strictEqual(result.yanked["TelemetryLib"]?.version, "2.0.0");
  });

  await t.test("Solver reports deprecation metadata when resolving deprecated version", async () => {
    const solver = new DependencySolver(provider);
    // Range pinned to 1.1.x
    const result = await solver.solve([{ name: "TelemetryLib", range: "~1.1.0" }]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.packages["TelemetryLib"]?.version, "1.1.0");
    assert.ok(result.deprecated);
    assert.strictEqual(result.deprecated["TelemetryLib"]?.version, "1.1.0");
    assert.ok(result.deprecated["TelemetryLib"]?.reason.includes("Superseded by 1.2.0"));
  });

  await t.test("Solver falls back to deprecated release when higher release is yanked", async () => {
    const solver = new DependencySolver(provider);
    // For CoreSensors: 1.0.0 is yanked, 0.9.0 is deprecated
    const result = await solver.solve([{ name: "CoreSensors", range: "*" }]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.packages["CoreSensors"]?.version, "0.9.0");
    assert.ok(result.deprecated);
    assert.strictEqual(result.deprecated["CoreSensors"]?.version, "0.9.0");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { DependencySolver, type PackageManifest, type PackageVersionProvider } from "../src/solver/solver.js";
import { parsePackageUses } from "../src/util/package-mo.js";

test("DependencySolver (PubGrub / SemVer Diamond Resolution & Modelica Parity)", async (t) => {
  // Mock registry repository
  const registry: Record<string, { versions: string[]; manifests: Record<string, PackageManifest> }> = {
    FlightAvionics: {
      versions: ["1.0.0", "1.1.0"],
      manifests: {
        "1.1.0": {
          name: "FlightAvionics",
          version: "1.1.0",
          dependencies: {
            Modelica: "^4.0.0",
            NavSensors: "^2.0.0",
          },
        },
      },
    },
    NavSensors: {
      versions: ["2.0.0", "2.1.0", "2.2.0"],
      manifests: {
        "2.2.0": {
          name: "NavSensors",
          version: "2.2.0",
          dependencies: {
            MathLib: "^1.0.0",
          },
        },
      },
    },
    MathLib: {
      versions: ["1.0.0", "1.2.0", "1.3.0", "2.0.0"],
      manifests: {
        "1.3.0": { name: "MathLib", version: "1.3.0", dependencies: {} },
        "2.0.0": { name: "MathLib", version: "2.0.0", dependencies: {} },
      },
    },
    Modelica: {
      versions: ["3.2.3", "4.0.0", "4.1.0"],
      manifests: {
        "4.0.0": { name: "Modelica", version: "4.0.0", dependencies: {} },
        "4.1.0": { name: "Modelica", version: "4.1.0", dependencies: {} },
      },
    },
  };

  const provider: PackageVersionProvider = {
    async getVersions(name: string): Promise<string[]> {
      return registry[name]?.versions || [];
    },
    async getManifest(name: string, ver: string): Promise<PackageManifest | null> {
      return registry[name]?.manifests[ver] || { name, version: ver };
    },
  };

  await t.test("Resolves multi-tier transitive dependency DAG deterministically", async () => {
    const solver = new DependencySolver(provider);
    const result = await solver.solve([{ name: "FlightAvionics", range: "^1.0.0" }]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.packages["FlightAvionics"]?.version, "1.1.0");
    assert.strictEqual(result.packages["NavSensors"]?.version, "2.2.0");
    assert.strictEqual(result.packages["MathLib"]?.version, "1.3.0");
    assert.strictEqual(result.packages["Modelica"]?.version, "4.1.0");

    // MathLib should precede NavSensors, which should precede FlightAvionics in topological install order
    const mathIdx = result.order.indexOf("MathLib");
    const navIdx = result.order.indexOf("NavSensors");
    const flightIdx = result.order.indexOf("FlightAvionics");

    assert.ok(mathIdx < navIdx, "MathLib installed before NavSensors");
    assert.ok(navIdx < flightIdx, "NavSensors installed before FlightAvionics");
  });

  await t.test("Detects and reports diamond version conflicts clearly", async () => {
    // Add conflicting diamond
    const conflictRegistry: Record<string, { versions: string[]; manifests: Record<string, PackageManifest> }> = {
      ...registry,
      LegacyTelemetry: {
        versions: ["1.0.0"],
        manifests: {
          "1.0.0": {
            name: "LegacyTelemetry",
            version: "1.0.0",
            dependencies: {
              MathLib: "^2.0.0", // Conflicts with NavSensors's ^1.0.0 requirement
            },
          },
        },
      },
    };

    const conflictProvider: PackageVersionProvider = {
      async getVersions(name: string): Promise<string[]> {
        return conflictRegistry[name]?.versions || [];
      },
      async getManifest(name: string, ver: string): Promise<PackageManifest | null> {
        return conflictRegistry[name]?.manifests[ver] || { name, version: ver };
      },
    };

    const solver = new DependencySolver(conflictProvider);
    const result = await solver.solve([
      { name: "FlightAvionics", range: "^1.0.0" },
      { name: "LegacyTelemetry", range: "^1.0.0" },
    ]);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("Version conflict for 'MathLib'"));
    assert.ok(result.error.includes("^1.0.0"));
    assert.ok(result.error.includes("^2.0.0"));
  });

  await t.test("Modelica annotation(uses(...)) parser and version normalization", () => {
    const sampleMo = `
      package DroneAutopilot "UAV Guidance"
        annotation(uses(Modelica(version="4.0.0"), FlightAvionics(version="1.1.0")));
      end DroneAutopilot;
    `;

    const uses = parsePackageUses(sampleMo);
    assert.strictEqual(uses["Modelica"], "4.0.0");
    assert.strictEqual(uses["FlightAvionics"], "1.1.0");

    assert.strictEqual(DependencySolver.normalizeModelicaVersion("4.0.0"), "^4.0.0");
    assert.strictEqual(DependencySolver.normalizeModelicaVersion("^3.2.0"), "^3.2.0");
  });
});

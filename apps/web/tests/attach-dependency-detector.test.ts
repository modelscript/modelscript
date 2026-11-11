// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectModelicaDependencies,
  detectPolyglotDependencies,
  extractModelicaUsesDependencies,
  extractSpiceDependencies,
  extractSysmlDependencies,
  findCuratedPackage,
  scanExternalNamespaceCandidates,
} from "../src/components/compose/attach/profiles/dependency-detector";

const PURE_LOCAL_MODEL = `
model SimplePendulum
  parameter Real L = 1.0;
  Real phi(start = 0.1);
equation
  der(phi) = -L * phi;
end SimplePendulum;
`;

const MSL_ONLY_MODEL = `
model ResistorCircuit
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 100);
  Modelica.Electrical.Analog.Basic.Ground G;
equation
  connect(R1.p, G.p);
end ResistorCircuit;
`;

const MODEL_WITH_USES = `
model HvacSystem
  annotation(uses(Buildings(version = "11.0.0"), PlanarMechanics(version = "1.6.1")));
  Buildings.Fluid.Sources.Boundary_pT source;
equation
end HvacSystem;
`;

const MODEL_WITH_IMPLICIT_DEPENDENCIES = `
model PowerGridSubstation
  import PlanarMechanics;
  Buildings.HeatTransfer.Sources.FixedTemperature tFix;
  parameter Real x = 10;
equation
end PowerGridSubstation;
`;

describe("Modelica Dependency Detector", () => {
  it("extracts explicit uses(...) annotations correctly", () => {
    const deps = extractModelicaUsesDependencies(MODEL_WITH_USES);
    assert.deepEqual(deps, [
      { name: "Buildings", version: "11.0.0" },
      { name: "PlanarMechanics", version: "1.6.1" },
    ]);
  });

  it("returns empty list for pure local models without external references", () => {
    const candidates = scanExternalNamespaceCandidates(PURE_LOCAL_MODEL, ["SimplePendulum"]);
    assert.deepEqual(candidates, []);
  });

  it("filters out Modelica Standard Library (MSL) namespaces", () => {
    const candidates = scanExternalNamespaceCandidates(MSL_ONLY_MODEL, ["ResistorCircuit"]);
    assert.deepEqual(candidates, []);
  });

  it("scans external namespace candidates from imports and qualified types", () => {
    const candidates = scanExternalNamespaceCandidates(MODEL_WITH_IMPLICIT_DEPENDENCIES, ["PowerGridSubstation"]);
    assert.ok(candidates.includes("PlanarMechanics"));
    assert.ok(candidates.includes("Buildings"));
    assert.strictEqual(candidates.length, 2);
  });

  it("matches curated registry packages and populates version choices", async () => {
    const pkg = findCuratedPackage("Buildings");
    assert.ok(pkg);
    assert.strictEqual(pkg.name, "Buildings");
    assert.ok(pkg.versions && pkg.versions.includes("11.0.0"));

    const detected = await detectModelicaDependencies(MODEL_WITH_USES, ["HvacSystem"]);
    assert.strictEqual(detected.length, 2);
    const buildings = detected.find((d) => d.name === "Buildings");
    assert.ok(buildings);
    assert.strictEqual(buildings.version, "11.0.0");
    assert.strictEqual(buildings.autoDetected, true);
    assert.strictEqual(buildings.resolvedFrom, "uses-annotation");
    assert.ok(buildings.availableVersions && buildings.availableVersions.length > 0);
  });

  it("detects implicit external packages when uses(...) is missing", async () => {
    const detected = await detectModelicaDependencies(MODEL_WITH_IMPLICIT_DEPENDENCIES, ["PowerGridSubstation"]);
    assert.strictEqual(detected.length, 2);
    const names = detected.map((d) => d.name);
    assert.ok(names.includes("Buildings"));
    assert.ok(names.includes("PlanarMechanics"));
  });

  it("preserves dependencies in encodeMorselPermalink and decompressMorselPayload", async () => {
    const { compressMorselPayload, decompressMorselPayload } = await import("../src/components/morsel/util/permalink");
    const original = {
      code: "model M end M;",
      title: "M with deps",
      dependencies: [{ name: "Buildings", version: "11.0.0" }],
    };
    const hash = compressMorselPayload(original);
    const decoded = decompressMorselPayload(`m=${hash}`);
    assert.ok(decoded);
    assert.ok(Array.isArray(decoded.dependencies));
    assert.strictEqual(decoded.dependencies[0].name, "Buildings");
    assert.strictEqual(decoded.dependencies[0].version, "11.0.0");
  });

  it("extracts SysML v2 dependencies while filtering built-ins", () => {
    const sysmlCode = `
      package DroneArchitecture {
        import ScalarValues::*;
        import ISQ::*;
        import SI::m;
        import PlanarMechanics::*;
        import Buildings::Fluid;

        part def Drone {
          attribute mass : ISQ::mass;
        }
      }
    `;
    const candidates = extractSysmlDependencies(sysmlCode, ["DroneArchitecture"]);
    assert.deepEqual(candidates.sort(), ["Buildings", "PlanarMechanics"].sort());
  });

  it("extracts SPICE netlist dependencies from .include and .lib", () => {
    const spiceNetlist = `
      * RLC Filter Benchmark
      .include "SPICE-Standard.cir"
      .lib "../models/tsmc018.mod" TT
      R1 in out 1k
      C1 out 0 100n
      .end
    `;
    const candidates = extractSpiceDependencies(spiceNetlist);
    assert.ok(candidates.includes("SPICE-Standard"));
    assert.ok(candidates.includes("tsmc018"));
  });

  it("detects polyglot dependencies across multiple modalities", async () => {
    const sysmlCode = `
      package Substation {
        import Buildings::*;
      }
    `;
    const sysmlDeps = await detectPolyglotDependencies(sysmlCode, ".sysml");
    assert.strictEqual(sysmlDeps.length, 1);
    assert.strictEqual(sysmlDeps[0].name, "Buildings");

    const spiceCode = `
      .include "SPICE-Standard.cir"
    `;
    const spiceDeps = await detectPolyglotDependencies(spiceCode, "spice");
    assert.strictEqual(spiceDeps.length, 1);
    assert.strictEqual(spiceDeps[0].name, "SPICE-Standard");
  });
});

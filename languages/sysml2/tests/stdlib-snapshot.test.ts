// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

test("KerML Standard Library Pre-compiled Snapshot", async (t) => {
  await t.test("loads instantly without requiring a WASM parser", async () => {
    const ws = createSysML2WorkspaceIndex();
    const start = performance.now();
    // Pass undefined as parser — verifying zero parser dependency
    const uri = loadEmbeddedKerMLStdlib(ws);
    const elapsed = performance.now() - start;

    assert.strictEqual(uri, "sysml2://stdlib/KerML.sysml");
    assert.ok(elapsed < 20, `Snapshot hydration took ${elapsed.toFixed(2)}ms (must be < 20ms)`);

    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    // Verify presence of core standard packages
    const pkgs = ["ScalarValues", "ISQ", "SIBaseUnits", "SIDerivedUnits", "Collections"];
    for (const pkg of pkgs) {
      const entries = db.byName(pkg);
      assert.ok(entries.length > 0, `Package '${pkg}' should be present in hydrated snapshot`);
    }

    // Verify key ISQ quantities
    const quantities = [
      "Length",
      "Mass",
      "Time",
      "ElectricCurrent",
      "ThermodynamicTemperature",
      "AmountOfSubstance",
      "LuminousIntensity",
      "Area",
      "Volume",
      "Velocity",
      "Acceleration",
      "Force",
      "Pressure",
      "Energy",
      "Power",
      "Voltage",
      "ElectricResistance",
      "Frequency",
    ];
    for (const q of quantities) {
      const entries = db.byName(q);
      assert.ok(entries.length > 0, `Quantity '${q}' should be present in hydrated snapshot`);
    }

    // Verify SI units
    const units = ["Second", "Kilogram", "Metre", "Newton", "Pascal", "Joule", "Watt", "Volt"];
    for (const u of units) {
      const entries = db.byName(u);
      assert.ok(entries.length > 0, `Unit '${u}' should be present in hydrated snapshot`);
    }
  });
});

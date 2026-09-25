// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runMultidomainFalsification } from "../src/commands/falsify.js";

describe("CLI Multi-Domain Adversarial Falsification Suite", () => {
  it("should falsify multi-domain requirement and generate counterexample CAD model", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-falsify-test-"));
    const cadFilePath = path.join(tmpDir, "bracket.scad");
    const traceFilePath = path.join(tmpDir, "counterexample.trace.json");
    const outCadFilePath = path.join(tmpDir, "bracket_counterexample.scad");

    const originalCadSource = `
// Parametric bracket CAD definition
const wall_thickness = 5.0;
const bracket_width = 30.0;
`;
    fs.writeFileSync(cadFilePath, originalCadSource, "utf-8");

    // Requirement: stress <= 150.0 MPa across loads [500, 2000] N and thickness [2, 6] mm
    // Peak stress formula: (load * 0.8) / thickness
    // At load=1500 and thickness=3 => stress = 1200 / 3 = 400 > 150! Falsified!
    const result = await runMultidomainFalsification({
      formula: "stress <= 150.0",
      params: JSON.stringify([
        { name: "wall_thickness", min: 2.0, max: 6.0 },
        { name: "external_load", min: 800.0, max: 2000.0 },
      ]),
      generations: 8,
      population: 10,
      cad: cadFilePath,
      outCad: outCadFilePath,
      outTrace: traceFilePath,
    });

    assert.strictEqual(result.isFalsified, true);
    assert(result.minRobustness < 0, `Expected negative robustness, got ${result.minRobustness}`);
    assert(result.counterexampleParams !== undefined);
    assert(result.traceRecord !== undefined);
    assert.strictEqual(result.traceRecord.status, "FALSIFIED");

    // Verify counterexample CAD was generated and patched
    assert(fs.existsSync(outCadFilePath), "Output CAD file must exist");
    const generatedCad = fs.readFileSync(outCadFilePath, "utf-8");
    assert(generatedCad.includes("const wall_thickness = "), "Must contain patched wall_thickness parameter");
    assert(!generatedCad.includes("const wall_thickness = 5;"), "Must have replaced original thickness value");

    // Verify trace file exists
    assert(fs.existsSync(traceFilePath), "Trace record file must exist");
    const traceJson = JSON.parse(fs.readFileSync(traceFilePath, "utf-8"));
    assert.strictEqual(traceJson.source, "falsification");

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should certify requirement when no parameter combination violates bounds", async () => {
    // Generous limit: stress <= 5000.0 MPa
    const result = await runMultidomainFalsification({
      formula: "stress <= 5000.0",
      params: JSON.stringify([
        { name: "wall_thickness", min: 4.0, max: 8.0 },
        { name: "external_load", min: 100.0, max: 500.0 },
      ]),
      generations: 4,
      population: 6,
    });

    assert.strictEqual(result.isFalsified, false);
    assert(result.minRobustness >= 0);
    assert(result.summary.includes("Requirement held across"));
  });
});

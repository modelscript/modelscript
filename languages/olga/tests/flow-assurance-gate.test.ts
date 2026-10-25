// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { parseOpi as parseOlga } from "../src/parser/opi-parser.js";
import { evaluateFlowAssuranceGate, parseGateMetric } from "../src/verification/flow-assurance-gate.js";

console.log("=== Testing Flow Assurance Gate Automation Engine ===");

const testModelOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="North Sea 12in Tieback" StartTime="0" EndTime="120" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_01">
    <Pipe Name="SUBSEA_PIPE" Length="4200.0" Diameter="0.3048" Elevation="-150.0" Roughness="0.000045" Discretization="12" />
    <Pipe Name="RISER" Length="850.0" Diameter="0.3048" Elevation="165.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="CHOKE" Position="5050.0" Diameter="0.18" Opening="0.80" Cd="0.84" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="TERMINAL" Flowpath="FLOWLINE_01" Fraction="0.0" Pressure="14000000" Temperature="340.15" MassRate="38.0" />
  <Node Name="PLATFORM" Type="SEPARATOR" Flowpath="FLOWLINE_01" Fraction="1.0" Pressure="3500000" Temperature="295.15" />
</Model>`;

const model = parseOlga(testModelOpi);

// 1. Metric parser tests
console.log("1. Testing parseGateMetric...");
assert.strictEqual(parseGateMetric("85m3", 100), 85);
assert.strictEqual(parseGateMetric("2mm", 5), 2);
assert.strictEqual(parseGateMetric("0.1mm/yr", 1), 0.1);
assert.strictEqual(parseGateMetric(undefined, 42), 42);
assert.strictEqual(parseGateMetric(150, 42), 150);
console.log("✔ parseGateMetric parsed units and numbers accurately.");

// 2. Gate evaluation with standard safe limits
console.log("2. Testing evaluateFlowAssuranceGate with compliant limits...");
const passingResult = evaluateFlowAssuranceGate(model, {
  maxSurgeM3: 150.0,
  minHydrateMarginK: 1.0,
  maxWaxThicknessMm: 2.0,
  maxCorrosionRateMmPerYear: 0.15,
  maxPressureBar: 250.0,
  minGasVelocity: 0.2,
  durationSeconds: 30,
});

assert.strictEqual(passingResult.passed, true, "Gate should pass with generous engineering thresholds");
assert.strictEqual(passingResult.checks.slugSurge.passed, true);
assert.strictEqual(passingResult.checks.hydrateMargin.passed, true);
assert.strictEqual(passingResult.checks.waxThickness.passed, true);
assert.strictEqual(passingResult.checks.corrosionRate.passed, true);
assert.strictEqual(passingResult.checks.maop.passed, true);
assert.strictEqual(passingResult.checks.turndownVelocity.passed, true);
assert.ok(passingResult.markdownReport.includes("# Flow Assurance Safety Gate Report: North Sea 12in Tieback"));
assert.ok(passingResult.markdownReport.includes("PASSED (APPROVED FOR OPERATION)"));
assert.ok(passingResult.markdownReport.includes("✅ PASS"));
console.log("✔ evaluateFlowAssuranceGate passed compliant model with GitHub Markdown summary!");

// 3. Gate evaluation with strictly failing surge threshold
console.log("3. Testing evaluateFlowAssuranceGate with failing surge limit...");
const failingResult = evaluateFlowAssuranceGate(model, {
  maxSurgeM3: 0.001, // Impossibly small slug catcher (0.001 m³)
  durationSeconds: 30,
});

assert.strictEqual(failingResult.passed, false, "Gate must fail when slug surge exceeds catcher limit");
assert.strictEqual(failingResult.checks.slugSurge.passed, false);
assert.ok(failingResult.markdownReport.includes("FAILED (BLOCKED — REMEDIATION REQUIRED)"));
assert.ok(failingResult.markdownReport.includes("❌ **FAIL**"));
console.log("✔ evaluateFlowAssuranceGate correctly detected surge limit violation!");

console.log("=== Flow Assurance Gate Tests Complete ===");

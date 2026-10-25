// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { lintOlgaModel } from "../src/lints/index.js";
import { getOlgaQuickFixes } from "../src/lints/quick-fixes.js";
import { parseOpi } from "../src/parser/opi-parser.js";
import {
  classifyNaceSourRegion,
  estimateInSituWaterPh,
  evaluateSourCorrosionIntegrity,
} from "../src/solver/sour-corrosion.js";

console.log("=== Testing Sour Gas (H2S) Corrosion & NACE MR0175 Compliance ===");

// 1. Test NACE MR0175 / ISO 15156 Region Classification
console.log("1. Testing NACE MR0175 sour severity region classification...");
assert.strictEqual(classifyNaceSourRegion(0.001, 6.0), "Region 0", "p_H2S < 0.003 bar should be Region 0");
assert.strictEqual(classifyNaceSourRegion(0.005, 6.0), "Region 1", "Low p_H2S with buffered pH should be Region 1");
assert.strictEqual(classifyNaceSourRegion(0.05, 5.0), "Region 2", "Moderate p_H2S (0.05 bar) should be Region 2");
assert.strictEqual(classifyNaceSourRegion(0.25, 4.2), "Region 3", "High p_H2S with low pH should be severe Region 3");

const ph = estimateInSituWaterPh(120e5, 340.15, 0.01, 0.03);
assert.ok(ph >= 3.5 && ph <= 6.5, `In-situ pH should be realistic (${ph})`);
console.log(`✔ NACE region mapping verified (estimated in-situ pH: ${ph.toFixed(2)})!`);

// 2. Test evaluateSourCorrosionIntegrity
console.log("2. Testing sour corrosion integrity & metallurgy compliance...");
const sourStandardSteel = evaluateSourCorrosionIntegrity({
  operatingPressurePa: 120e5, // 120 bar
  operatingTemperatureK: 335.15,
  h2sMoleFraction: 0.008, // ~0.96 bar H2S -> Severe Region 3
  co2MoleFraction: 0.03,
  mixtureVelocity: 2.5,
  pipeDiameterM: 0.254,
  nominalWallThicknessMm: 19.1,
  corrosionAllowanceMm: 3.0,
  metallurgy: "API_5L_X65", // Standard non-sour steel
});

assert.strictEqual(sourStandardSteel.naceRegion, "Region 3");
assert.strictEqual(sourStandardSteel.sscRisk, "SEVERE");
assert.strictEqual(sourStandardSteel.isHicSusceptible, true);
assert.strictEqual(
  sourStandardSteel.isMetallurgyCompliant,
  false,
  "Standard X65 cannot be deployed in Region 3 without CRA",
);
assert.ok(sourStandardSteel.complianceViolations.length > 0);
assert.ok(sourStandardSteel.mitigationRecommendation.includes("Inconel 625"));

// Test with Inconel 625 CRA cladding
const sourCraClad = evaluateSourCorrosionIntegrity({
  operatingPressurePa: 120e5,
  operatingTemperatureK: 335.15,
  h2sMoleFraction: 0.008,
  co2MoleFraction: 0.03,
  mixtureVelocity: 2.5,
  pipeDiameterM: 0.254,
  nominalWallThicknessMm: 19.1,
  corrosionAllowanceMm: 3.0,
  metallurgy: "INCONEL_625",
  hasCraCladding: true,
});
assert.strictEqual(sourCraClad.isMetallurgyCompliant, true, "Inconel 625 CRA cladding complies with severe Region 3");
console.log("✔ evaluateSourCorrosionIntegrity verified for standard steel vs CRA cladding!");

// 3. Test Linter Rule M7011 detection
console.log("3. Testing Pre-Flight Linter Rule M7011...");
const sourOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Sour Tieback System" StartTime="0" EndTime="100" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="SOUR_LINE">
    <Pipe Name="CARBON_STEEL_PIPE" Length="3000.0" Diameter="0.3048" Elevation="-100.0" Roughness="0.000045" Discretization="10" />
    <Valve Name="CHOKE" Position="2900.0" Diameter="0.20" Opening="0.80" Cd="0.84" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="TERMINAL" Flowpath="SOUR_LINE" Fraction="0.0" Pressure="14000000" Temperature="340.15" MassRate="35.0" H2sMoleFraction="0.005" />
  <Node Name="SEPARATOR" Type="SEPARATOR" Flowpath="SOUR_LINE" Fraction="1.0" Pressure="3000000" Temperature="295.15" />
</Model>`;

const parsedModel = parseOpi(sourOpi);
const diagnostics = lintOlgaModel(parsedModel);
const m7011 = diagnostics.find((d) => d.code === "M7011");
assert.ok(m7011, "Linter must detect M7011 for unmitigated sour flowline");
assert.strictEqual(m7011.severity, "error");
assert.ok(m7011.message.includes("NACE MR0175/ISO 15156 Region"));
console.log(`✔ Linter detected M7011: "${m7011.message}"`);

// 4. Test QuickFix for M7011
console.log("4. Testing Automated QuickFix for M7011...");
const fixes = getOlgaQuickFixes(sourOpi, "file:///model.opi");
assert.ok(fixes.length >= 2, "Should provide both sour service upgrade and CRA cladding QuickFixes");
assert.ok(fixes[0]!.title.includes("API 5L X65MS"));
assert.ok(fixes[1]!.title.includes("Inconel 625"));
assert.ok(fixes[0]!.isPreferred);

// Apply fix 0
const change = fixes[0]!.edit.changes["file:///model.opi"]![0]!;
assert.ok(change.newText.includes('Metallurgy="API_5L_X65MS"'));
console.log("✔ QuickFix for M7011 successfully synthesized sour-service upgrade edit!");

console.log("=== All Sour Gas (H2S) & NACE MR0175 Tests Passed! ===");

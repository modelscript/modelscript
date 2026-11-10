// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegulatoryDossier,
  compileNercRsawDocument,
  compileOscalAssessmentResults,
  generateCeiiWatermarkHeader,
  verifyComplianceAttestation,
  type DossierCompilationInput,
} from "../src/index.js";

describe("Automated Regulatory Dossier, NERC RSAW & NIST OSCAL 1.1 Compiler (@modelscript/ee)", () => {
  const sampleInput: DossierCompilationInput = {
    organizationName: "NextEra Energy Transmission LLC",
    utilityNercId: "NCR09876",
    plantName: "SOLAR_DESERT_100MW",
    gridInterconnection: "Western",
    baseKv: 230.0,
    totalMva: 100.0,
    generatorCount: 50,
    overallStatus: "COMPLIANT",
    findings: [
      {
        standard: "MOD-025-2",
        element: "Generator 1-1",
        rule: "active-power-limit",
        severity: "pass",
        description: "Active power output verified against registered maximum capability.",
        observedValue: "100.0 MW",
        expectedRange: "100.0 MW",
      },
      {
        standard: "MOD-026-1",
        element: "Generator 1-1",
        rule: "exciter-voltage-response",
        severity: "pass",
        description: "AVR dynamic step response meets NERC R² >= 0.85 tolerance (R² = 0.94).",
        observedValue: "R² = 0.94",
        expectedRange: "R² >= 0.85",
      },
      {
        standard: "MOD-027-1",
        element: "Generator 1-1",
        rule: "governor-droop-verification",
        severity: "pass",
        description: "Turbine-governor droop verified at 4.0% (within statutory 3%-5% range).",
        observedValue: "4.0%",
        expectedRange: "3.0% - 5.0%",
      },
      {
        standard: "PRC-019-2",
        element: "Generator 1-1",
        rule: "prc-019-lof-coordinated",
        severity: "pass",
        description: "Loss-of-Field relay mho circle coordinates cleanly with generator underexcited capability limit.",
      },
      {
        standard: "PRC-024-3",
        element: "Generator 1-1",
        rule: "prc-024-undervoltage-cleared",
        severity: "pass",
        description: "Undervoltage setting 0.80 pu at 3.5 s coordinates cleanly outside PRC-024 envelope.",
      },
      {
        standard: "IEEE-2800-2022",
        element: "POI Bus 10",
        rule: "fast-dynamic-voltage-support",
        severity: "pass",
        description: "Fast reactive current step response time T90% = 35 ms <= 50 ms limit.",
        observedValue: "35 ms",
        expectedRange: "<= 50 ms",
      },
    ],
    simulationArtifactHashes: {
      "SOLAR_DESERT_100MW_WECC_EQUIV.raw": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "SOLAR_DESERT_100MW.dyr": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      "LVRT_SIMULATION_PLAYBACK.comtrade": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce",
    },
    isCeiiRestricted: true,
  };

  it("generates FERC CEII watermarked NERC RSAW document", () => {
    const rsaw = compileNercRsawDocument(sampleInput);

    assert.ok(rsaw.includes("CRITICAL ENERGY/ELECTRIC INFRASTRUCTURE INFORMATION"));
    assert.ok(rsaw.includes("18 C.F.R. § 388.113"));
    assert.ok(rsaw.includes("SOLAR_DESERT_100MW"));
    assert.ok(rsaw.includes("MOD-025-2"));
    assert.ok(rsaw.includes("MOD-026-1"));
    assert.ok(rsaw.includes("MOD-027-1"));
    assert.ok(rsaw.includes("PRC-019-2"));
    assert.ok(rsaw.includes("PRC-024-3"));
    assert.ok(rsaw.includes("IEEE-2800-2022"));
    assert.ok(rsaw.includes("Cryptographic Chain of Custody & Verification Manifest"));
    assert.ok(rsaw.includes("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  });

  it("compiles NIST OSCAL 1.1 assessment-results JSON", () => {
    const oscal = compileOscalAssessmentResults(sampleInput) as Record<string, unknown>;
    const assessmentResults = oscal["assessment-results"] as Record<string, unknown>;
    assert.ok(assessmentResults);

    const metadata = assessmentResults["metadata"] as Record<string, unknown>;
    assert.equal(metadata["oscal-version"], "1.1.0");

    const results = assessmentResults["results"] as Array<Record<string, unknown>>;
    assert.ok(results && results.length > 0);

    const firstResult = results[0]!;
    const observations = firstResult["observations"] as Array<Record<string, unknown>>;
    assert.equal(observations.length, 6);

    const findings = firstResult["findings"] as Array<Record<string, unknown>>;
    assert.equal(findings.length, 6);
    assert.equal((findings[0]!["status"] as Record<string, string>)["state"], "satisfied");
  });

  it("builds, watermarks, digests, and signs a complete regulatory dossier bundle", () => {
    const dossier = buildRegulatoryDossier(sampleInput);

    assert.ok(dossier.dossierId.startsWith("DOSSIER-"));
    assert.equal(dossier.plantName, "SOLAR_DESERT_100MW");
    assert.equal(dossier.overallStatus, "COMPLIANT");
    assert.ok(dossier.manifestDigestSha256.length === 64);

    // Verify Ed25519 signature
    const verifyResult = verifyComplianceAttestation(dossier.signedAttestation.bundleToken);
    assert.equal(verifyResult.valid, true, `Attestation signature should be valid: ${verifyResult.reason}`);
    assert.equal(verifyResult.payload?.standard, "NERC-CIP-002-014");
    assert.equal(verifyResult.payload?.workspaceId, "SOLAR_DESERT_100MW");
    assert.equal(verifyResult.payload?.artifactSha256, dossier.manifestDigestSha256);
  });
});

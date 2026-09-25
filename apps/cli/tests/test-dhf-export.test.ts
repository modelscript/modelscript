// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RtmAnalytics, RtmElement, RtmLink } from "@modelscript/lsp";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { generateDhfMarkdown } from "../src/commands/dhf.js";

describe("Design History File (DHF) Exporter", () => {
  test("generateDhfMarkdown produces all 5 required regulatory sections for Class C device", () => {
    const hazards: RtmElement[] = [
      {
        id: 1,
        name: "HAZ_Stale_CGM",
        qualifiedName: "InsulinPump::HAZ_Stale_CGM",
        domain: "hazard",
        type: "HazardDefinition",
        uri: "file:///insulin_pump.sysml",
        startByte: 0,
        endByte: 100,
        metadata: {
          hazardId: "HAZ-102",
          text: "Algorithm calculates insulin dose on stale sensor reading",
          iso14971: {
            hazardId: "HAZ-102",
            name: "HAZ_Stale_CGM",
            initialSeverity: 5,
            initialProbability: 3,
            initialRpn: 15,
            initialAcceptability: "Unacceptable",
            mitigationRequirementIds: ["SR-204"],
            residualSeverity: 5,
            residualProbability: 1,
            residualRpn: 5,
            residualAcceptability: "Broadly Acceptable",
            status: "Mitigated",
          },
        },
      },
    ];

    const requirements: RtmElement[] = [
      {
        id: 2,
        name: "SR_204",
        qualifiedName: "InsulinPump::SR_204",
        domain: "requirement",
        type: "RequirementDefinition",
        uri: "file:///requirements.sysml",
        startByte: 110,
        endByte: 220,
        metadata: {
          reqId: "SR-204",
          text: "The controller shall reject CGM data older than 5 minutes",
        },
      },
    ];

    const components: RtmElement[] = [
      {
        id: 3,
        name: "data_validator",
        qualifiedName: "InsulinPump::data_validator",
        domain: "sysml_logical",
        type: "PartDefinition",
        uri: "file:///controller.sysml",
        startByte: 230,
        endByte: 300,
        metadata: {},
      },
    ];

    const verifications: RtmElement[] = [
      {
        id: 4,
        name: "cgm_timeout_proof",
        qualifiedName: "InsulinPump::cgm_timeout_proof",
        domain: "verification_case",
        type: "VerificationCaseDefinition",
        uri: "file:///verification.sysml",
        startByte: 310,
        endByte: 400,
        metadata: {},
      },
    ];

    const links: RtmLink[] = [
      {
        id: "HAZ_Stale_CGM->SR_204",
        linkKind: "mitigate",
        sourceId: 1,
        sourceName: "HAZ_Stale_CGM",
        sourceUri: "file:///insulin_pump.sysml",
        targetId: 2,
        targetName: "SR_204",
        targetUri: "file:///requirements.sysml",
        status: "passed",
        isSuspect: false,
      },
      {
        id: "data_validator->SR_204",
        linkKind: "satisfy",
        sourceId: 3,
        sourceName: "data_validator",
        sourceUri: "file:///controller.sysml",
        targetId: 2,
        targetName: "SR_204",
        targetUri: "file:///requirements.sysml",
        status: "passed",
        isSuspect: false,
      },
      {
        id: "cgm_timeout_proof->SR_204",
        linkKind: "verify",
        sourceId: 4,
        sourceName: "cgm_timeout_proof",
        sourceUri: "file:///verification.sysml",
        targetId: 2,
        targetName: "SR_204",
        targetUri: "file:///requirements.sysml",
        status: "passed",
        isSuspect: false,
      },
    ];

    const analytics: RtmAnalytics = {
      totalRequirements: 1,
      satisfiedCount: 1,
      satisfiedPercentage: 100,
      verifiedCount: 1,
      verifiedPercentage: 100,
      orphanRequirements: [],
      unallocatedComponents: [],
      suspectLinkCount: 0,
      failingLinkCount: 0,
      totalHazards: 1,
      mitigatedHazardsCount: 1,
      unmitigatedHazardsCount: 0,
      unacceptableResidualRiskCount: 0,
      averageRpnReduction: 10,
    };

    const gitInfo = {
      commitSha: "e9f7a8b2c1d0e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
      branch: "main",
      author: "Dr. Sarah Chen <sarah.chen@startup.com>",
      date: "2026-09-23 19:30:00 +0000",
      isSigned: true,
      signatureInfo: "Valid GPG/SSH Signature",
      isDirty: false,
    };

    const md = generateDhfMarkdown(
      "Artificial Pancreas DHF Dossier",
      "Closed-Loop Insulin Delivery System (Class C)",
      "Verification Team",
      hazards,
      requirements,
      components,
      verifications,
      links,
      analytics,
      gitInfo,
    );

    // Verify Title and Standards Conformance
    assert.ok(md.includes("# Artificial Pancreas DHF Dossier"));
    assert.ok(md.includes("IEC 62304 Safety Class C"));
    assert.ok(md.includes("ISO 14971:2019"));

    // Verify Section 1: Executive Summary & Identification
    assert.ok(md.includes("## 1. Executive Summary & Environment Fingerprint"));
    assert.ok(md.includes("e9f7a8b2c1d0e3f4a5b6c7d8e9f0a1b2c3d4e5f6"));
    assert.ok(md.includes("Valid GPG/SSH Signature"));

    // Verify Section 2: ISO 14971 FMECA Table
    assert.ok(md.includes("## 2. ISO 14971 Risk Management File & FMECA Ledger"));
    assert.ok(md.includes("HAZ-102"));
    assert.ok(md.includes("SR-204"));
    assert.ok(md.includes("✅ Mitigated"));

    // Verify Section 3: Traceability Matrix (RTM)
    assert.ok(md.includes("## 3. Requirement Traceability Matrix (RTM) Ledger"));
    assert.ok(md.includes("data_validator"));
    assert.ok(md.includes("cgm_timeout_proof"));
    assert.ok(md.includes("✅ Passed"));

    // Verify Section 4: Formal Verification Evidence
    assert.ok(md.includes("## 4. Formal Verification & Validation Proof Summary"));
    assert.ok(md.includes("DPLL(T) SMT + HC4"));
    assert.ok(md.includes("IC3 / PDR"));

    // Verify Section 5: 21 CFR Part 11 Electronic Signatures
    assert.ok(md.includes("## 5. 21 CFR Part 11 Electronic Signatures & Approvals"));
    assert.ok(md.includes("Verification Team"));
  });

  test("generateDhfMarkdown emits Section 6 when proofManifest is provided", () => {
    const gitInfo = {
      commitSha: "e9f7a8b2c1d0e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
      branch: "main",
      author: "Test Engineer <test@example.com>",
      date: "2026-03-30T10:00:00Z",
      isSigned: true,
      signatureInfo: "Valid GPG/SSH Signature",
      isDirty: false,
    };

    const analytics: RtmAnalytics = {
      totalRequirements: 1,
      satisfiedCount: 1,
      verifiedCount: 1,
      satisfiedPercentage: 100,
      verifiedPercentage: 100,
      suspectLinkCount: 0,
      unmitigatedHazardsCount: 0,
      totalHazards: 0,
    };

    const proofManifest = {
      manifestId: "manifest-001",
      schemaVersion: "1.0.0" as const,
      timestamp: "2026-09-25T01:00:00Z",
      gitCommitSha: gitInfo.commitSha,
      items: [
        {
          domain: "sysml" as const,
          identifier: "file:///model.sysml",
          sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          verificationStatus: "CERTIFIED_SAFE" as const,
          engine: "contract_algebra",
        },
      ],
      compositeRootHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      isCertifiedCompliant: true,
      signatureToken: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
    };

    const md = generateDhfMarkdown(
      "DHF with Proof Manifest",
      "Infusion Pump",
      "Safety Team",
      [],
      [],
      [],
      [],
      [],
      analytics,
      gitInfo,
      proofManifest,
    );

    assert.ok(md.includes("## 6. Cryptographic Digital Thread Proof Manifest & Machine-Checkable Evidence"));
    assert.ok(md.includes("manifest-001"));
    assert.ok(md.includes("MATHEMATICALLY CERTIFIED SAFE"));
    assert.ok(md.includes("file:///model.sysml"));
    assert.ok(md.includes("contract_algebra"));
  });
});

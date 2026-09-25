// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProofManifestGenerator, type ProofManifestItem } from "../src/formal/proof_manifest.js";

describe("Cryptographically Verifiable Digital Thread Proof Manifest Suite", () => {
  it("should generate and cryptographically verify a multi-domain proof manifest", () => {
    const sysmlCode = `requirement def SafePressureReq { doc /* pressure <= 50 bar */ }`;
    const modelicaCode = `model ValveControl ... equation p <= 50; end ValveControl;`;
    const cadStepContent = `ISO-10303-21; HEADER; ... ENDSEC; DATA; ... ENDSEC; END-ISO-10303-21;`;

    const items: ProofManifestItem[] = [
      {
        domain: "sysml",
        identifier: "SysML::SafePressureReq",
        sha256: ProofManifestGenerator.hashContent(sysmlCode),
        verificationStatus: "CERTIFIED_SAFE",
        engine: "contract_algebra",
      },
      {
        domain: "modelica",
        identifier: "file:///models/ValveControl.mo",
        sha256: ProofManifestGenerator.hashContent(modelicaCode),
        verificationStatus: "CERTIFIED_SAFE",
        engine: "dpll_t",
      },
      {
        domain: "cad",
        identifier: "file:///cad/valve_body.step",
        sha256: ProofManifestGenerator.hashContent(cadStepContent),
        verificationStatus: "CERTIFIED_SAFE",
        engine: "clearance",
      },
      {
        domain: "formal_proof",
        identifier: "ProofWitness::IC3_InductiveInvariant_P01",
        sha256: ProofManifestGenerator.hashContent("INDUCTIVE_INVARIANT_FRAME_3"),
        verificationStatus: "UNSAT",
        engine: "ic3",
      },
    ];

    const gitCommitSha = "a1b2c3d4e5f67890123456789abcdef012345678";
    const manifest = ProofManifestGenerator.generateManifest(items, gitCommitSha);

    assert.strictEqual(manifest.isCertifiedCompliant, true);
    assert.strictEqual(manifest.items.length, 4);
    assert.strictEqual(manifest.gitCommitSha, gitCommitSha);
    assert(manifest.compositeRootHash.length === 64, "SHA-256 root hash must be 64 hex characters");
    assert(manifest.signatureToken.length === 64, "Signature token must be 64 hex characters");

    // Cryptographic verification must pass
    const verification = ProofManifestGenerator.verifyManifest(manifest);
    assert.strictEqual(verification.isValid, true);
    assert.strictEqual(verification.computedRootHash, manifest.compositeRootHash);

    // Markdown generation
    const md = ProofManifestGenerator.formatMarkdownSection(manifest);
    assert(md.includes("Cryptographic Digital Thread Proof Manifest"));
    assert(md.includes("MATHEMATICALLY CERTIFIED SAFE"));
    assert(md.includes("SysML::SafePressureReq"));
    assert(md.includes("file:///models/ValveControl.mo"));
  });

  it("should detect tampering when any artifact hash or verification status is modified", () => {
    const items: ProofManifestItem[] = [
      {
        domain: "sysml",
        identifier: "SysML::HighStressLimit",
        sha256: "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
        verificationStatus: "CERTIFIED_SAFE",
      },
    ];

    const manifest = ProofManifestGenerator.generateManifest(items, "commit-1234");
    assert.strictEqual(ProofManifestGenerator.verifyManifest(manifest).isValid, true);

    // 1. Tamper with SHA256 of an artifact
    const tamperedManifest1 = JSON.parse(JSON.stringify(manifest));
    tamperedManifest1.items[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000";

    const v1 = ProofManifestGenerator.verifyManifest(tamperedManifest1);
    assert.strictEqual(v1.isValid, false);
    assert(v1.reason?.includes("Composite root hash mismatch"));

    // 2. Tamper with signature token
    const tamperedManifest2 = JSON.parse(JSON.stringify(manifest));
    tamperedManifest2.signatureToken = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const v2 = ProofManifestGenerator.verifyManifest(tamperedManifest2);
    assert.strictEqual(v2.isValid, false);
    assert(v2.reason?.includes("signature token verification failed"));
  });
});

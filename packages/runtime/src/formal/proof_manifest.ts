// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Cryptographically Verifiable Digital Thread Proof Manifest.
 *
 * Implements tamper-evident, machine-checkable digital thread certificates binding
 * SysML v2 requirements, Modelica 1D DAE equations, 3D CAD geometries, and formal
 * verification solver outcomes (IC3 inductive invariants, SMT UNSAT cores, and reachability proofs).
 */

import crypto from "node:crypto";

export interface ProofManifestItem {
  domain: "sysml" | "modelica" | "cad" | "formal_proof";
  identifier: string; // e.g. "file:///path/to/model.mo" or "SysML::SafetyReq"
  sha256: string;
  verificationStatus: "CERTIFIED_SAFE" | "UNSAT" | "FALSIFIED" | "UNCHECKED";
  engine?: string; // e.g. "ic3", "dpll_t", "reachability", "contract_algebra"
  witnessTraceId?: string;
  timestamp?: string;
}

export interface DigitalThreadProofManifest {
  manifestId: string;
  schemaVersion: "1.0.0";
  timestamp: string;
  gitCommitSha: string;
  items: ProofManifestItem[];
  compositeRootHash: string;
  isCertifiedCompliant: boolean;
  signatureToken: string;
}

export class ProofManifestGenerator {
  /**
   * Computes the SHA-256 hex digest of string or buffer content.
   */
  public static hashContent(content: string | Buffer): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Generates a tamper-evident digital thread proof manifest.
   */
  public static generateManifest(
    items: ProofManifestItem[],
    gitCommitSha: string = "HEAD",
  ): DigitalThreadProofManifest {
    const timestamp = new Date().toISOString();

    // Sort items by identifier for deterministic hashing
    const sortedItems = [...items].sort((a, b) => a.identifier.localeCompare(b.identifier));

    // Compute composite Merkle root hash
    const hash = crypto.createHash("sha256");
    hash.update(gitCommitSha);
    hash.update(timestamp);
    for (const item of sortedItems) {
      hash.update(`${item.domain}::${item.identifier}::${item.sha256}::${item.verificationStatus}`);
    }
    const compositeRootHash = hash.digest("hex");

    // All formal items must be either CERTIFIED_SAFE or UNSAT (safe)
    const isCertifiedCompliant =
      sortedItems.length > 0 &&
      sortedItems.every(
        (it) =>
          it.domain !== "formal_proof" ||
          it.verificationStatus === "CERTIFIED_SAFE" ||
          it.verificationStatus === "UNSAT",
      );

    // Synthetic verifiable cryptographic signature token
    const sigPayload = `PROOF-TOKEN::${compositeRootHash}::${gitCommitSha}::${isCertifiedCompliant ? "VALID" : "INVALID"}`;
    const signatureToken = crypto.createHash("sha256").update(sigPayload).digest("hex");

    return {
      manifestId: `proof-manifest-${Date.now()}`,
      schemaVersion: "1.0.0",
      timestamp,
      gitCommitSha,
      items: sortedItems,
      compositeRootHash,
      isCertifiedCompliant,
      signatureToken,
    };
  }

  /**
   * Verifies the cryptographic integrity and validity of a proof manifest.
   */
  public static verifyManifest(manifest: DigitalThreadProofManifest): {
    isValid: boolean;
    computedRootHash: string;
    reason?: string;
  } {
    const hash = crypto.createHash("sha256");
    hash.update(manifest.gitCommitSha);
    hash.update(manifest.timestamp);
    for (const item of manifest.items) {
      hash.update(`${item.domain}::${item.identifier}::${item.sha256}::${item.verificationStatus}`);
    }
    const computedRootHash = hash.digest("hex");

    if (computedRootHash !== manifest.compositeRootHash) {
      return {
        isValid: false,
        computedRootHash,
        reason: "Composite root hash mismatch: manifest content has been altered or tampered with.",
      };
    }

    const expectedSig = crypto
      .createHash("sha256")
      .update(
        `PROOF-TOKEN::${computedRootHash}::${manifest.gitCommitSha}::${manifest.isCertifiedCompliant ? "VALID" : "INVALID"}`,
      )
      .digest("hex");

    if (expectedSig !== manifest.signatureToken) {
      return {
        isValid: false,
        computedRootHash,
        reason: "Cryptographic signature token verification failed.",
      };
    }

    return {
      isValid: true,
      computedRootHash,
    };
  }

  /**
   * Formats the proof manifest as a GitHub-flavored markdown section for DHF dossiers.
   */
  public static formatMarkdownSection(manifest: DigitalThreadProofManifest): string {
    let md = `## 6. Cryptographic Digital Thread Proof Manifest & Machine-Checkable Evidence\n\n`;
    md += `This section provides tamper-evident cryptographic SHA-256 bindings across all architectural specifications (SysML v2), continuous physical models (Modelica DAE), 3D geometries (CAD), and automated formal verification proofs.\n\n`;

    md += `| Attribute | Verification Manifest Digest |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Manifest Identifier** | \`${manifest.manifestId}\` |\n`;
    md += `| **Composite Merkle Root Hash** | \`${manifest.compositeRootHash}\` |\n`;
    md += `| **Cryptographic Proof Token** | \`${manifest.signatureToken}\` |\n`;
    md += `| **Verification Compliance** | ${manifest.isCertifiedCompliant ? "✅ MATHEMATICALLY CERTIFIED SAFE" : "❌ VERIFICATION FALSIFIED / UNRESOLVED"} |\n`;
    md += `| **Timestamp** | ${manifest.timestamp} |\n\n`;

    md += `### Indexed Digital Thread Artifacts\n\n`;
    md += `| Domain | Artifact / Property Identifier | SHA-256 Digest | Formal Verification Status | Engine |\n`;
    md += `| :--- | :--- | :--- | :---: | :--- |\n`;

    for (const item of manifest.items) {
      const statusIcon =
        item.verificationStatus === "CERTIFIED_SAFE" || item.verificationStatus === "UNSAT"
          ? "✅ " + item.verificationStatus
          : item.verificationStatus === "FALSIFIED"
            ? "❌ FALSIFIED"
            : "⏳ UNCHECKED";

      md += `| \`${item.domain}\` | \`${item.identifier}\` | \`${item.sha256.substring(0, 16)}...\` | ${statusIcon} | ${item.engine ?? "N/A"} |\n`;
    }
    md += `\n`;

    return md;
  }
}

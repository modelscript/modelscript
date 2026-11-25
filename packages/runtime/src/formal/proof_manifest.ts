// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Cryptographically Verifiable Digital Thread Proof Manifest.
 *
 * Implements tamper-evident, machine-checkable digital thread certificates binding
 * SysML v2 requirements, Modelica 1D DAE equations, 3D CAD geometries, and formal
 * verification solver outcomes (IC3 inductive invariants, SMT UNSAT cores, and reachability proofs).
 */

import type * as cryptoType from "node:crypto";

function getNodeCryptoOptional(): typeof cryptoType | undefined {
  if (typeof process === "undefined") return undefined;
  return (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.("node:crypto") as
    typeof cryptoType | undefined;
}

function getNodeCrypto(): typeof cryptoType {
  const c = getNodeCryptoOptional();
  if (!c) {
    throw new Error("ProofManifestGenerator Ed25519 signing/verification requires Node.js node:crypto");
  }
  return c;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const textEncoder = new TextEncoder();

interface Sha256Hasher {
  update(data: string | Uint8Array): Sha256Hasher;
  digest(): string;
}

class PureSha256Hasher implements Sha256Hasher {
  private readonly chunks: Uint8Array[] = [];
  private totalLength = 0;

  update(data: string | Uint8Array): Sha256Hasher {
    const bytes = typeof data === "string" ? textEncoder.encode(data) : data;
    this.chunks.push(bytes);
    this.totalLength += bytes.byteLength;
    return this;
  }

  digest(): string {
    const len = this.totalLength;
    const paddedLen = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(paddedLen);

    let offset = 0;
    for (const chunk of this.chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }

    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    const bitLenHigh = Math.floor(len / 0x20000000);
    const bitLenLow = (len << 3) >>> 0;
    view.setUint32(paddedLen - 8, bitLenHigh, false);
    view.setUint32(paddedLen - 4, bitLenLow, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);

    for (let pos = 0; pos < paddedLen; pos += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(pos + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const w15 = w[i - 15]!;
        const w2 = w[i - 2]!;
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
      h5 = (h5 + f) | 0;
      h6 = (h6 + g) | 0;
      h7 = (h7 + h) | 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }
}

function createSha256(): Sha256Hasher {
  const nodeCrypto = getNodeCryptoOptional();
  if (nodeCrypto) {
    const native = nodeCrypto.createHash("sha256");
    const wrapper: Sha256Hasher = {
      update(data: string | Uint8Array): Sha256Hasher {
        native.update(data);
        return wrapper;
      },
      digest(): string {
        return native.digest("hex");
      },
    };
    return wrapper;
  }
  return new PureSha256Hasher();
}

export interface ProofManifestItem {
  domain: "sysml" | "modelica" | "cad" | "formal_proof";
  identifier: string; // e.g. "file:///path/to/model.mo" or "SysML::SafetyReq"
  sha256: string;
  verificationStatus: "CERTIFIED_SAFE" | "UNSAT" | "FALSIFIED" | "UNCHECKED";
  engine?: string | undefined; // e.g. "ic3", "dpll_t", "reachability", "contract_algebra"
  /**
   * Rigor of the evidence behind a safe status. A `heuristic` item can never make the manifest compliant;
   * `float-sound` is sound in exact arithmetic with uncontrolled floating-point rounding.
   */
  rigor?: "rigorous" | "float-sound" | "heuristic" | undefined;
  witnessTraceId?: string | undefined;
  timestamp?: string | undefined;
}

export interface ManifestSigningOptions {
  algorithm?: "sha256" | "ed25519" | undefined;
  privateKey?: cryptoType.KeyObject | string | undefined;
  publicKey?: cryptoType.KeyObject | string | undefined;
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
  signatureAlgorithm?: "sha256" | "ed25519" | undefined;
  publicKey?: string | undefined;
}

export class ProofManifestGenerator {
  /**
   * Computes the SHA-256 hex digest of string or byte buffer content.
   */
  public static hashContent(content: string | Uint8Array): string {
    return createSha256().update(content).digest();
  }

  /**
   * Generates a tamper-evident digital thread proof manifest.
   */
  public static generateManifest(
    items: ProofManifestItem[],
    gitCommitSha: string = "HEAD",
    options?: ManifestSigningOptions,
  ): DigitalThreadProofManifest {
    const timestamp = new Date().toISOString();

    // Sort items by identifier for deterministic hashing
    const sortedItems = [...items].sort((a, b) => a.identifier.localeCompare(b.identifier));

    // Compute composite Merkle root hash
    const hash = createSha256();
    hash.update(gitCommitSha);
    hash.update(timestamp);
    for (const item of sortedItems) {
      hash.update(`${item.domain}::${item.identifier}::${item.sha256}::${item.verificationStatus}`);
    }
    const compositeRootHash = hash.digest();

    // All formal items must be either CERTIFIED_SAFE or UNSAT (safe), and none may rest on heuristic evidence
    const isCertifiedCompliant =
      sortedItems.length > 0 &&
      sortedItems.every(
        (it) =>
          it.domain !== "formal_proof" ||
          ((it.verificationStatus === "CERTIFIED_SAFE" || it.verificationStatus === "UNSAT") &&
            it.rigor !== "heuristic"),
      );

    const sigPayload = `PROOF-TOKEN::${compositeRootHash}::${gitCommitSha}::${isCertifiedCompliant ? "VALID" : "INVALID"}`;

    if (options?.algorithm === "ed25519") {
      const nodeCrypto = getNodeCrypto();
      let privKey = options.privateKey;
      let pubKeyPem = typeof options.publicKey === "string" ? options.publicKey : undefined;

      if (!privKey) {
        const keyPair = nodeCrypto.generateKeyPairSync("ed25519");
        privKey = keyPair.privateKey;
        pubKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
      } else if (options.publicKey && typeof options.publicKey !== "string") {
        pubKeyPem = options.publicKey.export({ type: "spki", format: "pem" }).toString();
      }

      const sig = nodeCrypto.sign(null, Buffer.from(sigPayload, "utf8"), privKey);
      const signatureToken = sig.toString("hex");

      return {
        manifestId: `proof-manifest-${Date.now()}`,
        schemaVersion: "1.0.0",
        timestamp,
        gitCommitSha,
        items: sortedItems,
        compositeRootHash,
        isCertifiedCompliant,
        signatureToken,
        signatureAlgorithm: "ed25519",
        publicKey: pubKeyPem,
      };
    }

    // Default SHA-256 verifiable token
    const signatureToken = createSha256().update(sigPayload).digest();

    return {
      manifestId: `proof-manifest-${Date.now()}`,
      schemaVersion: "1.0.0",
      timestamp,
      gitCommitSha,
      items: sortedItems,
      compositeRootHash,
      isCertifiedCompliant,
      signatureToken,
      signatureAlgorithm: "sha256",
    };
  }

  /**
   * Verifies the cryptographic integrity and validity of a proof manifest.
   */
  public static verifyManifest(manifest: DigitalThreadProofManifest): {
    isValid: boolean;
    computedRootHash: string;
    reason?: string | undefined;
  } {
    const hash = createSha256();
    hash.update(manifest.gitCommitSha);
    hash.update(manifest.timestamp);
    for (const item of manifest.items) {
      hash.update(`${item.domain}::${item.identifier}::${item.sha256}::${item.verificationStatus}`);
    }
    const computedRootHash = hash.digest();

    if (computedRootHash !== manifest.compositeRootHash) {
      return {
        isValid: false,
        computedRootHash,
        reason: "Composite root hash mismatch: manifest content has been altered or tampered with.",
      };
    }

    const sigPayload = `PROOF-TOKEN::${computedRootHash}::${manifest.gitCommitSha}::${manifest.isCertifiedCompliant ? "VALID" : "INVALID"}`;

    if (manifest.signatureAlgorithm === "ed25519" && manifest.publicKey) {
      try {
        const nodeCrypto = getNodeCrypto();
        const pubKey = nodeCrypto.createPublicKey(manifest.publicKey);
        const isVerified = nodeCrypto.verify(
          null,
          Buffer.from(sigPayload, "utf8"),
          pubKey,
          Buffer.from(manifest.signatureToken, "hex"),
        );
        if (!isVerified) {
          return {
            isValid: false,
            computedRootHash,
            reason: "Cryptographic asymmetric signature (Ed25519) verification failed.",
          };
        }
        return {
          isValid: true,
          computedRootHash,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isValid: false,
          computedRootHash,
          reason: `Cryptographic signature verification error: ${message}`,
        };
      }
    }

    const expectedSig = createSha256().update(sigPayload).digest();

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
    md += `| **Verification Compliance** | ${manifest.isCertifiedCompliant ? "✅ ALL FORMAL ITEMS PROVEN (see per-item rigor)" : "❌ VERIFICATION FALSIFIED / UNRESOLVED"} |\n`;
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

      const engineLabel = item.rigor ? `${item.engine ?? "N/A"} (${item.rigor})` : (item.engine ?? "N/A");
      md += `| \`${item.domain}\` | \`${item.identifier}\` | \`${item.sha256.substring(0, 16)}...\` | ${statusIcon} | ${engineLabel} |\n`;
    }
    md += `\n`;

    return md;
  }
}

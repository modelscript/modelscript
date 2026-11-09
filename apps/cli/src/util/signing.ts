// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function encodeBase58(buffer: Uint8Array): string {
  if (buffer.length === 0) return "";
  let zeros = 0;
  while (zeros < buffer.length && buffer[zeros] === 0) {
    zeros++;
  }
  const digits: number[] = [0];
  for (let i = zeros; i < buffer.length; i++) {
    let carry = buffer[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]!];
  }
  return str;
}

export function encodeMultibase(bytes: Uint8Array): string {
  return `z${encodeBase58(bytes)}`;
}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Cannot serialize non-finite numbers in JCS");
      if (Object.is(value, -0)) return "0";
      return String(value);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalizeJson(item))).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => {
    const bufA = Buffer.from(a, "utf16le");
    const bufB = Buffer.from(b, "utf16le");
    const len = Math.min(bufA.length, bufB.length) / 2;
    for (let i = 0; i < len; i++) {
      const codeA = bufA.readUInt16LE(i * 2);
      const codeB = bufB.readUInt16LE(i * 2);
      if (codeA !== codeB) return codeA - codeB;
    }
    return a.length - b.length;
  });
  const entries: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    entries.push(`${JSON.stringify(k)}:${canonicalizeJson(v)}`);
  }
  return `{${entries.join(",")}}`;
}

export function writeSshWireString(data: Buffer | string): Buffer {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const out = Buffer.alloc(4 + buf.length);
  out.writeUInt32BE(buf.length, 0);
  buf.copy(out, 4);
  return out;
}

export function readSshWireString(buf: Buffer, offset: number): { value: Buffer; nextOffset: number } {
  if (offset + 4 > buf.length) throw new Error("Unexpected end of SSH wire buffer");
  const len = buf.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + len;
  if (end > buf.length) throw new Error("SSH wire string length exceeds buffer");
  return { value: buf.subarray(start, end), nextOffset: end };
}

export function computeSshFingerprint(wireBytes: Buffer): string {
  const hash = crypto.createHash("sha256").update(wireBytes).digest("base64").replace(/=+$/, "");
  return `SHA256:${hash}`;
}

export interface ParsedSshPublicKey {
  algo: string;
  rawPubkey: Buffer;
  wireBytes: Buffer;
  fingerprintSha256: string;
  multibase: string;
  openssh: string;
}

export function parseSshPublicKey(keyStr: string): ParsedSshPublicKey {
  const trimmed = keyStr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    throw new Error("Invalid OpenSSH public key format");
  }
  const algo = parts[0]!;
  if (algo !== "ssh-ed25519" && algo !== "sk-ssh-ed25519@openssh.com") {
    throw new Error(
      `Unsupported public key algorithm: '${algo}'. Supported algorithms: 'ssh-ed25519', 'sk-ssh-ed25519@openssh.com'.`,
    );
  }
  const wireBytes = Buffer.from(parts[1]!, "base64");
  let offset = 0;
  const algoWire = readSshWireString(wireBytes, offset);
  offset = algoWire.nextOffset;
  const keyType = algoWire.value.toString("utf8");
  if (keyType !== algo) {
    throw new Error(`Public key wire type '${keyType}' mismatch with header '${algo}'`);
  }
  const pubWire = readSshWireString(wireBytes, offset);
  const rawPubkey = pubWire.value;
  if (rawPubkey.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${rawPubkey.length} bytes (expected 32)`);
  }
  const fingerprintSha256 = computeSshFingerprint(wireBytes);
  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(rawPubkey, 2);
  const multibase = encodeMultibase(multicodec);

  return {
    algo: algo === "ssh-ed25519" ? "ed25519" : algo,
    rawPubkey,
    wireBytes,
    fingerprintSha256,
    multibase,
    openssh: `${algo} ${parts[1]}${parts[2] ? ` ${parts[2]}` : ""}`,
  };
}

export function generateEd25519KeyPair(comment: string = "modelscript"): {
  privateKeyPem: string;
  publicKeyOpenSsh: string;
  fingerprintSha256: string;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
  const pubDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const rawPubkey = pubDer.subarray(pubDer.length - 32);

  const wireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawPubkey)]);
  const publicKeyOpenSsh = `ssh-ed25519 ${wireBytes.toString("base64")} ${comment}`;
  const fingerprintSha256 = computeSshFingerprint(wireBytes);

  return {
    privateKeyPem,
    publicKeyOpenSsh,
    fingerprintSha256,
  };
}

export function readPrivateKey(keyPathOrContent: string): crypto.KeyObject {
  let content = keyPathOrContent;
  if (fs.existsSync(keyPathOrContent)) {
    content = fs.readFileSync(keyPathOrContent, "utf8");
  }
  return crypto.createPrivateKey(content);
}

export function signChallengePoP(challengeText: string, privateKeyInput: string): string {
  const privKey = readPrivateKey(privateKeyInput);
  const sig = crypto.sign(null, Buffer.from(challengeText, "utf8"), privKey);
  return sig.toString("base64");
}

export interface PostProofDocument {
  "@context": string[];
  type: string;
  id: string;
  proof: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
}

export function createPostProof(
  postId: string,
  content: string,
  createdAt: string,
  privateKeyInput: string,
  publicKeyOpenSsh: string,
): { payload: Record<string, unknown>; proofDoc: PostProofDocument } {
  const parsedKey = parseSshPublicKey(publicKeyOpenSsh);
  const privKey = readPrivateKey(privateKeyInput);

  const payload = {
    id: postId,
    content,
    created_at: createdAt,
  };

  const canonicalPayload = canonicalizeJson(payload);
  const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();

  const proofConfig = {
    type: "DataIntegrityProof" as const,
    cryptosuite: "eddsa-jcs-2022" as const,
    created: new Date().toISOString(),
    verificationMethod: `did:key:${parsedKey.multibase}#${parsedKey.multibase}`,
    proofPurpose: "assertionMethod" as const,
  };

  const canonicalProofConfig = canonicalizeJson(proofConfig);
  const configHash = crypto.createHash("sha256").update(canonicalProofConfig, "utf8").digest();

  const signingData = Buffer.concat([configHash, payloadHash]);
  const signature = crypto.sign(null, signingData, privKey);
  const proofValue = encodeMultibase(signature);

  const proofDoc: PostProofDocument = {
    "@context": ["https://www.w3.org/ns/credentials/v2", "https://w3id.org/security/suites/jcs-eddsa-2022/v1"],
    type: "PostEvidence",
    id: `urn:post:${postId}`,
    proof: {
      ...proofConfig,
      proofValue,
    },
  };

  return { payload, proofDoc };
}

export function verifyPostProof(
  postContent: string,
  postId: string,
  createdAt: string,
  proofDoc: PostProofDocument,
  rawPublicKeyBytes: Buffer,
): boolean {
  if (proofDoc.proof.cryptosuite !== "eddsa-jcs-2022") return false;

  const payload = {
    id: postId,
    content: postContent,
    created_at: createdAt,
  };
  const canonicalPayload = canonicalizeJson(payload);
  const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();

  const proofConfig = {
    type: proofDoc.proof.type,
    cryptosuite: proofDoc.proof.cryptosuite,
    created: proofDoc.proof.created,
    verificationMethod: proofDoc.proof.verificationMethod,
    proofPurpose: proofDoc.proof.proofPurpose,
  };
  const canonicalProofConfig = canonicalizeJson(proofConfig);
  const configHash = crypto.createHash("sha256").update(canonicalProofConfig, "utf8").digest();

  const signingData = Buffer.concat([configHash, payloadHash]);

  const rawProofValue = proofDoc.proof.proofValue;
  if (!rawProofValue.startsWith("z")) return false;
  // Decode Base58
  const b58Str = rawProofValue.slice(1);
  const sigBytes = decodeBase58(b58Str);

  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKeyBytes]);
  const pubKeyObj = crypto.createPublicKey({
    key: spkiDer,
    format: "der",
    type: "spki",
  });

  return crypto.verify(null, signingData, pubKeyObj, Buffer.from(sigBytes));
}

function decodeBase58(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") {
    zeros++;
  }
  const bytes = [0];
  for (let i = zeros; i < str.length; i++) {
    const val = BASE58_ALPHABET.indexOf(str[i]!);
    if (val === -1) throw new Error(`Invalid Base58 character: ${str[i]}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

export function signPackageContentHash(
  contentHash: string,
  privateKeyInput: string,
): { signature: string; publicKeySpki?: string | undefined } {
  const privKey = readPrivateKey(privateKeyInput);
  const formattedHash = contentHash.startsWith("sha256:") ? contentHash : `sha256:${contentHash}`;
  const sig = crypto.sign(null, Buffer.from(formattedHash, "utf8"), privKey);
  let publicKeySpki: string | undefined;
  try {
    const pubKey = crypto.createPublicKey(privKey);
    publicKeySpki = pubKey.export({ format: "pem", type: "spki" }) as string;
  } catch {}
  return {
    signature: sig.toString("base64"),
    publicKeySpki,
  };
}

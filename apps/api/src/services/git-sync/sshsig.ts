// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { encodeMultibase } from "./base58.js";

const SSHSIG_MAGIC = Buffer.from("SSHSIG");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface ParsedSshPublicKey {
  algo: string; // e.g. "ssh-ed25519"
  rawPubkey: Buffer; // 32 bytes for Ed25519
  wireBytes: Buffer; // full SSH wire-encoded public key
  fingerprintSha256: string; // "SHA256:..."
  multibase: string; // "z..."
  openssh: string; // "ssh-ed25519 AAAA..."
}

export interface ParsedSshsig {
  version: number;
  publicKey: Buffer; // wire bytes
  rawPubkey: Buffer; // 32 bytes for Ed25519
  namespace: string; // "git"
  hashAlgo: string; // "sha512" or "sha256"
  signature: Buffer; // 64 bytes
  signedMessageBuffer: (commitPayload: string | Buffer) => Buffer;
}

/**
 * Reads an OpenSSH wire-format string (4-byte length prefix + bytes).
 */
export function readSshWireString(buf: Buffer, offset: number): { value: Buffer; nextOffset: number } {
  if (offset + 4 > buf.length) {
    throw new Error("Unexpected end of SSH wire buffer");
  }
  const len = buf.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + len;
  if (end > buf.length) {
    throw new Error("SSH wire string length exceeds buffer");
  }
  return { value: buf.subarray(start, end), nextOffset: end };
}

/**
 * Writes an OpenSSH wire-format string (4-byte length prefix + bytes).
 */
export function writeSshWireString(data: Buffer | string): Buffer {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const out = Buffer.alloc(4 + buf.length);
  out.writeUInt32BE(buf.length, 0);
  buf.copy(out, 4);
  return out;
}

/**
 * Computes the OpenSSH standard SHA-256 fingerprint for a public key wire buffer.
 */
export function computeSshFingerprint(wireBytes: Buffer): string {
  const hash = crypto.createHash("sha256").update(wireBytes).digest("base64").replace(/=+$/, "");
  return `SHA256:${hash}`;
}

/**
 * Parses an OpenSSH public key line ("ssh-ed25519 AAAAC3... [comment]").
 */
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

  // W3C multibase: 0xed01 (ed25519-pub varint) + 32 bytes public key
  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(rawPubkey, 2);
  const multibase = encodeMultibase(multicodec);

  return {
    algo,
    rawPubkey,
    wireBytes,
    fingerprintSha256,
    multibase,
    openssh: `${algo} ${wireBytes.toString("base64")}`,
  };
}

/**
 * Creates an OpenSSH public key string from a 32-byte Ed25519 raw public key.
 */
export function createSshPublicKeyFromRaw(rawPubkey: Uint8Array | Buffer): ParsedSshPublicKey {
  const raw = Buffer.from(rawPubkey);
  if (raw.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${raw.length} bytes`);
  }
  const wireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(raw)]);
  return parseSshPublicKey(`ssh-ed25519 ${wireBytes.toString("base64")}`);
}

/**
 * Parses an OpenSSH SSHSIG armor block into binary components.
 */
export function parseSshsig(armorText: string): ParsedSshsig {
  const clean = armorText
    .replace(/-----BEGIN SSH SIGNATURE-----/g, "")
    .replace(/-----END SSH SIGNATURE-----/g, "")
    .replace(/\s+/g, "");

  const buf = Buffer.from(clean, "base64");
  if (buf.length < 6 || !buf.subarray(0, 6).equals(SSHSIG_MAGIC)) {
    throw new Error("Invalid SSH signature: missing SSHSIG magic prefix");
  }

  let offset = 6;
  if (offset + 4 > buf.length) throw new Error("Truncated SSH signature header");
  const version = buf.readUInt32BE(offset);
  offset += 4;
  if (version !== 1) {
    throw new Error(`Unsupported SSHSIG version: ${version}`);
  }

  const pkWire = readSshWireString(buf, offset);
  offset = pkWire.nextOffset;
  const publicKeyWire = pkWire.value;

  // Extract raw 32-byte Ed25519 key from publicKeyWire
  let pkOffset = 0;
  const pkTypeWire = readSshWireString(publicKeyWire, pkOffset);
  pkOffset = pkTypeWire.nextOffset;
  const rawPubkeyWire = readSshWireString(publicKeyWire, pkOffset);
  const rawPubkey = rawPubkeyWire.value;

  const nsWire = readSshWireString(buf, offset);
  offset = nsWire.nextOffset;
  const namespace = nsWire.value.toString("utf8");

  const reservedWire = readSshWireString(buf, offset);
  offset = reservedWire.nextOffset;
  const reserved = reservedWire.value;

  const hashAlgoWire = readSshWireString(buf, offset);
  offset = hashAlgoWire.nextOffset;
  const hashAlgo = hashAlgoWire.value.toString("utf8");

  const sigBlobWire = readSshWireString(buf, offset);
  offset = sigBlobWire.nextOffset;
  const sigBlob = sigBlobWire.value;

  // Inside sigBlob: wire(algo) + wire(sig)
  let sigOffset = 0;
  const sigTypeWire = readSshWireString(sigBlob, sigOffset);
  sigOffset = sigTypeWire.nextOffset;
  const rawSigWire = readSshWireString(sigBlob, sigOffset);
  const signature = rawSigWire.value;

  const signedMessageBuffer = (commitPayload: string | Buffer): Buffer => {
    const payloadBuf = typeof commitPayload === "string" ? Buffer.from(commitPayload, "utf8") : commitPayload;
    const msgHash = crypto.createHash(hashAlgo).update(payloadBuf).digest();
    return Buffer.concat([
      SSHSIG_MAGIC,
      writeSshWireString(namespace),
      writeSshWireString(reserved),
      writeSshWireString(hashAlgo),
      writeSshWireString(msgHash),
    ]);
  };

  return {
    version,
    publicKey: publicKeyWire,
    rawPubkey,
    namespace,
    hashAlgo,
    signature,
    signedMessageBuffer,
  };
}

/**
 * Extracts the payload and signature text from a raw Git commit object buffer.
 */
export function extractCommitSignedPayload(commitRaw: string): { payload: string; signatureText?: string } {
  const lines = commitRaw.split("\n");
  const payloadLines: string[] = [];
  const sigLines: string[] = [];
  let inSig = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inSig) {
      if (line.startsWith("gpgsig -----BEGIN SSH SIGNATURE-----") || line === "gpgsig") {
        inSig = true;
        if (line.startsWith("gpgsig ")) {
          sigLines.push(line.slice(7));
        }
      } else {
        payloadLines.push(line);
      }
    } else {
      if (line.startsWith(" ")) {
        sigLines.push(line.slice(1));
        if (line.includes("-----END SSH SIGNATURE-----")) {
          inSig = false;
        }
      } else if (line.includes("-----END SSH SIGNATURE-----")) {
        sigLines.push(line);
        inSig = false;
      } else {
        inSig = false;
        payloadLines.push(line);
      }
    }
  }

  const payload = payloadLines.join("\n");
  if (sigLines.length > 0) {
    return { payload, signatureText: sigLines.join("\n") };
  }
  return { payload };
}

export interface VerifyCommitSignatureResult {
  valid: boolean;
  fingerprint?: string;
  error?: string;
}

/**
 * Verifies an Ed25519 commit signature against an allowlist of valid SSH public keys.
 */
export function verifyCommitSignature(
  commitRaw: string,
  allowedPublicKeys: Array<{ fingerprint_sha256: string; public_key_openssh: string }>,
): VerifyCommitSignatureResult {
  const { payload, signatureText } = extractCommitSignedPayload(commitRaw);
  if (!signatureText) {
    return { valid: false, error: "Commit does not contain a signature" };
  }

  try {
    const parsedSig = parseSshsig(signatureText);
    const sigFp = computeSshFingerprint(parsedSig.publicKey);

    const matchedKey = allowedPublicKeys.find((k) => k.fingerprint_sha256 === sigFp);
    if (!matchedKey) {
      return {
        valid: false,
        fingerprint: sigFp,
        error: `Signature fingerprint '${sigFp}' is not associated with this user's registered keys`,
      };
    }

    const messageToVerify = parsedSig.signedMessageBuffer(payload);

    // Build SPKI DER buffer for crypto.verify
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, parsedSig.rawPubkey]);
    const pubKeyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    const isVerified = crypto.verify(null, messageToVerify, pubKeyObj, parsedSig.signature);
    if (!isVerified) {
      return { valid: false, fingerprint: sigFp, error: "Cryptographic signature verification failed" };
    }

    return { valid: true, fingerprint: sigFp };
  } catch (err) {
    return { valid: false, error: `Malformed signature block: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Creates an OpenSSH SSHSIG armor block given an Ed25519 private key (useful for CLI/testing).
 */
export function signSshsig(
  commitPayload: string | Buffer,
  privateKeyPemOrDer: string | Buffer | crypto.KeyObject,
  namespace: string = "git",
  hashAlgo: string = "sha512",
): string {
  let privKeyObj: crypto.KeyObject;
  if (typeof privateKeyPemOrDer === "object" && "type" in privateKeyPemOrDer) {
    privKeyObj = privateKeyPemOrDer as crypto.KeyObject;
  } else {
    privKeyObj = crypto.createPrivateKey(privateKeyPemOrDer);
  }

  const pubKeyObj = crypto.createPublicKey(privKeyObj);
  const pubDer = pubKeyObj.export({ format: "der", type: "spki" }) as Buffer;
  const rawPubkey = pubDer.subarray(pubDer.length - 32);

  const pkWire = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawPubkey)]);

  const payloadBuf = typeof commitPayload === "string" ? Buffer.from(commitPayload, "utf8") : commitPayload;
  const msgHash = crypto.createHash(hashAlgo).update(payloadBuf).digest();

  const toSign = Buffer.concat([
    SSHSIG_MAGIC,
    writeSshWireString(namespace),
    writeSshWireString(Buffer.alloc(0)),
    writeSshWireString(hashAlgo),
    writeSshWireString(msgHash),
  ]);

  const rawSig = crypto.sign(null, toSign, privKeyObj);
  const sigBlob = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawSig)]);

  const binarySshsig = Buffer.concat([
    SSHSIG_MAGIC,
    Buffer.from([0, 0, 0, 1]), // version 1
    writeSshWireString(pkWire),
    writeSshWireString(namespace),
    writeSshWireString(Buffer.alloc(0)),
    writeSshWireString(hashAlgo),
    writeSshWireString(sigBlob),
  ]);

  const b64 = binarySshsig.toString("base64");
  const chunks = b64.match(/.{1,70}/g) || [b64];
  return `-----BEGIN SSH SIGNATURE-----\n${chunks.join("\n")}\n-----END SSH SIGNATURE-----`;
}

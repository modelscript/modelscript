// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encodes a buffer as a base58btc string prefixed with 'z' (W3C Multibase).
 */
export function encodeBase58Btc(buffer: Buffer): string {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < digits.length; j++) {
      digits[j]! <<= 8;
    }
    digits[0]! += buffer[i]!;
    let carry = 0;
    for (let j = 0; j < digits.length; j++) {
      digits[j]! += carry;
      carry = (digits[j]! / 58) | 0;
      digits[j]! %= 58;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    str += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += ALPHABET[digits[i]!];
  }
  return "z" + str;
}

/**
 * Decodes a base58btc string prefixed with 'z' into a Buffer.
 */
export function decodeBase58Btc(str: string): Buffer {
  if (!str.startsWith("z")) {
    throw new Error("Invalid multibase string: must start with 'z' for base58btc");
  }
  const s = str.slice(1);
  const bytes = [0];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const value = ALPHABET.indexOf(c);
    if (value === -1) throw new Error(`Invalid base58 character: ${c}`);
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] = bytes[j]! * 58;
    }
    bytes[0]! += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j]! += carry;
      carry = bytes[j]! >> 8;
      bytes[j]! &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < s.length && s[i] === "1"; i++) {
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

/**
 * Converts an Ed25519 SPKI PEM string into a FEP-521a publicKeyMultibase string ('z...').
 * In multicodec, ed25519-pub is 0xed, 0x01 followed by the 32-byte raw public key.
 */
export function ed25519PemToMultibase(pem: string): string {
  const pubKey = crypto.createPublicKey(pem);
  const spkiDer = pubKey.export({ type: "spki", format: "der" });
  const rawBytes = spkiDer.subarray(spkiDer.length - 32);
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), rawBytes]);
  return encodeBase58Btc(multicodec);
}

/**
 * Converts a FEP-521a publicKeyMultibase string ('z...') back into an Ed25519 SPKI PEM.
 */
export function multibaseToEd25519Pem(multibase: string): string {
  const decoded = decodeBase58Btc(multibase);
  let rawBytes: Buffer;
  if (decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01) {
    rawBytes = decoded.subarray(2);
  } else if (decoded.length === 32) {
    rawBytes = decoded;
  } else {
    throw new Error(`Unsupported multibase Ed25519 key length or multicodec: ${decoded.length}`);
  }

  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const spkiDer = Buffer.concat([spkiPrefix, rawBytes]);
  const pubKey = crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
  return pubKey.export({ type: "spki", format: "pem" }) as string;
}

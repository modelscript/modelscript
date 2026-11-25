// SPDX-License-Identifier: AGPL-3.0-or-later

import { decodeBase58Btc, encodeBase58Btc } from "../../util/multikey.js";

/**
 * Encodes a byte buffer into Base58btc string.
 */
export function encodeBase58(source: Uint8Array): string {
  if (source.length === 0) return "";
  return encodeBase58Btc(Buffer.from(source.buffer, source.byteOffset, source.byteLength)).slice(1);
}

/**
 * Decodes a Base58btc string into a byte buffer.
 */
export function decodeBase58(source: string): Uint8Array {
  if (source.length === 0) return new Uint8Array(0);
  return new Uint8Array(decodeBase58Btc(source.startsWith("z") ? source : "z" + source));
}

/**
 * Encodes a buffer to Multibase Base58btc format (prefixed with 'z').
 */
export function encodeMultibase(source: Uint8Array): string {
  if (source.length === 0) return "z";
  return encodeBase58Btc(Buffer.from(source.buffer, source.byteOffset, source.byteLength));
}

/**
 * Decodes a Multibase Base58btc string (must start with 'z').
 */
export function decodeMultibase(source: string): Uint8Array {
  if (!source.startsWith("z")) {
    throw new Error("Multibase string must start with 'z' (base58btc)");
  }
  return new Uint8Array(decodeBase58Btc(source));
}

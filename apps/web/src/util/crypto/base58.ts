// SPDX-License-Identifier: AGPL-3.0-or-later

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = BigInt(58);

const INDEXES = new Uint8Array(128);
INDEXES.fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
  INDEXES[ALPHABET.charCodeAt(i)] = i;
}

/**
 * Encodes a byte buffer into Base58btc string.
 */
export function encodeBase58(source: Uint8Array): string {
  if (source.length === 0) return "";

  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === 0) {
    zeroes++;
  }

  // Convert bytes to BigInt
  let num = BigInt(0);
  for (let i = zeroes; i < source.length; i++) {
    num = (num << BigInt(8)) + BigInt(source[i]!);
  }

  let str = "";
  while (num > BigInt(0)) {
    const rem = Number(num % BASE);
    num = num / BASE;
    str = ALPHABET[rem] + str;
  }

  return "1".repeat(zeroes) + str;
}

/**
 * Decodes a Base58btc string into a byte buffer.
 */
export function decodeBase58(source: string): Uint8Array {
  if (source.length === 0) return new Uint8Array(0);

  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === "1") {
    zeroes++;
  }

  let num = BigInt(0);
  for (let i = zeroes; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 128 || INDEXES[code] === 255) {
      throw new Error(`Invalid Base58 character: ${source[i]}`);
    }
    num = num * BASE + BigInt(INDEXES[code]!);
  }

  // Convert BigInt to bytes
  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.push(Number(num & BigInt(0xff)));
    num = num >> BigInt(8);
  }
  bytes.reverse();

  const result = new Uint8Array(zeroes + bytes.length);
  result.set(bytes, zeroes);
  return result;
}

/**
 * Multibase Base58btc encoder (prefix 'z').
 */
export function encodeMultibase(source: Uint8Array): string {
  return `z${encodeBase58(source)}`;
}

/**
 * Multibase Base58btc decoder (checks and strips prefix 'z').
 */
export function decodeMultibase(source: string): Uint8Array {
  if (!source.startsWith("z")) {
    throw new Error(`Unsupported multibase prefix: '${source[0]}' (expected 'z' for base58btc)`);
  }
  return decodeBase58(source.slice(1));
}

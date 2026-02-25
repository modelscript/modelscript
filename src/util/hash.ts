// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A simple synchronous hash builder that works in both Node.js and browser environments.
 * Uses a fast non-cryptographic hash (FNV-1a based) for content identity/caching purposes.
 * This is NOT suitable for cryptographic use.
 */
export class SimpleHash {
  #parts: string[] = [];

  update(data: string): SimpleHash {
    this.#parts.push(data);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  digest(encoding?: string): string {
    const str = this.#parts.join("\0");
    // FNV-1a 64-bit hash (as two 32-bit halves for precision)
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c & 0xff;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (c >>> 8) | ((i & 0xff) << 8);
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }
}

/**
 * Drop-in replacement for Node.js `createHash("sha256")`.
 * Returns a `SimpleHash` instance with `.update()` and `.digest()` methods.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createHash(algorithm?: string): SimpleHash {
  return new SimpleHash();
}

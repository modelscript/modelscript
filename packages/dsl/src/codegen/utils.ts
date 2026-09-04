/**
 * Computes a 32-bit unsigned DJB2 hash for string identifiers.
 * Used for fast hashing of node types, field names, and symbol keys.
 *
 * @param str The string to hash.
 * @returns 32-bit unsigned integer hash value.
 */
export function getDJB2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return hash >>> 0;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JSON Canonicalization Scheme (JCS) according to RFC 8785.
 * Guarantees deterministic, byte-for-byte identical serialization across platforms.
 */
export function canonicalizeJson(data: unknown): string {
  if (data === null) {
    return "null";
  }

  const type = typeof data;

  if (type === "boolean") {
    return data ? "true" : "false";
  }

  if (type === "number") {
    const num = data as number;
    if (!Number.isFinite(num)) {
      throw new TypeError("NaN or Infinity cannot be canonicalized to JSON");
    }
    // Handle -0
    if (Object.is(num, -0)) {
      return "0";
    }
    return JSON.stringify(num);
  }

  if (type === "string") {
    return JSON.stringify(data);
  }

  if (Array.isArray(data)) {
    const elements = data.map((elem) => (elem === undefined ? "null" : canonicalizeJson(elem)));
    return `[${elements.join(",")}]`;
  }

  if (type === "object") {
    const obj = data as Record<string, unknown>;
    // Sort keys strictly by UTF-16 code units
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const val = obj[key];
      // Skip undefined or function properties per JSON specification
      if (val === undefined || typeof val === "function" || typeof val === "symbol") {
        continue;
      }
      pairs.push(`${JSON.stringify(key)}:${canonicalizeJson(val)}`);
    }

    return `{${pairs.join(",")}}`;
  }

  throw new TypeError(`Unsupported type for JCS: ${type}`);
}

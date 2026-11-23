// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`JED1001`–`JED5006`) for `@modelscript/jedec`.
 *
 * Numbering scheme:
 * - `1xxx`: Syntax / framing / `*` delimiter errors
 * - `2xxx`: Mandatory header fields (`QF`, `F`, `G`)
 * - `3xxx`: 16-bit JESD3 fuse (`C`) & ETX transmission checksum verification
 * - `4xxx`: Fuse-map address bounds, overlaps, and bit encoding (`L`)
 * - `5xxx`: Test vectors (`V`, `QV`, `QP`) and security / integrity advisories
 */

export const JedecErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "JED1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `JEDEC JESD3 syntax error: ${detail}.`,
  },
  MISSING_FIELD_DELIMITER: {
    code: 1002,
    id: "JED1002",
    rule: "missing-field-delimiter",
    severity: "error" as const,
    message: (fieldPreview: string) => `Missing mandatory '*' field delimiter at end of JESD3 field '${fieldPreview}'.`,
  },
  MISSING_FUSE_COUNT: {
    code: 2001,
    id: "JED2001",
    rule: "missing-fuse-count",
    severity: "error" as const,
    message: () => "Missing mandatory 'QF<n>*' fuse count declaration.",
  },
  INVALID_DEFAULT_FUSE_STATE: {
    code: 2002,
    id: "JED2002",
    rule: "invalid-default-fuse-state",
    severity: "error" as const,
    message: (value: string) => `Invalid default fuse state 'F${value}*': expected '0' or '1'.`,
  },
  INVALID_SECURITY_FUSE: {
    code: 2003,
    id: "JED2003",
    rule: "invalid-security-fuse",
    severity: "error" as const,
    message: (value: string) => `Invalid security fuse 'G${value}*': expected '0' or '1'.`,
  },
  FUSE_CHECKSUM_MISMATCH: {
    code: 3001,
    id: "JED3001",
    rule: "fuse-checksum-mismatch",
    severity: "error" as const,
    message: (declared: string, computed: string) =>
      `16-bit fuse checksum 'C${declared}*' does not match computed fuse checksum '${computed}'.`,
  },
  TRANSMISSION_CHECKSUM_MISMATCH: {
    code: 3002,
    id: "JED3002",
    rule: "transmission-checksum-mismatch",
    severity: "error" as const,
    message: (declared: string, computed: string) =>
      `16-bit ETX transmission checksum '${declared}' does not match computed checksum '${computed}'.`,
  },
  FUSE_ADDRESS_OUT_OF_BOUNDS: {
    code: 4001,
    id: "JED4001",
    rule: "fuse-address-out-of-bounds",
    severity: "error" as const,
    message: (startAddr: number, endAddr: number, fuseCount: number) =>
      `Fuse block 'L${startAddr}' (range [${startAddr}, ${endAddr})) exceeds device fuse bounds [0, ${fuseCount}).`,
  },
  OVERLAPPING_FUSE_WRITE: {
    code: 4002,
    id: "JED4002",
    rule: "overlapping-fuse-write",
    severity: "warning" as const,
    message: (address: number, count: number) =>
      `Overlapping fuse write at address ${address} (${count} fuse(s) previously written by an earlier 'L' field).`,
  },
  INVALID_FUSE_BIT: {
    code: 4003,
    id: "JED4003",
    rule: "invalid-fuse-bit",
    severity: "error" as const,
    message: (ch: string, address: number) =>
      `Invalid fuse bit '${ch}' in fuse block 'L${address}': expected '0' or '1'.`,
  },
  VECTOR_LENGTH_MISMATCH: {
    code: 5001,
    id: "JED5001",
    rule: "vector-length-mismatch",
    severity: "error" as const,
    message: (vectorNum: number, actualLen: number, pinCount: number) =>
      `Test vector 'V${vectorNum}' has ${actualLen} pin state(s), which does not match declared pin count 'QP${pinCount}*'.`,
  },
  VECTOR_COUNT_EXCEEDS_QV: {
    code: 5002,
    id: "JED5002",
    rule: "vector-count-exceeds-qv",
    severity: "error" as const,
    message: (actualCount: number, maxVectors: number) =>
      `Document contains ${actualCount} test vector(s), exceeding declared maximum 'QV${maxVectors}*'.`,
  },
  INVALID_VECTOR_CHAR: {
    code: 5003,
    id: "JED5003",
    rule: "invalid-vector-char",
    severity: "error" as const,
    message: (ch: string, vectorNum: number) =>
      `Invalid pin state character '${ch}' in test vector 'V${vectorNum}': expected one of 0, 1, C, K, H, L, X, Z, N, F, P, B.`,
  },
  MISSING_PIN_COUNT_FOR_VECTORS: {
    code: 5004,
    id: "JED5004",
    rule: "missing-pin-count-for-vectors",
    severity: "warning" as const,
    message: (vectorCount: number) =>
      `Document defines ${vectorCount} test vector(s) without a 'QP<n>*' pin count declaration.`,
  },
  MISSING_FUSE_CHECKSUM: {
    code: 5005,
    id: "JED5005",
    rule: "missing-fuse-checksum",
    severity: "warning" as const,
    message: () => "Missing 16-bit fuse checksum field 'C<hhhh>*'.",
  },
  SECURITY_FUSE_BLOWN: {
    code: 5006,
    id: "JED5006",
    rule: "security-fuse-blown",
    severity: "info" as const,
    message: () => "Security fuse 'G1*' is blown; programmed device fuse array is read-protected.",
  },
} as const;

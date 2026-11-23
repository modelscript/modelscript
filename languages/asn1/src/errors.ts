// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for ISO/ITU-T X.208 / X.680 ASN.1 and X.690 BER/DER (`ASN11001`–`ASN15006`).
 */

export type Asn1Severity = "error" | "warning" | "info";

export interface Asn1ErrorDefinition<TArgs extends unknown[] = string[]> {
  readonly code: string;
  readonly rule: string;
  readonly severity: Asn1Severity;
  readonly message: (...args: TArgs) => string;
}

export const Asn1ErrorCode = {
  SYNTAX_ERROR: {
    code: "ASN11001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `ASN.1 syntax error: ${detail}.`,
  },
  UNTERMINATED_MODULE: {
    code: "ASN11002",
    rule: "unterminated-module",
    severity: "error" as const,
    message: (moduleName: string) => `ASN.1 module '${moduleName}' is missing a matching BEGIN/END delimiter.`,
  },
  DUPLICATE_TYPE_DEFINITION: {
    code: "ASN12001",
    rule: "duplicate-type-definition",
    severity: "error" as const,
    message: (typeName: string) => `Duplicate ASN.1 type definition '${typeName}' in module scope.`,
  },
  DUPLICATE_FIELD_NAME: {
    code: "ASN12002",
    rule: "duplicate-field-name",
    severity: "error" as const,
    message: (fieldName: string, container: string) =>
      `Duplicate field name '${fieldName}' in ASN.1 type '${container}'.`,
  },
  DUPLICATE_ENUM_VALUE: {
    code: "ASN12003",
    rule: "duplicate-enum-value",
    severity: "error" as const,
    message: (detail: string, container: string) =>
      `Duplicate ENUMERATED/named-number entry (${detail}) in '${container}'.`,
  },
  UNDEFINED_TYPE_REFERENCE: {
    code: "ASN12004",
    rule: "undefined-type-reference",
    severity: "error" as const,
    message: (typeName: string, referrer: string) => `Undefined ASN.1 type reference '${typeName}' in '${referrer}'.`,
  },
  CYCLIC_TYPE_DEPENDENCY: {
    code: "ASN13001",
    rule: "cyclic-type-dependency",
    severity: "error" as const,
    message: (cyclePath: string) => `Cyclic non-optional ASN.1 type dependency detected: ${cyclePath}.`,
  },
  DUPLICATE_CONTEXT_TAG: {
    code: "ASN13002",
    rule: "duplicate-context-tag",
    severity: "error" as const,
    message: (tagNum: string, container: string) =>
      `Duplicate tag '[${tagNum}]' in ASN.1 '${container}' causes BER/DER decoding ambiguity.`,
  },
  AMBIGUOUS_OPTIONAL_FIELDS: {
    code: "ASN13003",
    rule: "ambiguous-optional-fields",
    severity: "warning" as const,
    message: (firstField: string, secondField: string, container: string) =>
      `Ambiguous consecutive untagged OPTIONAL fields '${firstField}' and '${secondField}' in '${container}' share the same outer tag.`,
  },
  INVALID_SIZE_CONSTRAINT: {
    code: "ASN14001",
    rule: "invalid-size-constraint",
    severity: "error" as const,
    message: (detail: string, context: string) => `Invalid SIZE constraint (${detail}) on '${context}'.`,
  },
  INVALID_INTEGER_RANGE: {
    code: "ASN14002",
    rule: "invalid-integer-range",
    severity: "error" as const,
    message: (min: string, max: string, context: string) =>
      `Invalid integer range (${min}..${max}) on '${context}': lower bound exceeds upper bound.`,
  },
  NON_CANONICAL_DER_LENGTH: {
    code: "ASN15001",
    rule: "non-canonical-der-length",
    severity: "error" as const,
    message: (detail: string) => `Non-canonical X.690 DER length encoding: ${detail}.`,
  },
  NON_CANONICAL_DER_BOOLEAN: {
    code: "ASN15002",
    rule: "non-canonical-der-boolean",
    severity: "error" as const,
    message: (hexByte: string) =>
      `Non-canonical X.690 DER BOOLEAN value '0x${hexByte}' (DER requires 0x00 for FALSE or 0xFF for TRUE).`,
  },
  NON_CANONICAL_DER_INTEGER: {
    code: "ASN15003",
    rule: "non-canonical-der-integer",
    severity: "error" as const,
    message: (detail: string) => `Non-canonical X.690 DER INTEGER encoding: ${detail}.`,
  },
  INVALID_OID_ARCS: {
    code: "ASN15004",
    rule: "invalid-oid-arcs",
    severity: "error" as const,
    message: (detail: string) => `Invalid OBJECT IDENTIFIER arc sequence: ${detail}.`,
  },
  TRUNCATED_TLV: {
    code: "ASN15005",
    rule: "truncated-tlv",
    severity: "error" as const,
    message: (detail: string) => `Truncated BER/DER TLV payload: ${detail}.`,
  },
  TRAILING_TLV_BYTES: {
    code: "ASN15006",
    rule: "trailing-tlv-bytes",
    severity: "warning" as const,
    message: (count: string) => `BER/DER buffer contains ${count} trailing unparsed byte(s) after top-level TLV.`,
  },
} as const;

export type Asn1ErrorKey = keyof typeof Asn1ErrorCode;

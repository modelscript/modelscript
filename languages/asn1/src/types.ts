// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for ISO/ITU-T X.208 / X.680 ASN.1 schemas and X.690 BER/DER TLV codecs.
 */

export interface Asn1Span {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type Asn1TagClass = "UNIVERSAL" | "APPLICATION" | "CONTEXT" | "PRIVATE";
export type Asn1TagMode = "AUTOMATIC" | "EXPLICIT" | "IMPLICIT";

export interface Asn1Tag {
  tagClass: Asn1TagClass;
  number: number;
  mode?: "EXPLICIT" | "IMPLICIT" | undefined;
  span: Asn1Span;
}

export interface Asn1Constraint {
  kind: "size" | "range" | "singleValue";
  min?: number | undefined;
  max?: number | undefined;
  exact?: number | undefined;
  minUnbounded?: boolean | undefined;
  maxUnbounded?: boolean | undefined;
  span: Asn1Span;
}

export interface Asn1NamedNumber {
  name: string;
  value: number;
  span: Asn1Span;
}

export type Asn1PrimitiveKind =
  | "BOOLEAN"
  | "INTEGER"
  | "REAL"
  | "NULL"
  | "OCTET STRING"
  | "BIT STRING"
  | "OBJECT IDENTIFIER"
  | "UTF8String"
  | "IA5String"
  | "PrintableString"
  | "VisibleString"
  | "NumericString"
  | "UTCTime"
  | "GeneralizedTime";

export interface Asn1Field {
  name: string;
  type: Asn1TypeExpr;
  tag?: Asn1Tag | undefined;
  optional: boolean;
  defaultValue?: string | undefined;
  span: Asn1Span;
}

export type Asn1TypeExpr =
  | {
      kind: "primitive";
      primitive: Asn1PrimitiveKind;
      constraint?: Asn1Constraint | undefined;
      namedNumbers?: Asn1NamedNumber[] | undefined;
      span: Asn1Span;
    }
  | {
      kind: "reference";
      name: string;
      constraint?: Asn1Constraint | undefined;
      span: Asn1Span;
    }
  | {
      kind: "sequence";
      fields: Asn1Field[];
      extensible?: boolean | undefined;
      span: Asn1Span;
    }
  | {
      kind: "set";
      fields: Asn1Field[];
      extensible?: boolean | undefined;
      span: Asn1Span;
    }
  | {
      kind: "choice";
      alternatives: Asn1Field[];
      extensible?: boolean | undefined;
      span: Asn1Span;
    }
  | {
      kind: "sequenceOf";
      elementType: Asn1TypeExpr;
      constraint?: Asn1Constraint | undefined;
      span: Asn1Span;
    }
  | {
      kind: "setOf";
      elementType: Asn1TypeExpr;
      constraint?: Asn1Constraint | undefined;
      span: Asn1Span;
    }
  | {
      kind: "enumerated";
      items: Asn1NamedNumber[];
      extensible?: boolean | undefined;
      span: Asn1Span;
    }
  | {
      kind: "tagged";
      tag: Asn1Tag;
      inner: Asn1TypeExpr;
      span: Asn1Span;
    };

export interface Asn1TypeAssignment {
  name: string;
  type: Asn1TypeExpr;
  span: Asn1Span;
}

export interface Asn1ValueAssignment {
  name: string;
  type: Asn1TypeExpr;
  rawValue: string;
  oidArcs?: number[] | undefined;
  span: Asn1Span;
}

export interface Asn1Import {
  symbols: string[];
  fromModule: string;
  span: Asn1Span;
}

export interface Asn1ParseError {
  message: string;
  span: Asn1Span;
}

export interface Asn1Module {
  name: string;
  oidArcs?: number[] | undefined;
  tagDefault: Asn1TagMode;
  exportsAll: boolean;
  exports: string[];
  imports: Asn1Import[];
  types: Asn1TypeAssignment[];
  values: Asn1ValueAssignment[];
  comments: string[];
  parseErrors: Asn1ParseError[];
  hasBegin: boolean;
  hasEnd: boolean;
  span: Asn1Span;
}

// ============================================================================
// X.690 BER / DER TLV Types
// ============================================================================

export const UNIVERSAL_TAGS = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_IDENTIFIER: 0x06,
  REAL: 0x09,
  ENUMERATED: 0x0a,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x10,
  SET: 0x11,
  NUMERIC_STRING: 0x12,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  VISIBLE_STRING: 0x1a,
} as const;

export type BerLengthForm = "short" | "long" | "indefinite";

export interface DerCanonicalIssue {
  code: "ASN15001" | "ASN15002" | "ASN15003" | "ASN15004" | "ASN15005" | "ASN15006";
  offset: number;
  message: string;
}

export interface BerTlvNode {
  tagClass: Asn1TagClass;
  constructed: boolean;
  tagNumber: number;
  tagByte: number;
  rawTagBytes: Uint8Array;
  length: number;
  lengthForm: BerLengthForm;
  rawLengthBytes: Uint8Array;
  offset: number;
  valueOffset: number;
  valueBytes: Uint8Array;
  totalLength: number;
  children?: BerTlvNode[] | undefined;
  decodedValue?: unknown;
  derIssues: DerCanonicalIssue[];
}

export interface BerDecodeResult {
  root: BerTlvNode | null;
  derIssues: DerCanonicalIssue[];
  trailingBytes: number;
  error?: string | undefined;
}

export type DerValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "integer"; value: number | bigint }
  | { kind: "enumerated"; value: number | bigint }
  | { kind: "null" }
  | { kind: "octetString"; value: Uint8Array }
  | { kind: "bitString"; value: Uint8Array; unusedBits?: number | undefined }
  | { kind: "oid"; value: number[] | string }
  | { kind: "utf8String"; value: string }
  | { kind: "ia5String"; value: string }
  | { kind: "printableString"; value: string }
  | { kind: "real"; value: number }
  | { kind: "sequence"; items: DerValue[] }
  | { kind: "set"; items: DerValue[] }
  | {
      kind: "tagged";
      tagClass: Asn1TagClass;
      tagNumber: number;
      constructed: boolean;
      inner: DerValue | Uint8Array;
    };

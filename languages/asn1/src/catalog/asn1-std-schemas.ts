// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/asn1-std-lib/src/models.ts`.
 */
export const Asn1ArchetypeId = {
  // X.680 Universal Tags (0x01 .. 0x31)
  TAG_BOOLEAN: 0x01,
  TAG_INTEGER: 0x02,
  TAG_BIT_STRING: 0x03,
  TAG_OCTET_STRING: 0x04,
  TAG_NULL: 0x05,
  TAG_OBJECT_IDENTIFIER: 0x06,
  TAG_REAL: 0x09,
  TAG_ENUMERATED: 0x0a,
  TAG_UTF8_STRING: 0x0c,
  TAG_PRINTABLE_STRING: 0x13,
  TAG_IA5_STRING: 0x16,
  TAG_UTC_TIME: 0x17,
  TAG_GENERALIZED_TIME: 0x18,
  TAG_SEQUENCE: 0x30,
  TAG_SET: 0x31,
  // Classic 1980s Protocol Schemas
  SNMPV1_PDU: 100,
  X509_ALGORITHM_ID: 101,
  X509_VALIDITY: 102,
  IEC61850_GOOSE_PDU: 103,
} as const;

export type Asn1ArchetypeId = (typeof Asn1ArchetypeId)[keyof typeof Asn1ArchetypeId];

export type Asn1ModelCategory = "X.680 Universal Tags" | "Classic Protocol Schemas";

export interface Asn1ModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Asn1ModelCategory;
  archetypeId: Asn1ArchetypeId;
  universalTagHex?: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
  ports: DiagramPortSpec[];
}

const CATEGORY_COLORS: Record<Asn1ModelCategory, { fill: string; stroke: string; badge: string }> = {
  "X.680 Universal Tags": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "TAG" },
  "Classic Protocol Schemas": { fill: "#2e2447", stroke: "#c084fc", badge: "PDU" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an ASN.1 universal tag or protocol schema.
 */
export function generateAsn1BlockSvg(modelType: string, category: Asn1ModelCategory, tagHex?: string): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const badgeText = tagHex ?? c.badge;
  const fontSize = label.length > 9 ? "7.4" : "8.8";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="34" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="23" y="15" text-anchor="middle" font-family="monospace" font-size="7.0" fill="${c.stroke}">${badgeText}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const ASN1_STD_SPECS: Asn1ModelSpec[] = [
  {
    modelType: "BOOLEAN",
    aliases: ["TAG_01", "0x01"],
    label: "BOOLEAN (0x01)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_BOOLEAN,
    universalTagHex: "0x01",
    description: "X.680 universal BOOLEAN type (tag 0x01). DER encodes FALSE as 0x00 and TRUE as 0xFF.",
    provenance: "ISO/ITU-T X.680 §18 & X.690 §11.1 (1984/2021)",
    params: [
      ["tagNumber", 1, "1", "Universal tag number (0x01)"],
      ["minBytes", 3, "B", "Fixed DER wire size (T+L+V = 3 bytes)"],
      ["maxBytes", 3, "B", "Fixed DER wire size (3 bytes)"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "INTEGER",
    aliases: ["TAG_02", "0x02"],
    label: "INTEGER (0x02)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_INTEGER,
    universalTagHex: "0x02",
    description:
      "X.680 universal arbitrary-precision signed INTEGER (tag 0x02), minimal big-endian two's-complement in DER.",
    provenance: "ISO/ITU-T X.680 §19 & X.690 §8.3",
    params: [
      ["tagNumber", 2, "1", "Universal tag number (0x02)"],
      ["minBytes", 3, "B", "Minimum DER wire size (0 => 02 01 00)"],
      ["maxBytes", 10, "B", "Default 64-bit DER wire ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "BIT_STRING",
    aliases: ["BIT STRING", "TAG_03", "0x03"],
    label: "BIT STRING (0x03)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_BIT_STRING,
    universalTagHex: "0x03",
    description: "X.680 universal BIT STRING (tag 0x03) with leading unused-bits count octet (0..7).",
    provenance: "ISO/ITU-T X.680 §22 & X.690 §8.6",
    params: [
      ["tagNumber", 3, "1", "Universal tag number (0x03)"],
      ["minBytes", 3, "B", "Minimum DER wire size (empty bit string: 03 01 00)"],
      ["maxBytes", 67, "B", "Default bounded wire size"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "OCTET_STRING",
    aliases: ["OCTET STRING", "TAG_04", "0x04"],
    label: "OCTET STRING (0x04)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_OCTET_STRING,
    universalTagHex: "0x04",
    description: "X.680 universal raw byte sequence OCTET STRING (tag 0x04).",
    provenance: "ISO/ITU-T X.680 §23 & X.690 §8.7",
    params: [
      ["tagNumber", 4, "1", "Universal tag number (0x04)"],
      ["minBytes", 2, "B", "Minimum DER wire size (empty: 04 00)"],
      ["maxBytes", 66, "B", "Default bounded wire size"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "NULL",
    aliases: ["TAG_05", "0x05"],
    label: "NULL (0x05)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_NULL,
    universalTagHex: "0x05",
    description: "X.680 universal NULL placeholder (tag 0x05), always encoded as 2 bytes (05 00).",
    provenance: "ISO/ITU-T X.680 §24 & X.690 §8.8",
    params: [
      ["tagNumber", 5, "1", "Universal tag number (0x05)"],
      ["minBytes", 2, "B", "Fixed DER wire size (05 00)"],
      ["maxBytes", 2, "B", "Fixed DER wire size (05 00)"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "OBJECT_IDENTIFIER",
    aliases: ["OBJECT IDENTIFIER", "OID", "TAG_06", "0x06"],
    label: "OBJECT IDENTIFIER (0x06)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_OBJECT_IDENTIFIER,
    universalTagHex: "0x06",
    description: "X.680 universal OBJECT IDENTIFIER (tag 0x06), base-128 VLQ encoding with first octet 40*arc0 + arc1.",
    provenance: "ISO/ITU-T X.680 §32 & X.690 §8.19",
    params: [
      ["tagNumber", 6, "1", "Universal tag number (0x06)"],
      ["minBytes", 3, "B", "Minimum 2-arc OID wire size"],
      ["maxBytes", 64, "B", "Typical OID wire ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "REAL",
    aliases: ["TAG_09", "0x09"],
    label: "REAL (0x09)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_REAL,
    universalTagHex: "0x09",
    description: "X.680 universal floating-point REAL (tag 0x09), base-2 normalized mantissa in DER.",
    provenance: "ISO/ITU-T X.680 §21 & X.690 §8.5",
    params: [
      ["tagNumber", 9, "1", "Universal tag number (0x09)"],
      ["minBytes", 2, "B", "Zero value encoding (09 00)"],
      ["maxBytes", 12, "B", "IEEE 754 binary64 DER ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "ENUMERATED",
    aliases: ["TAG_0A", "0x0A"],
    label: "ENUMERATED (0x0A)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_ENUMERATED,
    universalTagHex: "0x0A",
    description: "X.680 universal ENUMERATED type (tag 0x0A), integer-encoded named enumeration.",
    provenance: "ISO/ITU-T X.680 §20 & X.690 §8.4",
    params: [
      ["tagNumber", 10, "1", "Universal tag number (0x0A)"],
      ["minBytes", 3, "B", "Minimum DER wire size"],
      ["maxBytes", 6, "B", "Typical 32-bit enumeration ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "UTF8String",
    aliases: ["TAG_0C", "0x0C"],
    label: "UTF8String (0x0C)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_UTF8_STRING,
    universalTagHex: "0x0C",
    description: "X.680 universal UTF-8 character string (tag 0x0C).",
    provenance: "ISO/ITU-T X.680 §41",
    params: [
      ["tagNumber", 12, "1", "Universal tag number (0x0C)"],
      ["minBytes", 2, "B", "Empty UTF8String"],
      ["maxBytes", 258, "B", "Default bounded string ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "PrintableString",
    aliases: ["TAG_13", "0x13"],
    label: "PrintableString (0x13)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_PRINTABLE_STRING,
    universalTagHex: "0x13",
    description: "X.680 restricted ASCII PrintableString (tag 0x13), widely used in X.509 Distinguished Names.",
    provenance: "ISO/ITU-T X.680 §41.4",
    params: [
      ["tagNumber", 19, "1", "Universal tag number (0x13)"],
      ["minBytes", 2, "B", "Empty PrintableString"],
      ["maxBytes", 66, "B", "Default bounded string ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "IA5String",
    aliases: ["TAG_16", "0x16"],
    label: "IA5String (0x16)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_IA5_STRING,
    universalTagHex: "0x16",
    description: "X.680 International Alphabet No. 5 (7-bit ASCII) string (tag 0x16).",
    provenance: "ISO/ITU-T X.680 §41",
    params: [
      ["tagNumber", 22, "1", "Universal tag number (0x16)"],
      ["minBytes", 2, "B", "Empty IA5String"],
      ["maxBytes", 66, "B", "Default bounded string ceiling"],
    ],
    ports: [{ name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 }],
  },
  {
    modelType: "SEQUENCE",
    aliases: ["TAG_30", "0x30"],
    label: "SEQUENCE (0x30)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_SEQUENCE,
    universalTagHex: "0x30",
    description: "X.680 constructed ordered record SEQUENCE (universal tag 0x10, constructed 0x30).",
    provenance: "ISO/ITU-T X.680 §25 & X.690 §8.9",
    params: [
      ["tagNumber", 48, "1", "Constructed universal tag byte (0x30)"],
      ["minBytes", 2, "B", "Empty SEQUENCE (30 00)"],
      ["maxBytes", 512, "B", "Composite record ceiling"],
    ],
    ports: [
      { name: "fields", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "SET",
    aliases: ["TAG_31", "0x31"],
    label: "SET (0x31)",
    category: "X.680 Universal Tags",
    archetypeId: Asn1ArchetypeId.TAG_SET,
    universalTagHex: "0x31",
    description:
      "X.680 constructed unordered collection SET (universal tag 0x11, constructed 0x31); DER sorts elements lexicographically.",
    provenance: "ISO/ITU-T X.680 §27 & X.690 §11.6",
    params: [
      ["tagNumber", 49, "1", "Constructed universal tag byte (0x31)"],
      ["minBytes", 2, "B", "Empty SET (31 00)"],
      ["maxBytes", 512, "B", "Composite set ceiling"],
    ],
    ports: [
      { name: "fields", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "tlv", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  // Classic 1980s Protocol Schemas
  {
    modelType: "SNMPv1PDU",
    aliases: ["SNMPv1", "RFC1157"],
    label: "SNMPv1 PDU (RFC 1157)",
    category: "Classic Protocol Schemas",
    archetypeId: Asn1ArchetypeId.SNMPV1_PDU,
    universalTagHex: "0x30",
    description:
      "Classic 1988/1990 RFC 1157 SNMPv1 Message & GetRequest/GetResponse PDU envelope using BER TLV encoding.",
    provenance: "IETF RFC 1157 (SNMPv1, 1990) / ISO X.208",
    params: [
      ["minBytes", 28, "B", "Minimum SNMPv1 GetRequest packet size"],
      ["maxBytes", 484, "B", "RFC 1157 minimum required UDP datagram size"],
      ["rateHz", 10, "Hz", "Default polling message rate"],
    ],
    ports: [
      { name: "request", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "wire", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "X509AlgorithmIdentifier",
    aliases: ["AlgorithmIdentifier", "X509AlgId"],
    label: "X.509 AlgorithmIdentifier",
    category: "Classic Protocol Schemas",
    archetypeId: Asn1ArchetypeId.X509_ALGORITHM_ID,
    universalTagHex: "0x30",
    description:
      "ITU-T X.509 (1988) AlgorithmIdentifier SEQUENCE { algorithm OBJECT IDENTIFIER, parameters ANY OPTIONAL }.",
    provenance: "CCITT X.509 (1988) / RFC 5280 §4.1.1.2",
    params: [
      ["minBytes", 11, "B", "Minimum OID-only AlgorithmIdentifier"],
      ["maxBytes", 32, "B", "Typical RSA/ECDSA AlgorithmIdentifier DER size"],
      ["rateHz", 1, "Hz", "Handshake verification rate"],
    ],
    ports: [
      { name: "oid", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "der", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "X509Validity",
    aliases: ["Validity"],
    label: "X.509 Validity",
    category: "Classic Protocol Schemas",
    archetypeId: Asn1ArchetypeId.X509_VALIDITY,
    universalTagHex: "0x30",
    description: "ITU-T X.509 (1988) certificate Validity SEQUENCE { notBefore Time, notAfter Time }.",
    provenance: "CCITT X.509 (1988) / RFC 5280 §4.1.2.5",
    params: [
      ["minBytes", 32, "B", "Two UTCTime fields + SEQUENCE header"],
      ["maxBytes", 36, "B", "Two GeneralizedTime fields + SEQUENCE header"],
      ["rateHz", 1, "Hz", "Certificate check rate"],
    ],
    ports: [
      { name: "window", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "der", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
  {
    modelType: "IEC61850GoosePdu",
    aliases: ["GOOSE", "IEC61850_GOOSE"],
    label: "IEC 61850 GOOSE PDU",
    category: "Classic Protocol Schemas",
    archetypeId: Asn1ArchetypeId.IEC61850_GOOSE_PDU,
    universalTagHex: "0x61",
    description:
      "IEC 61850-8-1 Substation Automation GOOSE PDU ([APPLICATION 1] 0x61) encoded in ASN.1 BER for <4 ms protection trips.",
    provenance: "IEC 61850-8-1 Annex A (ASN.1 BER GOOSE)",
    params: [
      ["minBytes", 96, "B", "Minimal GOOSE trip frame payload"],
      ["maxBytes", 1492, "B", "Ethernet MTU GOOSE frame ceiling"],
      ["rateHz", 250, "Hz", "Burst retransmission rate (4 ms)"],
    ],
    ports: [
      { name: "dataset", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "ethernet", kind: "signal", side: "right", dx: 96, dy: 26 },
    ],
  },
];

/**
 * Builds the declarative cleanroom `CleanroomModelSchema[]` catalog for `@modelscript/asn1-std-lib`.
 */
export function buildAsn1CleanroomSchemas(): CleanroomModelSchema[] {
  return ASN1_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(description !== undefined ? { description } : {}),
    }));
    return {
      namePath: `ASN1.${spec.category === "X.680 Universal Tags" ? "Universal" : "Protocols"}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "protocols",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "X.680 Universal Tags" ? "Type" : "Block",
      width: 96,
      height: 52,
      svg: generateAsn1BlockSvg(spec.modelType, spec.category, spec.universalTagHex),
      ports: spec.ports,
      parameters,
      wasmKernel: "asn1ModelStep",
      extra: {
        archetypeId: spec.archetypeId,
        universalTagHex: spec.universalTagHex,
      },
    };
  });
}

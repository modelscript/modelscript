// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintAsn1 } from "../src/lints/index.js";
import { hexToBytes } from "../src/parser/ber-der.js";

describe("ASN.1 Schema & BER/DER Linter (ASN11001–ASN15006)", () => {
  it("reports zero diagnostics on a well-formed ASN.1 module", () => {
    const src = `
CleanMod DEFINITIONS EXPLICIT TAGS ::= BEGIN
  Status ::= ENUMERATED { ok(0), fail(1) }
  Header ::= SEQUENCE {
    id INTEGER (0..65535),
    tag [0] OCTET STRING (SIZE (4..16)) OPTIONAL,
    status Status
  }
  validOid OBJECT IDENTIFIER ::= { 1 2 840 113549 1 1 1 }
END
`;
    const diags = lintAsn1(src);
    assert.equal(diags.length, 0);
  });

  it("detects duplicate types (ASN12001), duplicate fields (ASN12002), duplicate enums (ASN12003), undefined refs (ASN12004)", () => {
    const src = `
BadNames DEFINITIONS ::= BEGIN
  Dup ::= INTEGER
  Dup ::= BOOLEAN
  Rec ::= SEQUENCE {
    a INTEGER,
    a BOOLEAN,
    missing UnknownType
  }
  Color ::= ENUMERATED { red(0), green(0), red(1) }
END
`;
    const codes = new Set(lintAsn1(src).map((d) => d.code));
    assert.ok(codes.has("ASN12001"));
    assert.ok(codes.has("ASN12002"));
    assert.ok(codes.has("ASN12003"));
    assert.ok(codes.has("ASN12004"));
  });

  it("detects cyclic non-optional dependency (ASN13001), duplicate context tag (ASN13002), ambiguous optionals (ASN13003)", () => {
    const src = `
BadStruct DEFINITIONS EXPLICIT TAGS ::= BEGIN
  NodeA ::= SEQUENCE { b NodeB }
  NodeB ::= SEQUENCE { a NodeA }
  BadChoice ::= CHOICE {
    first [0] INTEGER,
    second [0] OCTET STRING
  }
  AmbigSeq ::= SEQUENCE {
    x INTEGER OPTIONAL,
    y INTEGER OPTIONAL
  }
END
`;
    const codes = new Set(lintAsn1(src).map((d) => d.code));
    assert.ok(codes.has("ASN13001"));
    assert.ok(codes.has("ASN13002"));
    assert.ok(codes.has("ASN13003"));
  });

  it("detects invalid SIZE (ASN14001), invalid integer range (ASN14002), and invalid OID arcs (ASN15004)", () => {
    const src = `
BadConstraints DEFINITIONS ::= BEGIN
  BadStr ::= OCTET STRING (SIZE (16..4))
  BadInt ::= INTEGER (100..10)
  badOid OBJECT IDENTIFIER ::= { 1 55 1 }
END
`;
    const codes = new Set(lintAsn1(src).map((d) => d.code));
    assert.ok(codes.has("ASN14001"));
    assert.ok(codes.has("ASN14002"));
    assert.ok(codes.has("ASN15004"));
  });

  it("detects non-canonical DER wire samples (ASN15001, ASN15002, ASN15003, ASN15005, ASN15006)", () => {
    const validMod = `WireMod DEFINITIONS ::= BEGIN T ::= INTEGER END`;
    const diags = lintAsn1(validMod, [
      hexToBytes("01 01 01"), // non-canonical boolean
      hexToBytes("04 81 01 AA"), // non-minimal length
      hexToBytes("02 02 00 05"), // redundant integer sign byte
      hexToBytes("04 05 AA BB"), // truncated
      hexToBytes("05 00 FF"), // trailing byte
    ]);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("ASN15001"));
    assert.ok(codes.has("ASN15002"));
    assert.ok(codes.has("ASN15003"));
    assert.ok(codes.has("ASN15005"));
    assert.ok(codes.has("ASN15006"));
  });
});

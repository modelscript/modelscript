// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAsn1 } from "../src/parser/asn1-parser.js";

describe("ASN.1 Recursive-Descent Parser (X.208 / X.680)", () => {
  it("parses a complete SNMPv1-style ASN.1 module with IMPORTS, EXPORTS, tags, OPTIONAL, DEFAULT, and comments", () => {
    const src = `
-- RFC 1157 inspired SNMPv1 subset
SNMPv1-Demo { iso(1) org(3) dod(6) internet(1) mgmt(2) }
DEFINITIONS IMPLICIT TAGS ::= BEGIN

EXPORTS Message, PDUs;
IMPORTS ObjectName FROM RFC1155-SMI;

Message ::= SEQUENCE {
  version INTEGER { version-1(0) },
  community OCTET STRING (SIZE (1..64)),
  data PDUs
}

PDUs ::= CHOICE {
  get-request [0] GetRequest-PDU,
  get-response [2] GetResponse-PDU
}

GetRequest-PDU ::= SEQUENCE {
  request-id INTEGER (-2147483648..2147483647),
  error-status ENUMERATED { noError(0), tooBig(1), noSuchName(2) },
  error-index INTEGER (0..255) DEFAULT 0,
  variable-bindings SEQUENCE (SIZE (0..16)) OF VarBind OPTIONAL
}

GetResponse-PDU ::= GetRequest-PDU

VarBind ::= SEQUENCE {
  name OBJECT IDENTIFIER,
  value UTF8String
}

rsaEncryption OBJECT IDENTIFIER ::= { 1 2 840 113549 1 1 1 }

END
`;
    const mod = parseAsn1(src);
    assert.equal(mod.parseErrors.length, 0);
    assert.equal(mod.name, "SNMPv1-Demo");
    assert.deepEqual(mod.oidArcs, [1, 3, 6, 1, 2]);
    assert.equal(mod.tagDefault, "IMPLICIT");
    assert.equal(mod.hasBegin, true);
    assert.equal(mod.hasEnd, true);
    assert.deepEqual(mod.exports, ["Message", "PDUs"]);
    assert.equal(mod.imports.length, 1);
    assert.equal(mod.imports[0]!.fromModule, "RFC1155-SMI");
    assert.equal(mod.types.length, 5);
    assert.equal(mod.values.length, 1);
    assert.deepEqual(mod.values[0]!.oidArcs, [1, 2, 840, 113549, 1, 1, 1]);
    assert.ok(mod.comments.length >= 1);

    const getReq = mod.types.find((t) => t.name === "GetRequest-PDU");
    assert.ok(getReq && getReq.type.kind === "sequence");
    assert.equal(getReq.type.fields.length, 4);
    assert.equal(getReq.type.fields[2]!.defaultValue, "0");
    assert.equal(getReq.type.fields[3]!.optional, true);
  });

  it("parses AUTOMATIC TAGS, SET, SET OF, BIT STRING, REAL, NULL, and string types", () => {
    const src = `
Telemetry DEFINITIONS AUTOMATIC TAGS ::= BEGIN

Packet ::= SET {
  flags BIT STRING { ack(0), syn(1), fin(2) } (SIZE (8)),
  temp REAL,
  empty NULL,
  label PrintableString (SIZE (1..32)),
  ascii IA5String,
  tags SET OF INTEGER (0..100)
}

END
`;
    const mod = parseAsn1(src);
    assert.equal(mod.parseErrors.length, 0);
    assert.equal(mod.tagDefault, "AUTOMATIC");
    const pkt = mod.types[0]!;
    assert.equal(pkt.type.kind, "set");
    if (pkt.type.kind === "set") {
      assert.equal(pkt.type.fields.length, 6);
      assert.equal(pkt.type.fields[0]!.type.kind, "primitive");
      assert.equal(pkt.type.fields[5]!.type.kind, "setOf");
    }
  });
});

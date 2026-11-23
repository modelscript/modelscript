// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAsn1 } from "../src/parser/asn1-parser.js";
import { bytesToHex, encodeDer } from "../src/parser/ber-der.js";
import { computeWireSizeBounds, verifyDerRoundTrip } from "../src/solver/wire-analyzer.js";
import type { DerValue } from "../src/types.js";

describe("ASN.1 X.690 DER Canonical Encoding & Wire-Size Parity Benchmarks", () => {
  it("matches exact X.690 DER reference bytes with relErr === 0 and rmse === 0", () => {
    const vectors: Array<{ name: string; value: DerValue; expectedHex: string }> = [
      {
        name: "INTEGER 0",
        value: { kind: "integer", value: 0 },
        expectedHex: "02 01 00",
      },
      {
        name: "INTEGER 128",
        value: { kind: "integer", value: 128 },
        expectedHex: "02 02 00 80",
      },
      {
        name: "INTEGER -129",
        value: { kind: "integer", value: -129 },
        expectedHex: "02 02 FF 7F",
      },
      {
        name: "BOOLEAN TRUE",
        value: { kind: "boolean", value: true },
        expectedHex: "01 01 FF",
      },
      {
        name: "BOOLEAN FALSE",
        value: { kind: "boolean", value: false },
        expectedHex: "01 01 00",
      },
      {
        name: "OCTET STRING 'DER'",
        value: { kind: "octetString", value: new Uint8Array([0x44, 0x45, 0x52]) },
        expectedHex: "04 03 44 45 52",
      },
      {
        name: "OBJECT IDENTIFIER 1.2.840.113549.1.1.1 (rsaEncryption)",
        value: { kind: "oid", value: "1.2.840.113549.1.1.1" },
        expectedHex: "06 09 2A 86 48 86 F7 0D 01 01 01",
      },
      {
        name: "Nested SEQUENCE (X.509 AlgorithmIdentifier: rsaEncryption + NULL)",
        value: {
          kind: "sequence",
          items: [{ kind: "oid", value: "1.2.840.113549.1.1.1" }, { kind: "null" }],
        },
        expectedHex: "30 0D 06 09 2A 86 48 86 F7 0D 01 01 01 05 00",
      },
    ];

    for (const v of vectors) {
      const rt = verifyDerRoundTrip(v.value);
      assert.equal(rt.hex, v.expectedHex, `${v.name}: exact DER byte parity`);
      assert.equal(rt.exactMatch, true, `${v.name}: round-trip exact match`);
      assert.equal(rt.relErr, 0, `${v.name}: relErr === 0`);
      assert.equal(rt.rmse, 0, `${v.name}: rmse === 0`);
      assert.equal(rt.canonicalDer, true, `${v.name}: canonical DER`);
    }
  });

  it("verifies analytical wire-size bounds match actual encoded DER byte lengths", () => {
    const mod = parseAsn1(`
BoundedBench DEFINITIONS EXPLICIT TAGS ::= BEGIN
  FixedFrame ::= SEQUENCE {
    flag BOOLEAN,
    code INTEGER (0..127),
    payload OCTET STRING (SIZE (4..8)),
    marker NULL OPTIONAL
  }
END
`);
    const bounds = computeWireSizeBounds(mod).get("FixedFrame")!;
    // Min: SEQ(2) + BOOL(3) + INT(3) + OCTET(2+4=6) = 14 B
    // Max: SEQ(2) + BOOL(3) + INT(3) + OCTET(2+8=10) + NULL(2) = 20 B
    assert.equal(bounds.minBytes, 14);
    assert.equal(bounds.maxBytes, 20);
    assert.equal(bounds.isUnbounded, false);

    const minEncoded = encodeDer({
      kind: "sequence",
      items: [
        { kind: "boolean", value: false },
        { kind: "integer", value: 0 },
        { kind: "octetString", value: new Uint8Array([1, 2, 3, 4]) },
      ],
    });
    const maxEncoded = encodeDer({
      kind: "sequence",
      items: [
        { kind: "boolean", value: true },
        { kind: "integer", value: 127 },
        { kind: "octetString", value: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
        { kind: "null" },
      ],
    });

    assert.equal(minEncoded.length, bounds.minBytes, `minBytes parity (${bytesToHex(minEncoded)})`);
    assert.equal(maxEncoded.length, bounds.maxBytes, `maxBytes parity (${bytesToHex(maxEncoded)})`);
  });
});

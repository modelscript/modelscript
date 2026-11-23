// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesToHex,
  decodeBer,
  decodeDerIntegerContent,
  decodeOidContent,
  encodeDer,
  encodeDerIntegerContent,
  encodeLength,
  encodeOidContent,
  hexToBytes,
} from "../src/parser/ber-der.js";

describe("X.690 BER/DER TLV Binary Codec", () => {
  it("encodes and decodes minimal two's-complement INTEGER edge values", () => {
    const cases: Array<[number | bigint, string]> = [
      [0, "00"],
      [1, "01"],
      [127, "7F"],
      [128, "00 80"],
      [256, "01 00"],
      [-1, "FF"],
      [-128, "80"],
      [-129, "FF 7F"],
      [-32768, "80 00"],
      [65537, "01 00 01"],
    ];
    for (const [val, expectedHex] of cases) {
      const encoded = encodeDerIntegerContent(val);
      assert.equal(bytesToHex(encoded), expectedHex, `INTEGER ${val}`);
      assert.equal(decodeDerIntegerContent(encoded), BigInt(val));
    }
  });

  it("encodes definite short and minimal long DER lengths", () => {
    assert.equal(bytesToHex(encodeLength(0)), "00");
    assert.equal(bytesToHex(encodeLength(127)), "7F");
    assert.equal(bytesToHex(encodeLength(128)), "81 80");
    assert.equal(bytesToHex(encodeLength(255)), "81 FF");
    assert.equal(bytesToHex(encodeLength(256)), "82 01 00");
    assert.equal(bytesToHex(encodeLength(65535)), "82 FF FF");
  });

  it("encodes and decodes OBJECT IDENTIFIER with base-128 VLQ", () => {
    const rsaOid = encodeOidContent("1.2.840.113549.1.1.1");
    assert.equal(bytesToHex(rsaOid), "2A 86 48 86 F7 0D 01 01 01");
    assert.deepEqual(decodeOidContent(rsaOid), [1, 2, 840, 113549, 1, 1, 1]);

    // Root arc 2 with large second arc (2.999.3 -> 2*40+999 = 1079 -> 0x88 0x37)
    const jointOid = encodeOidContent([2, 999, 3]);
    assert.equal(bytesToHex(jointOid), "88 37 03");
    assert.deepEqual(decodeOidContent(jointOid), [2, 999, 3]);
  });

  it("sorts SET elements lexicographically in canonical DER", () => {
    const der = encodeDer({
      kind: "set",
      items: [
        { kind: "utf8String", value: "abc" }, // tag 0x0C
        { kind: "integer", value: 42 }, // tag 0x02
        { kind: "boolean", value: true }, // tag 0x01
      ],
    });
    const decoded = decodeBer(der);
    assert.ok(decoded.root && decoded.root.children);
    assert.equal(decoded.root.children.length, 3);
    assert.equal(decoded.root.children[0]!.tagByte, 0x01);
    assert.equal(decoded.root.children[1]!.tagByte, 0x02);
    assert.equal(decoded.root.children[2]!.tagByte, 0x0c);
    assert.equal(decoded.derIssues.length, 0);
  });

  it("decodes BER indefinite length and flags ASN15001 non-canonical DER issue", () => {
    // 30 80 02 01 05 00 00 (indefinite SEQUENCE containing INTEGER 5)
    const ber = hexToBytes("30 80 02 01 05 00 00");
    const res = decodeBer(ber);
    assert.ok(res.root);
    assert.equal(res.root.lengthForm, "indefinite");
    assert.equal(res.root.children?.length, 1);
    assert.equal(res.root.children?.[0]?.decodedValue, 5n);
    assert.ok(res.derIssues.some((i) => i.code === "ASN15001"));
  });

  it("detects non-canonical DER BOOLEAN (0x01), non-minimal length, and redundant INTEGER leading octet", () => {
    const badBool = decodeBer(hexToBytes("01 01 01"));
    assert.ok(badBool.derIssues.some((i) => i.code === "ASN15002"));

    const badLen = decodeBer(hexToBytes("04 81 02 AA BB"));
    assert.ok(badLen.derIssues.some((i) => i.code === "ASN15001"));

    const badInt = decodeBer(hexToBytes("02 02 00 01"));
    assert.ok(badInt.derIssues.some((i) => i.code === "ASN15003"));
  });
});

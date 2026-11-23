// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeArinc429Word, encodeArinc429Word, hasValidOddParity, reverseBits8 } from "../src/parser/codec.js";

describe("ARINC 429 32-Bit Word Codec", () => {
  it("reverses 8-bit octal labels accurately on the wire", () => {
    // Octal 203 = 0x83 = 1000_0011 -> reversed = 1100_0001 = 0xC1
    assert.strictEqual(reverseBits8(0o203), 0xc1);
    // Octal 310 = 0xC8 = 1100_1000 -> reversed = 0001_0011 = 0x13
    assert.strictEqual(reverseBits8(0o310), 0x13);
    assert.strictEqual(reverseBits8(reverseBits8(0o325)), 0o325);
  });

  it("encodes and decodes positive and negative 19-bit two's-complement BNR words with odd parity", () => {
    const posWord = encodeArinc429Word({
      label: "203",
      sdi: 1,
      encoding: "BNR",
      value: 35000,
      resolution: 0.5,
      ssm: 3,
    });
    assert.strictEqual(hasValidOddParity(posWord), true);
    const posDecoded = decodeArinc429Word(posWord, { encoding: "BNR", resolution: 0.5, units: "ft" });
    assert.strictEqual(posDecoded.labelOctal, "203");
    assert.strictEqual(posDecoded.wireLabelByte, 0xc1);
    assert.strictEqual(posDecoded.sdi, 1);
    assert.strictEqual(posDecoded.ssm, 3);
    assert.strictEqual(posDecoded.ssmMeaning, "NORMAL_OPERATION");
    assert.strictEqual(posDecoded.parityValid, true);
    assert.strictEqual(posDecoded.engineeringValue, 35000);

    const negWord = encodeArinc429Word({
      label: "324",
      sdi: 2,
      encoding: "BNR",
      value: -12.5,
      range: 180,
      ssm: 3,
    });
    assert.strictEqual(hasValidOddParity(negWord), true);
    const negDecoded = decodeArinc429Word(negWord, { encoding: "BNR", range: 180, units: "deg" });
    assert.strictEqual(negDecoded.labelOctal, "324");
    assert.strictEqual(negDecoded.sdi, 2);
    assert.ok(Math.abs(negDecoded.engineeringValue - -12.5) < 1e-3);
  });

  it("encodes and decodes 5-digit BCD words (positive and negative SSM) and detects invalid nibbles", () => {
    const bcdPos = encodeArinc429Word({
      label: "034",
      encoding: "BCD",
      value: 123.45,
      resolution: 0.01,
    });
    const decPos = decodeArinc429Word(bcdPos, { encoding: "BCD", resolution: 0.01 });
    assert.strictEqual(decPos.parityValid, true);
    assert.strictEqual(decPos.bcdValid, true);
    assert.strictEqual(decPos.ssm, 0);
    assert.strictEqual(decPos.ssmMeaning, "PLUS");
    assert.ok(Math.abs(decPos.engineeringValue - 123.45) < 1e-6);

    const bcdNeg = encodeArinc429Word({
      label: "034",
      encoding: "BCD",
      value: -543.21,
      resolution: 0.01,
    });
    const decNeg = decodeArinc429Word(bcdNeg, { encoding: "BCD", resolution: 0.01 });
    assert.strictEqual(decNeg.ssm, 3);
    assert.strictEqual(decNeg.ssmMeaning, "MINUS");
    assert.ok(Math.abs(decNeg.engineeringValue - -543.21) < 1e-6);

    // Inject nibble 0xA into digit 1 (bits 11..14)
    const badBcdWord = ((reverseBits8(0o034) & 0xff) | (0x0000a << 10)) >>> 0;
    const decBad = decodeArinc429Word(badBcdWord, { encoding: "BCD" });
    assert.strictEqual(decBad.bcdValid, false);
    assert.deepStrictEqual(decBad.invalidBcdDigits, [1]);
  });

  it("detects odd-parity fault injection on bit 32", () => {
    const badWord = encodeArinc429Word({
      label: "203",
      value: 10000,
      injectParityError: true,
    });
    assert.strictEqual(hasValidOddParity(badWord), false);
    const decoded = decodeArinc429Word(badWord);
    assert.strictEqual(decoded.parityValid, false);
  });
});

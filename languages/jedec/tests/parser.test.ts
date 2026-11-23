// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeJedecFuseChecksum, computeJedecTransmissionChecksum, formatHex16 } from "../src/parser/checksum.js";
import { parseJedec, serializeJedec } from "../src/parser/jedec-parser.js";

describe("@modelscript/jedec — JESD3 Parser & Serializer", () => {
  it("parses a framed STX/ETX PAL16L8 JEDEC file with all standard fields", () => {
    const body = [
      "PAL16L8 Inverter Demo*",
      "QP20*",
      "QF2048*",
      "QV4*",
      "F0*",
      "G0*",
      "X0*",
      "N DEVICE PAL16L8*",
      "L0000 11111111111111111111111111111111*",
      "L0032 11011111111111111111111111111111*",
      "V0001 000000000N0XXXXXXXXN*",
      "V0002 100000000N0XXXXXXXXN*",
    ].join("\n");

    const preDoc = parseJedec(body);
    const bodyWithC = `${body}\nC${formatHex16(preDoc.computedFuseChecksum)}*\n`;
    const framed = `\x02${bodyWithC}\x03`;
    const txHex = formatHex16(computeJedecTransmissionChecksum(framed));
    const full = `${framed}${txHex}\n`;

    const doc = parseJedec(full, "inverter.jed");
    assert.equal(doc.name, "inverter");
    assert.equal(doc.deviceName, "PAL16L8");
    assert.equal(doc.headerText, "PAL16L8 Inverter Demo");
    assert.equal(doc.hasStx, true);
    assert.equal(doc.hasEtx, true);
    assert.equal(doc.pinCount, 20);
    assert.equal(doc.fuseCount, 2048);
    assert.equal(doc.maxVectors, 4);
    assert.equal(doc.defaultFuseState, 0);
    assert.equal(doc.securityFuse, 0);
    assert.equal(doc.defaultTestCondition, 0);
    assert.equal(doc.notes.length, 1);
    assert.equal(doc.notes[0]?.text, "DEVICE PAL16L8");
    assert.equal(doc.fuseBlocks.length, 2);
    assert.equal(doc.testVectors.length, 2);
    assert.equal(doc.declaredFuseChecksum, doc.computedFuseChecksum);
    assert.equal(doc.declaredTransmissionChecksum, doc.computedTransmissionChecksum);
    assert.equal(doc.syntaxIssues.length, 0);
    assert.equal(doc.fuses.length, 2048);
    // Row 0 is all 1s
    for (let i = 0; i < 32; i++) assert.equal(doc.fuses[i], 1);
    // Row 1 bit 2 (address 34) is 0 (intact)
    assert.equal(doc.fuses[34], 0);
    assert.equal(doc.fuses[33], 1);
  });

  it("round-trips a JEDEC document via serializeJedec -> parseJedec with identical fuse map and checksums", () => {
    const src = [
      "GAL16V8 Roundtrip Test*",
      "QP20*",
      "QF2194*",
      "F1*",
      "G0*",
      "N DEVICE GAL16V8*",
      "L0000 00001111000011110000111100001111*",
      "L2048 10101010*",
      "V0001 010000000N0XXXXXXXXN*",
      "C0000*",
    ].join("\n");

    const doc1 = parseJedec(src, "roundtrip.jed");
    const serialized = serializeJedec(doc1, { includeFraming: true, recomputeChecksums: true });
    const doc2 = parseJedec(serialized, "roundtrip.jed");

    assert.equal(doc2.deviceName, "GAL16V8");
    assert.equal(doc2.pinCount, 20);
    assert.equal(doc2.fuseCount, 2194);
    assert.equal(doc2.defaultFuseState, 1);
    assert.equal(doc2.fuses.length, doc1.fuses.length);
    assert.deepEqual(Array.from(doc2.fuses), Array.from(doc1.fuses));
    assert.equal(doc2.declaredFuseChecksum, computeJedecFuseChecksum(doc2.fuses));
    assert.equal(doc2.declaredTransmissionChecksum, doc2.computedTransmissionChecksum);
    assert.equal(doc2.testVectors.length, 1);
    assert.equal(doc2.testVectors[0]?.pins, "010000000N0XXXXXXXXN");
  });

  it("handles multi-line whitespace inside L fuse-list bit strings", () => {
    const src = ["QP20*", "QF64*", "F0*", "L0000", "10101010", "01010101*"].join("\n");

    const doc = parseJedec(src);
    assert.equal(doc.fuseBlocks.length, 1);
    assert.equal(doc.fuseBlocks[0]?.bits, "1010101001010101");
    assert.equal(doc.fuses[0], 1);
    assert.equal(doc.fuses[1], 0);
    assert.equal(doc.fuses[8], 0);
    assert.equal(doc.fuses[9], 1);
  });
});

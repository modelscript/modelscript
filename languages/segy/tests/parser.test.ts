// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEGY_TEXTUAL_HEADER_BYTES,
  asciiToEbcdic,
  createDefaultTextualHeader,
  decodeTextualHeaderBytes,
  detectTextualHeaderEncoding,
  ebcdicToAscii,
  encodeTextualHeaderBytes,
  formatSegyTextualHeader,
  parseSegyTextualHeader,
} from "../src/index.js";

describe("@modelscript/segy — Textual Reel Header & EBCDIC/ASCII Codec", () => {
  it("round-trips printable ASCII strings through IBM CP037 EBCDIC", () => {
    const sample = "C 1 CLIENT: MODELSCRIPT GEOPHYSICS  LINE: NORTH-SEA-3D  REV 1.0  (2002)";
    const ebcdic = asciiToEbcdic(sample);
    assert.equal(ebcdic.length, sample.length);
    assert.equal(ebcdic[0], 0xc3); // EBCDIC 'C'
    assert.equal(detectTextualHeaderEncoding(ebcdic), "ebcdic");

    const decoded = ebcdicToAscii(ebcdic);
    assert.equal(decoded, sample);
  });

  it("parses multi-line 40-card textual reel header metadata", () => {
    const text = [
      "C 1 CLIENT: ACME ENERGY CORP",
      "C 2 LINE: GOM-2025-L04",
      "C 3 AREA: GULF OF MEXICO",
      "C 4 SAMPLE INTERVAL: 2000 US",
      "C 5 TRACE LENGTH: 4000 MS",
      "C 6 FORMAT: 1 (4-BYTE IBM FLOATING POINT)",
      "C 7 SEG Y REV 1.0",
      "C40 END TEXTUAL HEADER",
    ].join("\n");

    const hdr = parseSegyTextualHeader(text, "ascii");
    assert.equal(hdr.client, "ACME ENERGY CORP");
    assert.equal(hdr.line, "GOM-2025-L04");
    assert.equal(hdr.area, "GULF OF MEXICO");
    assert.equal(hdr.sampleIntervalUs, 2000);
    assert.equal(hdr.traceLengthMs, 4000);
    assert.equal(hdr.format, "1 (4-BYTE IBM FLOATING POINT)");
    assert.equal(hdr.revision, "1.0");
    assert.equal(hdr.hasEndTextualHeader, true);
    assert.equal(hdr.cards.length, 8);
  });

  it("encodes and decodes exact 3200-byte EBCDIC and ASCII textual headers", () => {
    const hdr = createDefaultTextualHeader({
      client: "NORTHERN SEISMIC",
      line: "IL-100",
      area: "PERMIAN BASIN",
      sampleIntervalUs: 4000,
      traceLengthMs: 2000,
      encoding: "ebcdic",
    });

    const formatted = formatSegyTextualHeader(hdr);
    assert.equal(formatted.length, SEGY_TEXTUAL_HEADER_BYTES);

    const ebcdicBytes = encodeTextualHeaderBytes(hdr, "ebcdic");
    assert.equal(ebcdicBytes.byteLength, SEGY_TEXTUAL_HEADER_BYTES);
    assert.equal(detectTextualHeaderEncoding(ebcdicBytes), "ebcdic");

    const decodedEbcdic = decodeTextualHeaderBytes(ebcdicBytes);
    assert.equal(decodedEbcdic.encoding, "ebcdic");
    assert.equal(decodedEbcdic.client, "NORTHERN SEISMIC");
    assert.equal(decodedEbcdic.line, "IL-100");
    assert.equal(decodedEbcdic.area, "PERMIAN BASIN");
    assert.equal(decodedEbcdic.sampleIntervalUs, 4000);
    assert.equal(decodedEbcdic.hasEndTextualHeader, true);

    const asciiBytes = encodeTextualHeaderBytes(hdr, "ascii");
    assert.equal(detectTextualHeaderEncoding(asciiBytes), "ascii");
    const decodedAscii = decodeTextualHeaderBytes(asciiBytes);
    assert.equal(decodedAscii.encoding, "ascii");
    assert.equal(decodedAscii.client, "NORTHERN SEISMIC");
  });
});

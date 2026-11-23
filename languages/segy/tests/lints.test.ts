// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SegySampleFormat,
  createDefaultBinaryHeader,
  createDefaultTextualHeader,
  createDefaultTraceHeader,
  decodeSegyBuffer,
  encodeSegyBuffer,
  lintSegy,
  lintSegyTextualHeader,
  parseSegyTextualHeader,
  type SegyFile,
} from "../src/index.js";

function makeValidFile(): SegyFile {
  return {
    textualHeader: createDefaultTextualHeader({ encoding: "ascii" }),
    binaryHeader: createDefaultBinaryHeader({
      sampleIntervalUs: 2000,
      samplesPerTrace: 4,
      sampleFormatCode: SegySampleFormat.IEEE_FLOAT32,
      measurementSystem: 1,
      segyRevision: 0x0100,
    }),
    extendedTextualHeaders: [],
    traces: [
      {
        header: createDefaultTraceHeader({ traceSeqLine: 1, sampleCount: 4, sampleIntervalUs: 2000 }),
        samples: new Float32Array([0.1, 0.2, -0.1, 0.0]),
      },
      {
        header: createDefaultTraceHeader({ traceSeqLine: 2, sampleCount: 4, sampleIntervalUs: 2000 }),
        samples: new Float32Array([0.0, 0.3, -0.2, 0.1]),
      },
    ],
    streamIssues: [],
  };
}

describe("@modelscript/segy — Domain Linter (SEGY1001–SEGY5006)", () => {
  it("reports zero diagnostics on a valid SEG-Y Rev 1 file", () => {
    const file = makeValidFile();
    assert.deepEqual(lintSegy(file), []);
  });

  it("flags SEGY1001 on malformed textual header cards", () => {
    const diags = lintSegyTextualHeader("INVALID CARD WITHOUT PREFIX");
    assert.ok(diags.some((d) => d.code === "SEGY1001"));
  });

  it("flags SEGY1002 on truncated reel header (< 3600 bytes)", () => {
    const truncated = new Uint8Array(1024);
    const decoded = decodeSegyBuffer(truncated);
    const diags = lintSegy(decoded);
    assert.ok(diags.some((d) => d.code === "SEGY1002"));
  });

  it("flags SEGY1003 on truncated trace payload", () => {
    const bytes = encodeSegyBuffer(makeValidFile(), "ascii");
    const truncated = bytes.subarray(0, bytes.byteLength - 8);
    const decoded = decodeSegyBuffer(truncated);
    const diags = lintSegy(decoded);
    assert.ok(diags.some((d) => d.code === "SEGY1003"));
  });

  it("flags SEGY2001 on unsupported sample format code", () => {
    const file = makeValidFile();
    file.binaryHeader.sampleFormatCode = 99;
    const diags = lintSegy(file);
    assert.ok(diags.some((d) => d.code === "SEGY2001"));
  });

  it("flags SEGY2002 on invalid measurement system code", () => {
    const file = makeValidFile();
    file.binaryHeader.measurementSystem = 7;
    const diags = lintSegy(file);
    assert.ok(diags.some((d) => d.code === "SEGY2002"));
  });

  it("flags SEGY3001 and SEGY3002 on non-positive sample interval or sample count", () => {
    const file = makeValidFile();
    file.binaryHeader.sampleIntervalUs = 0;
    file.binaryHeader.samplesPerTrace = 0;
    const diags = lintSegy(file);
    assert.ok(diags.some((d) => d.code === "SEGY3001"));
    assert.ok(diags.some((d) => d.code === "SEGY3002"));
  });

  it("flags SEGY3003 on trace sample count mismatch with binary header", () => {
    const file = makeValidFile();
    file.traces[1]!.header.sampleCount = 8;
    const diags = lintSegy(file);
    assert.ok(diags.some((d) => d.code === "SEGY3003"));
  });

  it("flags SEGY4001 on duplicate trace sequence and SEGY4002 on non-monotonic sequence", () => {
    const dupFile = makeValidFile();
    dupFile.traces[1]!.header.traceSeqLine = 1;
    assert.ok(lintSegy(dupFile).some((d) => d.code === "SEGY4001"));

    const nonMonoFile = makeValidFile();
    nonMonoFile.traces[0]!.header.traceSeqLine = 10;
    nonMonoFile.traces[1]!.header.traceSeqLine = 5;
    assert.ok(lintSegy(nonMonoFile).some((d) => d.code === "SEGY4002"));
  });

  it("flags SEGY5001 on NaN or Infinite trace amplitudes", () => {
    const file = makeValidFile();
    file.traces[0]!.samples[2] = Number.NaN;
    file.traces[1]!.samples[1] = Number.POSITIVE_INFINITY;
    const diags = lintSegy(file);
    assert.equal(diags.filter((d) => d.code === "SEGY5001").length, 2);
  });

  it("flags SEGY5006 when Rev 1 textual header omits END TEXTUAL HEADER", () => {
    const file = makeValidFile();
    file.textualHeader = parseSegyTextualHeader("C 1 CLIENT: TEST\nC 2 SEG Y REV 1.0", "ascii");
    const diags = lintSegy(file);
    assert.ok(diags.some((d) => d.code === "SEGY5006"));
  });
});

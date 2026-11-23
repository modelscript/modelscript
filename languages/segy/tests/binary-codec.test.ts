// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEGY_REEL_HEADER_BYTES,
  SEGY_TRACE_HEADER_BYTES,
  SegySampleFormat,
  createDefaultBinaryHeader,
  createDefaultTextualHeader,
  createDefaultTraceHeader,
  decodeSegyBuffer,
  encodeSegyBuffer,
  lintSegy,
  rickerWavelet,
  type SegyFile,
} from "../src/index.js";

describe("@modelscript/segy — Binary SEG-Y Rev 0 / Rev 1 Codec", () => {
  it("round-trips IBM float32 (format=1) SEG-Y Rev 1 stream with EBCDIC header and 3D trace headers", () => {
    const nSamples = 64;
    const wavelet = rickerWavelet(30, 0.002, nSamples);
    const file: SegyFile = {
      textualHeader: createDefaultTextualHeader({
        client: "MODELSCRIPT",
        line: "3D-TEST",
        area: "OFFSHORE",
        sampleIntervalUs: 2000,
        encoding: "ebcdic",
      }),
      binaryHeader: createDefaultBinaryHeader({
        jobId: 42,
        lineNumber: 101,
        sampleIntervalUs: 2000,
        samplesPerTrace: nSamples,
        sampleFormatCode: SegySampleFormat.IBM_FLOAT32,
        segyRevision: 0x0100,
      }),
      extendedTextualHeaders: [],
      traces: [
        {
          header: createDefaultTraceHeader({
            traceSeqLine: 1,
            traceSeqFile: 1,
            cdp: 500,
            offsetM: 150,
            inline3D: 1020,
            crossline3D: 2040,
            sampleCount: nSamples,
            sampleIntervalUs: 2000,
          }),
          samples: wavelet,
        },
        {
          header: createDefaultTraceHeader({
            traceSeqLine: 2,
            traceSeqFile: 2,
            cdp: 500,
            offsetM: 300,
            inline3D: 1020,
            crossline3D: 2041,
            sampleCount: nSamples,
            sampleIntervalUs: 2000,
          }),
          samples: wavelet,
        },
      ],
      streamIssues: [],
    };

    const bytes = encodeSegyBuffer(file);
    assert.equal(bytes.byteLength, SEGY_REEL_HEADER_BYTES + 2 * (SEGY_TRACE_HEADER_BYTES + nSamples * 4));

    const decoded = decodeSegyBuffer(bytes);
    assert.equal(decoded.streamIssues.length, 0);
    assert.equal(lintSegy(decoded).length, 0);
    assert.equal(decoded.textualHeader.encoding, "ebcdic");
    assert.equal(decoded.binaryHeader.jobId, 42);
    assert.equal(decoded.binaryHeader.lineNumber, 101);
    assert.equal(decoded.binaryHeader.sampleFormatCode, 1);
    assert.equal(decoded.traces.length, 2);
    assert.equal(decoded.traces[0]!.header.inline3D, 1020);
    assert.equal(decoded.traces[1]!.header.crossline3D, 2041);
    assert.equal(decoded.traces[1]!.header.offsetM, 300);

    for (let i = 0; i < nSamples; i++) {
      const diff = Math.abs(decoded.traces[0]!.samples[i]! - wavelet[i]!);
      assert.ok(diff < 1e-6, `Sample ${i} mismatch: ${diff}`);
    }
  });

  it("round-trips IEEE float32 (format=5), int32 (format=2), int16 (format=3), and int8 (format=8)", () => {
    const formats = [
      { code: SegySampleFormat.IEEE_FLOAT32, samples: new Float32Array([0, 1.5, -2.25, 123.456]), tol: 1e-5 },
      { code: SegySampleFormat.INT32, samples: new Float32Array([0, 100000, -500000, 42]), tol: 0 },
      { code: SegySampleFormat.INT16, samples: new Float32Array([0, 1234, -32000, 32767]), tol: 0 },
      { code: SegySampleFormat.INT8, samples: new Float32Array([0, 64, -128, 127]), tol: 0 },
    ] as const;

    for (const tc of formats) {
      const file: SegyFile = {
        textualHeader: createDefaultTextualHeader({ encoding: "ascii" }),
        binaryHeader: createDefaultBinaryHeader({
          samplesPerTrace: tc.samples.length,
          sampleFormatCode: tc.code,
        }),
        extendedTextualHeaders: [],
        traces: [
          {
            header: createDefaultTraceHeader({ sampleCount: tc.samples.length }),
            samples: tc.samples,
          },
        ],
        streamIssues: [],
      };

      const encoded = encodeSegyBuffer(file, "ascii");
      const decoded = decodeSegyBuffer(encoded);
      assert.equal(decoded.binaryHeader.sampleFormatCode, tc.code);
      assert.equal(decoded.traces.length, 1);
      for (let i = 0; i < tc.samples.length; i++) {
        assert.ok(
          Math.abs(decoded.traces[0]!.samples[i]! - tc.samples[i]!) <= tc.tol,
          `Format ${tc.code} sample ${i} mismatch`,
        );
      }
    }
  });

  it("supports SEG-Y Rev 1 extended textual headers", () => {
    const file: SegyFile = {
      textualHeader: createDefaultTextualHeader({ encoding: "ascii" }),
      binaryHeader: createDefaultBinaryHeader({ samplesPerTrace: 4, sampleFormatCode: SegySampleFormat.IEEE_FLOAT32 }),
      extendedTextualHeaders: ["C 1 EXTENDED STANZA: PROCESSING HISTORY\nC40 END TEXTUAL HEADER"],
      traces: [
        {
          header: createDefaultTraceHeader({ sampleCount: 4 }),
          samples: new Float32Array([1, 2, 3, 4]),
        },
      ],
      streamIssues: [],
    };

    const bytes = encodeSegyBuffer(file, "ascii");
    const decoded = decodeSegyBuffer(bytes);
    assert.equal(decoded.extendedTextualHeaders.length, 1);
    assert.ok(decoded.extendedTextualHeaders[0]!.includes("PROCESSING HISTORY"));
    assert.equal(decoded.traces.length, 1);
    assert.equal(decoded.traces[0]!.samples[3], 4);
  });
});

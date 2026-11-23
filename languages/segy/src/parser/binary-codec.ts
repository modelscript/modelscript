// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Full binary SEG-Y Rev 0 / Rev 1 stream encoder and decoder.
 *
 * Layout (big-endian per SEG-Y Rev 0 (1975) & Rev 1 (2002) specification):
 *   - Bytes 0..3199    : 3200-byte textual reel header (EBCDIC or ASCII)
 *   - Bytes 3200..3599 : 400-byte binary reel header
 *   - Optional         : N × 3200-byte extended textual reel headers (Rev 1)
 *   - Repeating traces : 240-byte trace header + (ns × bytesPerSample) sample data
 */

import { SegyErrorCode } from "../errors.js";
import {
  SegyMeasurementSystem,
  SegySampleFormat,
  type SegyBinaryHeader,
  type SegyFile,
  type SegyStreamIssue,
  type SegyTextEncoding,
  type SegyTrace,
  type SegyTraceHeader,
} from "../types.js";
import { asciiBytesToString, detectTextualHeaderEncoding, ebcdicToAscii } from "./ebcdic.js";
import { decodeIbmFloatArray, encodeIbmFloatArray } from "./ibm-float.js";
import {
  SEGY_TEXTUAL_HEADER_BYTES,
  createDefaultTextualHeader,
  decodeTextualHeaderBytes,
  encodeTextualHeaderBytes,
} from "./textual-header.js";

export const SEGY_BINARY_HEADER_BYTES = 400;
export const SEGY_REEL_HEADER_BYTES = SEGY_TEXTUAL_HEADER_BYTES + SEGY_BINARY_HEADER_BYTES; // 3600
export const SEGY_TRACE_HEADER_BYTES = 240;

/**
 * Returns byte width per sample for a valid SEG-Y sample format code, or `undefined` if unsupported.
 */
export function bytesPerSampleForFormat(formatCode: number): number | undefined {
  switch (formatCode) {
    case SegySampleFormat.IBM_FLOAT32:
    case SegySampleFormat.INT32:
    case SegySampleFormat.IEEE_FLOAT32:
      return 4;
    case SegySampleFormat.INT16:
      return 2;
    case SegySampleFormat.INT8:
      return 1;
    default:
      return undefined;
  }
}

export function createDefaultBinaryHeader(overrides?: Partial<SegyBinaryHeader>): SegyBinaryHeader {
  return {
    jobId: 1,
    lineNumber: 1,
    reelNumber: 1,
    tracesPerEnsemble: 1,
    auxTracesPerEnsemble: 0,
    sampleIntervalUs: 2000,
    origSampleIntervalUs: 2000,
    samplesPerTrace: 256,
    origSamplesPerTrace: 256,
    sampleFormatCode: SegySampleFormat.IBM_FLOAT32,
    ensembleFold: 1,
    traceSortingCode: 2,
    verticalSumCode: 1,
    sweepFreqStartHz: 0,
    sweepFreqEndHz: 0,
    sweepLengthMs: 0,
    sweepTypeCode: 0,
    measurementSystem: SegyMeasurementSystem.METERS,
    impulsePolarity: 1,
    segyRevision: 0x0100,
    fixedLengthTraceFlag: 1,
    extendedTextualHeadersCount: 0,
    ...overrides,
  };
}

export function createDefaultTraceHeader(overrides?: Partial<SegyTraceHeader>): SegyTraceHeader {
  return {
    traceSeqLine: 1,
    traceSeqFile: 1,
    fieldRecord: 1,
    traceNumberField: 1,
    cdp: 1,
    traceNumberEnsemble: 1,
    traceIdCode: 1,
    offsetM: 0,
    receiverElevation: 0,
    sourceElevation: 0,
    sourceDepth: 0,
    coordScalar: 1,
    sourceX: 0,
    sourceY: 0,
    groupX: 0,
    groupY: 0,
    coordUnits: 1,
    delayRecordingTimeMs: 0,
    sampleCount: 256,
    sampleIntervalUs: 2000,
    inline3D: 1,
    crossline3D: 1,
    ...overrides,
  };
}

function readBinaryHeader(view: DataView, offset: number): SegyBinaryHeader {
  return {
    jobId: view.getInt32(offset + 0, false),
    lineNumber: view.getInt32(offset + 4, false),
    reelNumber: view.getInt32(offset + 8, false),
    tracesPerEnsemble: view.getInt16(offset + 12, false),
    auxTracesPerEnsemble: view.getInt16(offset + 14, false),
    sampleIntervalUs: view.getUint16(offset + 16, false),
    origSampleIntervalUs: view.getUint16(offset + 18, false),
    samplesPerTrace: view.getUint16(offset + 20, false),
    origSamplesPerTrace: view.getUint16(offset + 22, false),
    sampleFormatCode: view.getInt16(offset + 24, false),
    ensembleFold: view.getInt16(offset + 26, false),
    traceSortingCode: view.getInt16(offset + 28, false),
    verticalSumCode: view.getInt16(offset + 30, false),
    sweepFreqStartHz: view.getInt16(offset + 32, false),
    sweepFreqEndHz: view.getInt16(offset + 34, false),
    sweepLengthMs: view.getInt16(offset + 36, false),
    sweepTypeCode: view.getInt16(offset + 38, false),
    measurementSystem: view.getInt16(offset + 54, false),
    impulsePolarity: view.getInt16(offset + 56, false),
    segyRevision: view.getUint16(offset + 300, false),
    fixedLengthTraceFlag: view.getInt16(offset + 302, false),
    extendedTextualHeadersCount: view.getInt16(offset + 304, false),
  };
}

function writeBinaryHeader(view: DataView, offset: number, h: SegyBinaryHeader): void {
  view.setInt32(offset + 0, h.jobId, false);
  view.setInt32(offset + 4, h.lineNumber, false);
  view.setInt32(offset + 8, h.reelNumber, false);
  view.setInt16(offset + 12, h.tracesPerEnsemble, false);
  view.setInt16(offset + 14, h.auxTracesPerEnsemble, false);
  view.setUint16(offset + 16, Math.max(0, Math.min(65535, Math.round(h.sampleIntervalUs))), false);
  view.setUint16(offset + 18, Math.max(0, Math.min(65535, Math.round(h.origSampleIntervalUs))), false);
  view.setUint16(offset + 20, Math.max(0, Math.min(65535, Math.round(h.samplesPerTrace))), false);
  view.setUint16(offset + 22, Math.max(0, Math.min(65535, Math.round(h.origSamplesPerTrace))), false);
  view.setInt16(offset + 24, h.sampleFormatCode, false);
  view.setInt16(offset + 26, h.ensembleFold, false);
  view.setInt16(offset + 28, h.traceSortingCode, false);
  view.setInt16(offset + 30, h.verticalSumCode, false);
  view.setInt16(offset + 32, h.sweepFreqStartHz, false);
  view.setInt16(offset + 34, h.sweepFreqEndHz, false);
  view.setInt16(offset + 36, h.sweepLengthMs, false);
  view.setInt16(offset + 38, h.sweepTypeCode, false);
  view.setInt16(offset + 54, h.measurementSystem, false);
  view.setInt16(offset + 56, h.impulsePolarity, false);
  view.setUint16(offset + 300, h.segyRevision & 0xffff, false);
  view.setInt16(offset + 302, h.fixedLengthTraceFlag, false);
  view.setInt16(offset + 304, h.extendedTextualHeadersCount, false);
}

function readTraceHeader(view: DataView, offset: number): SegyTraceHeader {
  return {
    traceSeqLine: view.getInt32(offset + 0, false),
    traceSeqFile: view.getInt32(offset + 4, false),
    fieldRecord: view.getInt32(offset + 8, false),
    traceNumberField: view.getInt32(offset + 12, false),
    cdp: view.getInt32(offset + 20, false),
    traceNumberEnsemble: view.getInt32(offset + 24, false),
    traceIdCode: view.getInt16(offset + 28, false),
    offsetM: view.getInt32(offset + 36, false),
    receiverElevation: view.getInt32(offset + 40, false),
    sourceElevation: view.getInt32(offset + 44, false),
    sourceDepth: view.getInt32(offset + 48, false),
    coordScalar: view.getInt16(offset + 70, false),
    sourceX: view.getInt32(offset + 72, false),
    sourceY: view.getInt32(offset + 76, false),
    groupX: view.getInt32(offset + 80, false),
    groupY: view.getInt32(offset + 84, false),
    coordUnits: view.getInt16(offset + 88, false),
    delayRecordingTimeMs: view.getInt16(offset + 108, false),
    sampleCount: view.getUint16(offset + 114, false),
    sampleIntervalUs: view.getUint16(offset + 116, false),
    inline3D: view.getInt32(offset + 188, false),
    crossline3D: view.getInt32(offset + 192, false),
  };
}

function writeTraceHeader(view: DataView, offset: number, h: SegyTraceHeader): void {
  view.setInt32(offset + 0, h.traceSeqLine, false);
  view.setInt32(offset + 4, h.traceSeqFile, false);
  view.setInt32(offset + 8, h.fieldRecord, false);
  view.setInt32(offset + 12, h.traceNumberField, false);
  view.setInt32(offset + 20, h.cdp, false);
  view.setInt32(offset + 24, h.traceNumberEnsemble, false);
  view.setInt16(offset + 28, h.traceIdCode, false);
  view.setInt32(offset + 36, h.offsetM, false);
  view.setInt32(offset + 40, h.receiverElevation, false);
  view.setInt32(offset + 44, h.sourceElevation, false);
  view.setInt32(offset + 48, h.sourceDepth, false);
  view.setInt16(offset + 70, h.coordScalar, false);
  view.setInt32(offset + 72, h.sourceX, false);
  view.setInt32(offset + 76, h.sourceY, false);
  view.setInt32(offset + 80, h.groupX, false);
  view.setInt32(offset + 84, h.groupY, false);
  view.setInt16(offset + 88, h.coordUnits, false);
  view.setInt16(offset + 108, h.delayRecordingTimeMs, false);
  view.setUint16(offset + 114, Math.max(0, Math.min(65535, Math.round(h.sampleCount))), false);
  view.setUint16(offset + 116, Math.max(0, Math.min(65535, Math.round(h.sampleIntervalUs))), false);
  view.setInt32(offset + 188, h.inline3D, false);
  view.setInt32(offset + 192, h.crossline3D, false);
}

function decodeTraceSamples(view: DataView, offset: number, count: number, formatCode: number): Float32Array {
  switch (formatCode) {
    case SegySampleFormat.IBM_FLOAT32:
      return decodeIbmFloatArray(view, offset, count);
    case SegySampleFormat.INT32: {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt32(offset + i * 4, false);
      return out;
    }
    case SegySampleFormat.INT16: {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt16(offset + i * 2, false);
      return out;
    }
    case SegySampleFormat.IEEE_FLOAT32: {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getFloat32(offset + i * 4, false);
      return out;
    }
    case SegySampleFormat.INT8: {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt8(offset + i);
      return out;
    }
    default:
      return new Float32Array(0);
  }
}

function encodeTraceSamples(samples: ArrayLike<number>, view: DataView, offset: number, formatCode: number): void {
  switch (formatCode) {
    case SegySampleFormat.IBM_FLOAT32:
      encodeIbmFloatArray(samples, view, offset);
      break;
    case SegySampleFormat.INT32:
      for (let i = 0; i < samples.length; i++) {
        view.setInt32(offset + i * 4, Math.round(samples[i]!), false);
      }
      break;
    case SegySampleFormat.INT16:
      for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-32768, Math.min(32767, Math.round(samples[i]!)));
        view.setInt16(offset + i * 2, clamped, false);
      }
      break;
    case SegySampleFormat.IEEE_FLOAT32:
      for (let i = 0; i < samples.length; i++) {
        view.setFloat32(offset + i * 4, samples[i]!, false);
      }
      break;
    case SegySampleFormat.INT8:
      for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-128, Math.min(127, Math.round(samples[i]!)));
        view.setInt8(offset + i, clamped);
      }
      break;
    default:
      throw new Error(SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.message(formatCode));
  }
}

/**
 * Decodes a binary SEG-Y Rev 0 / Rev 1 byte stream into a structured `SegyFile`.
 * Structural issues (truncated headers/traces, unsupported formats) are recorded in `streamIssues`
 * so the linter can report full diagnostics without crashing.
 */
export function decodeSegyBuffer(buffer: Uint8Array, encoding?: SegyTextEncoding): SegyFile {
  const streamIssues: SegyStreamIssue[] = [];
  const textualHeader =
    buffer.byteLength > 0
      ? decodeTextualHeaderBytes(buffer, encoding)
      : createDefaultTextualHeader({ encoding: encoding ?? "ascii" });

  if (buffer.byteLength < SEGY_REEL_HEADER_BYTES) {
    streamIssues.push({
      code: SegyErrorCode.TRUNCATED_REEL_HEADER.code,
      message: SegyErrorCode.TRUNCATED_REEL_HEADER.message(buffer.byteLength, SEGY_REEL_HEADER_BYTES),
      byteOffset: buffer.byteLength,
    });
    return {
      textualHeader,
      binaryHeader: createDefaultBinaryHeader({ sampleIntervalUs: 0, samplesPerTrace: 0 }),
      extendedTextualHeaders: [],
      traces: [],
      byteLength: buffer.byteLength,
      streamIssues,
    };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const binaryHeader = readBinaryHeader(view, SEGY_TEXTUAL_HEADER_BYTES);

  let offset = SEGY_REEL_HEADER_BYTES;
  const extendedTextualHeaders: string[] = [];

  if (binaryHeader.extendedTextualHeadersCount > 0) {
    for (let i = 0; i < binaryHeader.extendedTextualHeadersCount; i++) {
      if (offset + SEGY_TEXTUAL_HEADER_BYTES > buffer.byteLength) {
        streamIssues.push({
          code: SegyErrorCode.TRUNCATED_REEL_HEADER.code,
          message: SegyErrorCode.TRUNCATED_REEL_HEADER.message(buffer.byteLength, offset + SEGY_TEXTUAL_HEADER_BYTES),
          byteOffset: offset,
        });
        break;
      }
      const extSlice = buffer.subarray(offset, offset + SEGY_TEXTUAL_HEADER_BYTES);
      const enc = encoding ?? detectTextualHeaderEncoding(extSlice);
      extendedTextualHeaders.push(enc === "ebcdic" ? ebcdicToAscii(extSlice) : asciiBytesToString(extSlice));
      offset += SEGY_TEXTUAL_HEADER_BYTES;
    }
  }

  const bps = bytesPerSampleForFormat(binaryHeader.sampleFormatCode);
  const traces: SegyTrace[] = [];

  if (bps === undefined) {
    streamIssues.push({
      code: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.code,
      message: SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.message(binaryHeader.sampleFormatCode),
      byteOffset: SEGY_TEXTUAL_HEADER_BYTES + 24,
    });
    return {
      textualHeader,
      binaryHeader,
      extendedTextualHeaders,
      traces,
      byteLength: buffer.byteLength,
      streamIssues,
    };
  }

  let traceIdx = 0;
  while (offset < buffer.byteLength) {
    const remaining = buffer.byteLength - offset;
    if (remaining < SEGY_TRACE_HEADER_BYTES) {
      streamIssues.push({
        code: SegyErrorCode.TRUNCATED_TRACE.code,
        message: SegyErrorCode.TRUNCATED_TRACE.message(traceIdx, remaining, SEGY_TRACE_HEADER_BYTES),
        byteOffset: offset,
        traceIndex: traceIdx,
      });
      break;
    }

    const traceStart = offset;
    const header = readTraceHeader(view, offset);
    offset += SEGY_TRACE_HEADER_BYTES;

    const ns = header.sampleCount > 0 ? header.sampleCount : binaryHeader.samplesPerTrace;
    const sampleBytes = ns * bps;

    if (offset + sampleBytes > buffer.byteLength) {
      streamIssues.push({
        code: SegyErrorCode.TRUNCATED_TRACE.code,
        message: SegyErrorCode.TRUNCATED_TRACE.message(
          traceIdx,
          buffer.byteLength - traceStart,
          SEGY_TRACE_HEADER_BYTES + sampleBytes,
        ),
        byteOffset: traceStart,
        traceIndex: traceIdx,
      });
      break;
    }

    const samples = decodeTraceSamples(view, offset, ns, binaryHeader.sampleFormatCode);
    offset += sampleBytes;

    traces.push({ header, samples, byteOffset: traceStart });
    traceIdx++;
  }

  return {
    textualHeader,
    binaryHeader,
    extendedTextualHeaders,
    traces,
    byteLength: buffer.byteLength,
    streamIssues,
  };
}

/**
 * Encodes a `SegyFile` into a binary SEG-Y Rev 0 / Rev 1 `Uint8Array`.
 */
export function encodeSegyBuffer(file: SegyFile, encoding?: SegyTextEncoding): Uint8Array {
  const fmt = file.binaryHeader.sampleFormatCode;
  const bps = bytesPerSampleForFormat(fmt);
  if (bps === undefined) {
    throw new Error(SegyErrorCode.UNSUPPORTED_SAMPLE_FORMAT.message(fmt));
  }

  const extCount = file.extendedTextualHeaders.length;
  const binHeader: SegyBinaryHeader = {
    ...file.binaryHeader,
    extendedTextualHeadersCount: extCount,
  };

  let totalBytes = SEGY_REEL_HEADER_BYTES + extCount * SEGY_TEXTUAL_HEADER_BYTES;
  for (const trace of file.traces) {
    totalBytes += SEGY_TRACE_HEADER_BYTES + trace.samples.length * bps;
  }

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // 1. Textual reel header (3200 bytes)
  const textEnc = encoding ?? file.textualHeader.encoding;
  const textBytes = encodeTextualHeaderBytes(file.textualHeader, textEnc);
  out.set(textBytes, 0);

  // 2. Binary reel header (400 bytes)
  writeBinaryHeader(view, SEGY_TEXTUAL_HEADER_BYTES, binHeader);

  // 3. Extended textual headers
  let offset = SEGY_REEL_HEADER_BYTES;
  for (const extText of file.extendedTextualHeaders) {
    const extBytes = encodeTextualHeaderBytes(extText.split(/\r?\n/), textEnc);
    out.set(extBytes, offset);
    offset += SEGY_TEXTUAL_HEADER_BYTES;
  }

  // 4. Traces
  for (const trace of file.traces) {
    const th: SegyTraceHeader = {
      ...trace.header,
      sampleCount: trace.header.sampleCount > 0 ? trace.header.sampleCount : trace.samples.length,
    };
    writeTraceHeader(view, offset, th);
    offset += SEGY_TRACE_HEADER_BYTES;
    encodeTraceSamples(trace.samples, view, offset, fmt);
    offset += trace.samples.length * bps;
  }

  return out;
}

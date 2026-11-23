// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Intel HEX (I8HEX / I16HEX / I32HEX) parser and encoder.
 *
 * Record format: `:LLAAAATT[DD...]CC`
 *   - `:`    Start code
 *   - `LL`   Byte count (1 byte, hex)
 *   - `AAAA` 16-bit load offset address (2 bytes, big-endian hex)
 *   - `TT`   Record type (1 byte, 00..05)
 *   - `DD`   Data payload (`LL` bytes)
 *   - `CC`   2's-complement checksum: `(256 - (sum(LL, AAAA_hi, AAAA_lo, TT, DD...) & 0xFF)) & 0xFF`
 */

import {
  IhexRecordType,
  type IhexEncodeOptions,
  type IhexFormat,
  type IhexInputSegment,
  type IhexModel,
  type IhexParseError,
  type IhexRecord,
  type IhexStartSegmentAddress,
} from "../types.js";

const HEX_RE = /^[0-9A-Fa-f]+$/;

/**
 * Computes the Intel HEX 2's-complement checksum byte over the record header + payload bytes.
 */
export function computeIhexChecksum(bytes: Uint8Array | readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + (bytes[i] ?? 0)) & 0xff;
  }
  return (256 - sum) & 0xff;
}

/**
 * Formats a byte as 2-character hex.
 */
export function hexByte(value: number, uppercase: boolean = true): string {
  const s = (value & 0xff).toString(16).padStart(2, "0");
  return uppercase ? s.toUpperCase() : s;
}

/**
 * Formats a 16-bit word as 4-character hex.
 */
export function hexWord(value: number, uppercase: boolean = true): string {
  const s = (value & 0xffff).toString(16).padStart(4, "0");
  return uppercase ? s.toUpperCase() : s;
}

/**
 * Formats a 32-bit unsigned integer as 8-character hex.
 */
export function hexDword(value: number, uppercase: boolean = true): string {
  const s = (value >>> 0).toString(16).padStart(8, "0");
  return uppercase ? s.toUpperCase() : s;
}

/**
 * Parses an Intel HEX text image (I8HEX, I16HEX, or I32HEX) into a structured `IhexModel`.
 */
export function parseIhex(text: string, name: string = "firmware.hex"): IhexModel {
  const records: IhexRecord[] = [];
  const parseErrors: IhexParseError[] = [];

  let baseAddress = 0;
  let hasSegExt = false;
  let hasLinExt = false;
  let hasEof = false;
  let eofLine: number | undefined;
  let startSegmentAddress: IhexStartSegmentAddress | undefined;
  let startLinearAddress: number | undefined;
  let totalDataBytes = 0;
  let minAddress: number | undefined;
  let maxAddress: number | undefined;

  let offset = 0;
  const rawLines = text.split(/\r?\n/);

  // Track exact offsets even with mixed LF / CRLF
  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx] ?? "";
    const lineStart = offset;
    const lineEnd = lineStart + rawLine.length;
    // Advance offset past line + newline sequence
    if (idx < rawLines.length - 1) {
      const nextChar = text[lineEnd];
      if (nextChar === "\r" && text[lineEnd + 1] === "\n") {
        offset = lineEnd + 2;
      } else {
        offset = lineEnd + 1;
      }
    } else {
      offset = lineEnd;
    }

    const lineNumber = idx + 1;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    if (!trimmed.startsWith(":")) {
      parseErrors.push({
        lineNumber,
        column: 1,
        startOffset: lineStart,
        endOffset: lineEnd,
        code: "IHEX1001",
        message: `Intel HEX record on line ${lineNumber} does not start with ':' start code.`,
        raw: trimmed,
      });
      continue;
    }

    const body = trimmed.slice(1);
    if (body.length < 10) {
      parseErrors.push({
        lineNumber,
        column: 1,
        startOffset: lineStart,
        endOffset: lineEnd,
        code: "IHEX1003",
        message: `Truncated Intel HEX record on line ${lineNumber} (${trimmed.length} characters; minimum is 11 for ':LLAAAATTCC').`,
        raw: trimmed,
      });
      continue;
    }

    if (body.length % 2 !== 0 || !HEX_RE.test(body)) {
      const detail =
        body.length % 2 !== 0 ? `odd hex digit count (${body.length})` : "contains non-hexadecimal characters";
      parseErrors.push({
        lineNumber,
        column: 2,
        startOffset: lineStart,
        endOffset: lineEnd,
        code: "IHEX1002",
        message: `Invalid hexadecimal syntax on line ${lineNumber}: ${detail}.`,
        raw: trimmed,
      });
      continue;
    }

    const byteCount = Number.parseInt(body.slice(0, 2), 16);
    const addrHi = Number.parseInt(body.slice(2, 4), 16);
    const addrLo = Number.parseInt(body.slice(4, 6), 16);
    const address = ((addrHi << 8) | addrLo) & 0xffff;
    const recordType = Number.parseInt(body.slice(6, 8), 16);

    const payloadHexLen = body.length - 10; // minus LL(2) + AAAA(4) + TT(2) + CC(2)
    const actualPayloadLen = payloadHexLen / 2;
    const data = new Uint8Array(actualPayloadLen);
    for (let i = 0; i < actualPayloadLen; i++) {
      data[i] = Number.parseInt(body.slice(8 + i * 2, 10 + i * 2), 16);
    }

    const checksum = Number.parseInt(body.slice(body.length - 2), 16);

    // Compute 2's-complement checksum across LL, AAAA_hi, AAAA_lo, TT, and actual payload bytes
    const sumBuf = new Uint8Array(4 + actualPayloadLen);
    sumBuf[0] = byteCount;
    sumBuf[1] = addrHi;
    sumBuf[2] = addrLo;
    sumBuf[3] = recordType;
    sumBuf.set(data, 4);
    const expectedChecksum = computeIhexChecksum(sumBuf);
    const checksumValid = checksum === expectedChecksum;
    const byteCountValid = actualPayloadLen === byteCount;

    const recordBase = baseAddress;
    const linearAddress = (recordBase + address) >>> 0;

    if (recordType === IhexRecordType.Data) {
      totalDataBytes += data.length;
      if (data.length > 0) {
        const endAddr = (linearAddress + data.length) >>> 0;
        if (minAddress === undefined || linearAddress < minAddress) {
          minAddress = linearAddress;
        }
        if (maxAddress === undefined || endAddr > maxAddress) {
          maxAddress = endAddr;
        }
      }
    } else if (recordType === IhexRecordType.Eof) {
      if (!hasEof) {
        hasEof = true;
        eofLine = lineNumber;
      }
    } else if (recordType === IhexRecordType.ExtendedSegmentAddress) {
      hasSegExt = true;
      if (data.length >= 2) {
        const seg = ((data[0] ?? 0) << 8) | (data[1] ?? 0);
        baseAddress = (seg << 4) >>> 0;
      }
    } else if (recordType === IhexRecordType.StartSegmentAddress) {
      hasSegExt = true;
      if (data.length >= 4) {
        startSegmentAddress = {
          cs: (((data[0] ?? 0) << 8) | (data[1] ?? 0)) & 0xffff,
          ip: (((data[2] ?? 0) << 8) | (data[3] ?? 0)) & 0xffff,
        };
      }
    } else if (recordType === IhexRecordType.ExtendedLinearAddress) {
      hasLinExt = true;
      if (data.length >= 2) {
        const upper16 = ((data[0] ?? 0) << 8) | (data[1] ?? 0);
        baseAddress = (upper16 << 16) >>> 0;
      }
    } else if (recordType === IhexRecordType.StartLinearAddress) {
      hasLinExt = true;
      if (data.length >= 4) {
        startLinearAddress =
          (((data[0] ?? 0) << 24) | ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0)) >>> 0;
      }
    }

    records.push({
      lineNumber,
      startOffset: lineStart,
      endOffset: lineEnd,
      raw: trimmed,
      byteCount,
      address,
      recordType,
      data,
      checksum,
      expectedChecksum,
      checksumValid,
      byteCountValid,
      baseAddress: recordBase,
      linearAddress,
    });
  }

  let format: IhexFormat = "I8HEX";
  if (hasLinExt) {
    format = "I32HEX";
  } else if (hasSegExt) {
    format = "I16HEX";
  }

  return {
    name,
    format,
    records,
    parseErrors,
    hasEof,
    eofLine,
    startSegmentAddress,
    startLinearAddress,
    totalDataBytes,
    minAddress,
    maxAddress,
  };
}

/**
 * Formats a single Intel HEX record line (`:LLAAAATT[DD...]CC`).
 */
export function formatIhexRecord(
  recordType: number,
  address: number,
  data: Uint8Array | readonly number[],
  uppercase: boolean = true,
): string {
  const ll = data.length & 0xff;
  const addrHi = (address >>> 8) & 0xff;
  const addrLo = address & 0xff;
  const tt = recordType & 0xff;

  const buf = new Uint8Array(4 + ll);
  buf[0] = ll;
  buf[1] = addrHi;
  buf[2] = addrLo;
  buf[3] = tt;
  for (let i = 0; i < ll; i++) {
    buf[4 + i] = (data[i] ?? 0) & 0xff;
  }

  const cc = computeIhexChecksum(buf);
  let out = `:${hexByte(ll, uppercase)}${hexWord(address, uppercase)}${hexByte(tt, uppercase)}`;
  for (let i = 0; i < ll; i++) {
    out += hexByte(buf[4 + i] ?? 0, uppercase);
  }
  out += hexByte(cc, uppercase);
  return out;
}

/**
 * Encodes binary segment(s) or a flat `Uint8Array` into Intel HEX (I8HEX / I16HEX / I32HEX).
 */
export function encodeIhex(input: readonly IhexInputSegment[] | Uint8Array, options: IhexEncodeOptions = {}): string {
  const segments: IhexInputSegment[] =
    input instanceof Uint8Array
      ? [{ address: 0, data: input }]
      : [...input].sort((a, b) => (a.address >>> 0) - (b.address >>> 0));

  const bytesPerLine = Math.max(1, Math.min(255, Math.floor(options.bytesPerLine ?? 16)));
  const lineEnding = options.lineEnding ?? "\n";
  const uppercase = options.uppercase ?? true;

  // Determine highest end address to auto-select format if not explicitly provided
  let highestAddr = 0;
  for (const seg of segments) {
    if (seg.data.length > 0) {
      const end = (seg.address >>> 0) + seg.data.length - 1;
      if (end > highestAddr) highestAddr = end;
    }
  }

  let format: IhexFormat = options.format ?? "I8HEX";
  if (!options.format) {
    if (options.startLinearAddress !== undefined || highestAddr > 0xfffff) {
      format = "I32HEX";
    } else if (options.startSegmentAddress !== undefined || highestAddr > 0xffff) {
      format = "I32HEX";
    } else {
      format = "I8HEX";
    }
  }

  const lines: string[] = [];
  let currentUpper16 = -1;
  let currentSegment = -1;

  for (const seg of segments) {
    const startAddr = seg.address >>> 0;
    let pos = 0;

    while (pos < seg.data.length) {
      const curAddr = (startAddr + pos) >>> 0;

      if (format === "I32HEX") {
        const upper16 = (curAddr >>> 16) & 0xffff;
        const low16 = curAddr & 0xffff;
        if (upper16 !== currentUpper16 && (upper16 !== 0 || currentUpper16 !== -1)) {
          lines.push(
            formatIhexRecord(
              IhexRecordType.ExtendedLinearAddress,
              0x0000,
              [(upper16 >>> 8) & 0xff, upper16 & 0xff],
              uppercase,
            ),
          );
          currentUpper16 = upper16;
        }
        // Do not cross 64 KiB boundary in a single data record
        const maxInPage = 0x10000 - low16;
        const chunkLen = Math.min(bytesPerLine, seg.data.length - pos, maxInPage);
        const chunk = seg.data.subarray(pos, pos + chunkLen);
        lines.push(formatIhexRecord(IhexRecordType.Data, low16, chunk, uppercase));
        pos += chunkLen;
      } else if (format === "I16HEX") {
        const segBase = (curAddr >>> 4) & 0xf000; // 64 KiB aligned segment paragraph
        const offset16 = (curAddr - (segBase << 4)) & 0xffff;
        if (segBase !== currentSegment && (segBase !== 0 || currentSegment !== -1)) {
          lines.push(
            formatIhexRecord(
              IhexRecordType.ExtendedSegmentAddress,
              0x0000,
              [(segBase >>> 8) & 0xff, segBase & 0xff],
              uppercase,
            ),
          );
          currentSegment = segBase;
        }
        const maxInSeg = 0x10000 - offset16;
        const chunkLen = Math.min(bytesPerLine, seg.data.length - pos, maxInSeg);
        const chunk = seg.data.subarray(pos, pos + chunkLen);
        lines.push(formatIhexRecord(IhexRecordType.Data, offset16, chunk, uppercase));
        pos += chunkLen;
      } else {
        // I8HEX (16-bit addressing)
        const low16 = curAddr & 0xffff;
        const maxInPage = 0x10000 - low16;
        const chunkLen = Math.min(bytesPerLine, seg.data.length - pos, maxInPage);
        const chunk = seg.data.subarray(pos, pos + chunkLen);
        lines.push(formatIhexRecord(IhexRecordType.Data, low16, chunk, uppercase));
        pos += chunkLen;
      }
    }
  }

  if (options.startSegmentAddress !== undefined) {
    const { cs, ip } = options.startSegmentAddress;
    lines.push(
      formatIhexRecord(
        IhexRecordType.StartSegmentAddress,
        0x0000,
        [(cs >>> 8) & 0xff, cs & 0xff, (ip >>> 8) & 0xff, ip & 0xff],
        uppercase,
      ),
    );
  }

  if (options.startLinearAddress !== undefined) {
    const eip = options.startLinearAddress >>> 0;
    lines.push(
      formatIhexRecord(
        IhexRecordType.StartLinearAddress,
        0x0000,
        [(eip >>> 24) & 0xff, (eip >>> 16) & 0xff, (eip >>> 8) & 0xff, eip & 0xff],
        uppercase,
      ),
    );
  }

  // Always terminate with End-Of-File record
  lines.push(formatIhexRecord(IhexRecordType.Eof, 0x0000, [], uppercase));
  return lines.join(lineEnding) + lineEnding;
}

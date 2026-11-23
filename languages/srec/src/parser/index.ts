// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Motorola S-Record (SREC) lossless parser and encoder.
 *
 * Supports `S0` (Header), `S1`/`S2`/`S3` (16/24/32-bit Data), `S5`/`S6` (16/24-bit Record Count),
 * and `S7`/`S8`/`S9` (32/24/16-bit Start Address Termination) with 1's-complement checksums.
 */

import type {
  SrecDataRecordType,
  SrecEncodeOptions,
  SrecFile,
  SrecMemoryRegion,
  SrecParseError,
  SrecRecord,
  SrecRecordType,
  SrecTermRecordType,
} from "../types.js";

const HEX_RE = /^[0-9A-Fa-f]+$/;

/**
 * Returns the address/count field width in bytes for a given Motorola S-Record type.
 */
export function addressBytesForRecordType(type: SrecRecordType): number {
  switch (type) {
    case "S0":
    case "S1":
    case "S5":
    case "S9":
      return 2;
    case "S2":
    case "S6":
    case "S8":
      return 3;
    case "S3":
    case "S7":
      return 4;
    case "S4":
      return 2;
  }
}

/**
 * Computes the Motorola S-Record 1's-complement checksum over
 * `byteCount`, `address` (big-endian `addressBytes`), and `data` bytes.
 */
export function computeSrecChecksum(
  byteCount: number,
  address: number,
  addressBytes: number,
  data: Uint8Array,
): number {
  let sum = byteCount & 0xff;
  const addrUnsigned = address >>> 0;
  for (let i = addressBytes - 1; i >= 0; i--) {
    sum += (addrUnsigned >>> (i * 8)) & 0xff;
  }
  for (let i = 0; i < data.length; i++) {
    sum += data[i]! & 0xff;
  }
  return ~sum & 0xff;
}

/**
 * Decodes an `S0` header payload as printable ASCII text.
 */
export function decodeHeaderAscii(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!;
    if (b === 0) break;
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return out;
}

function toHex(value: number, digits: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, "0");
}

/**
 * Formats a single Motorola S-Record line with computed byte count and 1's-complement checksum.
 */
export function formatSrecRecord(type: SrecRecordType, address: number, data: Uint8Array = new Uint8Array(0)): string {
  const addrBytes = addressBytesForRecordType(type);
  const byteCount = addrBytes + data.length + 1;
  if (byteCount > 0xff) {
    throw new RangeError(`S-Record byte count ${byteCount} exceeds maximum 255`);
  }
  const checksum = computeSrecChecksum(byteCount, address, addrBytes, data);
  let hexPayload = "";
  for (let i = 0; i < data.length; i++) {
    hexPayload += toHex(data[i]!, 2);
  }
  return `${type}${toHex(byteCount, 2)}${toHex(address, addrBytes * 2)}${hexPayload}${toHex(checksum, 2)}`;
}

/**
 * Parses Motorola S-Record text into a structured `SrecFile`.
 */
export function parseSrec(text: string, name: string = "firmware.srec"): SrecFile {
  const records: SrecRecord[] = [];
  const parseErrors: SrecParseError[] = [];

  let headerText: string | undefined;
  let startAddress: number | undefined;
  let terminationType: SrecTermRecordType | undefined;
  let declaredRecordCount: number | undefined;
  let dataRecordCount = 0;
  let totalDataBytes = 0;

  let offset = 0;
  let lineNum = 0;
  const len = text.length;

  while (offset <= len) {
    const nlIdx = text.indexOf("\n", offset);
    const lineEnd = nlIdx === -1 ? len : nlIdx;
    const rawLine = text.slice(offset, lineEnd);
    const trimmed = rawLine.replace(/\r$/, "").trim();
    lineNum++;

    if (trimmed.length > 0) {
      const startOffset = offset;
      const endOffset = lineEnd;

      if (!trimmed.startsWith("S") && !trimmed.startsWith("s")) {
        parseErrors.push({
          line: lineNum,
          column: 1,
          startOffset,
          endOffset,
          raw: trimmed,
          message: `Record must start with 'S', found '${trimmed.slice(0, 8)}'`,
        });
      } else if (trimmed.length < 10) {
        parseErrors.push({
          line: lineNum,
          column: 1,
          startOffset,
          endOffset,
          raw: trimmed,
          message: `Record is too short (${trimmed.length} chars, minimum 10)`,
        });
      } else {
        const typeDigit = trimmed[1]!;
        if (typeDigit < "0" || typeDigit > "9") {
          parseErrors.push({
            line: lineNum,
            column: 2,
            startOffset,
            endOffset,
            raw: trimmed,
            message: `Invalid record type digit '${typeDigit}'`,
          });
        } else {
          const hexBody = trimmed.slice(2);
          if (hexBody.length % 2 !== 0) {
            parseErrors.push({
              line: lineNum,
              column: 3,
              startOffset,
              endOffset,
              raw: trimmed,
              message: `Hex payload has odd character length (${hexBody.length})`,
            });
          } else if (!HEX_RE.test(hexBody)) {
            parseErrors.push({
              line: lineNum,
              column: 3,
              startOffset,
              endOffset,
              raw: trimmed,
              message: `Non-hexadecimal characters in record body`,
            });
          } else {
            const type = `S${typeDigit}` as SrecRecordType;
            const addrBytes = addressBytesForRecordType(type);
            const totalPairs = hexBody.length / 2;

            if (totalPairs < 1 + addrBytes + 1) {
              parseErrors.push({
                line: lineNum,
                column: 1,
                startOffset,
                endOffset,
                raw: trimmed,
                message: `Record '${type}' requires at least ${addrBytes + 2} bytes (count + ${addrBytes}-byte address + checksum)`,
              });
            } else {
              const byteCount = parseInt(hexBody.slice(0, 2), 16);
              const actualCount = totalPairs - 1; // bytes after the byteCount byte
              const addrHex = hexBody.slice(2, 2 + addrBytes * 2);
              const address = parseInt(addrHex, 16) >>> 0;
              const dataHexStart = 2 + addrBytes * 2;
              const dataHexEnd = hexBody.length - 2;
              const dataLen = Math.max(0, (dataHexEnd - dataHexStart) / 2);
              const data = new Uint8Array(dataLen);
              for (let i = 0; i < dataLen; i++) {
                data[i] = parseInt(hexBody.slice(dataHexStart + i * 2, dataHexStart + i * 2 + 2), 16);
              }
              const checksum = parseInt(hexBody.slice(dataHexEnd), 16);
              const computedChecksum = computeSrecChecksum(byteCount, address, addrBytes, data);
              const byteCountValid = byteCount === actualCount;
              const checksumValid = checksum === computedChecksum;

              const rec: SrecRecord = {
                line: lineNum,
                startOffset,
                endOffset,
                raw: trimmed,
                type,
                addressBytes: addrBytes,
                byteCount,
                address,
                data,
                checksum,
                computedChecksum,
                checksumValid,
                byteCountValid,
              };
              records.push(rec);

              if (type === "S0" && headerText === undefined) {
                headerText = decodeHeaderAscii(data);
              } else if (type === "S1" || type === "S2" || type === "S3") {
                dataRecordCount++;
                totalDataBytes += data.length;
              } else if (type === "S5" || type === "S6") {
                declaredRecordCount = address;
              } else if (type === "S7" || type === "S8" || type === "S9") {
                terminationType = type;
                startAddress = address;
              }
            }
          }
        }
      }
    }

    if (nlIdx === -1) break;
    offset = nlIdx + 1;
  }

  return {
    name: headerText && headerText.trim().length > 0 ? headerText.trim() : name,
    headerText,
    records,
    parseErrors,
    startAddress,
    terminationType,
    declaredRecordCount,
    dataRecordCount,
    totalDataBytes,
  };
}

/**
 * Selects the appropriate data record type (`S1`, `S2`, or `S3`) for the given maximum address.
 */
function pickDataRecordType(
  maxEndAddress: number,
  requested: SrecDataRecordType | "auto" = "auto",
): SrecDataRecordType {
  if (requested !== "auto") return requested;
  if (maxEndAddress <= 0xffff) return "S1";
  if (maxEndAddress <= 0xffffff) return "S2";
  return "S3";
}

function terminationForDataType(dataType: SrecDataRecordType): SrecTermRecordType {
  if (dataType === "S1") return "S9";
  if (dataType === "S2") return "S8";
  return "S7";
}

/**
 * Encodes memory regions (or a parsed `SrecFile`) into canonical Motorola S-Record text.
 */
export function encodeSrec(
  input: Array<{ startAddress: number; data: Uint8Array }> | SrecMemoryRegion[] | SrecFile,
  options: SrecEncodeOptions = {},
): string {
  const regions: Array<{ startAddress: number; data: Uint8Array }> = Array.isArray(input)
    ? input
    : input.records
        .filter((r) => r.type === "S1" || r.type === "S2" || r.type === "S3")
        .map((r) => ({ startAddress: r.address, data: r.data }));

  const header = options.header ?? (!Array.isArray(input) ? input.headerText : undefined);
  const bytesPerLine = Math.max(1, Math.min(250, options.bytesPerLine ?? 16));
  const includeRecordCount = options.includeRecordCount ?? true;
  const lineEnding = options.lineEnding ?? "\n";

  let maxAddr = 0;
  for (const r of regions) {
    if (r.data.length > 0) {
      const end = (r.startAddress >>> 0) + r.data.length - 1;
      if (end > maxAddr) maxAddr = end;
    }
  }
  const explicitStart = options.startAddress ?? (!Array.isArray(input) ? input.startAddress : undefined);
  if (explicitStart !== undefined && explicitStart >>> 0 > maxAddr) {
    maxAddr = explicitStart >>> 0;
  }

  const dataType = pickDataRecordType(maxAddr, options.dataRecordType ?? "auto");
  const termType = terminationForDataType(dataType);

  const lines: string[] = [];

  // S0 Header
  if (header !== undefined) {
    const hdrBytes = new Uint8Array(header.length);
    for (let i = 0; i < header.length; i++) {
      hdrBytes[i] = header.charCodeAt(i) & 0xff;
    }
    lines.push(formatSrecRecord("S0", 0x0000, hdrBytes));
  }

  // S1 / S2 / S3 Data Records
  let dataRecCount = 0;
  for (const region of regions) {
    let cursor = 0;
    while (cursor < region.data.length) {
      const chunkLen = Math.min(bytesPerLine, region.data.length - cursor);
      const chunk = region.data.subarray(cursor, cursor + chunkLen);
      const addr = ((region.startAddress >>> 0) + cursor) >>> 0;
      lines.push(formatSrecRecord(dataType, addr, chunk));
      dataRecCount++;
      cursor += chunkLen;
    }
  }

  // S5 / S6 Record Count
  if (includeRecordCount) {
    const countType = dataRecCount <= 0xffff ? "S5" : "S6";
    lines.push(formatSrecRecord(countType, dataRecCount));
  }

  // S7 / S8 / S9 Start Address Termination
  const startAddr = explicitStart ?? (regions.length > 0 ? regions[0]!.startAddress : 0);
  lines.push(formatSrecRecord(termType, startAddr >>> 0));

  return lines.join(lineEnding) + lineEnding;
}

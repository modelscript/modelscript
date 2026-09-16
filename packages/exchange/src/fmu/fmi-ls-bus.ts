// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI Layered Standard for Network Communication (FMI-LS-BUS).
 *
 * Implements the Modelica Association FMI-LS-BUS standard:
 *   1. Data model for bus, frame, and signal definitions (CAN, CAN-FD, LIN, Ethernet).
 *   2. XML generator for `fmi-ls-bus.xml` manifests bundled in FMU archives.
 *   3. Bit-level frame codec (Intel/Motorola byte orders, scaling, bit offsets)
 *      to pack Modelica variables into raw network frames and unpack incoming frames.
 */

import { type DAEBuilder, ExprKind } from "@modelscript/runtime";

// ── Types and Interfaces ──

export type BusType = "CAN" | "CAN-FD" | "LIN" | "FlexRay" | "Ethernet";
export type ByteOrder = "littleEndian" | "bigEndian"; // littleEndian = Intel, bigEndian = Motorola
export type SignalDataType =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int8"
  | "int16"
  | "int32"
  | "float32"
  | "float64"
  | "boolean";

export interface FmiLsBusSignal {
  /** Signal name matching a Modelica / FMI variable name. */
  name: string;
  /** FMI ValueReference of the scalar variable. */
  valueReference: number;
  /** Start bit within the frame (0-indexed). */
  startBit: number;
  /** Bit length of the signal. */
  bitLength: number;
  /** Byte order (Intel / Motorola). Default: "littleEndian". */
  byteOrder?: ByteOrder;
  /** Data representation. Default: "uint32" or auto-detected from bitLength. */
  dataType?: SignalDataType;
  /** Linear scale factor (physical = raw * factor + offset). Default: 1.0. */
  factor?: number;
  /** Linear offset. Default: 0.0. */
  offset?: number;
  /** Minimum physical value. */
  min?: number;
  /** Maximum physical value. */
  max?: number;
  /** Physical engineering unit (e.g. "km/h", "rpm", "V"). */
  unit?: string;
  /** Human-readable description. */
  description?: string;
}

export interface FmiLsBusFrame {
  /** Frame name (e.g., "EngineState", "BMS_Status"). */
  name: string;
  /** Numeric frame identifier (e.g., 0x120 or 288). */
  id: number;
  /** Whether this is an extended 29-bit CAN identifier (false = 11-bit standard). */
  isExtended?: boolean;
  /** Frame payload length in bytes (DLC). Default: 8 for CAN, up to 64 for CAN-FD. */
  length: number;
  /** Periodic transmission cycle time in seconds (e.g., 0.01 for 10ms). */
  cycleTime?: number;
  /** List of signals packed into this frame. */
  signals: FmiLsBusSignal[];
  /** Optional FMI binary variable valueReference if the raw frame is exposed directly. */
  binaryValueReference?: number;
}

export interface FmiLsBusDefinition {
  /** Bus name (e.g., "PowertrainCAN", "BodyCAN"). */
  name: string;
  /** Network bus type. */
  type: BusType;
  /** Baud rate in bits per second (e.g., 500000 for 500 kbit/s CAN). */
  baudRate?: number;
  /** CAN-FD data phase baud rate (e.g. 2000000 for 2 Mbit/s). */
  dataBaudRate?: number;
  /** List of frames defined on this bus. */
  frames: FmiLsBusFrame[];
}

export interface FmiLsBusManifest {
  /** Specification version. Default: "1.0.0". */
  version: string;
  /** Buses defined in this manifest. */
  buses: FmiLsBusDefinition[];
}

// ── XML Manifest Generation ──

/**
 * Generates standard `fmi-ls-bus.xml` content according to FMI-LS-BUS 1.0.
 */
export function generateFmiLsBusXml(manifest: FmiLsBusManifest): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<fmi-ls-bus version="${escapeXml(manifest.version || "1.0.0")}" ` +
      'xmlns="http://fmi-standard.org/fmi-ls-bus" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  );

  lines.push("  <Buses>");
  for (const bus of manifest.buses) {
    let busAttr = `name="${escapeXml(bus.name)}" type="${bus.type}"`;
    if (bus.baudRate !== undefined) busAttr += ` baudRate="${bus.baudRate}"`;
    if (bus.dataBaudRate !== undefined) busAttr += ` dataBaudRate="${bus.dataBaudRate}"`;
    lines.push(`    <Bus ${busAttr}>`);
    lines.push("      <Frames>");

    for (const frame of bus.frames) {
      let frameAttr = `name="${escapeXml(frame.name)}" id="${frame.id}" length="${frame.length}"`;
      if (frame.isExtended) frameAttr += ` isExtended="true"`;
      if (frame.cycleTime !== undefined) frameAttr += ` cycleTime="${frame.cycleTime}"`;
      if (frame.binaryValueReference !== undefined) {
        frameAttr += ` binaryValueReference="${frame.binaryValueReference}"`;
      }
      lines.push(`        <Frame ${frameAttr}>`);
      lines.push("          <Signals>");

      for (const sig of frame.signals) {
        let sigAttr = `name="${escapeXml(sig.name)}" valueReference="${sig.valueReference}" startBit="${sig.startBit}" bitLength="${sig.bitLength}"`;
        if (sig.byteOrder) sigAttr += ` byteOrder="${sig.byteOrder}"`;
        if (sig.dataType) sigAttr += ` dataType="${sig.dataType}"`;
        if (sig.factor !== undefined && sig.factor !== 1.0) sigAttr += ` factor="${sig.factor}"`;
        if (sig.offset !== undefined && sig.offset !== 0.0) sigAttr += ` offset="${sig.offset}"`;
        if (sig.min !== undefined) sigAttr += ` min="${sig.min}"`;
        if (sig.max !== undefined) sigAttr += ` max="${sig.max}"`;
        if (sig.unit) sigAttr += ` unit="${escapeXml(sig.unit)}"`;
        if (sig.description) sigAttr += ` description="${escapeXml(sig.description)}"`;
        lines.push(`            <Signal ${sigAttr} />`);
      }

      lines.push("          </Signals>");
      lines.push("        </Frame>");
    }

    lines.push("      </Frames>");
    lines.push("    </Bus>");
  }
  lines.push("  </Buses>");
  lines.push("</fmi-ls-bus>");

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Bit-Level Frame Codec (FmiLsBusCodec) ──

/**
 * Bit-level encoder/decoder for network frames (CAN, LIN, etc.).
 * Handles Intel (little-endian) and Motorola (big-endian) bit extraction,
 * scaling, offsets, and type casting.
 */
export class FmiLsBusCodec {
  /**
   * Pack multiple named signal values into a raw byte buffer (frame payload).
   */
  static packFrame(frame: FmiLsBusFrame, values: Map<string, number> | Record<string, number>): Uint8Array {
    const buffer = new Uint8Array(frame.length);
    const getVal = (name: string): number | undefined => {
      if (values instanceof Map) return values.get(name);
      return values[name];
    };

    for (const sig of frame.signals) {
      const physVal = getVal(sig.name);
      if (physVal === undefined) continue;

      const factor = sig.factor ?? 1.0;
      const offset = sig.offset ?? 0.0;
      const rawVal = Math.round((physVal - offset) / factor);

      this.writeBits(buffer, rawVal, sig.startBit, sig.bitLength, sig.byteOrder ?? "littleEndian", sig.dataType);
    }

    return buffer;
  }

  /**
   * Unpack a raw byte buffer into physical signal values.
   */
  static unpackFrame(frame: FmiLsBusFrame, buffer: Uint8Array): Map<string, number> {
    const result = new Map<string, number>();

    for (const sig of frame.signals) {
      const rawVal = this.readBits(buffer, sig.startBit, sig.bitLength, sig.byteOrder ?? "littleEndian", sig.dataType);
      const factor = sig.factor ?? 1.0;
      const offset = sig.offset ?? 0.0;
      const physVal = rawVal * factor + offset;

      result.set(sig.name, physVal);
    }

    return result;
  }

  // ── Bit manipulation primitives ──

  /**
   * Write an integer raw value into buffer at given startBit and bitLength.
   */
  static writeBits(
    buffer: Uint8Array,
    value: number,
    startBit: number,
    bitLength: number,
    byteOrder: ByteOrder,
    dataType?: SignalDataType,
  ): void {
    if (bitLength <= 0 || bitLength > 64) return;

    if (dataType === "float32") {
      const fview = new DataView(new ArrayBuffer(4));
      fview.setFloat32(0, value, byteOrder === "littleEndian");
      value = fview.getUint32(0, byteOrder === "littleEndian");
    }

    let uVal = BigInt(Math.trunc(value));
    const mask = (1n << BigInt(bitLength)) - 1n;
    uVal = uVal & mask;

    if (byteOrder === "littleEndian") {
      // Intel byte order: startBit is LSB
      for (let i = 0; i < bitLength; i++) {
        const bit = Number((uVal >> BigInt(i)) & 1n);
        const currBit = startBit + i;
        const byteIdx = Math.floor(currBit / 8);
        const bitInByte = currBit % 8;
        if (byteIdx < buffer.length) {
          if (bit === 1) {
            buffer[byteIdx] |= 1 << bitInByte;
          } else {
            buffer[byteIdx] &= ~(1 << bitInByte);
          }
        }
      }
    } else {
      // Motorola byte order (MSB-first): startBit is MSB
      let currBit = startBit;
      for (let i = 0; i < bitLength; i++) {
        const bit = Number((uVal >> BigInt(bitLength - 1 - i)) & 1n);
        const byteIdx = Math.floor(currBit / 8);
        const bitInByte = currBit % 8;
        if (byteIdx < buffer.length) {
          if (bit === 1) {
            buffer[byteIdx] |= 1 << bitInByte;
          } else {
            buffer[byteIdx] &= ~(1 << bitInByte);
          }
        }
        if (currBit % 8 === 0) {
          currBit += 15;
        } else {
          currBit -= 1;
        }
      }
    }
  }

  /**
   * Read raw value from buffer at given startBit and bitLength.
   */
  static readBits(
    buffer: Uint8Array,
    startBit: number,
    bitLength: number,
    byteOrder: ByteOrder,
    dataType?: SignalDataType,
  ): number {
    if (bitLength <= 0 || bitLength > 64) return 0;

    let uVal = 0n;

    if (byteOrder === "littleEndian") {
      for (let i = 0; i < bitLength; i++) {
        const currBit = startBit + i;
        const byteIdx = Math.floor(currBit / 8);
        const bitInByte = currBit % 8;
        if (byteIdx < buffer.length) {
          const bit = (buffer[byteIdx] >> bitInByte) & 1;
          if (bit === 1) {
            uVal |= 1n << BigInt(i);
          }
        }
      }
    } else {
      let currBit = startBit;
      for (let i = 0; i < bitLength; i++) {
        const byteIdx = Math.floor(currBit / 8);
        const bitInByte = currBit % 8;
        if (byteIdx < buffer.length) {
          const bit = (buffer[byteIdx] >> bitInByte) & 1;
          if (bit === 1) {
            uVal |= 1n << BigInt(bitLength - 1 - i);
          }
        }
        if (currBit % 8 === 0) {
          currBit += 15;
        } else {
          currBit -= 1;
        }
      }
    }

    if (dataType === "float32" && bitLength === 32) {
      const fview = new DataView(new ArrayBuffer(4));
      fview.setUint32(0, Number(uVal), byteOrder === "littleEndian");
      return fview.getFloat32(0, byteOrder === "littleEndian");
    }

    const isSigned = dataType?.startsWith("int") ?? false;
    if (isSigned) {
      const signBit = 1n << BigInt(bitLength - 1);
      if ((uVal & signBit) !== 0n) {
        // Sign extend negative number
        const fullMask = (1n << BigInt(bitLength)) - 1n;
        return -Number((~uVal & fullMask) + 1n);
      }
    }

    return Number(uVal);
  }
}

/**
 * Automatically extracts bus, frame, and signal definitions from DAE variable attributes
 * or vendor annotations to construct an FmiLsBusManifest.
 *
 * Recognized variable attributes:
 *   - __bus_name: string (default: "CAN0")
 *   - __bus_type: "CAN" | "CAN-FD" | "LIN" | "Ethernet" (default: "CAN")
 *   - __frame_id / __can_id: integer (e.g. 0x120 or 288)
 *   - __frame_name: string (e.g. "EngineStatus")
 *   - __frame_length: integer (default: 8)
 *   - __frame_cycletime: float seconds (e.g. 0.01)
 *   - __signal_startbit: integer (default: auto)
 *   - __signal_bitlength: integer (default: 16)
 *   - __signal_byteorder: "littleEndian" | "bigEndian"
 *   - __signal_factor: float (default: 1.0)
 *   - __signal_offset: float (default: 0.0)
 *   - __signal_datatype: SignalDataType
 */
export function extractBusManifestFromDae(dae: DAEBuilder, defaultBusName = "CAN0"): FmiLsBusManifest {
  const busMap = new Map<string, { type: BusType; baudRate?: number; frames: Map<number, FmiLsBusFrame> }>();

  const resolveExprVal = (exprId: number): number | string | undefined => {
    if (exprId < 0) return undefined;
    const kind = dae.getExprKind(exprId);
    if (kind === ExprKind.IntLiteral) return dae.getExprData1(exprId);
    if (kind === ExprKind.RealLiteral) return dae.getExprRealValue(exprId);
    if (kind === ExprKind.StringLiteral) return dae.interner.resolve(dae.getExprData1(exprId));
    if (kind === ExprKind.BoolLiteral) return dae.getExprData1(exprId) !== 0 ? 1 : 0;
    return undefined;
  };

  for (let varIdx = 0; varIdx < dae.varCount; varIdx++) {
    const varName = dae.getVarName(varIdx);
    if (!varName) continue;

    const attrs = dae.getVarAttrExprIds(varIdx);
    if (!attrs) continue;

    const getAttr = (names: string[]): number | string | undefined => {
      for (const n of names) {
        if (attrs.has(n)) {
          const val = resolveExprVal(attrs.get(n)!);
          if (val !== undefined) return val;
        }
      }
      return undefined;
    };

    // Check if this variable has CAN / bus frame attributes
    const rawFrameId = getAttr(["__frame_id", "__can_id", "frameId", "frame_id", "id", "can_id"]);
    if (rawFrameId === undefined) continue;
    const frameId = Number(rawFrameId);
    if (isNaN(frameId)) continue;

    // Bus definition
    const busName = String(getAttr(["__bus_name", "busName", "bus_name"]) || defaultBusName);
    const busType = String(getAttr(["__bus_type", "busType", "bus_type"]) || "CAN") as BusType;

    if (!busMap.has(busName)) {
      busMap.set(busName, { type: busType, frames: new Map() });
    }
    const busDef = busMap.get(busName)!;

    // Frame definition
    let frameDef = busDef.frames.get(frameId);
    if (!frameDef) {
      let frameName = `Frame_0x${frameId.toString(16).toUpperCase()}`;
      const rawFrameName = getAttr(["__frame_name", "frameName", "frame_name"]);
      if (rawFrameName) frameName = String(rawFrameName);

      const rawLength = getAttr(["__frame_length", "length", "frame_length", "dlc"]);
      const length = rawLength ? Number(rawLength) : 8;

      const rawCycleTime = getAttr(["__frame_cycletime", "cycleTime", "cycle_time", "period"]);
      const cycleTime = rawCycleTime ? Number(rawCycleTime) : undefined;
      const isExtended = frameId > 0x7ff;

      frameDef = {
        name: frameName,
        id: frameId,
        isExtended,
        length,
        cycleTime,
        signals: [],
      };
      busDef.frames.set(frameId, frameDef);
    }

    // Signal definition
    const rawStartBit = getAttr(["__signal_startbit", "startBit", "startbit", "start_bit"]);
    const startBit = rawStartBit !== undefined ? Number(rawStartBit) : frameDef.signals.length * 16;

    const rawBitLength = getAttr(["__signal_bitlength", "bitLength", "bitlength", "bit_length", "length"]);
    const bitLength = rawBitLength !== undefined ? Number(rawBitLength) : 16;

    const rawByteOrder = getAttr(["__signal_byteorder", "byteOrder", "byteorder", "endian"]);
    const byteOrder = (rawByteOrder ? String(rawByteOrder) : "littleEndian") as ByteOrder;

    const rawFactor = getAttr(["__signal_factor", "factor", "scale"]);
    const factor = rawFactor !== undefined ? Number(rawFactor) : 1.0;

    const rawOffset = getAttr(["__signal_offset", "offset"]);
    const offset = rawOffset !== undefined ? Number(rawOffset) : 0.0;

    const rawDataType = getAttr(["__signal_datatype", "dataType", "datatype", "type"]);
    let dataType = (rawDataType ? String(rawDataType) : undefined) as SignalDataType;
    if (!dataType) {
      if (bitLength <= 8) dataType = "uint8";
      else if (bitLength <= 16) dataType = "uint16";
      else if (bitLength <= 32) dataType = "uint32";
      else dataType = "uint32";
    }

    frameDef.signals.push({
      name: varName,
      valueReference: varIdx,
      startBit,
      bitLength,
      byteOrder,
      factor,
      offset,
      dataType,
    });
  }

  const buses: FmiLsBusDefinition[] = [];
  for (const [name, bus] of busMap) {
    buses.push({
      name,
      type: bus.type,
      baudRate: bus.baudRate ?? 500000,
      frames: Array.from(bus.frames.values()),
    });
  }

  return {
    version: "1.0.0",
    buses,
  };
}

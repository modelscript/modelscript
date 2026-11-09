// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for Telcordia/Bellcore Standard Optical Report (*.sor) binary files.
 * Compliant with GR-196-CORE and SR-4731 (Rev 1.0 & 2.0).
 */

import type {
  SorBlockInfo,
  SorDataPoints,
  SorDocument,
  SorEventType,
  SorFxdParams,
  SorGenParams,
  SorKeyEvent,
  SorSupParams,
  SorVersion,
} from "./sor-types.js";

const SPEED_OF_LIGHT = 299792458; // m/s

class BinaryReader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.view = new DataView(buffer);
    }
  }

  get position(): number {
    return this.offset;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.view.byteLength) {
      throw new Error(`Seek out of bounds: ${pos} (length: ${this.view.byteLength})`);
    }
    this.offset = pos;
  }

  remaining(): number {
    return this.view.byteLength - this.offset;
  }

  readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt8(): number {
    const val = this.view.getInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16(): number {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readInt16(): number {
    const val = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint32(): number {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readInt32(): number {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readStringNullTerminated(): string {
    const start = this.offset;
    while (this.offset < this.view.byteLength && this.view.getUint8(this.offset) !== 0) {
      this.offset++;
    }
    const len = this.offset - start;
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + start, len);
    if (this.offset < this.view.byteLength) {
      this.offset++; // Skip the null terminator
    }
    return new TextDecoder("latin1").decode(bytes);
  }

  readFixedString(length: number): string {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new TextDecoder("latin1").decode(bytes).replace(/\0+$/, "");
  }
}

export function parseSor(data: ArrayBuffer | Uint8Array): SorDocument {
  const reader = new BinaryReader(data);

  // 1. Read Map block header
  const mapName = reader.readStringNullTerminated();
  if (mapName !== "Map") {
    throw new Error(`Invalid SOR file: expected Map block header, found '${mapName}'`);
  }

  const mapRev = reader.readUint16();
  const mapSize = reader.readInt32();
  const numBlocks = reader.readInt16();

  const version: SorVersion = mapRev >= 200 ? "2.0" : "1.0";
  const blocks: SorBlockInfo[] = [{ name: "Map", revision: mapRev, size: mapSize }];
  const blockOffsets = new Map<string, { offset: number; size: number; revision: number }>();

  let cumulativeOffset = mapSize;
  for (let i = 0; i < numBlocks; i++) {
    const bName = reader.readStringNullTerminated();
    const bRev = reader.readUint16();
    const bSize = reader.readInt32();
    blocks.push({ name: bName, revision: bRev, size: bSize });
    blockOffsets.set(bName, { offset: cumulativeOffset, size: bSize, revision: bRev });
    cumulativeOffset += bSize;
  }

  // Helper to seek to a block
  function seekToBlock(name: string): boolean {
    const info = blockOffsets.get(name);
    if (!info) return false;
    reader.seek(info.offset);
    const header = reader.readStringNullTerminated();
    if (header !== name) {
      // Some vendors omit header inside block or include variation; rewind
      reader.seek(info.offset);
    }
    return true;
  }

  // 2. Parse GenParams
  let genParams: SorGenParams = {
    cableId: "",
    fiberId: "",
    fiberType: "G.652",
    nominalWavelengthNm: 1550,
    originLocation: "",
    terminateLocation: "",
    cableCode: "",
    currentCondition: "BC",
    operator: "",
    comments: "",
  };

  if (seekToBlock("GenParams")) {
    reader.readFixedString(2); // lang
    const cableId = reader.readStringNullTerminated();
    const fiberId = reader.readStringNullTerminated();
    const fiberTypeRaw = reader.readFixedString(4);
    const nominalWavelength = reader.readInt16();
    const originLocation = reader.readStringNullTerminated();
    const terminateLocation = reader.readStringNullTerminated();
    const cableCode = reader.readStringNullTerminated();
    const currentCondition = reader.readFixedString(2);
    const userOperator = reader.readStringNullTerminated();
    const comments = reader.readStringNullTerminated();

    genParams = {
      cableId,
      fiberId,
      fiberType: fiberTypeRaw || "G.652",
      nominalWavelengthNm: nominalWavelength > 0 ? nominalWavelength : 1550,
      originLocation,
      terminateLocation,
      cableCode,
      currentCondition,
      operator: userOperator,
      comments,
    };
  }

  // 3. Parse SupParams
  let supParams: SorSupParams = {
    supplierName: "",
    otdrName: "",
    otdrSerialNumber: "",
    moduleName: "",
    moduleSerialNumber: "",
    softwareVersion: "",
  };

  if (seekToBlock("SupParams")) {
    const supplierName = reader.readStringNullTerminated();
    const otdrName = reader.readStringNullTerminated();
    const otdrSerialNumber = reader.readStringNullTerminated();
    const moduleName = reader.readStringNullTerminated();
    const moduleSerialNumber = reader.readStringNullTerminated();
    const softwareVersion = reader.readStringNullTerminated();

    supParams = {
      supplierName,
      otdrName,
      otdrSerialNumber,
      moduleName,
      moduleSerialNumber,
      softwareVersion,
    };
  }

  // 4. Parse FxdParams
  let fxdParams: SorFxdParams = {
    dateTime: new Date(),
    distanceUnits: "km",
    actualWavelengthNm: 1550,
    acquisitionOffset: 0,
    pulseWidthNs: 100,
    sampleSpacingNs: 1.0,
    numPoints: 0,
    refractiveIndex: 1.4682,
    backscatterCoefficientDb: -79.0,
    numAverages: 1000,
    rangeKm: 20.0,
    frontPanelLossDb: 0.0,
  };

  if (seekToBlock("FxdParams")) {
    const epochSec = reader.readUint32();
    const distanceUnitsRaw = reader.readFixedString(2);
    const actualWavelengthRaw = reader.readUint16();
    const acqOffset = reader.readInt32();
    reader.readInt32(); // acqOffsetDist
    reader.readInt16(); // numPulses
    const pulseWidth = reader.readUint16();
    const sampleSpacingRaw = reader.readInt32();
    const numDataPoints = reader.readUint32();
    const groupIndexRaw = reader.readInt32();
    const backscatterRaw = reader.readInt16();
    const numAverages = reader.readUint32();
    reader.readUint16(); // avgTime
    const rangeRaw = reader.readUint32();
    const frontPanelLoss = reader.readInt32();

    const distanceUnits = (["km", "mt", "mi", "kf"].includes(distanceUnitsRaw) ? distanceUnitsRaw : "km") as
      | "km"
      | "mt"
      | "mi"
      | "kf";

    fxdParams = {
      dateTime: epochSec > 0 ? new Date(epochSec * 1000) : new Date(),
      distanceUnits,
      actualWavelengthNm: actualWavelengthRaw > 0 ? actualWavelengthRaw / 10 : 1550,
      acquisitionOffset: acqOffset,
      pulseWidthNs: pulseWidth,
      sampleSpacingNs: sampleSpacingRaw > 0 ? sampleSpacingRaw * 1e-4 : 1.0, // Scaled by 10000
      numPoints: numDataPoints,
      refractiveIndex: groupIndexRaw > 0 ? groupIndexRaw / 100000 : 1.4682,
      backscatterCoefficientDb: backscatterRaw !== 0 ? backscatterRaw / 10 : -79.0,
      numAverages,
      rangeKm: rangeRaw > 0 ? rangeRaw * 1e-4 : 20.0,
      frontPanelLossDb: frontPanelLoss / 1000,
    };
  }

  // 5. Parse DataPts
  let dataPoints: SorDataPoints = {
    numPoints: 0,
    scalingFactor: 1000,
    powerDb: new Float64Array(0),
    distanceMeters: new Float64Array(0),
  };

  if (seekToBlock("DataPts")) {
    const numPts = reader.readInt32();
    reader.readInt16(); // numTraces
    const scaleFactor = reader.readUint16() || 1000;

    const powerDb = new Float64Array(numPts);
    const distanceMeters = new Float64Array(numPts);

    // Physical distance step per sample: d = (c / (2 * n)) * delta_t
    const deltaT = fxdParams.sampleSpacingNs * 1e-9;
    const distancePerSample = (SPEED_OF_LIGHT / (2 * fxdParams.refractiveIndex)) * deltaT;

    for (let i = 0; i < numPts; i++) {
      const rawVal = reader.readUint16();
      // DataPts values are typically decibels scaled by scaleFactor (e.g. 1000)
      powerDb[i] = rawVal / scaleFactor;
      distanceMeters[i] = i * distancePerSample;
    }

    dataPoints = {
      numPoints: numPts,
      scalingFactor: scaleFactor,
      powerDb,
      distanceMeters,
    };
  }

  // 6. Parse KeyEvents
  const keyEvents: SorKeyEvent[] = [];
  if (seekToBlock("KeyEvents")) {
    const numEvents = reader.readInt16();

    for (let i = 0; i < numEvents; i++) {
      const eventNumber = reader.readInt16();
      const propTime = reader.readUint32(); // Propagation time (100 ps or sample index)
      const slopeRaw = reader.readInt16();
      const eventLossRaw = reader.readInt16();
      const reflectanceRaw = reader.readInt16();
      const eventCode = reader.readFixedString(4);
      reader.readFixedString(2); // lossTech
      const leadInLoss = reader.readInt32();
      const comments = reader.readStringNullTerminated();

      // Convert propagation time to distance in meters
      const timeSec = propTime * 1e-10;
      const distMeters = (SPEED_OF_LIGHT / (2 * fxdParams.refractiveIndex)) * timeSec;

      let eventType: SorEventType = "unknown";
      if (reflectanceRaw === -32768 || reflectanceRaw === 0) {
        eventType = "non-reflective";
      } else if (eventCode.startsWith("2") || i === numEvents - 1) {
        eventType = "end-of-fiber";
      } else if (reflectanceRaw !== -32768) {
        eventType = "reflective";
      }

      keyEvents.push({
        eventNumber,
        distanceMeters: distMeters,
        slopeDbPerKm: slopeRaw / 1000,
        eventLossDb: eventLossRaw / 1000,
        reflectanceDb: reflectanceRaw !== -32768 ? reflectanceRaw / 1000 : Number.NEGATIVE_INFINITY,
        eventCode,
        eventType,
        leadInLossDb: leadInLoss / 1000,
        comments,
      });
    }
  }

  // 7. Parse Checksum
  let checksum: number | undefined = undefined;
  if (seekToBlock("Cksum")) {
    checksum = reader.readUint16();
  }

  return createSorDocument(version, blocks, genParams, supParams, fxdParams, dataPoints, keyEvents, checksum);
}

export function createSorDocument(
  version: SorVersion,
  blocks: SorBlockInfo[],
  genParams: SorGenParams,
  supParams: SorSupParams,
  fxdParams: SorFxdParams,
  dataPoints: SorDataPoints,
  keyEvents: SorKeyEvent[],
  checksum?: number,
): SorDocument {
  return {
    version,
    blocks,
    genParams,
    supParams,
    fxdParams,
    dataPoints,
    keyEvents,
    checksum,

    computeTwoPointLoss(startDist: number, endDist: number): number {
      if (dataPoints.numPoints === 0) return 0;
      const idx1 = findClosestSampleIndex(dataPoints.distanceMeters, startDist);
      const idx2 = findClosestSampleIndex(dataPoints.distanceMeters, endDist);
      const p1 = dataPoints.powerDb[idx1] ?? 0;
      const p2 = dataPoints.powerDb[idx2] ?? 0;
      return Math.abs(p1 - p2);
    },

    computeLsaSlope(startDist: number, endDist: number): number {
      if (dataPoints.numPoints === 0) return 0;
      const idx1 = findClosestSampleIndex(dataPoints.distanceMeters, startDist);
      const idx2 = findClosestSampleIndex(dataPoints.distanceMeters, endDist);
      if (idx1 === idx2) return 0;

      const [startIdx, endIdx] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
      const n = endIdx - startIdx + 1;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumX2 = 0;

      for (let i = startIdx; i <= endIdx; i++) {
        const x = (dataPoints.distanceMeters[i] ?? 0) / 1000; // km
        const y = dataPoints.powerDb[i] ?? 0; // dB
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }

      const denominator = n * sumX2 - sumX * sumX;
      if (Math.abs(denominator) < 1e-9) return 0;
      const slope = (n * sumXY - sumX * sumY) / denominator;
      return Math.abs(slope); // dB/km
    },

    totalSpanLossDb(): number {
      if (keyEvents.length > 0) {
        const lastEv = keyEvents[keyEvents.length - 1];
        if (lastEv && lastEv.leadInLossDb > 0) return lastEv.leadInLossDb;
      }
      if (dataPoints.numPoints > 1) {
        const pFirst = dataPoints.powerDb[0] ?? 0;
        const pLast = dataPoints.powerDb[dataPoints.numPoints - 1] ?? 0;
        return Math.abs(pFirst - pLast);
      }
      return 0;
    },

    fiberLengthMeters(): number {
      if (keyEvents.length > 0) {
        const lastEv = keyEvents[keyEvents.length - 1];
        if (lastEv) return lastEv.distanceMeters;
      }
      if (dataPoints.numPoints > 0) {
        return dataPoints.distanceMeters[dataPoints.numPoints - 1] ?? 0;
      }
      return 0;
    },
  };
}

function findClosestSampleIndex(arr: Float64Array, target: number): number {
  if (arr.length === 0) return 0;
  let low = 0;
  let high = arr.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = arr[mid] ?? 0;
    if (midVal === target) return mid;
    if (midVal < target) low = mid + 1;
    else high = mid - 1;
  }

  if (low >= arr.length) return arr.length - 1;
  if (high < 0) return 0;
  const valLow = arr[low] ?? 0;
  const valHigh = arr[high] ?? 0;
  return Math.abs(valLow - target) < Math.abs(valHigh - target) ? low : high;
}

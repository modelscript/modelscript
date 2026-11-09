// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Serializer for Telcordia/Bellcore Standard Optical Report (*.sor) binary files.
 * Compliant with GR-196-CORE and SR-4731.
 */

import type { SorDocument } from "./sor-types.js";

const SPEED_OF_LIGHT = 299792458;

class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 65536) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  get position(): number {
    return this.offset;
  }

  private ensureCapacity(bytes: number): void {
    if (this.offset + bytes > this.buffer.byteLength) {
      let newCapacity = this.buffer.byteLength * 2;
      while (newCapacity < this.offset + bytes) {
        newCapacity *= 2;
      }
      const newBuffer = new Uint8Array(newCapacity);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  writeUint8(val: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, val);
    this.offset += 1;
  }

  writeInt8(val: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, val);
    this.offset += 1;
  }

  writeUint16(val: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, val, true);
    this.offset += 2;
  }

  writeInt16(val: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, val, true);
    this.offset += 2;
  }

  writeUint32(val: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, val, true);
    this.offset += 4;
  }

  writeInt32(val: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, true);
    this.offset += 4;
  }

  writeStringNullTerminated(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.ensureCapacity(encoded.length + 1);
    this.buffer.set(encoded, this.offset);
    this.offset += encoded.length;
    this.buffer[this.offset] = 0; // null terminator
    this.offset += 1;
  }

  writeFixedString(str: string, length: number): void {
    const encoded = new TextEncoder().encode(str);
    this.ensureCapacity(length);
    for (let i = 0; i < length; i++) {
      const b = encoded[i];
      this.buffer[this.offset + i] = b !== undefined ? b : 0;
    }
    this.offset += length;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  patchInt32(offset: number, val: number): void {
    this.view.setInt32(offset, val, true);
  }

  patchUint16(offset: number, val: number): void {
    this.view.setUint16(offset, val, true);
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

export function writeSor(doc: SorDocument): Uint8Array {
  // We construct each block separately, then assemble the Map block with exact block sizes.
  const blocksToWrite: Array<{ name: string; revision: number; data: Uint8Array }> = [];

  // 1. Build GenParams block
  const genWriter = new BinaryWriter();
  genWriter.writeStringNullTerminated("GenParams");
  genWriter.writeFixedString("EN", 2);
  genWriter.writeStringNullTerminated(doc.genParams.cableId);
  genWriter.writeStringNullTerminated(doc.genParams.fiberId);
  genWriter.writeFixedString(doc.genParams.fiberType, 4);
  genWriter.writeInt16(doc.genParams.nominalWavelengthNm);
  genWriter.writeStringNullTerminated(doc.genParams.originLocation);
  genWriter.writeStringNullTerminated(doc.genParams.terminateLocation);
  genWriter.writeStringNullTerminated(doc.genParams.cableCode);
  genWriter.writeFixedString(doc.genParams.currentCondition, 2);
  genWriter.writeStringNullTerminated(doc.genParams.operator);
  genWriter.writeStringNullTerminated(doc.genParams.comments);
  blocksToWrite.push({ name: "GenParams", revision: 100, data: genWriter.toUint8Array() });

  // 2. Build SupParams block
  const supWriter = new BinaryWriter();
  supWriter.writeStringNullTerminated("SupParams");
  supWriter.writeStringNullTerminated(doc.supParams.supplierName);
  supWriter.writeStringNullTerminated(doc.supParams.otdrName);
  supWriter.writeStringNullTerminated(doc.supParams.otdrSerialNumber);
  supWriter.writeStringNullTerminated(doc.supParams.moduleName);
  supWriter.writeStringNullTerminated(doc.supParams.moduleSerialNumber);
  supWriter.writeStringNullTerminated(doc.supParams.softwareVersion);
  blocksToWrite.push({ name: "SupParams", revision: 100, data: supWriter.toUint8Array() });

  // 3. Build FxdParams block
  const fxdWriter = new BinaryWriter();
  fxdWriter.writeStringNullTerminated("FxdParams");
  fxdWriter.writeUint32(Math.floor(doc.fxdParams.dateTime.getTime() / 1000));
  fxdWriter.writeFixedString(doc.fxdParams.distanceUnits, 2);
  fxdWriter.writeUint16(Math.round(doc.fxdParams.actualWavelengthNm * 10));
  fxdWriter.writeInt32(doc.fxdParams.acquisitionOffset);
  fxdWriter.writeInt32(0); // acq offset dist
  fxdWriter.writeInt16(1); // num pulse widths
  fxdWriter.writeUint16(doc.fxdParams.pulseWidthNs);
  fxdWriter.writeInt32(Math.round(doc.fxdParams.sampleSpacingNs * 10000));
  fxdWriter.writeUint32(doc.dataPoints.numPoints);
  fxdWriter.writeInt32(Math.round(doc.fxdParams.refractiveIndex * 100000));
  fxdWriter.writeInt16(Math.round(doc.fxdParams.backscatterCoefficientDb * 10));
  fxdWriter.writeUint32(doc.fxdParams.numAverages);
  fxdWriter.writeUint16(15); // avg time
  fxdWriter.writeUint32(Math.round(doc.fxdParams.rangeKm * 10000));
  fxdWriter.writeInt32(Math.round(doc.fxdParams.frontPanelLossDb * 1000));
  blocksToWrite.push({ name: "FxdParams", revision: 100, data: fxdWriter.toUint8Array() });

  // 4. Build DataPts block
  const dataWriter = new BinaryWriter();
  dataWriter.writeStringNullTerminated("DataPts");
  dataWriter.writeInt32(doc.dataPoints.numPoints);
  dataWriter.writeInt16(1); // numTraces
  dataWriter.writeUint16(doc.dataPoints.scalingFactor || 1000);
  const factor = doc.dataPoints.scalingFactor || 1000;
  for (let i = 0; i < doc.dataPoints.numPoints; i++) {
    const p = doc.dataPoints.powerDb[i] ?? 0;
    const rawVal = Math.round(p * factor);
    dataWriter.writeUint16(Math.max(0, Math.min(65535, rawVal)));
  }
  blocksToWrite.push({ name: "DataPts", revision: 100, data: dataWriter.toUint8Array() });

  // 5. Build KeyEvents block
  const evWriter = new BinaryWriter();
  evWriter.writeStringNullTerminated("KeyEvents");
  evWriter.writeInt16(doc.keyEvents.length);
  for (const ev of doc.keyEvents) {
    evWriter.writeInt16(ev.eventNumber);
    // Convert distance back to 100 ps propagation time
    const timeSec = (ev.distanceMeters * 2 * doc.fxdParams.refractiveIndex) / SPEED_OF_LIGHT;
    const propTime = Math.round(timeSec * 1e10);
    evWriter.writeUint32(propTime);
    evWriter.writeInt16(Math.round(ev.slopeDbPerKm * 1000));
    evWriter.writeInt16(Math.round(ev.eventLossDb * 1000));
    const refl = Number.isFinite(ev.reflectanceDb) ? Math.round(ev.reflectanceDb * 1000) : -32768;
    evWriter.writeInt16(refl);
    evWriter.writeFixedString(ev.eventCode || "0999", 4);
    evWriter.writeFixedString("2P", 2);
    evWriter.writeInt32(Math.round(ev.leadInLossDb * 1000));
    evWriter.writeStringNullTerminated(ev.comments || "");
  }
  blocksToWrite.push({ name: "KeyEvents", revision: 100, data: evWriter.toUint8Array() });

  // 6. Build Cksum block
  const cksumWriter = new BinaryWriter();
  cksumWriter.writeStringNullTerminated("Cksum");
  cksumWriter.writeUint16(doc.checksum ?? 0);
  blocksToWrite.push({ name: "Cksum", revision: 100, data: cksumWriter.toUint8Array() });

  // 7. Assemble Map block
  const mapWriter = new BinaryWriter();
  mapWriter.writeStringNullTerminated("Map");
  mapWriter.writeUint16(doc.version === "2.0" ? 200 : 100);
  // We'll calculate Map block size
  const mapSizeOffset = mapWriter.position;
  mapWriter.writeInt32(0); // placeholder for mapSize
  mapWriter.writeInt16(blocksToWrite.length);

  for (const b of blocksToWrite) {
    mapWriter.writeStringNullTerminated(b.name);
    mapWriter.writeUint16(b.revision);
    mapWriter.writeInt32(b.data.byteLength);
  }

  const mapSize = mapWriter.position;
  mapWriter.patchInt32(mapSizeOffset, mapSize);

  // 8. Concatenate Map block and all data blocks
  const totalLength = mapSize + blocksToWrite.reduce((acc, b) => acc + b.data.byteLength, 0);
  const outWriter = new BinaryWriter(totalLength);
  outWriter.writeBytes(mapWriter.toUint8Array());
  for (const b of blocksToWrite) {
    outWriter.writeBytes(b.data);
  }

  return outWriter.toUint8Array();
}

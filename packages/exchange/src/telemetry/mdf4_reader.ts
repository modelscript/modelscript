// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — ASAM MDF4 (Measurement Data Format v4.10) Binary Telemetry Engine.
 *
 * Implements high-throughput, zero-copy binary streaming and generation for ASAM MDF4 (.mf4)
 * files, the global automotive and aerospace standard for synchronized sensor, bus (CAN/LIN/FlexRay),
 * and test bench telemetry.
 *
 * Supported MDF4 blocks:
 *   - ##ID (Identification Block: 64 bytes, version 4.10)
 *   - ##HD (Header Block: time start, data group link)
 *   - ##DG (Data Group Block: channel groups and raw data records)
 *   - ##CG (Channel Group Block: cycle count, record byte size)
 *   - ##CN (Channel Block: name, type, byte offset, bit count, sync type)
 *   - ##CC (Channel Conversion Block: 1:1, linear a*x + b)
 *   - ##TX (Text Block: channel names, comments, engineering units)
 *   - ##DT (Data Block: packed binary data records)
 */

export enum Mdf4ChannelType {
  FixedLength = 0,
  VariableLength = 1,
  MasterChannel = 2,
  VirtualMaster = 3,
  SyncChannel = 4,
  MaxLength = 5,
  VirtualData = 6,
}

export enum Mdf4SyncType {
  None = 0,
  Time = 1,
  Angle = 2,
  Distance = 3,
  Index = 4,
}

export enum Mdf4DataType {
  UnsignedIntegerLE = 0,
  UnsignedIntegerBE = 1,
  SignedIntegerLE = 2,
  SignedIntegerBE = 3,
  FloatLE = 4,
  FloatBE = 5,
  StringLatin1 = 6,
  StringUTF8 = 7,
  ByteArray = 8,
  MIMESample = 9,
}

export interface Mdf4ChannelMetadata {
  name: string;
  channelType: Mdf4ChannelType;
  syncType: Mdf4SyncType;
  dataType: Mdf4DataType;
  byteOffset: number;
  bitCount: number;
  unit?: string;
  comment?: string;
  conversion?: {
    type: "identity" | "linear";
    factor: number;
    offset: number;
  };
}

export interface Mdf4ChannelGroupMetadata {
  recordId: bigint;
  cycleCount: bigint;
  dataBytes: number;
  channels: Mdf4ChannelMetadata[];
}

export interface Mdf4DataSeries {
  name: string;
  unit?: string;
  isMasterTime: boolean;
  timestamps: Float64Array;
  values: Float64Array;
}

/**
 * High-performance binary reader for ASAM MDF4 telemetry files.
 */
export class Mdf4Reader {
  private view: DataView;
  private buffer: Uint8Array;
  private decoder = new TextDecoder("utf-8");

  constructor(data: Uint8Array | ArrayBuffer) {
    if (data instanceof Uint8Array) {
      this.buffer = data;
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.buffer = new Uint8Array(data);
      this.view = new DataView(data);
    }

    this.verifyIdBlock();
  }

  /**
   * Checks the ##ID block magic: "##MDF    "
   */
  private verifyIdBlock(): void {
    if (this.buffer.byteLength < 64) {
      throw new Error(`Invalid MDF4 file: size ${this.buffer.byteLength} bytes is less than 64-byte IDBLOCK`);
    }

    const magic = this.decoder.decode(this.buffer.subarray(0, 8));
    if (!magic.startsWith("##MDF")) {
      throw new Error(`Not an MDF4 file: invalid magic '${magic}' (expected '##MDF    ')`);
    }

    const versionStr = this.decoder.decode(this.buffer.subarray(28, 32));
    const versionNum = this.view.getUint16(32, true);
    if (versionNum < 400) {
      throw new Error(`Unsupported MDF version ${versionStr} (${versionNum}): only MDF 4.x is supported`);
    }
  }

  /**
   * Reads a 4-character ASCII block ID at offset.
   */
  private readBlockId(offset: number): string {
    if (offset + 4 > this.buffer.byteLength) return "";
    return this.decoder.decode(this.buffer.subarray(offset, offset + 4));
  }

  /**
   * Reads a UTF-8 or Latin1 string from a ##TX block.
   */
  private readTextBlock(offset: number): string {
    if (offset === 0 || offset + 24 > this.buffer.byteLength) return "";
    const id = this.readBlockId(offset);
    if (id !== "##TX" && id !== "##MD") return "";

    const length = Number(this.view.getBigUint64(offset + 8, true));
    const linkCount = Number(this.view.getBigUint64(offset + 16, true));
    const dataOffset = offset + 24 + linkCount * 8;
    const dataLength = Math.max(0, offset + length - dataOffset);

    // Null-terminated string
    let end = dataOffset;
    const maxEnd = dataOffset + dataLength;
    while (end < maxEnd && this.buffer[end] !== 0) {
      end++;
    }
    return this.decoder.decode(this.buffer.subarray(dataOffset, end)).trim();
  }

  /**
   * Parses all channel groups and extracts their channel metadata.
   */
  public parseMetadata(): { headerStartTimeNs: bigint; groups: Mdf4ChannelGroupMetadata[] } {
    // HDBLOCK is always at byte 64 in MDF 4
    const hdOffset = 64;
    const hdId = this.readBlockId(hdOffset);
    if (hdId !== "##HD") {
      throw new Error(`Corrupted MDF4: expected ##HD at offset 64, got '${hdId}'`);
    }

    const hdLinkCount = Number(this.view.getBigUint64(hdOffset + 16, true));
    if (hdLinkCount < 1) {
      throw new Error("MDF4 ##HD block has no data group links");
    }

    const firstDgLink = Number(this.view.getBigUint64(hdOffset + 24, true));
    const startTimeNs = this.view.getBigUint64(hdOffset + 24 + hdLinkCount * 8, true);

    const groups: Mdf4ChannelGroupMetadata[] = [];
    let dgOffset = firstDgLink;

    while (dgOffset !== 0 && dgOffset + 24 <= this.buffer.byteLength) {
      const dgId = this.readBlockId(dgOffset);
      if (dgId !== "##DG") break;

      const nextDgLink = Number(this.view.getBigUint64(dgOffset + 24, true));
      const firstCgLink = Number(this.view.getBigUint64(dgOffset + 32, true));

      let cgOffset = firstCgLink;
      while (cgOffset !== 0 && cgOffset + 24 <= this.buffer.byteLength) {
        const cgId = this.readBlockId(cgOffset);
        if (cgId !== "##CG") break;

        const nextCgLink = Number(this.view.getBigUint64(cgOffset + 24, true));
        const firstCnLink = Number(this.view.getBigUint64(cgOffset + 32, true));
        const cgLinkCount = Number(this.view.getBigUint64(cgOffset + 16, true));

        const dataStart = cgOffset + 24 + cgLinkCount * 8;
        const recordId = this.view.getBigUint64(dataStart, true);
        const cycleCount = this.view.getBigUint64(dataStart + 8, true);
        const dataBytes = this.view.getUint32(dataStart + 18, true);

        const channels: Mdf4ChannelMetadata[] = [];
        let cnOffset = firstCnLink;

        while (cnOffset !== 0 && cnOffset + 24 <= this.buffer.byteLength) {
          const cnId = this.readBlockId(cnOffset);
          if (cnId !== "##CN") break;

          const nextCnLink = Number(this.view.getBigUint64(cnOffset + 24, true));
          const nameLink = Number(this.view.getBigUint64(cnOffset + 40, true));
          const conversionLink = Number(this.view.getBigUint64(cnOffset + 56, true));
          const unitLink = Number(this.view.getBigUint64(cnOffset + 64, true));
          const cnLinkCount = Number(this.view.getBigUint64(cnOffset + 16, true));

          const cnDataStart = cnOffset + 24 + cnLinkCount * 8;
          const channelType = this.buffer[cnDataStart] as Mdf4ChannelType;
          const syncType = this.buffer[cnDataStart + 1] as Mdf4SyncType;
          const dataType = this.buffer[cnDataStart + 2] as Mdf4DataType;
          const byteOffset = this.view.getUint32(cnDataStart + 4, true);
          const bitCount = this.view.getUint32(cnDataStart + 8, true);

          const name = this.readTextBlock(nameLink) || `Channel_${channels.length}`;
          const unit = this.readTextBlock(unitLink) || undefined;

          let conversion: Mdf4ChannelMetadata["conversion"];
          if (conversionLink !== 0) {
            const ccId = this.readBlockId(conversionLink);
            if (ccId === "##CC") {
              const ccLinkCount = Number(this.view.getBigUint64(conversionLink + 16, true));
              const ccDataStart = conversionLink + 24 + ccLinkCount * 8;
              const convType = this.buffer[ccDataStart];
              if (convType === 1) {
                // Linear: y = a * x + b
                const offsetVal = this.view.getFloat64(ccDataStart + 8, true);
                const factorVal = this.view.getFloat64(ccDataStart + 16, true);
                conversion = { type: "linear", factor: factorVal, offset: offsetVal };
              } else {
                conversion = { type: "identity", factor: 1.0, offset: 0.0 };
              }
            }
          }

          channels.push({
            name,
            channelType,
            syncType,
            dataType,
            byteOffset,
            bitCount,
            unit,
            conversion,
          });

          cnOffset = nextCnLink;
        }

        groups.push({
          recordId,
          cycleCount,
          dataBytes,
          channels,
        });

        cgOffset = nextCgLink;
      }

      dgOffset = nextDgLink;
    }

    return { headerStartTimeNs: startTimeNs, groups };
  }

  /**
   * Extracts all channels into structured Float64Array time-series.
   */
  public extractAllChannels(): Mdf4DataSeries[] {
    const hdOffset = 64;
    const firstDgLink = Number(this.view.getBigUint64(hdOffset + 24, true));
    const results: Mdf4DataSeries[] = [];

    let dgOffset = firstDgLink;
    while (dgOffset !== 0 && dgOffset + 24 <= this.buffer.byteLength) {
      const dgId = this.readBlockId(dgOffset);
      if (dgId !== "##DG") break;

      const nextDgLink = Number(this.view.getBigUint64(dgOffset + 24, true));
      const firstCgLink = Number(this.view.getBigUint64(dgOffset + 32, true));
      const dtLink = Number(this.view.getBigUint64(dgOffset + 40, true));

      if (dtLink === 0) {
        dgOffset = nextDgLink;
        continue;
      }

      const dtId = this.readBlockId(dtLink);
      if (dtId !== "##DT") {
        dgOffset = nextDgLink;
        continue;
      }

      const dtLinkCount = Number(this.view.getBigUint64(dtLink + 16, true));
      const dtDataOffset = dtLink + 24 + dtLinkCount * 8;

      let cgOffset = firstCgLink;
      while (cgOffset !== 0 && cgOffset + 24 <= this.buffer.byteLength) {
        const cgLinkCount = Number(this.view.getBigUint64(cgOffset + 16, true));
        const cgDataStart = cgOffset + 24 + cgLinkCount * 8;
        const cycleCount = Number(this.view.getBigUint64(cgDataStart + 8, true));
        const recordBytes = this.view.getUint32(cgDataStart + 18, true);

        const firstCnLink = Number(this.view.getBigUint64(cgOffset + 32, true));
        const channelList: {
          name: string;
          unit?: string;
          isMaster: boolean;
          byteOffset: number;
          dataType: Mdf4DataType;
          bitCount: number;
          conversion?: { factor: number; offset: number };
        }[] = [];

        let cnOffset = firstCnLink;
        while (cnOffset !== 0 && cnOffset + 24 <= this.buffer.byteLength) {
          const nextCn = Number(this.view.getBigUint64(cnOffset + 24, true));
          const nameLink = Number(this.view.getBigUint64(cnOffset + 40, true));
          const convLink = Number(this.view.getBigUint64(cnOffset + 56, true));
          const unitLink = Number(this.view.getBigUint64(cnOffset + 64, true));
          const cnLinkCount = Number(this.view.getBigUint64(cnOffset + 16, true));
          const cnData = cnOffset + 24 + cnLinkCount * 8;

          const chType = this.buffer[cnData] as Mdf4ChannelType;
          const syncType = this.buffer[cnData + 1] as Mdf4SyncType;
          const dataType = this.buffer[cnData + 2] as Mdf4DataType;
          const byteOffset = this.view.getUint32(cnData + 4, true);
          const bitCount = this.view.getUint32(cnData + 8, true);

          const name = this.readTextBlock(nameLink) || `Channel_${channelList.length}`;
          const unit = this.readTextBlock(unitLink) || undefined;
          const isMaster = chType === Mdf4ChannelType.MasterChannel || syncType === Mdf4SyncType.Time;

          let conv: { factor: number; offset: number } | undefined;
          if (convLink !== 0 && this.readBlockId(convLink) === "##CC") {
            const ccLinkCount = Number(this.view.getBigUint64(convLink + 16, true));
            const ccData = convLink + 24 + ccLinkCount * 8;
            if (this.buffer[ccData] === 1) {
              conv = {
                offset: this.view.getFloat64(ccData + 8, true),
                factor: this.view.getFloat64(ccData + 16, true),
              };
            }
          }

          channelList.push({
            name,
            unit,
            isMaster,
            byteOffset,
            dataType,
            bitCount,
            conversion: conv,
          });

          cnOffset = nextCn;
        }

        // Find master time channel
        const masterCh = channelList.find((c) => c.isMaster) || channelList[0];
        const timestamps = new Float64Array(cycleCount);

        // Pre-allocate value buffers
        const valueBuffers = channelList.map(() => new Float64Array(cycleCount));

        // Fast zero-copy sweep across DT records
        for (let i = 0; i < cycleCount; i++) {
          const recBase = dtDataOffset + i * recordBytes;
          if (recBase + recordBytes > this.buffer.byteLength) break;

          for (let c = 0; c < channelList.length; c++) {
            const ch = channelList[c]!;
            const pos = recBase + ch.byteOffset;
            let raw = 0.0;

            if (ch.dataType === Mdf4DataType.FloatLE) {
              raw = ch.bitCount === 64 ? this.view.getFloat64(pos, true) : this.view.getFloat32(pos, true);
            } else if (ch.dataType === Mdf4DataType.SignedIntegerLE) {
              if (ch.bitCount === 8) raw = this.view.getInt8(pos);
              else if (ch.bitCount === 16) raw = this.view.getInt16(pos, true);
              else if (ch.bitCount === 32) raw = this.view.getInt32(pos, true);
              else if (ch.bitCount === 64) raw = Number(this.view.getBigInt64(pos, true));
            } else if (ch.dataType === Mdf4DataType.UnsignedIntegerLE) {
              if (ch.bitCount === 8) raw = this.view.getUint8(pos);
              else if (ch.bitCount === 16) raw = this.view.getUint16(pos, true);
              else if (ch.bitCount === 32) raw = this.view.getUint32(pos, true);
              else if (ch.bitCount === 64) raw = Number(this.view.getBigUint64(pos, true));
            }

            if (ch.conversion) {
              raw = raw * ch.conversion.factor + ch.conversion.offset;
            }

            valueBuffers[c]![i] = raw;
          }
        }

        // Assign master timestamps
        const masterIdx = masterCh ? channelList.indexOf(masterCh) : 0;
        if (masterIdx >= 0 && valueBuffers[masterIdx]) {
          timestamps.set(valueBuffers[masterIdx]!);
        } else {
          for (let i = 0; i < cycleCount; i++) timestamps[i] = i * 0.001; // default 1 kHz
        }

        // Emit series
        for (let c = 0; c < channelList.length; c++) {
          const ch = channelList[c]!;
          results.push({
            name: ch.name,
            unit: ch.unit,
            isMasterTime: ch.isMaster,
            timestamps,
            values: valueBuffers[c]!,
          });
        }

        cgOffset = Number(this.view.getBigUint64(cgOffset + 24, true));
      }

      dgOffset = nextDgLink;
    }

    return results;
  }
}

/**
 * High-performance ASAM MDF4 writer for generating compliant .mf4 files from simulation or test runs.
 */
export class Mdf4Writer {
  public static create(
    timeSeries: { name: string; unit?: string; timestamps: Float64Array; values: Float64Array }[],
    startTimeNs: bigint = 0n,
  ): Uint8Array {
    if (timeSeries.length === 0) {
      throw new Error("Cannot create MDF4 with 0 time series");
    }

    const timeCh = timeSeries[0]!;
    const numCycles = timeCh.timestamps.length;
    const encoder = new TextEncoder();

    // Layout calculation:
    // ID Block: 64 bytes
    // HD Block: 24 bytes header + 6 links (48 bytes) + data (24 bytes) = 96 bytes
    // DG Block: 24 bytes header + 3 links (24 bytes) + data (8 bytes) = 56 bytes
    // CG Block: 24 bytes header + 3 links (24 bytes) + data (32 bytes) = 80 bytes
    // Master Time CN Block + TX blocks + Other CN Blocks + DT Block

    // Each record: 1x float64 (time) + N x float64 (values)
    const numSignals = timeSeries.length;
    const recordBytes = (1 + numSignals) * 8; // time + each signal
    const dtBytes = numCycles * recordBytes;

    const chunks: Uint8Array[] = [];
    let currentOffset = 0;

    function pushChunk(bytes: Uint8Array): number {
      const offset = currentOffset;
      chunks.push(bytes);
      currentOffset += bytes.byteLength;
      return offset;
    }

    // 1. ID Block (64 bytes)
    const idBlock = new Uint8Array(64);
    idBlock.set(encoder.encode("##MDF   "));
    idBlock.set(encoder.encode("4.10    "), 8);
    idBlock.set(encoder.encode("ModelScript 1.0 "), 16);
    // Version 410 = 0x019A
    new DataView(idBlock.buffer).setUint16(32, 410, true);
    pushChunk(idBlock);

    // Placeholder offsets to stitch
    const hdOffset = 64;
    const dgOffset = hdOffset + 96;
    const cgOffset = dgOffset + 56;
    const timeCnOffset = cgOffset + 80;

    // We will build and patch blocks
    // 2. HD Block (offset 64, len 96)
    const hd = new Uint8Array(96);
    const hdView = new DataView(hd.buffer);
    hd.set(encoder.encode("##HD"));
    hdView.setBigUint64(8, 96n, true); // length
    hdView.setBigUint64(16, 6n, true); // 6 links
    hdView.setBigUint64(24, BigInt(dgOffset), true); // link to DG
    hdView.setBigUint64(72, startTimeNs, true); // start time
    pushChunk(hd);

    // 3. DG Block (offset 160, len 56)
    const dg = new Uint8Array(56);
    const dgView = new DataView(dg.buffer);
    dg.set(encoder.encode("##DG"));
    dgView.setBigUint64(8, 56n, true);
    dgView.setBigUint64(16, 3n, true);
    dgView.setBigUint64(24, 0n, true); // next DG
    dgView.setBigUint64(32, BigInt(cgOffset), true); // link to CG
    // dt link will be patched after calculating CN blocks
    pushChunk(dg);

    // 4. CG Block (offset 216, len 80)
    const cg = new Uint8Array(80);
    const cgView = new DataView(cg.buffer);
    cg.set(encoder.encode("##CG"));
    cgView.setBigUint64(8, 80n, true);
    cgView.setBigUint64(16, 3n, true);
    cgView.setBigUint64(24, 0n, true); // next CG
    cgView.setBigUint64(32, BigInt(timeCnOffset), true); // first CN (Time)
    cgView.setBigUint64(48, 0n, true); // record ID
    cgView.setBigUint64(56, BigInt(numCycles), true); // cycle count
    cgView.setUint16(64, 0, true); // flags
    cgView.setUint32(66, recordBytes, true); // record byte size
    pushChunk(cg);

    // 5. Build CN Blocks for Master Time and each Series
    let prevCnView: DataView | null = null;
    let prevCnOffset = 0;
    const allChannels = [
      { name: "time", unit: "s", isMaster: true, byteOffset: 0 },
      ...timeSeries.map((s, idx) => ({
        name: s.name,
        unit: s.unit || "",
        isMaster: false,
        byteOffset: (idx + 1) * 8,
      })),
    ];

    for (let c = 0; c < allChannels.length; c++) {
      const ch = allChannels[c]!;
      const cnOffset = currentOffset;

      if (prevCnView) {
        prevCnView.setBigUint64(24, BigInt(cnOffset), true);
      }

      // CN Block: 24 bytes header + 8 links (64 bytes) + data (32 bytes) = 120 bytes
      const cn = new Uint8Array(120);
      const cnView = new DataView(cn.buffer);
      cn.set(encoder.encode("##CN"));
      cnView.setBigUint64(8, 120n, true);
      cnView.setBigUint64(16, 8n, true); // 8 links
      cnView.setBigUint64(24, 0n, true); // next CN link (filled next iteration)

      // Name TX block
      const nameBytes = encoder.encode(ch.name + "\0");
      const nameTxLen = 24 + Math.ceil(nameBytes.byteLength / 8) * 8;
      const nameTx = new Uint8Array(nameTxLen);
      nameTx.set(encoder.encode("##TX"));
      new DataView(nameTx.buffer).setBigUint64(8, BigInt(nameTxLen), true);
      new DataView(nameTx.buffer).setBigUint64(16, 0n, true);
      nameTx.set(nameBytes, 24);

      // Unit TX block
      const unitBytes = encoder.encode((ch.unit || "") + "\0");
      const unitTxLen = 24 + Math.ceil(unitBytes.byteLength / 8) * 8;
      const unitTx = new Uint8Array(unitTxLen);
      unitTx.set(encoder.encode("##MD"));
      new DataView(unitTx.buffer).setBigUint64(8, BigInt(unitTxLen), true);
      new DataView(unitTx.buffer).setBigUint64(16, 0n, true);
      unitTx.set(unitBytes, 24);

      pushChunk(cn);
      const nameTxOffset = pushChunk(nameTx);
      const unitTxOffset = pushChunk(unitTx);

      cnView.setBigUint64(40, BigInt(nameTxOffset), true); // name link
      cnView.setBigUint64(64, BigInt(unitTxOffset), true); // unit link

      // CN data:
      const cnData = 24 + 64;
      cn[cnData] = ch.isMaster ? Mdf4ChannelType.MasterChannel : Mdf4ChannelType.FixedLength;
      cn[cnData + 1] = ch.isMaster ? Mdf4SyncType.Time : Mdf4SyncType.None;
      cn[cnData + 2] = Mdf4DataType.FloatLE; // 64-bit IEEE double
      cn[cnData + 3] = 0; // bit offset
      cnView.setUint32(cnData + 4, ch.byteOffset, true);
      cnView.setUint32(cnData + 8, 64, true); // 64 bits

      prevCnView = cnView;
      prevCnOffset = cnOffset;
    }

    // 6. DT Block (Data Block)
    const dtOffset = currentOffset;
    dgView.setBigUint64(40, BigInt(dtOffset), true); // Link DG -> DT

    const dtHeaderLen = 24;
    const dtTotalLen = dtHeaderLen + dtBytes;
    const dt = new Uint8Array(dtTotalLen);
    const dtView = new DataView(dt.buffer);
    dt.set(encoder.encode("##DT"));
    dtView.setBigUint64(8, BigInt(dtTotalLen), true);
    dtView.setBigUint64(16, 0n, true); // 0 links

    // Populate data records
    for (let i = 0; i < numCycles; i++) {
      const recBase = dtHeaderLen + i * recordBytes;
      dtView.setFloat64(recBase, timeCh.timestamps[i]!, true);

      for (let s = 0; s < numSignals; s++) {
        const val = timeSeries[s]!.values[i] ?? 0.0;
        dtView.setFloat64(recBase + (s + 1) * 8, val, true);
      }
    }
    pushChunk(dt);

    // Concatenate all chunks into a contiguous file buffer
    const fullFile = new Uint8Array(currentOffset);
    let writePos = 0;
    for (const chunk of chunks) {
      fullFile.set(chunk, writePos);
      writePos += chunk.byteLength;
    }

    return fullFile;
  }
}

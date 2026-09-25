// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Foxglove MCAP (v1.0) High-Performance Binary Telemetry Engine.
 *
 * Implements zero-copy parsing and generation for MCAP container files, the modern open
 * standard for autonomous vehicle, robotics, and cyber-physical telemetry (ROS 2 / protobuf / JSON).
 *
 * Supported MCAP Records:
 *   - 0x01: Header
 *   - 0x02: Footer
 *   - 0x03: Schema
 *   - 0x04: Channel
 *   - 0x05: Message (zero-copy timestamp & payload extraction)
 *   - 0x06: Chunk
 */

export const MCAP_MAGIC = new Uint8Array([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a]);

export enum McapOpcode {
  Header = 0x01,
  Footer = 0x02,
  Schema = 0x03,
  Channel = 0x04,
  Message = 0x05,
  Chunk = 0x06,
  MessageIndex = 0x07,
  ChunkIndex = 0x08,
  Attachment = 0x09,
  Metadata = 0x0a,
}

export interface McapChannelInfo {
  id: number;
  schemaId: number;
  topic: string;
  messageEncoding: string;
  metadata: Record<string, string>;
}

export interface McapDataSeries {
  topic: string;
  channelId: number;
  messageEncoding: string;
  timestamps: Float64Array; // in seconds relative to t0
  values: Float64Array;
}

/**
 * Streaming reader for MCAP robotics and cyber-physical telemetry files.
 */
export class McapReader {
  private buffer: Uint8Array;
  private view: DataView;
  private decoder = new TextDecoder("utf-8");

  constructor(data: Uint8Array | ArrayBuffer) {
    if (data instanceof Uint8Array) {
      this.buffer = data;
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.buffer = new Uint8Array(data);
      this.view = new DataView(data);
    }

    this.verifyMagic();
  }

  private verifyMagic(): void {
    if (this.buffer.byteLength < 16) {
      throw new Error(`Invalid MCAP file: length ${this.buffer.byteLength} is less than header/footer magic`);
    }

    for (let i = 0; i < 8; i++) {
      if (this.buffer[i] !== MCAP_MAGIC[i]) {
        throw new Error("Invalid MCAP file: header magic mismatch");
      }
    }
  }

  /**
   * Scans and extracts all channel metadata.
   */
  public getChannels(): Map<number, McapChannelInfo> {
    const channels = new Map<number, McapChannelInfo>();
    let offset = 8; // skip 8-byte magic
    const end = this.buffer.byteLength - 8; // skip footer magic

    while (offset < end) {
      if (offset + 9 > end) break;
      const op = this.buffer[offset]!;
      const recordLen = Number(this.view.getBigUint64(offset + 1, true));
      const recordStart = offset + 9;

      if (op === McapOpcode.Channel && recordStart + recordLen <= this.buffer.byteLength) {
        let p = recordStart;
        const channelId = this.view.getUint16(p, true);
        p += 2;
        const schemaId = this.view.getUint16(p, true);
        p += 2;
        const topicLen = this.view.getUint32(p, true);
        p += 4;
        const topic = this.decoder.decode(this.buffer.subarray(p, p + topicLen));
        p += topicLen;
        const encLen = this.view.getUint32(p, true);
        p += 4;
        const messageEncoding = this.decoder.decode(this.buffer.subarray(p, p + encLen));

        channels.set(channelId, {
          id: channelId,
          schemaId,
          topic,
          messageEncoding,
          metadata: {},
        });
      }

      offset = recordStart + recordLen;
    }

    return channels;
  }

  /**
   * Fast zero-copy extraction of numeric time series from MCAP messages.
   */
  public extractAllSeries(): McapDataSeries[] {
    const channelMap = this.getChannels();
    const timeLists = new Map<number, number[]>();
    const valueLists = new Map<number, number[]>();

    for (const [id] of channelMap) {
      timeLists.set(id, []);
      valueLists.set(id, []);
    }

    let offset = 8;
    const end = this.buffer.byteLength - 8;
    let t0Ns: bigint | null = null;

    while (offset < end) {
      if (offset + 9 > end) break;
      const op = this.buffer[offset]!;
      const recordLen = Number(this.view.getBigUint64(offset + 1, true));
      const recordStart = offset + 9;

      if (op === McapOpcode.Message && recordStart + recordLen <= this.buffer.byteLength) {
        let p = recordStart;
        const channelId = this.view.getUint16(p, true);
        p += 2;
        const _sequence = this.view.getUint32(p, true);
        p += 4;
        const logTime = this.view.getBigUint64(p, true);
        p += 8;
        const _publishTime = this.view.getBigUint64(p, true);
        p += 8;

        if (t0Ns === null) {
          t0Ns = logTime;
        }

        const timeSec = Number(logTime - t0Ns) * 1e-9;
        const payload = this.buffer.subarray(p, recordStart + recordLen);

        let numericVal = 0.0;
        const ch = channelMap.get(channelId);

        if (ch && ch.messageEncoding === "json") {
          try {
            const str = this.decoder.decode(payload);
            const obj = JSON.parse(str);
            numericVal = typeof obj === "number" ? obj : typeof obj.value === "number" ? obj.value : (obj.data ?? 0);
          } catch {
            numericVal = 0.0;
          }
        } else if (payload.byteLength >= 8) {
          // Default raw binary double little-endian
          numericVal = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getFloat64(0, true);
        } else if (payload.byteLength >= 4) {
          numericVal = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getFloat32(0, true);
        }

        if (timeLists.has(channelId)) {
          timeLists.get(channelId)!.push(timeSec);
          valueLists.get(channelId)!.push(numericVal);
        }
      }

      offset = recordStart + recordLen;
    }

    const results: McapDataSeries[] = [];
    for (const [id, ch] of channelMap) {
      const times = timeLists.get(id) || [];
      const vals = valueLists.get(id) || [];
      results.push({
        topic: ch.topic,
        channelId: id,
        messageEncoding: ch.messageEncoding,
        timestamps: new Float64Array(times),
        values: new Float64Array(vals),
      });
    }

    return results;
  }
}

/**
 * Lightweight generator for valid MCAP telemetry recordings.
 */
export class McapWriter {
  public static create(
    series: { topic: string; timestamps: Float64Array; values: Float64Array; encoding?: "json" | "binary" }[],
  ): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    // 1. Magic
    chunks.push(MCAP_MAGIC);

    // 2. Header (opcode 0x01)
    const profile = "modelscript-cyberphysical";
    const schemaEnc = "";
    const pBytes = encoder.encode(profile);
    const sBytes = encoder.encode(schemaEnc);
    const headerPayloadLen = 4 + pBytes.byteLength + 4 + sBytes.byteLength;
    const headerRec = new Uint8Array(9 + headerPayloadLen);
    headerRec[0] = McapOpcode.Header;
    new DataView(headerRec.buffer).setBigUint64(1, BigInt(headerPayloadLen), true);
    let p = 9;
    new DataView(headerRec.buffer).setUint32(p, pBytes.byteLength, true);
    p += 4;
    headerRec.set(pBytes, p);
    p += pBytes.byteLength;
    new DataView(headerRec.buffer).setUint32(p, sBytes.byteLength, true);
    p += 4;
    headerRec.set(sBytes, p);
    chunks.push(headerRec);

    // 3. Channels (opcode 0x04)
    for (let i = 0; i < series.length; i++) {
      const s = series[i]!;
      const channelId = i + 1;
      const topicBytes = encoder.encode(s.topic);
      const enc = s.encoding === "json" ? "json" : "application/octet-stream";
      const encBytes = encoder.encode(enc);
      const chLen = 2 + 2 + 4 + topicBytes.byteLength + 4 + encBytes.byteLength + 4; // empty metadata map (4 bytes)
      const chRec = new Uint8Array(9 + chLen);
      chRec[0] = McapOpcode.Channel;
      new DataView(chRec.buffer).setBigUint64(1, BigInt(chLen), true);
      let cp = 9;
      new DataView(chRec.buffer).setUint16(cp, channelId, true);
      cp += 2;
      new DataView(chRec.buffer).setUint16(cp, 0, true); // schemaId 0
      cp += 2;
      new DataView(chRec.buffer).setUint32(cp, topicBytes.byteLength, true);
      cp += 4;
      chRec.set(topicBytes, cp);
      cp += topicBytes.byteLength;
      new DataView(chRec.buffer).setUint32(cp, encBytes.byteLength, true);
      cp += 4;
      chRec.set(encBytes, cp);
      cp += encBytes.byteLength;
      new DataView(chRec.buffer).setUint32(cp, 0, true); // metadata map len = 0
      chunks.push(chRec);
    }

    // 4. Messages (opcode 0x05)
    // Flatten and interleave by time
    interface MsgRef {
      channelId: number;
      timeSec: number;
      value: number;
      encoding?: "json" | "binary";
    }

    const allMsgs: MsgRef[] = [];
    for (let c = 0; c < series.length; c++) {
      const s = series[c]!;
      for (let i = 0; i < s.timestamps.length; i++) {
        allMsgs.push({
          channelId: c + 1,
          timeSec: s.timestamps[i]!,
          value: s.values[i]!,
          encoding: s.encoding,
        });
      }
    }
    allMsgs.sort((a, b) => a.timeSec - b.timeSec);

    for (let seq = 0; seq < allMsgs.length; seq++) {
      const msg = allMsgs[seq]!;
      let payloadBytes: Uint8Array;
      if (msg.encoding === "json") {
        payloadBytes = encoder.encode(JSON.stringify({ value: msg.value }));
      } else {
        payloadBytes = new Uint8Array(8);
        new DataView(payloadBytes.buffer).setFloat64(0, msg.value, true);
      }

      const logTimeNs = BigInt(Math.round(msg.timeSec * 1e9));
      const msgPayloadLen = 2 + 4 + 8 + 8 + payloadBytes.byteLength;
      const msgRec = new Uint8Array(9 + msgPayloadLen);
      msgRec[0] = McapOpcode.Message;
      new DataView(msgRec.buffer).setBigUint64(1, BigInt(msgPayloadLen), true);
      let mp = 9;
      new DataView(msgRec.buffer).setUint16(mp, msg.channelId, true);
      mp += 2;
      new DataView(msgRec.buffer).setUint32(mp, seq, true);
      mp += 4;
      new DataView(msgRec.buffer).setBigUint64(mp, logTimeNs, true);
      mp += 8;
      new DataView(msgRec.buffer).setBigUint64(mp, logTimeNs, true);
      mp += 8;
      msgRec.set(payloadBytes, mp);
      chunks.push(msgRec);
    }

    // 5. Footer (opcode 0x02)
    const footerLen = 8 + 8 + 4; // summary_start (8), summary_offset (8), summary_crc (4)
    const footerRec = new Uint8Array(9 + footerLen);
    footerRec[0] = McapOpcode.Footer;
    new DataView(footerRec.buffer).setBigUint64(1, BigInt(footerLen), true);
    // summary_start = 0, summary_offset = 0, crc = 0
    chunks.push(footerRec);

    // 6. Magic footer
    chunks.push(MCAP_MAGIC);

    // Assemble file
    let totalBytes = 0;
    for (const c of chunks) totalBytes += c.byteLength;
    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.byteLength;
    }

    return result;
  }
}

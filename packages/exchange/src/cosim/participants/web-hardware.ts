// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser "Soft HIL" Hardware Participant.
 *
 * Connects physical hardware (microcontrollers, ECUs, USB-CAN dongles)
 * directly to the ModelScript co-simulation orchestrator using modern
 * browser hardware APIs:
 *   - WebSerial API (`navigator.serial`): USB-UART, Arduino, STM32, ESP32, SLCAN (CANable/candleLight)
 *   - WebUSB API (`navigator.usb`): Raw USB endpoints, custom DAQ
 *   - WebHID API (`navigator.hid`): Human-in-the-loop joysticks, flight controls
 *
 * Supports protocol framing:
 *   - "slcan": Standard ASCII CAN framing (LAWICEL protocol) for USB-to-CAN adapters.
 *   - "cobs": Consistent Overhead Byte Stuffing for robust binary frame packets.
 *   - "json": Line-delimited JSON for quick MCU prototyping.
 */

import type { FmiLsBusFrame } from "../../fmu/fmi-ls-bus.js";
import { FmiLsBusCodec } from "../../fmu/fmi-ls-bus.js";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata, ParticipantVariable } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

// ── WebSerial Protocol Formats ──

export type SerialProtocol = "slcan" | "cobs" | "json" | "raw";

/** In-flight decoded SLCAN frame. */
export interface SlcanFrame {
  id: number;
  isExtended: boolean;
  length: number;
  data: Uint8Array;
}

export interface WebSerialOptions {
  /** Participant identifier. */
  id: string;
  /** Serial port baud rate. Default: 115200. */
  baudRate?: number;
  /** Framing protocol. Default: "slcan". */
  protocol?: SerialProtocol;
  /** Optional FMI-LS-BUS frame definitions to auto-decode CAN/serial payloads into variables. */
  busFrames?: FmiLsBusFrame[];
  /** Mock or custom stream reader/writer for headless or testing environments. */
  customStream?: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
}

/**
 * WebSerial co-simulation participant.
 * Connects physical microcontrollers or CAN bus adapters to the Modelica plant model.
 */
export class WebSerialParticipant implements CoSimParticipant {
  readonly id: string;
  readonly modelName: string;
  readonly metadata: ParticipantMetadata;

  private baudRate: number;
  private protocol: SerialProtocol;
  private busFrames: FmiLsBusFrame[];
  private frameMap = new Map<number, FmiLsBusFrame>();

  // Browser Serial handles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private port: any = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private customStream?: WebSerialOptions["customStream"];

  // State
  private inputValues = new Map<string, CosimValue>();
  private outputValues = new Map<string, CosimValue>();
  private rxBuffer = new Uint8Array(4096);
  private rxBufferLen = 0;
  private isConnected = false;

  constructor(options: WebSerialOptions) {
    this.id = options.id;
    this.modelName = `WebSerial_${options.protocol ?? "slcan"}`;
    this.baudRate = options.baudRate ?? 115200;
    this.protocol = options.protocol ?? "slcan";
    this.busFrames = options.busFrames ?? [];
    this.customStream = options.customStream;

    for (const frame of this.busFrames) {
      this.frameMap.set(frame.id, frame);
    }

    // Build metadata from bus frame signals
    const variables: ParticipantVariable[] = [];
    for (const frame of this.busFrames) {
      for (const sig of frame.signals) {
        variables.push({
          name: sig.name,
          causality: "output", // physical device outputs are inputs to plant
          type: "Real",
          unit: sig.unit,
        });
      }
      if (frame.binaryValueReference !== undefined) {
        variables.push({
          name: `raw_${frame.name}`,
          causality: "output",
          type: "Binary",
        });
      }
    }

    this.metadata = {
      participantId: this.id,
      modelName: this.modelName,
      type: "web-hardware",
      classKind: "hardware-device",
      description: `Browser WebSerial hardware participant (${this.protocol})`,
      variables,
      timestamp: new Date().toISOString(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    if (this.customStream) {
      this.reader = this.customStream.readable.getReader();
      this.writer = this.customStream.writable.getWriter();
      this.isConnected = true;
      this.startBackgroundReader();
      return;
    }

    // Connect via navigator.serial if available in browser
    if (typeof navigator !== "undefined" && "serial" in navigator) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serial = (navigator as any).serial;
        this.port = await serial.requestPort();
        await this.port.open({ baudRate: this.baudRate });
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();
        this.isConnected = true;
        this.startBackgroundReader();

        // If SLCAN, open CAN channel (e.g. "O\r" for open 500k)
        if (this.protocol === "slcan" && this.writer) {
          const encoder = new TextEncoder();
          await this.writer.write(encoder.encode("S6\r")); // 500 kbit/s
          await this.writer.write(encoder.encode("O\r")); // Open CAN channel
        }
      } catch (err) {
        console.warn(`[WebSerialParticipant] Failed to open serial port:`, err);
      }
    }
  }

  async doStep(currentTime: number, stepSize: number): Promise<void> {
    // 1. Send outputs (plant model outputs sent to physical hardware)
    await this.transmitOutputs();

    // 2. Poll inputs (read from physical hardware)
    await this.pollHardwareInputs();
  }

  async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values) {
      this.inputValues.set(k, v);
    }
  }

  async getOutputs(): Promise<Map<string, CosimValue>> {
    return new Map(this.outputValues);
  }

  async terminate(): Promise<void> {
    this.isConnected = false;
    if (this.protocol === "slcan" && this.writer) {
      try {
        await this.writer.write(new TextEncoder().encode("C\r")); // Close CAN channel
      } catch {
        /* ignore */
      }
    }
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
      this.reader.releaseLock();
      this.reader = null;
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        /* ignore */
      }
      this.writer.releaseLock();
      this.writer = null;
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
  }

  // ── Hardware I/O Helpers ──

  private startBackgroundReader(): void {
    if (!this.reader) return;
    (async () => {
      while (this.isConnected && this.reader) {
        try {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            this.appendRxChunk(value);
            this.processRxBuffer();
          }
        } catch {
          break;
        }
      }
    })();
  }

  private async transmitOutputs(): Promise<void> {
    if (!this.writer || !this.isConnected || this.inputValues.size === 0) return;

    if (this.protocol === "slcan") {
      // Pack each defined frame that has signals present in inputValues
      for (const frame of this.busFrames) {
        const hasSignal = frame.signals.some((s) => this.inputValues.has(s.name));
        if (!hasSignal) continue;

        const payload = FmiLsBusCodec.packFrame(frame, this.toNumericMap(this.inputValues));
        const slcanStr = formatSlcanFrame(frame.id, frame.isExtended ?? false, payload);
        await this.writer.write(new TextEncoder().encode(slcanStr));
      }
    } else if (this.protocol === "json") {
      const obj: Record<string, number> = {};
      for (const [k, v] of this.inputValues) {
        if (typeof v === "number") obj[k] = v;
      }
      const jsonLine = JSON.stringify(obj) + "\n";
      await this.writer.write(new TextEncoder().encode(jsonLine));
    }
  }

  private pollHardwareInputs(): void {
    if (!this.isConnected) return;
    this.processRxBuffer();
  }

  private appendRxChunk(chunk: Uint8Array): void {
    if (this.rxBufferLen + chunk.length > this.rxBuffer.length) {
      // Shift or resize
      const newBuf = new Uint8Array(Math.max(this.rxBuffer.length * 2, this.rxBufferLen + chunk.length));
      newBuf.set(this.rxBuffer.subarray(0, this.rxBufferLen));
      this.rxBuffer = newBuf;
    }
    this.rxBuffer.set(chunk, this.rxBufferLen);
    this.rxBufferLen += chunk.length;
  }

  private processRxBuffer(): void {
    if (this.protocol === "slcan") {
      // Find carriage return delimiter '\r'
      let delimIdx: number;
      while ((delimIdx = this.rxBuffer.subarray(0, this.rxBufferLen).indexOf(0x0d)) !== -1) {
        const lineBytes = this.rxBuffer.subarray(0, delimIdx);
        const line = new TextDecoder().decode(lineBytes);

        const frame = parseSlcanLine(line);
        if (frame) {
          const frameDef = this.frameMap.get(frame.id);
          if (frameDef) {
            const decodedSignals = FmiLsBusCodec.unpackFrame(frameDef, frame.data);
            for (const [sigName, val] of decodedSignals) {
              this.outputValues.set(sigName, val);
            }
          }
          // Also set raw binary variable if defined
          this.outputValues.set(`frame_${frame.id}`, frame.data);
        }

        // Shift buffer past '\r'
        const remLen = this.rxBufferLen - (delimIdx + 1);
        this.rxBuffer.copyWithin(0, delimIdx + 1, this.rxBufferLen);
        this.rxBufferLen = remLen;
      }
    } else if (this.protocol === "json") {
      let delimIdx: number;
      while ((delimIdx = this.rxBuffer.subarray(0, this.rxBufferLen).indexOf(0x0a)) !== -1) {
        const lineBytes = this.rxBuffer.subarray(0, delimIdx);
        const line = new TextDecoder().decode(lineBytes).trim();

        try {
          if (line) {
            const obj = JSON.parse(line);
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
                this.outputValues.set(k, v);
              }
            }
          }
        } catch {
          /* malformed line, skip */
        }

        const remLen = this.rxBufferLen - (delimIdx + 1);
        this.rxBuffer.copyWithin(0, delimIdx + 1, this.rxBufferLen);
        this.rxBufferLen = remLen;
      }
    }
  }

  private toNumericMap(map: Map<string, CosimValue>): Map<string, number> {
    const res = new Map<string, number>();
    for (const [k, v] of map) {
      if (typeof v === "number") res.set(k, v);
    }
    return res;
  }
}

// ── SLCAN Helpers (ASCII CAN Protocol) ──

/**
 * Format a CAN frame into standard SLCAN ASCII string:
 *   t<id><dlc><data>\r   (11-bit standard)
 *   T<id><dlc><data>\r   (29-bit extended)
 */
export function formatSlcanFrame(id: number, isExtended: boolean, data: Uint8Array): string {
  const dlc = data.length;
  const idStr = isExtended
    ? id.toString(16).toUpperCase().padStart(8, "0")
    : id.toString(16).toUpperCase().padStart(3, "0");
  const prefix = isExtended ? "T" : "t";
  let hex = "";
  for (let i = 0; i < dlc; i++) {
    hex += data[i]!.toString(16).toUpperCase().padStart(2, "0");
  }
  return `${prefix}${idStr}${dlc}${hex}\r`;
}

/**
 * Parse an SLCAN ASCII line (without '\r').
 */
export function parseSlcanLine(line: string): SlcanFrame | null {
  if (!line || line.length < 4) return null;
  const type = line[0];

  if (type === "t") {
    // 11-bit standard data frame: t<id:3><dlc:1><data:2*dlc>
    const id = parseInt(line.substring(1, 4), 16);
    const dlc = parseInt(line[4]!, 10);
    const dataHex = line.substring(5, 5 + dlc * 2);
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataHex.substring(i * 2, i * 2 + 2), 16) || 0;
    }
    return { id, isExtended: false, length: dlc, data };
  } else if (type === "T") {
    // 29-bit extended data frame: T<id:8><dlc:1><data:2*dlc>
    const id = parseInt(line.substring(1, 9), 16);
    const dlc = parseInt(line[9]!, 10);
    const dataHex = line.substring(10, 10 + dlc * 2);
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataHex.substring(i * 2, i * 2 + 2), 16) || 0;
    }
    return { id, isExtended: true, length: dlc, data };
  }

  return null;
}

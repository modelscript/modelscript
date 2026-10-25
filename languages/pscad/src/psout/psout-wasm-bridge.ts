// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly bridge and low-level linear memory manager for psout.wasm.
 */

import { getPsoutWasmBinary } from "./psout-wasm-binary.js";

export interface PsoutWasmExports {
  memory: WebAssembly.Memory;
  psout_alloc_buffer(size: number): number;
  psout_get_buffer_ptr(): number;
  psout_get_buffer_len(): number;
  psout_decode(ptr: number, len: number): number;
  psout_get_page_size(): number;
  psout_get_page_count(): number;
  psout_get_num_runs(): number;
  psout_get_call_count(): number;
  psout_get_call_id(idx: number): number;
  psout_get_call_parent_id(idx: number): number;
  psout_get_call_type(idx: number): number;
  psout_get_call_data_page(idx: number): number;
  psout_get_call_sample_count(idx: number): number;
  psout_get_call_domain_id(idx: number): number;
  psout_get_call_varlist_page(idx: number): number;
  psout_read_samples_from_page(
    filePtr: number,
    fileLen: number,
    startPage: number,
    numPages: number,
    outSamplesPtr: number,
    maxSamples: number,
  ): number;
  psout_read_samples_for_call(
    filePtr: number,
    fileLen: number,
    callId: number,
    outSamplesPtr: number,
    maxSamples: number,
  ): number;
  psout_writer_init(pageSize: number): void;
  psout_writer_set_time(dataPtr: number, count: number): void;
  psout_writer_add_trace(
    namePtr: number,
    nameLen: number,
    unitPtr: number,
    unitLen: number,
    groupPtr: number,
    groupLen: number,
    dataPtr: number,
    count: number,
  ): number;
  psout_writer_build(createdEpochSec: bigint): number;
}

export class PsoutWasmBridge {
  readonly instance: WebAssembly.Instance;
  readonly exports: PsoutWasmExports;

  private constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.exports = instance.exports as unknown as PsoutWasmExports;
  }

  static create(): PsoutWasmBridge {
    const wasmBytes = getPsoutWasmBinary();
    const module = new WebAssembly.Module(wasmBytes.buffer as ArrayBuffer);
    const instance = new WebAssembly.Instance(module, {
      env: {
        abort: (msg: number, file: number, line: number, col: number) => {
          throw new Error(`AssemblyScript abort in psout.wasm at ${file}:${line}:${col} (msg: ${msg})`);
        },
      },
    });
    return new PsoutWasmBridge(instance);
  }

  get memoryBuffer(): ArrayBuffer {
    return this.exports.memory.buffer;
  }

  alloc(size: number): number {
    return this.exports.psout_alloc_buffer(size);
  }

  writeStringToMemory(str: string): { ptr: number; len: number } {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = this.alloc(bytes.length + 4);
    const view = new Uint8Array(this.memoryBuffer, ptr, bytes.length);
    view.set(bytes);
    return { ptr, len: bytes.length };
  }

  writeFloat64ToMemory(data: Float64Array): { ptr: number; len: number; count: number } {
    const byteLen = data.length * 8;
    const ptr = this.alloc(byteLen);
    const view = new Float64Array(this.memoryBuffer, ptr, data.length);
    view.set(data);
    return { ptr, len: byteLen, count: data.length };
  }

  readBytesFromMemory(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memoryBuffer.slice(ptr, ptr + len));
  }
}

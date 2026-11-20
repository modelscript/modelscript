// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative `@modelscript/dsl` Binary-to-SoA Codecs for PSS/E `.sav` and `.out` files.
 *
 * Uses `@modelscript/dsl`'s bidirectional `codec` combinators to:
 *  - Decode/encode binary `.sav` and `.out` files into tightly packed linear-memory SoA tables
 *  - Stream multi-GB `.out` transient trajectories in arbitrary chunks without holding all rows in RAM
 *  - Perform O(1) fixed-stride byte-offset seeking (`readPsseOutWindow`) on `.out` files
 *  - Emit AssemblyScript WASM (`emitAssemblyScriptCodec`) and typed TS SoA views (`emitTypeScriptCodecBindings`)
 */

import {
  createRuntimeBinaryCodec,
  emitAssemblyScriptCodec,
  emitTypeScriptCodecBindings,
  type RandomAccessReader,
  type RuntimeBinaryCodec,
} from "@modelscript/dsl";
import { createPsseSavSoaWasmView, type PsseSavSoaWasmExports } from "../../src-gen/psse-sav-codec.js";
import { psseOutFortranFrameCodecDef, psseOutStreamCodecDef, psseSavSoaCodecDef } from "./codec-defs.js";
import { getSavCodecWasmBinary } from "./sav-codec-wasm-binary.js";

export { psseOutFortranFrameCodecDef, psseOutStreamCodecDef, psseSavSoaCodecDef };

export interface PsseOutStreamFrame {
  time: number;
  values: number[];
}

export interface PsseOutStreamHeader {
  version: number;
  caseTitle: string;
  numChannels: number;
  channelMeta: Array<{ name: string; unit: string }>;
  numSteps: number;
}

export const psseOutStreamCodec: RuntimeBinaryCodec = createRuntimeBinaryCodec(psseOutStreamCodecDef);
export const psseSavSoaCodec: RuntimeBinaryCodec = createRuntimeBinaryCodec(psseSavSoaCodecDef);
export const psseOutFortranFrameCodec: RuntimeBinaryCodec = createRuntimeBinaryCodec(psseOutFortranFrameCodecDef);

/**
 * Streams a `PSSE_OUT` binary file in arbitrary chunks (e.g. Node `fs.createReadStream`
 * or browser `File.stream()`), invoking `onFrame` for each decoded time-step without
 * buffering the entire trajectory in memory.
 */
export async function streamPsseOut(
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  onFrame: (frame: PsseOutStreamFrame, stepIndex: number) => void | Promise<void>,
): Promise<{ header: PsseOutStreamHeader; framesEmitted: number }> {
  const res = await psseOutStreamCodec.decodeStream<PsseOutStreamFrame>(chunks, onFrame);
  return {
    header: res.header as unknown as PsseOutStreamHeader,
    framesEmitted: res.framesEmitted,
  };
}

/**
 * O(1) fixed-stride random-access read of a step window `[startStep, startStep + count)`
 * from a `PSSE_OUT` file or `Blob` without scanning earlier steps.
 */
export async function readPsseOutWindow(
  reader: RandomAccessReader,
  startStep: number,
  count: number,
): Promise<{ header: PsseOutStreamHeader; frames: PsseOutStreamFrame[] }> {
  const res = await psseOutStreamCodec.readSlice<PsseOutStreamFrame>(reader, startStep, count);
  return {
    header: res.header as unknown as PsseOutStreamHeader,
    frames: res.frames,
  };
}

/**
 * Emits AssemblyScript WASM linear-memory codec source for `psseSavSoaCodecDef`.
 */
export function emitPsseSavCodecAssemblyScript(): string {
  return emitAssemblyScriptCodec(psseSavSoaCodecDef);
}

/**
 * Emits strongly typed TypeScript zero-copy SoA bindings for `psseSavSoaCodecDef`.
 */
export function emitPsseSavCodecTypeScriptBindings(): string {
  return emitTypeScriptCodecBindings(psseSavSoaCodecDef);
}

let cachedSavCodecModule: WebAssembly.Module | undefined;

/**
 * Instantiates the compiled AssemblyScript WASM binary codec (`psse-sav-codec.wasm`)
 * and returns a strongly typed zero-copy linear-memory SoA view (`decode`, `encode`,
 * `decodeStream`, and direct `Int32Array`/`Float64Array` column accessors over `wasmMemory.buffer`).
 */
export function createPsseSavWasmCodec() {
  if (!cachedSavCodecModule) {
    const bytes = getSavCodecWasmBinary();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    cachedSavCodecModule = new WebAssembly.Module(copy);
  }
  const instance = new WebAssembly.Instance(cachedSavCodecModule, {
    env: {
      abort() {
        throw new Error("psse-sav-codec.wasm aborted");
      },
    },
  });
  return createPsseSavSoaWasmView(instance.exports as unknown as PsseSavSoaWasmExports);
}

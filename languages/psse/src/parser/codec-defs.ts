// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure declarative `@modelscript/dsl` Binary Codec definitions for PSS/E `.sav` and `.out` files.
 *
 * Kept free of generated `src-gen/` imports so both build scripts (`scripts/build-wasm.js`)
 * and runtime modules (`codecs.ts`, `language.ts`) share a single source of truth.
 */

import { codec, defineBinaryCodec } from "@modelscript/dsl";

/**
 * Native ModelScript `PSSE_OUT` 64-bit IEEE 754 channel output codec.
 *
 * Layout:
 *   magic("PSSE_OUT") | u32 version | lenPrefixedStr title
 *   | u32 numChannels | repeat(numChannels, { name, unit })
 *   | u32 numSteps
 *   | repeat(numSteps, { time: f64, values: repeat(numChannels, f64) })   <-- streamable & O(1) seekable!
 */
export const psseOutStreamCodecDef = defineBinaryCodec({
  name: "psse_out_stream",
  endian: "le",
  versions: [33, 34, 35, 36],
  root: codec.struct({
    magic: codec.magic("PSSE_OUT"),
    version: codec.u32(),
    caseTitle: codec.lenPrefixedStr("u32"),
    numChannels: codec.u32(),
    channelMeta: codec.repeat(
      "numChannels",
      codec.struct({
        name: codec.lenPrefixedStr("u32"),
        unit: codec.lenPrefixedStr("u32"),
      }),
    ),
    numSteps: codec.u32(),
    frames: codec.repeat(
      "numSteps",
      codec.struct({
        time: codec.f64(),
        values: codec.repeat("numChannels", codec.f64()),
      }),
    ),
  }),
});

/**
 * Linear-memory SoA codec for PSS/E `.sav` bus/branch/generator binary snapshots.
 * Compiles directly to AssemblyScript WASM (`emitAssemblyScriptCodec`) and zero-copy TS views.
 */
export const psseSavSoaCodecDef = defineBinaryCodec({
  name: "psse_sav_soa",
  endian: "le",
  versions: [26, 29, 30, 31, 32, 33, 34, 35, 36],
  root: codec.struct({
    magic: codec.magic("PSSE_SOA"),
    version: codec.u32(),
    rev: codec.i32(),
    sbase: codec.f64(),
    basfrq: codec.f64(),
    busCount: codec.u32(),
    buses: codec.soaTable(
      "buses",
      {
        i: codec.i32(),
        ide: codec.i32(),
        area: codec.i32(),
        zone: codec.i32(),
        owner: codec.i32(),
        baseKv: codec.f64(),
        vm: codec.f64(),
        va: codec.f64(),
      },
      { countField: "busCount" },
    ),
    branchCount: codec.u32(),
    branches: codec.soaTable(
      "branches",
      {
        i: codec.i32(),
        j: codec.i32(),
        st: codec.i32(),
        r: codec.f64(),
        x: codec.f64(),
        b: codec.f64(),
        rateA: codec.f64(),
      },
      { countField: "branchCount" },
    ),
    genCount: codec.u32(),
    generators: codec.soaTable(
      "generators",
      {
        i: codec.i32(),
        stat: codec.i32(),
        pg: codec.f64(),
        qg: codec.f64(),
        qt: codec.f64(),
        qb: codec.f64(),
        vs: codec.f64(),
        mbase: codec.f64(),
      },
      { countField: "genCount" },
    ),
  }),
});

/**
 * Legacy PSS/E v33/v34 Fortran unformatted sequential `.out` time-step frame codec
 * using `codec.fortranRecord(...)` (4-byte leading + trailing record length markers).
 */
export const psseOutFortranFrameCodecDef = defineBinaryCodec({
  name: "psse_out_fortran_frame",
  endian: "le",
  versions: [33, 34],
  root: codec.struct({
    numChannels: codec.u32(),
    records: codec.repeatUntilEof(
      codec.fortranRecord(
        codec.struct({
          time: codec.f32(),
          values: codec.repeat("numChannels", codec.f32()),
        }),
        4,
      ),
    ),
  }),
});

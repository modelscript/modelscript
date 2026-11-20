// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Binary Saved Case (`.sav`) & Dynamic Channel Output (`.out`) Serializer/Deserializer.
 *
 * Fully powered by `@modelscript/dsl` declarative bidirectional binary codecs:
 *   1. Compact binary `.sav` power flow case snapshot read/write (`serializePsseSav`, `parsePsseSav`)
 *      plus compiled AssemblyScript WASM linear-memory SoA codec (`createPsseSavWasmCodec`).
 *   2. Binary `.out` dynamic simulation channel output read/write (`serializePsseOut`,
 *      `serializeFortranUnformattedPsseOut`, `parsePsseOut`) plus chunked streaming (`streamPsseOut`)
 *      and O(1) fixed-stride window seeking (`readPsseOutWindow`).
 */

import { codec, createRuntimeBinaryCodec, defineBinaryCodec } from "@modelscript/dsl";
import type { PsseTransientResult } from "../solver/ac-powerflow.js";
import {
  type AreaRecord,
  type BranchRecord,
  type BusRecord,
  type BusType,
  type FixedShuntRecord,
  type GeneratorRecord,
  type LoadRecord,
  type PsseCase,
  type SwitchedShuntRecord,
  type TransformerRecord,
  type TwoTerminalDcRecord,
  type VscDcRecord,
} from "../types.js";
export { createPsseSavWasmCodec, readPsseOutWindow, streamPsseOut } from "./codecs.js";

const SAV_MAGIC = "PSSE_SAV";
const OUT_MAGIC = "PSSE_OUT";
const FORMAT_VERSION = 35;

/**
 * Parsed PSS/E `.out` dynamic channel output file.
 */
export interface PsseOutChannelData {
  version: number;
  caseTitle: string;
  channelNames: string[];
  channelUnits: string[];
  time: Float64Array;
  /** Channel values indexed by channel index (0..numChannels-1), each of length `time.length`. */
  channels: Float64Array[];
  /** Lookup map by channel name (`delta_Bus1_deg`, `Vm_Bus1_pu`, etc.). */
  byName: Record<string, Float64Array>;
}

/**
 * Declarative `@modelscript/dsl` bidirectional codec for full PSS/E `.sav` binary snapshots
 * (buses, loads, fixed shunts, generators, branches, transformers, areas, switched shunts).
 */
const psseSavFullCodec = createRuntimeBinaryCodec(
  defineBinaryCodec({
    name: "psse_sav_full",
    endian: "le",
    versions: [26, 29, 30, 31, 32, 33, 34, 35, 36],
    root: codec.struct({
      magic: codec.magic(SAV_MAGIC),
      version: codec.u32(),
      ic: codec.i32(),
      sbase: codec.f64(),
      rev: codec.i32(),
      xfrrat: codec.f64(),
      nxfrat: codec.f64(),
      basfrq: codec.f64(),
      title1: codec.lenPrefixedStr("u32"),
      title2: codec.lenPrefixedStr("u32"),
      busCount: codec.u32(),
      buses: codec.repeat(
        "busCount",
        codec.struct({
          i: codec.i32(),
          name: codec.fixedStr(12),
          baseKv: codec.f64(),
          ide: codec.i32(),
          area: codec.i32(),
          zone: codec.i32(),
          owner: codec.i32(),
          vm: codec.f64(),
          va: codec.f64(),
          nvhi: codec.f64(),
          nvlo: codec.f64(),
          evhi: codec.f64(),
          evlo: codec.f64(),
        }),
      ),
      loadCount: codec.u32(),
      loads: codec.repeat(
        "loadCount",
        codec.struct({
          i: codec.i32(),
          id: codec.fixedStr(2),
          status: codec.i32(),
          area: codec.i32(),
          zone: codec.i32(),
          pl: codec.f64(),
          ql: codec.f64(),
          ip: codec.f64(),
          iq: codec.f64(),
          yp: codec.f64(),
          yq: codec.f64(),
          owner: codec.i32(),
          scale: codec.i32(),
          intrct: codec.i32(),
        }),
      ),
      shuntCount: codec.u32(),
      fixedShunts: codec.repeat(
        "shuntCount",
        codec.struct({
          i: codec.i32(),
          id: codec.fixedStr(2),
          status: codec.i32(),
          gl: codec.f64(),
          bl: codec.f64(),
        }),
      ),
      genCount: codec.u32(),
      generators: codec.repeat(
        "genCount",
        codec.struct({
          i: codec.i32(),
          id: codec.fixedStr(2),
          pg: codec.f64(),
          qg: codec.f64(),
          qt: codec.f64(),
          qb: codec.f64(),
          vs: codec.f64(),
          ireg: codec.i32(),
          mbase: codec.f64(),
          zr: codec.f64(),
          zx: codec.f64(),
          rt: codec.f64(),
          xt: codec.f64(),
          gtap: codec.f64(),
          stat: codec.i32(),
          rmpct: codec.f64(),
          pt: codec.f64(),
          pb: codec.f64(),
        }),
      ),
      branchCount: codec.u32(),
      branches: codec.repeat(
        "branchCount",
        codec.struct({
          i: codec.i32(),
          j: codec.i32(),
          ckt: codec.fixedStr(2),
          r: codec.f64(),
          x: codec.f64(),
          b: codec.f64(),
          rateA: codec.f64(),
          rateB: codec.f64(),
          rateC: codec.f64(),
          gi: codec.f64(),
          bi: codec.f64(),
          gj: codec.f64(),
          bj: codec.f64(),
          st: codec.i32(),
          met: codec.i32(),
          len: codec.f64(),
        }),
      ),
      xfmrCount: codec.u32(),
      transformers: codec.repeat(
        "xfmrCount",
        codec.struct({
          i: codec.i32(),
          j: codec.i32(),
          k: codec.i32(),
          ckt: codec.fixedStr(2),
          cw: codec.i32(),
          cm: codec.i32(),
          mag1: codec.f64(),
          mag2: codec.f64(),
          nmetr: codec.i32(),
          name: codec.fixedStr(12),
          stat: codec.i32(),
          r12: codec.f64(),
          x12: codec.f64(),
          sbase12: codec.f64(),
          windv1: codec.f64(),
          nomv1: codec.f64(),
          ang1: codec.f64(),
          rata1: codec.f64(),
          ratb1: codec.f64(),
          ratc1: codec.f64(),
          cod1: codec.i32(),
          cont1: codec.i32(),
          rma1: codec.f64(),
          rmi1: codec.f64(),
          vma1: codec.f64(),
          vmi1: codec.f64(),
          ntp1: codec.i32(),
          tab1: codec.i32(),
          cr1: codec.f64(),
          cx1: codec.f64(),
          cnxa1: codec.f64(),
          windv2: codec.f64(),
          nomv2: codec.f64(),
        }),
      ),
      areaCount: codec.u32(),
      areas: codec.repeat(
        "areaCount",
        codec.struct({
          i: codec.i32(),
          isw: codec.i32(),
          pdes: codec.f64(),
          ptol: codec.f64(),
          arname: codec.fixedStr(12),
        }),
      ),
      swShuntCount: codec.u32(),
      switchedShunts: codec.repeat(
        "swShuntCount",
        codec.struct({
          i: codec.i32(),
          modsw: codec.i32(),
          adjm: codec.i32(),
          stat: codec.i32(),
          vswhi: codec.f64(),
          vswlo: codec.f64(),
          swrem: codec.i32(),
          rmpct: codec.f64(),
          rmidnt: codec.fixedStr(12),
          binit: codec.f64(),
          n1: codec.i32(),
          b1: codec.f64(),
        }),
      ),
    }),
  }),
);

/**
 * Declarative `@modelscript/dsl` codec for ModelScript's channel-major `PSSE_OUT` 64-bit format.
 */
const psseOutChannelMajorCodec = createRuntimeBinaryCodec(
  defineBinaryCodec({
    name: "psse_out_channel_major",
    endian: "le",
    versions: [33, 34, 35, 36],
    root: codec.struct({
      magic: codec.magic(OUT_MAGIC),
      version: codec.u32(),
      caseTitle: codec.lenPrefixedStr("u32"),
      nChannels: codec.u32(),
      nSteps: codec.u32(),
      channelMeta: codec.repeat(
        "nChannels",
        codec.struct({
          name: codec.lenPrefixedStr("u32"),
          unit: codec.lenPrefixedStr("u32"),
        }),
      ),
      time: codec.repeat("nSteps", codec.f64()),
      channels: codec.repeat("nChannels", codec.repeat("nSteps", codec.f64())),
    }),
  }),
);

/**
 * Declarative `@modelscript/dsl` header codec for legacy PSS/E v33/v34 Fortran unformatted `.out`.
 */
const psseOutFortranHeaderCodec = createRuntimeBinaryCodec(
  defineBinaryCodec({
    name: "psse_out_fortran_legacy",
    endian: "le",
    versions: [33, 34],
    root: codec.struct({
      headerRec: codec.fortranRecord(
        codec.struct({
          tag: codec.fixedStr(8),
          nChannels: codec.i32(),
        }),
        4,
      ),
      titleRec: codec.fortranRecord(
        codec.struct({
          title1: codec.fixedStr(60),
          title2: codec.fixedStr(60),
        }),
        4,
      ),
    }),
  }),
);

/**
 * Checks whether a byte buffer has the PSS/E `.sav` binary magic signature.
 */
export function isPsseSavBuffer(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 12) return false;
  for (let i = 0; i < SAV_MAGIC.length; i++) {
    if (buffer[i] !== SAV_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Serializes a `PsseCase` into a binary `.sav` snapshot buffer via `@modelscript/dsl` `psseSavFullCodec`.
 */
export function serializePsseSav(psseCase: PsseCase): Uint8Array {
  const buses = Array.from(psseCase.buses.values()).map((b) => ({
    ...b,
    nvhi: b.nvhi ?? 1.1,
    nvlo: b.nvlo ?? 0.9,
    evhi: b.evhi ?? 1.1,
    evlo: b.evlo ?? 0.9,
  }));
  return psseSavFullCodec.encode({
    magic: SAV_MAGIC,
    version: FORMAT_VERSION,
    ic: psseCase.header.ic,
    sbase: psseCase.header.sbase,
    rev: psseCase.header.rev,
    xfrrat: psseCase.header.xfrrat,
    nxfrat: psseCase.header.nxfrat,
    basfrq: psseCase.header.basfrq,
    title1: psseCase.title1,
    title2: psseCase.title2,
    busCount: buses.length,
    buses,
    loadCount: psseCase.loads.length,
    loads: psseCase.loads,
    shuntCount: psseCase.fixedShunts.length,
    fixedShunts: psseCase.fixedShunts,
    genCount: psseCase.generators.length,
    generators: psseCase.generators,
    branchCount: psseCase.branches.length,
    branches: psseCase.branches,
    xfmrCount: psseCase.transformers.length,
    transformers: psseCase.transformers,
    areaCount: psseCase.areas.length,
    areas: psseCase.areas,
    swShuntCount: psseCase.switchedShunts.length,
    switchedShunts: psseCase.switchedShunts,
  });
}

/**
 * Deserializes a binary `.sav` buffer into a `PsseCase` via `@modelscript/dsl` `psseSavFullCodec`.
 */
export function parsePsseSav(buffer: Uint8Array): PsseCase {
  const d = psseSavFullCodec.decode(buffer) as {
    ic: number;
    sbase: number;
    rev: number;
    xfrrat: number;
    nxfrat: number;
    basfrq: number;
    title1: string;
    title2: string;
    buses: BusRecord[];
    loads: LoadRecord[];
    fixedShunts: FixedShuntRecord[];
    generators: GeneratorRecord[];
    branches: BranchRecord[];
    transformers: TransformerRecord[];
    areas: AreaRecord[];
    switchedShunts: SwitchedShuntRecord[];
  };

  const buses = new Map<number, BusRecord>();
  for (const b of d.buses) {
    buses.set(b.i, { ...b, ide: b.ide as BusType });
  }

  return {
    header: {
      ic: d.ic,
      sbase: d.sbase,
      rev: d.rev,
      xfrrat: d.xfrrat,
      nxfrat: d.nxfrat,
      basfrq: d.basfrq,
    },
    title1: d.title1,
    title2: d.title2,
    buses,
    loads: d.loads,
    fixedShunts: d.fixedShunts,
    generators: d.generators,
    branches: d.branches,
    transformers: d.transformers,
    areas: d.areas,
    twoTerminalDc: [] as TwoTerminalDcRecord[],
    vscDc: [] as VscDcRecord[],
    switchedShunts: d.switchedShunts,
  };
}

/**
 * Infers unit string from PSS/E channel identifier suffix.
 */
function inferChannelUnit(name: string): string {
  if (name.endsWith("_deg")) return "deg";
  if (name.endsWith("_Hz")) return "Hz";
  if (name.endsWith("_MW")) return "MW";
  if (name.endsWith("_Mvar")) return "Mvar";
  if (name.endsWith("_pu")) return "pu";
  if (name.endsWith("_kA")) return "kA";
  return "";
}

/**
 * Serializes a `PsseTransientResult` into a binary `.out` dynamic channel file
 * via `@modelscript/dsl`'s declarative bidirectional `psseOutChannelMajorCodec`.
 */
export function serializePsseOut(
  result: PsseTransientResult,
  caseTitle = "PSS/E Dynamic Simulation Output",
): Uint8Array {
  const nChannels = result.states.length;
  const nSteps = result.t.length;
  return psseOutChannelMajorCodec.encode({
    magic: OUT_MAGIC,
    version: FORMAT_VERSION,
    caseTitle,
    nChannels,
    nSteps,
    channelMeta: result.states.map((chName) => ({
      name: chName,
      unit: inferChannelUnit(chName),
    })),
    time: Array.from({ length: nSteps }, (_, k) => result.t[k] ?? 0.0),
    channels: Array.from({ length: nChannels }, (_, c) => {
      const series = result.y[c] ?? [];
      return Array.from({ length: nSteps }, (_, k) => series[k] ?? 0.0);
    }),
  });
}

/**
 * Serializes a `PsseTransientResult` into a legacy PSS/E v33/v34 Fortran unformatted
 * sequential binary `.out` file (`[recLen: u32][payload][recLen: u32]` with `REAL*4` frames)
 * using `@modelscript/dsl`'s `fortranRecord` codec combinators.
 */
export function serializeFortranUnformattedPsseOut(
  result: PsseTransientResult,
  caseTitle = "PSS/E v33 Dynamic Simulation Output",
): Uint8Array {
  const nChannels = result.states.length;
  const nSteps = result.t.length;
  const fullFortranCodec = createRuntimeBinaryCodec(
    defineBinaryCodec({
      name: "psse_out_fortran_full",
      endian: "le",
      versions: [33, 34],
      root: codec.struct({
        headerRec: codec.fortranRecord(
          codec.struct({
            tag: codec.fixedStr(8),
            nChannels: codec.i32(),
          }),
          4,
        ),
        titleRec: codec.fortranRecord(
          codec.struct({
            title1: codec.fixedStr(60),
            title2: codec.fixedStr(60),
          }),
          4,
        ),
        namesRec: codec.fortranRecord(codec.repeat(nChannels, codec.fixedStr(32)), 4),
        steps: codec.repeat(
          nSteps,
          codec.fortranRecord(
            codec.struct({
              time: codec.f32(),
              values: codec.repeat(nChannels, codec.f32()),
            }),
            4,
          ),
        ),
      }),
    }),
  );

  return fullFortranCodec.encode({
    headerRec: { tag: "PSSOUT33", nChannels },
    titleRec: { title1: caseTitle, title2: "MODELSCRIPT PSSE DYNAMIC SIMULATION" },
    namesRec: Array.from({ length: nChannels }, (_, c) => result.states[c] ?? `CH_${c + 1}`),
    steps: Array.from({ length: nSteps }, (_, k) => ({
      time: result.t[k] ?? 0.0,
      values: Array.from({ length: nChannels }, (_, c) => result.y[c]?.[k] ?? 0.0),
    })),
  });
}

/**
 * Deserializes a binary `.out` dynamic channel output buffer into `PsseOutChannelData`.
 * Automatically detects both ModelScript `"PSSE_OUT"` (64-bit float) and legacy PSS/E v33/v34
 * Fortran unformatted sequential binary `.out` records (`REAL*4` float32 frames), decoded via
 * `@modelscript/dsl`'s bidirectional binary codecs.
 */
export function parsePsseOut(buffer: Uint8Array): PsseOutChannelData {
  if (buffer.byteLength >= 20) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const firstRecLen = view.getUint32(0, true);
    if (firstRecLen === 12) {
      let tag = "";
      for (let i = 0; i < 6; i++) {
        tag += String.fromCharCode(buffer[4 + i]!);
      }
      if (tag === "PSSOUT") {
        const hdr = psseOutFortranHeaderCodec.decode(buffer.subarray(0, Math.min(buffer.byteLength, 200))) as {
          headerRec: { tag: string; nChannels: number };
          titleRec: { title1: string; title2: string };
        };
        const nChannels = hdr.headerRec.nChannels;
        const fullFortranCodec = createRuntimeBinaryCodec(
          defineBinaryCodec({
            name: "psse_out_fortran_decode",
            endian: "le",
            versions: [33, 34],
            root: codec.struct({
              headerRec: codec.fortranRecord(
                codec.struct({
                  tag: codec.fixedStr(8),
                  nChannels: codec.i32(),
                }),
                4,
              ),
              titleRec: codec.fortranRecord(
                codec.struct({
                  title1: codec.fixedStr(60),
                  title2: codec.fixedStr(60),
                }),
                4,
              ),
              namesRec: codec.fortranRecord(codec.repeat(nChannels, codec.fixedStr(32)), 4),
              steps: codec.repeatUntilEof(
                codec.fortranRecord(
                  codec.struct({
                    time: codec.f32(),
                    values: codec.repeat(nChannels, codec.f32()),
                  }),
                  4,
                ),
              ),
            }),
          }),
        );

        const decoded = fullFortranCodec.decode(buffer) as {
          titleRec: { title1: string };
          namesRec: string[];
          steps: Array<{ time: number; values: number[] }>;
        };
        const nSteps = decoded.steps.length;
        const time = new Float64Array(nSteps);
        const channels: Float64Array[] = Array.from({ length: nChannels }, () => new Float64Array(nSteps));
        for (let k = 0; k < nSteps; k++) {
          const st = decoded.steps[k]!;
          time[k] = st.time;
          for (let c = 0; c < nChannels; c++) {
            channels[c]![k] = st.values[c] ?? 0.0;
          }
        }
        const channelNames = decoded.namesRec;
        const channelUnits = channelNames.map((n) => inferChannelUnit(n));
        const byName: Record<string, Float64Array> = {};
        for (let c = 0; c < nChannels; c++) {
          byName[channelNames[c]!] = channels[c]!;
        }
        return {
          version: 33,
          caseTitle: decoded.titleRec.title1,
          channelNames,
          channelUnits,
          time,
          channels,
          byName,
        };
      }
    }
  }

  const decoded = psseOutChannelMajorCodec.decode(buffer) as {
    version: number;
    caseTitle: string;
    nChannels: number;
    nSteps: number;
    channelMeta: Array<{ name: string; unit: string }>;
    time: number[];
    channels: number[][];
  };

  const channelNames = decoded.channelMeta.map((m) => m.name);
  const channelUnits = decoded.channelMeta.map((m) => m.unit);
  const time = Float64Array.from(decoded.time);
  const channels: Float64Array[] = [];
  const byName: Record<string, Float64Array> = {};
  for (let c = 0; c < decoded.nChannels; c++) {
    const arr = Float64Array.from(decoded.channels[c] ?? []);
    channels.push(arr);
    byName[channelNames[c]!] = arr;
  }

  return {
    version: decoded.version,
    caseTitle: decoded.caseTitle,
    channelNames,
    channelUnits,
    time,
    channels,
    byName,
  };
}

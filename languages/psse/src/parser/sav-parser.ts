// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Binary Saved Case (`.sav`) & Dynamic Channel Output (`.out`) Serializer/Deserializer.
 *
 * Implements:
 *   1. Compact binary `.sav` power flow case snapshot read/write (`serializePsseSav`, `parsePsseSav`)
 *      with IEEE 754 float64/int32 record blocks for buses, loads, shunts, generators,
 *      branches, transformers, areas, HVDC, and switched shunts.
 *   2. Binary `.out` dynamic simulation channel output read/write (`serializePsseOut`, `parsePsseOut`)
 *      supporting PSS/E `chnf` / `chier` channel metadata and IEEE 754 time-series trajectories.
 */

import type { PsseTransientResult } from "../solver/ac-powerflow.js";
import {
  type AreaRecord,
  type BranchRecord,
  type BusRecord,
  BusType,
  type FixedShuntRecord,
  type GeneratorRecord,
  type LoadRecord,
  type PsseCase,
  type SwitchedShuntRecord,
  type TransformerRecord,
  type TwoTerminalDcRecord,
  type VscDcRecord,
} from "../types.js";

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

class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 16384) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(bytes: number): void {
    if (this.offset + bytes <= this.buf.byteLength) return;
    let nextCap = this.buf.byteLength * 2;
    while (nextCap < this.offset + bytes) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeAsciiFixed(str: string, len: number): void {
    this.ensure(len);
    for (let i = 0; i < len; i++) {
      this.buf[this.offset + i] = i < str.length ? str.charCodeAt(i) & 0x7f : 0x20;
    }
    this.offset += len;
  }

  writeString(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.writeU32(encoded.byteLength);
    this.ensure(encoded.byteLength);
    this.buf.set(encoded, this.offset);
    this.offset += encoded.byteLength;
  }

  writeI32(val: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, val | 0, true);
    this.offset += 4;
  }

  writeU32(val: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, val >>> 0, true);
    this.offset += 4;
  }

  writeF64(val: number): void {
    this.ensure(8);
    this.view.setFloat64(this.offset, Number.isFinite(val) ? val : 0.0, true);
    this.offset += 8;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }
}

class BinaryReader {
  private view: DataView;
  private offset = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readAsciiFixed(len: number): string {
    if (this.offset + len > this.buf.byteLength) {
      throw new Error("Unexpected EOF reading fixed ASCII string in PSS/E binary stream.");
    }
    let out = "";
    for (let i = 0; i < len; i++) {
      out += String.fromCharCode(this.buf[this.offset + i]!);
    }
    this.offset += len;
    return out;
  }

  readString(): string {
    const len = this.readU32();
    if (this.offset + len > this.buf.byteLength) {
      throw new Error("Unexpected EOF reading UTF-8 string in PSS/E binary stream.");
    }
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder().decode(slice);
  }

  readI32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readF64(): number {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }
}

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
 * Serializes a `PsseCase` into a binary `.sav` snapshot buffer.
 */
export function serializePsseSav(psseCase: PsseCase): Uint8Array {
  const w = new BinaryWriter(Math.max(4096, psseCase.buses.size * 128));
  w.writeAsciiFixed(SAV_MAGIC, 8);
  w.writeU32(FORMAT_VERSION);

  // Header & titles
  w.writeI32(psseCase.header.ic);
  w.writeF64(psseCase.header.sbase);
  w.writeI32(psseCase.header.rev);
  w.writeF64(psseCase.header.xfrrat);
  w.writeF64(psseCase.header.nxfrat);
  w.writeF64(psseCase.header.basfrq);
  w.writeString(psseCase.title1);
  w.writeString(psseCase.title2);

  // 1. Buses
  const buses = Array.from(psseCase.buses.values());
  w.writeU32(buses.length);
  for (const b of buses) {
    w.writeI32(b.i);
    w.writeAsciiFixed(b.name, 12);
    w.writeF64(b.baseKv);
    w.writeI32(b.ide);
    w.writeI32(b.area);
    w.writeI32(b.zone);
    w.writeI32(b.owner);
    w.writeF64(b.vm);
    w.writeF64(b.va);
    w.writeF64(b.nvhi ?? 1.1);
    w.writeF64(b.nvlo ?? 0.9);
    w.writeF64(b.evhi ?? 1.1);
    w.writeF64(b.evlo ?? 0.9);
  }

  // 2. Loads
  w.writeU32(psseCase.loads.length);
  for (const ld of psseCase.loads) {
    w.writeI32(ld.i);
    w.writeAsciiFixed(ld.id, 2);
    w.writeI32(ld.status);
    w.writeI32(ld.area);
    w.writeI32(ld.zone);
    w.writeF64(ld.pl);
    w.writeF64(ld.ql);
    w.writeF64(ld.ip);
    w.writeF64(ld.iq);
    w.writeF64(ld.yp);
    w.writeF64(ld.yq);
    w.writeI32(ld.owner);
    w.writeI32(ld.scale);
    w.writeI32(ld.intrct);
  }

  // 3. Fixed Shunts
  w.writeU32(psseCase.fixedShunts.length);
  for (const sh of psseCase.fixedShunts) {
    w.writeI32(sh.i);
    w.writeAsciiFixed(sh.id, 2);
    w.writeI32(sh.status);
    w.writeF64(sh.gl);
    w.writeF64(sh.bl);
  }

  // 4. Generators
  w.writeU32(psseCase.generators.length);
  for (const g of psseCase.generators) {
    w.writeI32(g.i);
    w.writeAsciiFixed(g.id, 2);
    w.writeF64(g.pg);
    w.writeF64(g.qg);
    w.writeF64(g.qt);
    w.writeF64(g.qb);
    w.writeF64(g.vs);
    w.writeI32(g.ireg);
    w.writeF64(g.mbase);
    w.writeF64(g.zr);
    w.writeF64(g.zx);
    w.writeF64(g.rt);
    w.writeF64(g.xt);
    w.writeF64(g.gtap);
    w.writeI32(g.stat);
    w.writeF64(g.rmpct);
    w.writeF64(g.pt);
    w.writeF64(g.pb);
  }

  // 5. Branches
  w.writeU32(psseCase.branches.length);
  for (const br of psseCase.branches) {
    w.writeI32(br.i);
    w.writeI32(br.j);
    w.writeAsciiFixed(br.ckt, 2);
    w.writeF64(br.r);
    w.writeF64(br.x);
    w.writeF64(br.b);
    w.writeF64(br.rateA);
    w.writeF64(br.rateB);
    w.writeF64(br.rateC);
    w.writeF64(br.gi);
    w.writeF64(br.bi);
    w.writeF64(br.gj);
    w.writeF64(br.bj);
    w.writeI32(br.st);
    w.writeI32(br.met);
    w.writeF64(br.len);
  }

  // 6. Transformers
  w.writeU32(psseCase.transformers.length);
  for (const xf of psseCase.transformers) {
    w.writeI32(xf.i);
    w.writeI32(xf.j);
    w.writeI32(xf.k);
    w.writeAsciiFixed(xf.ckt, 2);
    w.writeI32(xf.cw);
    w.writeI32(xf.cm);
    w.writeF64(xf.mag1);
    w.writeF64(xf.mag2);
    w.writeI32(xf.nmetr);
    w.writeAsciiFixed(xf.name, 12);
    w.writeI32(xf.stat);
    w.writeF64(xf.r12);
    w.writeF64(xf.x12);
    w.writeF64(xf.sbase12);
    w.writeF64(xf.windv1);
    w.writeF64(xf.nomv1);
    w.writeF64(xf.ang1);
    w.writeF64(xf.rata1);
    w.writeF64(xf.ratb1);
    w.writeF64(xf.ratc1);
    w.writeI32(xf.cod1);
    w.writeI32(xf.cont1);
    w.writeF64(xf.rma1);
    w.writeF64(xf.rmi1);
    w.writeF64(xf.vma1);
    w.writeF64(xf.vmi1);
    w.writeI32(xf.ntp1);
    w.writeI32(xf.tab1);
    w.writeF64(xf.cr1);
    w.writeF64(xf.cx1);
    w.writeF64(xf.cnxa1);
    w.writeF64(xf.windv2);
    w.writeF64(xf.nomv2);
  }

  // 7. Areas
  w.writeU32(psseCase.areas.length);
  for (const ar of psseCase.areas) {
    w.writeI32(ar.i);
    w.writeI32(ar.isw);
    w.writeF64(ar.pdes);
    w.writeF64(ar.ptol);
    w.writeAsciiFixed(ar.arname, 12);
  }

  // 8. Switched Shunts
  w.writeU32(psseCase.switchedShunts.length);
  for (const sw of psseCase.switchedShunts) {
    w.writeI32(sw.i);
    w.writeI32(sw.modsw);
    w.writeI32(sw.adjm);
    w.writeI32(sw.stat);
    w.writeF64(sw.vswhi);
    w.writeF64(sw.vswlo);
    w.writeI32(sw.swrem);
    w.writeF64(sw.rmpct);
    w.writeAsciiFixed(sw.rmidnt, 12);
    w.writeF64(sw.binit);
    w.writeI32(sw.n1);
    w.writeF64(sw.b1);
  }

  return w.finish();
}

/**
 * Deserializes a binary `.sav` buffer into a `PsseCase`.
 */
export function parsePsseSav(buffer: Uint8Array): PsseCase {
  const r = new BinaryReader(buffer);
  const magic = r.readAsciiFixed(8);
  if (magic !== SAV_MAGIC) {
    throw new Error(`Invalid PSS/E .sav file magic header: expected '${SAV_MAGIC}', got '${magic}'.`);
  }
  r.readU32(); // version

  const header = {
    ic: r.readI32(),
    sbase: r.readF64(),
    rev: r.readI32(),
    xfrrat: r.readF64(),
    nxfrat: r.readF64(),
    basfrq: r.readF64(),
  };
  const title1 = r.readString();
  const title2 = r.readString();

  // 1. Buses
  const nBuses = r.readU32();
  const buses = new Map<number, BusRecord>();
  for (let idx = 0; idx < nBuses; idx++) {
    const i = r.readI32();
    const name = r.readAsciiFixed(12).trimEnd();
    const baseKv = r.readF64();
    const ide = r.readI32() as BusType;
    const area = r.readI32();
    const zone = r.readI32();
    const owner = r.readI32();
    const vm = r.readF64();
    const va = r.readF64();
    const nvhi = r.readF64();
    const nvlo = r.readF64();
    const evhi = r.readF64();
    const evlo = r.readF64();
    buses.set(i, {
      i,
      name,
      baseKv,
      ide: ide in BusType ? ide : BusType.PQ,
      area,
      zone,
      owner,
      vm,
      va,
      nvhi,
      nvlo,
      evhi,
      evlo,
    });
  }

  // 2. Loads
  const nLoads = r.readU32();
  const loads: LoadRecord[] = [];
  for (let idx = 0; idx < nLoads; idx++) {
    loads.push({
      i: r.readI32(),
      id: r.readAsciiFixed(2).trim() || "1",
      status: r.readI32(),
      area: r.readI32(),
      zone: r.readI32(),
      pl: r.readF64(),
      ql: r.readF64(),
      ip: r.readF64(),
      iq: r.readF64(),
      yp: r.readF64(),
      yq: r.readF64(),
      owner: r.readI32(),
      scale: r.readI32(),
      intrct: r.readI32(),
    });
  }

  // 3. Fixed Shunts
  const nShunts = r.readU32();
  const fixedShunts: FixedShuntRecord[] = [];
  for (let idx = 0; idx < nShunts; idx++) {
    fixedShunts.push({
      i: r.readI32(),
      id: r.readAsciiFixed(2).trim() || "1",
      status: r.readI32(),
      gl: r.readF64(),
      bl: r.readF64(),
    });
  }

  // 4. Generators
  const nGens = r.readU32();
  const generators: GeneratorRecord[] = [];
  for (let idx = 0; idx < nGens; idx++) {
    generators.push({
      i: r.readI32(),
      id: r.readAsciiFixed(2).trim() || "1",
      pg: r.readF64(),
      qg: r.readF64(),
      qt: r.readF64(),
      qb: r.readF64(),
      vs: r.readF64(),
      ireg: r.readI32(),
      mbase: r.readF64(),
      zr: r.readF64(),
      zx: r.readF64(),
      rt: r.readF64(),
      xt: r.readF64(),
      gtap: r.readF64(),
      stat: r.readI32(),
      rmpct: r.readF64(),
      pt: r.readF64(),
      pb: r.readF64(),
    });
  }

  // 5. Branches
  const nBranches = r.readU32();
  const branches: BranchRecord[] = [];
  for (let idx = 0; idx < nBranches; idx++) {
    branches.push({
      i: r.readI32(),
      j: r.readI32(),
      ckt: r.readAsciiFixed(2).trim() || "1",
      r: r.readF64(),
      x: r.readF64(),
      b: r.readF64(),
      rateA: r.readF64(),
      rateB: r.readF64(),
      rateC: r.readF64(),
      gi: r.readF64(),
      bi: r.readF64(),
      gj: r.readF64(),
      bj: r.readF64(),
      st: r.readI32(),
      met: r.readI32(),
      len: r.readF64(),
    });
  }

  // 6. Transformers
  const nXfmrs = r.readU32();
  const transformers: TransformerRecord[] = [];
  for (let idx = 0; idx < nXfmrs; idx++) {
    transformers.push({
      i: r.readI32(),
      j: r.readI32(),
      k: r.readI32(),
      ckt: r.readAsciiFixed(2).trim() || "1",
      cw: r.readI32(),
      cm: r.readI32(),
      mag1: r.readF64(),
      mag2: r.readF64(),
      nmetr: r.readI32(),
      name: r.readAsciiFixed(12).trimEnd(),
      stat: r.readI32(),
      r12: r.readF64(),
      x12: r.readF64(),
      sbase12: r.readF64(),
      windv1: r.readF64(),
      nomv1: r.readF64(),
      ang1: r.readF64(),
      rata1: r.readF64(),
      ratb1: r.readF64(),
      ratc1: r.readF64(),
      cod1: r.readI32(),
      cont1: r.readI32(),
      rma1: r.readF64(),
      rmi1: r.readF64(),
      vma1: r.readF64(),
      vmi1: r.readF64(),
      ntp1: r.readI32(),
      tab1: r.readI32(),
      cr1: r.readF64(),
      cx1: r.readF64(),
      cnxa1: r.readF64(),
      windv2: r.readF64(),
      nomv2: r.readF64(),
    });
  }

  // 7. Areas
  const nAreas = r.readU32();
  const areas: AreaRecord[] = [];
  for (let idx = 0; idx < nAreas; idx++) {
    areas.push({
      i: r.readI32(),
      isw: r.readI32(),
      pdes: r.readF64(),
      ptol: r.readF64(),
      arname: r.readAsciiFixed(12).trimEnd(),
    });
  }

  // 8. Switched Shunts
  const nSwShunts = r.readU32();
  const switchedShunts: SwitchedShuntRecord[] = [];
  for (let idx = 0; idx < nSwShunts; idx++) {
    switchedShunts.push({
      i: r.readI32(),
      modsw: r.readI32(),
      adjm: r.readI32(),
      stat: r.readI32(),
      vswhi: r.readF64(),
      vswlo: r.readF64(),
      swrem: r.readI32(),
      rmpct: r.readF64(),
      rmidnt: r.readAsciiFixed(12).trimEnd(),
      binit: r.readF64(),
      n1: r.readI32(),
      b1: r.readF64(),
    });
  }

  const twoTerminalDc: TwoTerminalDcRecord[] = [];
  const vscDc: VscDcRecord[] = [];

  return {
    header,
    title1,
    title2,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    areas,
    twoTerminalDc,
    vscDc,
    switchedShunts,
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
 * Serializes a `PsseTransientResult` into a binary `.out` dynamic channel file.
 */
export function serializePsseOut(
  result: PsseTransientResult,
  caseTitle = "PSS/E Dynamic Simulation Output",
): Uint8Array {
  const nChannels = result.states.length;
  const nSteps = result.t.length;
  const w = new BinaryWriter(256 + (nChannels + 1) * nSteps * 8);

  w.writeAsciiFixed(OUT_MAGIC, 8);
  w.writeU32(FORMAT_VERSION);
  w.writeString(caseTitle);
  w.writeU32(nChannels);
  w.writeU32(nSteps);

  for (let c = 0; c < nChannels; c++) {
    const chName = result.states[c]!;
    w.writeString(chName);
    w.writeString(inferChannelUnit(chName));
  }

  // Time vector
  for (let k = 0; k < nSteps; k++) {
    w.writeF64(result.t[k] ?? 0.0);
  }

  // Channel matrices (channel-major IEEE 754 float64)
  for (let c = 0; c < nChannels; c++) {
    const series = result.y[c] ?? [];
    for (let k = 0; k < nSteps; k++) {
      w.writeF64(series[k] ?? 0.0);
    }
  }

  return w.finish();
}

/**
 * Serializes a `PsseTransientResult` into a legacy PSS/E v33/v34 Fortran unformatted
 * sequential binary `.out` file (`[recLen: u32][payload][recLen: u32]` with `REAL*4` frames).
 */
export function serializeFortranUnformattedPsseOut(
  result: PsseTransientResult,
  caseTitle = "PSS/E v33 Dynamic Simulation Output",
): Uint8Array {
  const nChannels = result.states.length;
  const nSteps = result.t.length;
  const rec1Len = 12; // 'PSSOUT33' (8B) + nChannels (4B)
  const rec2Len = 120; // 2x60B title lines
  const rec3Len = nChannels * 32; // 32B per channel name
  const stepRecLen = (1 + nChannels) * 4; // float32 time + float32[nChannels]
  const totalBytes = rec1Len + 8 + (rec2Len + 8) + (rec3Len + 8) + nSteps * (stepRecLen + 8);

  const buf = new Uint8Array(totalBytes);
  const view = new DataView(buf.buffer);
  let off = 0;

  const writeAscii = (str: string, width: number) => {
    for (let i = 0; i < width; i++) {
      buf[off + i] = i < str.length ? str.charCodeAt(i) & 0xff : 0x20;
    }
    off += width;
  };

  // Record 1: Header ('PSSOUT33' + int32 nChannels)
  view.setUint32(off, rec1Len, true);
  off += 4;
  writeAscii("PSSOUT33", 8);
  view.setInt32(off, nChannels, true);
  off += 4;
  view.setUint32(off, rec1Len, true);
  off += 4;

  // Record 2: 2x60-byte ASCII case title
  view.setUint32(off, rec2Len, true);
  off += 4;
  writeAscii(caseTitle, 60);
  writeAscii("MODELSCRIPT PSSE DYNAMIC SIMULATION", 60);
  view.setUint32(off, rec2Len, true);
  off += 4;

  // Record 3: 32-byte fixed-width channel names
  view.setUint32(off, rec3Len, true);
  off += 4;
  for (let c = 0; c < nChannels; c++) {
    writeAscii(result.states[c] ?? `CH_${c + 1}`, 32);
  }
  view.setUint32(off, rec3Len, true);
  off += 4;

  // Records 4..N: Time step float32 records
  for (let k = 0; k < nSteps; k++) {
    view.setUint32(off, stepRecLen, true);
    off += 4;
    view.setFloat32(off, result.t[k] ?? 0.0, true);
    off += 4;
    for (let c = 0; c < nChannels; c++) {
      view.setFloat32(off, result.y[c]?.[k] ?? 0.0, true);
      off += 4;
    }
    view.setUint32(off, stepRecLen, true);
    off += 4;
  }

  return buf;
}

/**
 * Deserializes a binary `.out` dynamic channel output buffer into `PsseOutChannelData`.
 * Automatically detects both ModelScript `"PSSE_OUT"` (64-bit float) and legacy PSS/E v33/v34
 * Fortran unformatted sequential binary `.out` records (`REAL*4` float32 frames).
 */
export function parsePsseOut(buffer: Uint8Array): PsseOutChannelData {
  if (buffer.byteLength >= 16) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const firstRecLen = view.getUint32(0, true);
    if (firstRecLen === 12 && buffer.byteLength >= 20) {
      let tag = "";
      for (let i = 0; i < 6; i++) {
        tag += String.fromCharCode(buffer[4 + i]!);
      }
      if (tag === "PSSOUT") {
        const nChannels = view.getInt32(12, true);
        let off = 20; // skip Record 1 (4 + 12 + 4)

        // Record 2: 120-byte title
        const rec2Len = view.getUint32(off, true);
        off += 4;
        let title = "";
        for (let i = 0; i < Math.min(60, rec2Len); i++) {
          title += String.fromCharCode(buffer[off + i]!);
        }
        const caseTitle = title.trim();
        off += rec2Len + 4;

        // Record 3: 32-byte channel names
        const rec3Len = view.getUint32(off, true);
        off += 4;
        const channelNames: string[] = [];
        const channelUnits: string[] = [];
        for (let c = 0; c < nChannels; c++) {
          let name = "";
          for (let i = 0; i < 32; i++) {
            name += String.fromCharCode(buffer[off + c * 32 + i]!);
          }
          const trimmed = name.trim();
          channelNames.push(trimmed);
          channelUnits.push(inferChannelUnit(trimmed));
        }
        off += rec3Len + 4;

        // Remaining records: float32 time steps
        const stepRecLen = (1 + nChannels) * 4;
        const nSteps = stepRecLen > 0 ? Math.floor((buffer.byteLength - off) / (stepRecLen + 8)) : 0;
        const time = new Float64Array(nSteps);
        const channels: Float64Array[] = Array.from({ length: nChannels }, () => new Float64Array(nSteps));

        for (let k = 0; k < nSteps; k++) {
          const rLen = view.getUint32(off, true);
          off += 4;
          time[k] = view.getFloat32(off, true);
          for (let c = 0; c < nChannels; c++) {
            channels[c]![k] = view.getFloat32(off + (1 + c) * 4, true);
          }
          off += rLen + 4;
        }

        const byName: Record<string, Float64Array> = {};
        for (let c = 0; c < nChannels; c++) {
          byName[channelNames[c]!] = channels[c]!;
        }

        return {
          version: 33,
          caseTitle,
          channelNames,
          channelUnits,
          time,
          channels,
          byName,
        };
      }
    }
  }

  const r = new BinaryReader(buffer);
  const magic = r.readAsciiFixed(8);
  if (magic !== OUT_MAGIC) {
    throw new Error(`Invalid PSS/E .out file magic header: expected '${OUT_MAGIC}', got '${magic}'.`);
  }
  const version = r.readU32();
  const caseTitle = r.readString();
  const nChannels = r.readU32();
  const nSteps = r.readU32();

  const channelNames: string[] = [];
  const channelUnits: string[] = [];
  for (let c = 0; c < nChannels; c++) {
    channelNames.push(r.readString());
    channelUnits.push(r.readString());
  }

  const time = new Float64Array(nSteps);
  for (let k = 0; k < nSteps; k++) {
    time[k] = r.readF64();
  }

  const channels: Float64Array[] = [];
  const byName: Record<string, Float64Array> = {};
  for (let c = 0; c < nChannels; c++) {
    const arr = new Float64Array(nSteps);
    for (let k = 0; k < nSteps; k++) {
      arr[k] = r.readF64();
    }
    channels.push(arr);
    byName[channelNames[c]!] = arr;
  }

  return {
    version,
    caseTitle,
    channelNames,
    channelUnits,
    time,
    channels,
    byName,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-GC Struct-of-Arrays (SoA) Typed-Array Pipeline for Large PSS/E RAW Decks (70k–100k+ buses).
 *
 * Parses PSS/E RAW numeric records directly into contiguous `Int32Array` / `Float64Array` / `Uint8Array`
 * buffers via the native WASM CST line tokenizer (without allocating JS BusRecord / BranchRecord objects).
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import type { CaseIdentification, PsseCase } from "../types.js";
import { extractFieldsFromCstTokens, isPsseSectionTerminator, parsePsseCstDocument } from "./cst-tokens.js";

export interface PsseSoaTables {
  header: Pick<CaseIdentification, "ic" | "sbase" | "rev" | "basfrq">;
  nBuses: number;
  busId: Int32Array;
  busIde: Uint8Array;
  busArea: Int32Array;
  busZone: Int32Array;
  busBaseKv: Float64Array;
  busVm: Float64Array;
  busVaDeg: Float64Array;
  busIndexById: Map<number, number>;

  nLoads: number;
  loadBus: Int32Array;
  loadStatus: Uint8Array;
  loadPl: Float64Array;
  loadQl: Float64Array;
  loadIp: Float64Array;
  loadIq: Float64Array;
  loadYp: Float64Array;
  loadYq: Float64Array;

  nFixedShunts: number;
  shuntBus: Int32Array;
  shuntStatus: Uint8Array;
  shuntGl: Float64Array;
  shuntBl: Float64Array;

  nGenerators: number;
  genBus: Int32Array;
  genStat: Uint8Array;
  genPg: Float64Array;
  genQg: Float64Array;
  genQt: Float64Array;
  genQb: Float64Array;
  genVs: Float64Array;
  genMbase: Float64Array;
  genZx: Float64Array;

  nBranches: number;
  brFrom: Int32Array;
  brTo: Int32Array;
  brR: Float64Array;
  brX: Float64Array;
  brB: Float64Array;
  brRateA: Float64Array;
  brGi: Float64Array;
  brBi: Float64Array;
  brGj: Float64Array;
  brBj: Float64Array;
  brSt: Uint8Array;

  /** True if deck contains transformers, switched shunts, or extended v35 records outside SoA tables. */
  hasComplexRecords: boolean;
}

class GrowableInt32 {
  public buf: Int32Array;
  public len = 0;
  constructor(cap = 64) {
    this.buf = new Int32Array(cap);
  }
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  finish(): Int32Array {
    return this.buf.slice(0, this.len);
  }
}

class GrowableUint8 {
  public buf: Uint8Array;
  public len = 0;
  constructor(cap = 64) {
    this.buf = new Uint8Array(cap);
  }
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class GrowableFloat64 {
  public buf: Float64Array;
  public len = 0;
  constructor(cap = 64) {
    this.buf = new Float64Array(cap);
  }
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  finish(): Float64Array {
    return this.buf.slice(0, this.len);
  }
}

function numField(s: string | undefined, def = 0): number {
  if (!s) return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

/**
 * Parses PSS/E RAW text directly into flat Struct-of-Arrays typed tables without
 * instantiating intermediate `BusRecord`/`BranchRecord`/`GeneratorRecord`/`LoadRecord` objects.
 */
export function parseRawToSoa(sourceText: string): PsseSoaTables {
  const cstDoc = parsePsseCstDocument(sourceText);
  const lines = cstDoc.lines;
  let lineIdx = 0;

  while (lineIdx < lines.length && lines[lineIdx]!.isCommentOrBlank) lineIdx++;
  const hLine = lines[lineIdx++];
  const hToks = hLine ? extractFieldsFromCstTokens(hLine.tokens, sourceText, "delimited").map((f) => f.value) : [];
  const header = {
    ic: numField(hToks[0], 0),
    sbase: numField(hToks[1], 100.0),
    rev: numField(hToks[2], 33),
    basfrq: numField(hToks[5], 60.0),
  };

  // Skip up to 2 optional title lines unless bus records start immediately
  for (let t = 0; t < 2 && lineIdx < lines.length; t++) {
    const l = lines[lineIdx]!;
    if (l.isCommentOrBlank) {
      lineIdx++;
      continue;
    }
    const f = extractFieldsFromCstTokens(l.tokens, sourceText, "delimited");
    const maybeBus = Number(f[0]?.value);
    const maybeIde = Number(f[3]?.value);
    if (f.length >= 7 && Number.isInteger(maybeBus) && maybeBus > 0 && maybeIde >= 1 && maybeIde <= 4) break;
    lineIdx++;
  }

  const busId = new GrowableInt32(128);
  const busIde = new GrowableUint8(128);
  const busArea = new GrowableInt32(128);
  const busZone = new GrowableInt32(128);
  const busBaseKv = new GrowableFloat64(128);
  const busVm = new GrowableFloat64(128);
  const busVaDeg = new GrowableFloat64(128);
  const busIndexById = new Map<number, number>();

  const loadBus = new GrowableInt32(128);
  const loadStatus = new GrowableUint8(128);
  const loadPl = new GrowableFloat64(128);
  const loadQl = new GrowableFloat64(128);
  const loadIp = new GrowableFloat64(128);
  const loadIq = new GrowableFloat64(128);
  const loadYp = new GrowableFloat64(128);
  const loadYq = new GrowableFloat64(128);

  const shuntBus = new GrowableInt32(32);
  const shuntStatus = new GrowableUint8(32);
  const shuntGl = new GrowableFloat64(32);
  const shuntBl = new GrowableFloat64(32);

  const genBus = new GrowableInt32(64);
  const genStat = new GrowableUint8(64);
  const genPg = new GrowableFloat64(64);
  const genQg = new GrowableFloat64(64);
  const genQt = new GrowableFloat64(64);
  const genQb = new GrowableFloat64(64);
  const genVs = new GrowableFloat64(64);
  const genMbase = new GrowableFloat64(64);
  const genZx = new GrowableFloat64(64);

  const brFrom = new GrowableInt32(256);
  const brTo = new GrowableInt32(256);
  const brR = new GrowableFloat64(256);
  const brX = new GrowableFloat64(256);
  const brB = new GrowableFloat64(256);
  const brRateA = new GrowableFloat64(256);
  const brGi = new GrowableFloat64(256);
  const brBi = new GrowableFloat64(256);
  const brGj = new GrowableFloat64(256);
  const brBj = new GrowableFloat64(256);
  const brSt = new GrowableUint8(256);
  let hasComplexRecords = false;

  let section = 0;
  while (lineIdx < lines.length) {
    const info = lines[lineIdx++]!;
    if (info.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(info.tokens, sourceText, "delimited");
    const term = isPsseSectionTerminator(fields);
    if (term === "end_file") break;
    if (term === "end_section") {
      const upper = (info.commentText || info.line).toUpperCase();
      if (upper.includes("BEGIN LOAD")) section = 1;
      else if (upper.includes("BEGIN FIXED SHUNT")) section = 2;
      else if (upper.includes("BEGIN GENERATOR")) section = 3;
      else if (upper.includes("BEGIN BRANCH") || upper.includes("BEGIN NON-TRANSFORMER")) section = 4;
      else if (upper.includes("BEGIN TRANSFORMER")) section = 5;
      else section++;
      continue;
    }

    if (section >= 5) {
      hasComplexRecords = true;
      continue;
    }

    const toks = fields.map((f) => f.value);
    if (section === 0) {
      const id = numField(toks[0], 0);
      if (id > 0) {
        busIndexById.set(id, busId.len);
        busId.push(id);
        busBaseKv.push(numField(toks[2], 0));
        busIde.push(numField(toks[3], 1));
        busArea.push(numField(toks[4], 1));
        busZone.push(numField(toks[5], 1));
        busVm.push(numField(toks[7], 1.0));
        busVaDeg.push(numField(toks[8], 0.0));
      }
    } else if (section === 1) {
      const id = numField(toks[0], 0);
      if (id > 0) {
        loadBus.push(id);
        loadStatus.push(numField(toks[2], 1));
        loadPl.push(numField(toks[5], 0));
        loadQl.push(numField(toks[6], 0));
        loadIp.push(numField(toks[7], 0));
        loadIq.push(numField(toks[8], 0));
        loadYp.push(numField(toks[9], 0));
        loadYq.push(numField(toks[10], 0));
      }
    } else if (section === 2) {
      const id = numField(toks[0], 0);
      if (id > 0) {
        shuntBus.push(id);
        shuntStatus.push(numField(toks[2], 1));
        shuntGl.push(numField(toks[3], 0));
        shuntBl.push(numField(toks[4], 0));
      }
    } else if (section === 3) {
      const id = numField(toks[0], 0);
      if (id > 0) {
        genBus.push(id);
        genPg.push(numField(toks[2], 0));
        genQg.push(numField(toks[3], 0));
        genQt.push(numField(toks[4], 9999));
        genQb.push(numField(toks[5], -9999));
        genVs.push(numField(toks[6], 1.0));
        genMbase.push(numField(toks[8], header.sbase));
        genZx.push(numField(toks[10], 0.2));
        genStat.push(numField(toks[14], 1));
      }
    } else if (section === 4) {
      if (header.rev >= 35 && toks.length > 18) {
        hasComplexRecords = true;
      }
      const i = numField(toks[0], 0);
      const j = numField(toks[1], 0);
      if (i > 0 && j !== 0) {
        brFrom.push(i);
        brTo.push(Math.abs(j));
        brR.push(numField(toks[3], 0));
        brX.push(numField(toks[4], 0.0001));
        brB.push(numField(toks[5], 0));
        brRateA.push(numField(toks[6], 0));
        brGi.push(numField(toks[9], 0));
        brBi.push(numField(toks[10], 0));
        brGj.push(numField(toks[11], 0));
        brBj.push(numField(toks[12], 0));
        brSt.push(numField(toks[13], 1));
      }
    }
  }

  return {
    header,
    nBuses: busId.len,
    busId: busId.finish(),
    busIde: busIde.finish(),
    busArea: busArea.finish(),
    busZone: busZone.finish(),
    busBaseKv: busBaseKv.finish(),
    busVm: busVm.finish(),
    busVaDeg: busVaDeg.finish(),
    busIndexById,
    nLoads: loadBus.len,
    loadBus: loadBus.finish(),
    loadStatus: loadStatus.finish(),
    loadPl: loadPl.finish(),
    loadQl: loadQl.finish(),
    loadIp: loadIp.finish(),
    loadIq: loadIq.finish(),
    loadYp: loadYp.finish(),
    loadYq: loadYq.finish(),
    nFixedShunts: shuntBus.len,
    shuntBus: shuntBus.finish(),
    shuntStatus: shuntStatus.finish(),
    shuntGl: shuntGl.finish(),
    shuntBl: shuntBl.finish(),
    nGenerators: genBus.len,
    genBus: genBus.finish(),
    genStat: genStat.finish(),
    genPg: genPg.finish(),
    genQg: genQg.finish(),
    genQt: genQt.finish(),
    genQb: genQb.finish(),
    genVs: genVs.finish(),
    genMbase: genMbase.finish(),
    genZx: genZx.finish(),
    nBranches: brFrom.len,
    brFrom: brFrom.finish(),
    brTo: brTo.finish(),
    brR: brR.finish(),
    brX: brX.finish(),
    brB: brB.finish(),
    brRateA: brRateA.finish(),
    brGi: brGi.finish(),
    brBi: brBi.finish(),
    brGj: brGj.finish(),
    brBj: brBj.finish(),
    brSt: brSt.finish(),
    hasComplexRecords,
  };
}

/**
 * Converts an existing `PsseCase` into flat typed Struct-of-Arrays buffers for SIMD/LU kernels.
 */
export function caseToSoaTables(c: PsseCase): PsseSoaTables {
  const nBuses = c.buses.size;
  const busId = new Int32Array(nBuses);
  const busIde = new Uint8Array(nBuses);
  const busArea = new Int32Array(nBuses);
  const busZone = new Int32Array(nBuses);
  const busBaseKv = new Float64Array(nBuses);
  const busVm = new Float64Array(nBuses);
  const busVaDeg = new Float64Array(nBuses);
  const busIndexById = new Map<number, number>();

  let bi = 0;
  for (const b of c.buses.values()) {
    busIndexById.set(b.i, bi);
    busId[bi] = b.i;
    busIde[bi] = b.ide;
    busArea[bi] = b.area;
    busZone[bi] = b.zone;
    busBaseKv[bi] = b.baseKv;
    busVm[bi] = b.vm;
    busVaDeg[bi] = b.va;
    bi++;
  }

  const nLoads = c.loads.length;
  const loadBus = new Int32Array(nLoads);
  const loadStatus = new Uint8Array(nLoads);
  const loadPl = new Float64Array(nLoads);
  const loadQl = new Float64Array(nLoads);
  const loadIp = new Float64Array(nLoads);
  const loadIq = new Float64Array(nLoads);
  const loadYp = new Float64Array(nLoads);
  const loadYq = new Float64Array(nLoads);
  for (let i = 0; i < nLoads; i++) {
    const l = c.loads[i]!;
    loadBus[i] = l.i;
    loadStatus[i] = l.status;
    loadPl[i] = l.pl;
    loadQl[i] = l.ql;
    loadIp[i] = l.ip ?? 0;
    loadIq[i] = l.iq ?? 0;
    loadYp[i] = l.yp ?? 0;
    loadYq[i] = l.yq ?? 0;
  }

  const nFixedShunts = c.fixedShunts.length;
  const shuntBus = new Int32Array(nFixedShunts);
  const shuntStatus = new Uint8Array(nFixedShunts);
  const shuntGl = new Float64Array(nFixedShunts);
  const shuntBl = new Float64Array(nFixedShunts);
  for (let i = 0; i < nFixedShunts; i++) {
    const s = c.fixedShunts[i]!;
    shuntBus[i] = s.i;
    shuntStatus[i] = s.status;
    shuntGl[i] = s.gl;
    shuntBl[i] = s.bl;
  }

  const nGenerators = c.generators.length;
  const genBus = new Int32Array(nGenerators);
  const genStat = new Uint8Array(nGenerators);
  const genPg = new Float64Array(nGenerators);
  const genQg = new Float64Array(nGenerators);
  const genQt = new Float64Array(nGenerators);
  const genQb = new Float64Array(nGenerators);
  const genVs = new Float64Array(nGenerators);
  const genMbase = new Float64Array(nGenerators);
  const genZx = new Float64Array(nGenerators);
  for (let i = 0; i < nGenerators; i++) {
    const g = c.generators[i]!;
    genBus[i] = g.i;
    genStat[i] = g.stat;
    genPg[i] = g.pg;
    genQg[i] = g.qg;
    genQt[i] = g.qt;
    genQb[i] = g.qb;
    genVs[i] = g.vs;
    genMbase[i] = g.mbase;
    genZx[i] = g.zx;
  }

  const nBranches = c.branches.length;
  const brFrom = new Int32Array(nBranches);
  const brTo = new Int32Array(nBranches);
  const brR = new Float64Array(nBranches);
  const brX = new Float64Array(nBranches);
  const brB = new Float64Array(nBranches);
  const brRateA = new Float64Array(nBranches);
  const brGi = new Float64Array(nBranches);
  const brBi = new Float64Array(nBranches);
  const brGj = new Float64Array(nBranches);
  const brBj = new Float64Array(nBranches);
  const brSt = new Uint8Array(nBranches);
  for (let i = 0; i < nBranches; i++) {
    const br = c.branches[i]!;
    brFrom[i] = br.i;
    brTo[i] = Math.abs(br.j);
    brR[i] = br.r;
    brX[i] = br.x;
    brB[i] = br.b;
    brRateA[i] = br.rateA;
    brGi[i] = br.gi;
    brBi[i] = br.bi;
    brGj[i] = br.gj;
    brBj[i] = br.bj;
    brSt[i] = br.st;
  }

  return {
    header: {
      ic: c.header.ic,
      sbase: c.header.sbase,
      rev: c.header.rev,
      basfrq: c.header.basfrq,
    },
    nBuses,
    busId,
    busIde,
    busArea,
    busZone,
    busBaseKv,
    busVm,
    busVaDeg,
    busIndexById,
    nLoads,
    loadBus,
    loadStatus,
    loadPl,
    loadQl,
    loadIp,
    loadIq,
    loadYp,
    loadYq,
    nFixedShunts,
    shuntBus,
    shuntStatus,
    shuntGl,
    shuntBl,
    nGenerators,
    genBus,
    genStat,
    genPg,
    genQg,
    genQt,
    genQb,
    genVs,
    genMbase,
    genZx,
    nBranches,
    brFrom,
    brTo,
    brR,
    brX,
    brB,
    brRateA,
    brGi,
    brBi,
    brGj,
    brBj,
    brSt,
    hasComplexRecords: c.transformers.length > 0 || c.switchedShunts.length > 0,
  };
}

/**
 * Contiguous SoA arena backed directly by `@modelscript/runtime` WebAssembly linear memory
 * (falling back seamlessly to detached typed arrays if the WASM module is not yet initialized).
 */
export interface WasmSoaArena {
  usingWasmMemory: boolean;
  basePtr: number;
  nBuses: number;
  nBranches: number;
  busVm: Float64Array;
  busVaDeg: Float64Array;
  busIde: Uint8Array;
  brR: Float64Array;
  brX: Float64Array;
  brB: Float64Array;
}

/**
 * Allocates and copies bus/branch SoA buffers into WASM linear memory so numerical kernels
 * can index contiguous `Float64Array`/`Uint8Array` views without JS heap object indirection.
 */
export function allocateWasmSoaArena(soa: PsseSoaTables): WasmSoaArena {
  const nBuses = soa.nBuses;
  const nBranches = soa.nBranches;
  const wasm = getDefaultWasmExports() as {
    memory?: WebAssembly.Memory;
    alloc?: (bytes: number) => number;
    __new?: (bytes: number, id: number) => number;
  } | null;

  const vmBytes = nBuses * 8;
  const vaBytes = nBuses * 8;
  const rBytes = nBranches * 8;
  const xBytes = nBranches * 8;
  const bBytes = nBranches * 8;
  const ideBytes = Math.max(8, (nBuses + 7) & ~7);
  const totalBytes = vmBytes + vaBytes + rBytes + xBytes + bBytes + ideBytes + 16;

  if (wasm?.memory && (typeof wasm.alloc === "function" || typeof wasm.__new === "function")) {
    const rawPtr = typeof wasm.__new === "function" ? wasm.__new(totalBytes, 0) : wasm.alloc!(totalBytes);
    if (rawPtr > 0) {
      const aligned = (rawPtr + 7) & ~7;
      const buf = wasm.memory.buffer;
      if (aligned + totalBytes <= buf.byteLength) {
        let off = aligned;
        const busVm = new Float64Array(buf, off, nBuses);
        off += vmBytes;
        const busVaDeg = new Float64Array(buf, off, nBuses);
        off += vaBytes;
        const brR = new Float64Array(buf, off, nBranches);
        off += rBytes;
        const brX = new Float64Array(buf, off, nBranches);
        off += xBytes;
        const brB = new Float64Array(buf, off, nBranches);
        off += bBytes;
        const busIde = new Uint8Array(buf, off, nBuses);

        busVm.set(soa.busVm);
        busVaDeg.set(soa.busVaDeg);
        brR.set(soa.brR);
        brX.set(soa.brX);
        brB.set(soa.brB);
        busIde.set(soa.busIde);

        return {
          usingWasmMemory: true,
          basePtr: aligned,
          nBuses,
          nBranches,
          busVm,
          busVaDeg,
          busIde,
          brR,
          brX,
          brB,
        };
      }
    }
  }

  return {
    usingWasmMemory: false,
    basePtr: 0,
    nBuses,
    nBranches,
    busVm: soa.busVm.slice(),
    busVaDeg: soa.busVaDeg.slice(),
    busIde: soa.busIde.slice(),
    brR: soa.brR.slice(),
    brX: soa.brX.slice(),
    brB: soa.brB.slice(),
  };
}

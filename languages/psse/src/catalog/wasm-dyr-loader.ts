// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import type { PsseCase } from "../types.js";

function sanitizeIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

interface WasmDyrExports {
  memory?: WebAssembly.Memory;
  [fnName: string]: unknown;
}

export interface PsseDynamicModelIO {
  eterm: number;
  speedDev: number;
  efd: number;
  pmech: number;
  vr: number;
  vi: number;
}

export interface PsseLinkedDynamicInstance {
  busNumber: number;
  machineId?: string | undefined;
  modelName: string;
  category?: string | undefined;
  init(io: PsseDynamicModelIO): void;
  doStep(
    tSec: number,
    dtSec: number,
    io: PsseDynamicModelIO,
  ): {
    efd?: number | undefined;
    pmech?: number | undefined;
    vsPss?: number | undefined;
    irInj?: number | undefined;
    iiInj?: number | undefined;
    qSvc?: number | undefined;
    tripMult?: number | undefined;
  };
}

const compiledModuleCache = new WeakMap<Uint8Array, WebAssembly.Module>();

function getOrCompileWasmModule(wasmBytes: Uint8Array): WebAssembly.Module | undefined {
  let mod = compiledModuleCache.get(wasmBytes);
  if (mod) return mod;
  try {
    const copy = new Uint8Array(wasmBytes);
    mod = new WebAssembly.Module(copy);
    compiledModuleCache.set(wasmBytes, mod);
    return mod;
  } catch {
    return undefined;
  }
}

function createIsolatedWasmInstance(wasmBytes: Uint8Array): WebAssembly.Instance | undefined {
  const mod = getOrCompileWasmModule(wasmBytes);
  if (!mod) return undefined;
  try {
    return new WebAssembly.Instance(mod, {
      env: {
        abort() {
          // no-op abort stub for AssemblyScript runtimes
        },
      },
    });
  } catch {
    return undefined;
  }
}

interface CachedMemoryViews {
  mem: WebAssembly.Memory;
  buf: ArrayBufferLike;
  f64: Float64Array;
  i32: Int32Array;
  u32: Uint32Array;
}

function createMemoryViews(mem: WebAssembly.Memory): CachedMemoryViews {
  const buf = mem.buffer;
  return {
    mem,
    buf,
    f64: new Float64Array(buf),
    i32: new Int32Array(buf),
    u32: new Uint32Array(buf),
  };
}

function ensureMemoryCapacity(views: CachedMemoryViews, requiredBytes: number): void {
  if (views.mem.buffer.byteLength < requiredBytes) {
    const neededPages = Math.ceil((requiredBytes - views.mem.buffer.byteLength) / 65536);
    views.mem.grow(neededPages);
  }
  if (views.buf !== views.mem.buffer) {
    views.buf = views.mem.buffer;
    views.f64 = new Float64Array(views.buf);
    views.i32 = new Int32Array(views.buf);
    views.u32 = new Uint32Array(views.buf);
  }
}

import {
  PSSE_STD_LIB_DIAGRAMS,
  PSSE_STD_LIB_PKG_JSON,
  PSSE_STD_LIB_SYMBOLS,
  getPsseStdLibWasmBytes,
} from "./psse-std-lib-data.js";

/**
 * Synchronously registers the pre-bundled `@modelscript/psse-std-lib` (366 schemas,
 * 366 cleanroom SVG block icons, and `runtime.wasm`) in `globalLibraryRegistry` with
 * zero filesystem I/O — works identically in Browsers, Web Workers, and Node.js.
 */
export function registerBuiltInPsseLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("psse").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(PSSE_STD_LIB_PKG_JSON, {
    symbols: PSSE_STD_LIB_SYMBOLS,
    diagrams: PSSE_STD_LIB_DIAGRAMS,
    wasmBytes: getPsseStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/psse-std-lib` (`modelscript.yaml` or pre-bundled payload)
 * is registered in `globalLibraryRegistry` in Node.js, Browsers, or Web Workers.
 */
export async function ensureBuiltInPsseLibraryRegistered(): Promise<void> {
  if (globalLibraryRegistry.getPackagesForLanguage("psse").length > 0) return;
  try {
    const path = await import("node:path");
    const url = await import("node:url");
    const fs = await import("node:fs");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../../assets/psse-std-lib"),
      path.resolve(here, "../../../assets/psse-std-lib"),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, "modelscript.yaml")) || fs.existsSync(path.join(dir, "package.json"))) {
        await globalLibraryRegistry.loadLibraryFromDir(dir);
        if (globalLibraryRegistry.getPackagesForLanguage("psse").length > 0) return;
      }
    }
  } catch {
    // Fall through to zero-I/O pre-bundled registration for Browser / Web Worker environments
  }
  registerBuiltInPsseLibrarySync();
}

import { resolveDyrModelSchema, type DaeArchetypeId } from "../schema/index.js";

export const PSSE_ARCHETYPE_CODE: Record<DaeArchetypeId, number> = {
  sync_classical_2o: 0,
  sync_transient_3o: 1,
  sync_subtrans_round_6o: 2,
  sync_subtrans_salient_5o: 3,
  sync_gentpj_6o: 4,
  induction_machine_4o: 5,
  wind_ind_gen_4o: 6,
  wind_type3_dfag: 7,
  exc_sexs: 10,
  exc_scrx: 11,
  exc_ieee_dc: 12,
  exc_ieee_ac: 13,
  exc_ieee_st: 14,
  exc_st4b_pi: 15,
  exc_pid: 16,
  lim_oel: 17,
  lim_uel: 18,
  lim_vhz: 19,
  comp_rc_xc: 58,
  gov_steam_simple: 20,
  gov_steam_reheat: 21,
  gov_lcfb: 22,
  gov_gast: 23,
  gov_ggov1_temp: 24,
  gov_hydro_penstock: 25,
  gov_hydro_pid: 26,
  gov_degov: 27,
  wind_drivetrain_2mass: 28,
  wind_pitch_torque: 29,
  pss_single_leadlag: 30,
  pss_dual_ramptrack: 31,
  pss_multiband_4b: 32,
  ibr_regc_converter: 35,
  ibr_reec_control: 36,
  ibr_repc_plant: 37,
  ibr_dera_aggregate: 38,
  ibr_regfm_vsm: 39,
  ibr_iec_generic: 40,
  load_static_zipf: 42,
  load_complex_clod: 43,
  load_ind_motor: 44,
  load_1ph_stall: 45,
  load_composite_cmpldw: 46,
  facts_svc: 48,
  facts_statcom: 49,
  facts_tcsc: 50,
  hvdc_lcc_2t: 51,
  hvdc_vsc_2t: 52,
  relay_load_shed: 54,
  relay_gen_trip: 55,
  relay_branch_dist: 56,
  meas_bus_freq: 57,
};

export interface WasmDyrBatchSlotMeta {
  index: number;
  busNumber: number;
  machineId?: string | undefined;
  modelName: string;
  category?: string | undefined;
  archetypeId: number;
  slotPtr: number;
  ioF64Offset: number;
}

/**
 * Zero-copy batched WASM dynamic model session.
 * Executes all ABI v2 models inside linear memory in a single JS<->WASM call per time step.
 */
export interface WasmDyrBatchSession {
  readonly slots: readonly WasmDyrBatchSlotMeta[];
  readonly count: number;
  readonly exports: WasmDyrExports;
  writeSlotIo(slotIndex: number, io: PsseDynamicModelIO): void;
  readSlotOutput(slotIndex: number): {
    efd: number;
    pmech: number;
    vsPss: number;
    pe: number;
    ifd: number;
    irInj: number;
    iiInj: number;
    qSvc: number;
    tripMult: number;
    vComp: number;
    freqHz: number;
  };
  initAll(): void;
  stepAll(tSec: number, dtSec: number): void;
  checkFlatStart(slotIndex: number): number;
}

function pickParam(np: Record<string, number>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = np[k];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Normalizes a `.dyr` record's `CON` array into canonical positional slots for the target
 * WASM archetype using `rec.namedParams`, so all 366 model variants (including shifted-CON
 * aliases like `AC10C`, `ESAC8B`, `HYGOV2`, `GGOV1`) receive exact semantic parameter values.
 */
export function normalizeConForArchetype(
  archCode: number,
  rawCon: readonly number[],
  namedParams?: Record<string, number>,
): number[] {
  const out = rawCon.slice(0, 160);
  if (!namedParams || Object.keys(namedParams).length === 0) return out;

  const set = (idx: number, val: number | undefined) => {
    if (val === undefined || !Number.isFinite(val)) return;
    while (out.length <= idx) out.push(0);
    out[idx] = val;
  };

  if (archCode === 0) {
    set(0, pickParam(namedParams, "H"));
    set(1, pickParam(namedParams, "D"));
  } else if (archCode >= 1 && archCode <= 7) {
    set(0, pickParam(namedParams, "Td0p", "Tdo'"));
    set(1, pickParam(namedParams, "Td0pp", "Tdo''"));
    set(2, pickParam(namedParams, "Tq0p", "Tqo'"));
    set(3, pickParam(namedParams, "Tq0pp", "Tqo''"));
    set(4, pickParam(namedParams, "H"));
    set(5, pickParam(namedParams, "D"));
    set(6, pickParam(namedParams, "Xd"));
    set(7, pickParam(namedParams, "Xq"));
    set(8, pickParam(namedParams, "Xdp", "Xd'"));
    set(9, pickParam(namedParams, "Xqp", "Xq'"));
    set(12, pickParam(namedParams, "S10", "S(1.0)"));
    set(13, pickParam(namedParams, "S12", "S(1.2)"));
    set(14, pickParam(namedParams, "Kis"));
  } else if (archCode === 10 || archCode === 11) {
    set(0, pickParam(namedParams, "TA_TB", "Ta/Tb"));
    set(1, pickParam(namedParams, "TB", "Tb"));
    set(2, pickParam(namedParams, "K", "KA"));
    set(3, pickParam(namedParams, "TE", "Te"));
    set(4, pickParam(namedParams, "EMIN", "VRMIN"));
    set(5, pickParam(namedParams, "EMAX", "VRMAX"));
  } else if (archCode === 12) {
    set(0, pickParam(namedParams, "TR"));
    set(1, pickParam(namedParams, "KA"));
    set(2, pickParam(namedParams, "TA"));
    set(3, pickParam(namedParams, "VRMAX"));
    set(4, pickParam(namedParams, "VRMIN"));
    set(5, pickParam(namedParams, "KE"));
    set(6, pickParam(namedParams, "TE"));
    set(9, pickParam(namedParams, "KF"));
    set(10, pickParam(namedParams, "TF", "E1"));
    set(11, pickParam(namedParams, "SE1", "S(E1)"));
    set(12, pickParam(namedParams, "E2"));
    set(13, pickParam(namedParams, "SE2", "S(E2)"));
  } else if (archCode === 13) {
    set(0, pickParam(namedParams, "TR"));
    set(3, pickParam(namedParams, "KA", "KPR"));
    set(4, pickParam(namedParams, "TA"));
    set(5, pickParam(namedParams, "VRMAX", "VAMAX"));
    set(6, pickParam(namedParams, "VRMIN", "VAMIN"));
    set(7, pickParam(namedParams, "KE"));
    set(8, pickParam(namedParams, "TE"));
    set(9, pickParam(namedParams, "KF"));
    set(10, pickParam(namedParams, "TF"));
    set(11, pickParam(namedParams, "KC"));
    set(12, pickParam(namedParams, "KD"));
    set(13, pickParam(namedParams, "E1", "VE1"));
    set(14, pickParam(namedParams, "SE1", "SE_VE1"));
    set(15, pickParam(namedParams, "E2", "VE2"));
    set(16, pickParam(namedParams, "SE2", "SE_VE2"));
  } else if (archCode === 14) {
    set(0, pickParam(namedParams, "TR"));
    set(3, pickParam(namedParams, "TC"));
    set(4, pickParam(namedParams, "TB"));
    set(5, pickParam(namedParams, "KA"));
    set(6, pickParam(namedParams, "TA"));
    set(7, pickParam(namedParams, "VRMAX"));
    set(8, pickParam(namedParams, "VRMIN"));
    set(9, pickParam(namedParams, "KC"));
  } else if (archCode === 15 || archCode === 16) {
    set(0, pickParam(namedParams, "TR"));
    set(3, pickParam(namedParams, "KPR", "KP", "KA"));
    set(4, pickParam(namedParams, "KIR", "KI"));
    set(5, pickParam(namedParams, "VRMAX", "VMAX", "VMMAX"));
    set(6, pickParam(namedParams, "VRMIN", "VMIN", "VMMIN"));
  } else if (archCode === 17) {
    set(1, pickParam(namedParams, "Ifdlim", "IFDLIM", "Ifdmax"));
    set(2, pickParam(namedParams, "Kr", "KR"));
    set(3, pickParam(namedParams, "Tr", "TR"));
  } else if (archCode === 58) {
    set(0, pickParam(namedParams, "Rc", "RC"));
    set(1, pickParam(namedParams, "Xc", "XC"));
    set(2, pickParam(namedParams, "Tr", "TR"));
  } else if (archCode >= 20 && archCode <= 27) {
    set(0, pickParam(namedParams, "R", "Rp", "Rperm", "Droop"));
    set(1, pickParam(namedParams, "T1", "Tg", "Ta", "Tact"));
    set(2, pickParam(namedParams, "VMAX", "PMAX", "Pmax", "GMAX", "Gmax", "Tfuel"));
    set(3, pickParam(namedParams, "VMIN", "PMIN", "Pmin", "GMIN", "Gmin"));
    if (archCode === 25 || archCode === 26) {
      set(4, pickParam(namedParams, "VELM", "Velm"));
      set(5, pickParam(namedParams, "GMAX", "Gmax"));
      set(6, pickParam(namedParams, "GMIN", "Gmin"));
      set(7, pickParam(namedParams, "Tw", "TW"));
    }
  } else if (archCode === 30 || archCode === 31) {
    set(0, pickParam(namedParams, "Tw1", "TW1", "Tw"));
    set(1, pickParam(namedParams, "Tw2", "TW2"));
    set(4, pickParam(namedParams, "T1"));
    set(5, pickParam(namedParams, "T2"));
    set(6, pickParam(namedParams, "T3"));
    set(7, pickParam(namedParams, "T4"));
    set(archCode === 30 ? 8 : 10, pickParam(namedParams, "Ks", "KS", "KS1"));
    set(14, pickParam(namedParams, "VSTMAX", "Vstmax"));
    set(15, pickParam(namedParams, "VSTMIN", "Vstmin"));
  } else if (archCode === 32) {
    set(2, pickParam(namedParams, "KL", "Kl"));
    set(3, pickParam(namedParams, "KI", "Ki"));
    set(4, pickParam(namedParams, "KH", "Kh"));
    set(12, pickParam(namedParams, "VSTMAX", "Vstmax"));
    set(13, pickParam(namedParams, "VSTMIN", "Vstmin"));
  } else if (archCode === 39) {
    set(0, pickParam(namedParams, "mp", "Mp", "R"));
    set(1, pickParam(namedParams, "H", "Hvirt"));
    set(2, pickParam(namedParams, "D", "Dvirt"));
    set(3, pickParam(namedParams, "Xv", "Xvirt"));
  } else if (archCode >= 35 && archCode <= 40) {
    set(0, pickParam(namedParams, "Tg", "TG", "Droop"));
    set(6, pickParam(namedParams, "Kqv", "KQV"));
    set(12, pickParam(namedParams, "Imax", "IMAX"));
  } else if (archCode === 54) {
    set(0, pickParam(namedParams, "F1", "Ftrip"));
    set(1, pickParam(namedParams, "V1", "Vtrip"));
    set(2, pickParam(namedParams, "T1", "Td", "Tdelay"));
  } else if (archCode === 55) {
    set(0, pickParam(namedParams, "FL", "Flo"));
    set(1, pickParam(namedParams, "FU", "Fhi"));
    set(2, pickParam(namedParams, "Tp", "Td", "Tdelay"));
  } else if (archCode === 57) {
    set(0, pickParam(namedParams, "Tf", "TF"));
  }

  return out;
}

/**
 * Creates an isolated, zero-copy batched WASM session for all `.dyr` records in `psseCase`
 * backed by `@modelscript/psse-std-lib`'s `psseBatchInit` / `psseBatchStep`.
 */
export function createWasmDyrBatchSession(psseCase: PsseCase): WasmDyrBatchSession | undefined {
  const records = psseCase.dyr?.records ?? [];
  if (records.length === 0) return undefined;

  if (globalLibraryRegistry.getPackagesForLanguage("psse").length === 0) {
    registerBuiltInPsseLibrarySync();
  }

  const pkg = globalLibraryRegistry
    .getPackagesForLanguage("psse")
    .find((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (!pkg?.wasmBytes) return undefined;

  const instance = createIsolatedWasmInstance(pkg.wasmBytes);
  if (!instance) return undefined;
  const exports = instance.exports as WasmDyrExports;
  if (!exports.memory) return undefined;

  const batchInit = exports["psseBatchInit"] as ((count: number, tablePtr: number) => void) | undefined;
  const batchStep = exports["psseBatchStep"] as
    | ((count: number, t: number, dt: number, tablePtr: number) => void)
    | undefined;
  const checkFlatFn = exports["psseModelCheckFlatStart"] as
    | ((archetypeId: number, slotPtr: number, conCount: number) => number)
    | undefined;
  if (typeof batchInit !== "function" || typeof batchStep !== "function") return undefined;

  // Filter records that map to a known ABI v2 archetype
  const mapped: Array<{
    rec: (typeof records)[number];
    archCode: number;
    category: string;
  }> = [];
  for (const rec of records) {
    const schema = resolveDyrModelSchema(rec.model);
    if (!schema) continue;
    const archCode = PSSE_ARCHETYPE_CODE[schema.daeArchetype];
    if (archCode === undefined) continue;
    mapped.push({ rec, archCode, category: schema.category ?? rec.category });
  }
  if (mapped.length === 0) return undefined;

  const count = mapped.length;
  const getArenaBaseFn = exports["psseGetArenaBase"] as (() => number) | undefined;
  const arenaBase = typeof getArenaBaseFn === "function" ? Math.max(8192, (getArenaBaseFn() + 63) & ~63) : 8192;
  const tablePtr = arenaBase;
  const tableBytes = Math.ceil((count * 16) / 64) * 64;
  const slotsBase = tablePtr + tableBytes;
  const totalBytes = slotsBase + count * 2048;

  const views = createMemoryViews(exports.memory);
  ensureMemoryCapacity(views, totalBytes);

  const slots: WasmDyrBatchSlotMeta[] = [];
  for (let i = 0; i < count; i++) {
    const { rec, archCode, category } = mapped[i]!;
    const slotPtr = slotsBase + i * 2048;
    const con = normalizeConForArchetype(archCode, rec.con ?? [], rec.namedParams);
    const icons = rec.icons ?? [];
    const iconCount = Math.min(icons.length, 32);
    const conCount = Math.min(con.length, 160);

    // Populate descriptor table entry (16 bytes = 4 x i32/u32)
    const tOff = (tablePtr >> 2) + i * 4;
    views.i32[tOff + 0] = archCode;
    views.u32[tOff + 1] = slotPtr;
    views.i32[tOff + 2] = iconCount;
    views.i32[tOff + 3] = conCount;

    // Populate ICON[32] @ +0x000 and CON[160] @ +0x080
    const iconOff = slotPtr >> 2;
    for (let k = 0; k < iconCount; k++) {
      const v = icons[k];
      views.i32[iconOff + k] = typeof v === "number" ? Math.trunc(v) : 0;
    }
    const conOff = (slotPtr + 0x080) >> 3;
    for (let k = 0; k < conCount; k++) {
      views.f64[conOff + k] = con[k]!;
    }

    slots.push({
      index: i,
      busNumber: rec.ibus,
      machineId: rec.id,
      modelName: rec.model,
      category,
      archetypeId: archCode,
      slotPtr,
      ioF64Offset: (slotPtr + 0x780) >> 3,
    });
  }

  return {
    slots,
    count,
    exports,
    writeSlotIo(slotIndex: number, io: PsseDynamicModelIO) {
      const o = slots[slotIndex]!.ioF64Offset;
      const f64 = views.f64;
      f64[o + 0] = io.eterm;
      f64[o + 1] = io.speedDev;
      f64[o + 2] = io.efd;
      f64[o + 3] = io.pmech;
      f64[o + 4] = io.vr;
      f64[o + 5] = io.vi;
    },
    readSlotOutput(slotIndex: number) {
      const o = slots[slotIndex]!.ioF64Offset;
      const f64 = views.f64;
      return {
        efd: f64[o + 2]!,
        pmech: f64[o + 3]!,
        vsPss: f64[o + 6]!,
        pe: f64[o + 7]!,
        ifd: f64[o + 8]!,
        irInj: f64[o + 9]!,
        iiInj: f64[o + 10]!,
        qSvc: f64[o + 11]!,
        tripMult: f64[o + 12]!,
        vComp: f64[o + 13]!,
        freqHz: f64[o + 14]!,
      };
    },
    initAll() {
      batchInit(count, tablePtr);
    },
    stepAll(tSec: number, dtSec: number) {
      batchStep(count, tSec, dtSec, tablePtr);
    },
    checkFlatStart(slotIndex: number): number {
      if (typeof checkFlatFn !== "function") return 0;
      const s = slots[slotIndex]!;
      const conCount = views.i32[(tablePtr >> 2) + slotIndex * 4 + 3]!;
      return checkFlatFn(s.archetypeId, s.slotPtr, conCount);
    },
  };
}

/**
 * Instantiates AssemblyScript `.dyr` dynamic models from any loaded `package.json#modelscript`
 * PSS/E library package (`pkg.wasmBytes`) matching records in `psseCase.dyr`.
 * Uses an isolated `WebAssembly.Instance` per call and cached TypedArray views for concurrency
 * safety and zero per-step allocations.
 */
export function instantiateWasmDyrModelsForCase(psseCase: PsseCase): PsseLinkedDynamicInstance[] {
  const records = psseCase.dyr?.records ?? [];
  if (records.length === 0) return [];

  if (globalLibraryRegistry.getPackagesForLanguage("psse").length === 0) {
    registerBuiltInPsseLibrarySync();
  }

  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("psse")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (pkgs.length === 0) return [];

  // Instantiate one isolated WASM instance + cached memory views per package for this simulation
  const pkgSessions = new Map<Uint8Array, { exports: WasmDyrExports; views: CachedMemoryViews; slotIndex: number }>();

  const instances: PsseLinkedDynamicInstance[] = [];

  for (const rec of records) {
    const safe = sanitizeIdent(rec.model.toUpperCase());
    const schema = resolveDyrModelSchema(rec.model);
    const archCode = schema ? PSSE_ARCHETYPE_CODE[schema.daeArchetype] : undefined;

    for (const pkg of pkgs) {
      if (!pkg.wasmBytes) continue;
      let session = pkgSessions.get(pkg.wasmBytes);
      if (!session) {
        const inst = createIsolatedWasmInstance(pkg.wasmBytes);
        if (!inst) continue;
        const exp = inst.exports as WasmDyrExports;
        if (!exp.memory) continue;
        session = { exports: exp, views: createMemoryViews(exp.memory), slotIndex: 0 };
        pkgSessions.set(pkg.wasmBytes, session);
      }
      const { exports, views } = session;

      const initFnV1 = exports[`${safe}_init`] as
        | ((conPtr: number, count: number, statePtr: number, ioPtr: number) => void)
        | undefined;
      const stepFnV1 = exports[`${safe}_step`] as
        | ((t: number, dt: number, conPtr: number, statePtr: number, ioPtr: number) => void)
        | undefined;

      const initFnV2 = exports["psseModelInit"] as
        | ((archetypeId: number, slotPtr: number, iconCount: number, conCount: number) => number)
        | undefined;
      const stepFnV2 = exports["psseModelStep"] as
        | ((archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number) => void)
        | undefined;

      const useV1 = typeof initFnV1 === "function" && typeof stepFnV1 === "function";
      const useV2 =
        !useV1 && archCode !== undefined && typeof initFnV2 === "function" && typeof stepFnV2 === "function";
      if (!useV1 && !useV2) continue;

      const getArenaBaseFn = exports["psseGetArenaBase"] as (() => number) | undefined;
      const arenaBase = typeof getArenaBaseFn === "function" ? Math.max(8192, (getArenaBaseFn() + 63) & ~63) : 8192;
      const base = arenaBase + session.slotIndex * 2048;
      ensureMemoryCapacity(views, base + 2048);
      session.slotIndex++;

      const rawCon = rec.con ?? [];
      const con =
        useV2 && archCode !== undefined ? normalizeConForArchetype(archCode, rawCon, rec.namedParams) : rawCon;
      const icons = rec.icons ?? [];

      if (useV1) {
        const conPtr = base;
        const statePtr = base + 512;
        const ioPtr = base + 640;
        const ioOff = ioPtr >> 3;
        const conOff = conPtr >> 3;

        const writeIo = (io: PsseDynamicModelIO) => {
          const f64 = views.f64;
          f64[ioOff + 0] = io.eterm;
          f64[ioOff + 1] = io.speedDev;
          f64[ioOff + 2] = io.efd;
          f64[ioOff + 3] = io.pmech;
          f64[ioOff + 4] = io.vr;
          f64[ioOff + 5] = io.vi;
        };

        const readIo = (): { efd?: number | undefined; pmech?: number | undefined } => {
          const f64 = views.f64;
          return { efd: f64[ioOff + 2], pmech: f64[ioOff + 3] };
        };

        instances.push({
          busNumber: rec.ibus,
          machineId: rec.id,
          modelName: rec.model,
          category: schema?.category ?? rec.category,
          init(io: PsseDynamicModelIO) {
            const f64 = views.f64;
            for (let i = 0; i < Math.min(con.length, 64); i++) {
              f64[conOff + i] = con[i]!;
            }
            writeIo(io);
            initFnV1!(conPtr, con.length, statePtr, ioPtr);
          },
          doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO) {
            writeIo(io);
            stepFnV1!(tSec, dtSec, conPtr, statePtr, ioPtr);
            return readIo();
          },
        });
      } else {
        // ABI v2: ICON[32] @ +0x000, CON[160] @ +0x080, IO[16] @ +0x780
        const iconOff = (base + 0x000) >> 2;
        const conOff = (base + 0x080) >> 3;
        const ioOff = (base + 0x780) >> 3;

        const writeIoV2 = (io: PsseDynamicModelIO) => {
          const f64 = views.f64;
          f64[ioOff + 0] = io.eterm;
          f64[ioOff + 1] = io.speedDev;
          f64[ioOff + 2] = io.efd;
          f64[ioOff + 3] = io.pmech;
          f64[ioOff + 4] = io.vr;
          f64[ioOff + 5] = io.vi;
        };

        const readIoV2 = () => {
          const f64 = views.f64;
          return {
            efd: f64[ioOff + 2],
            pmech: f64[ioOff + 3],
            vsPss: f64[ioOff + 6],
            irInj: f64[ioOff + 9],
            iiInj: f64[ioOff + 10],
            qSvc: f64[ioOff + 11],
            tripMult: f64[ioOff + 12],
          };
        };

        instances.push({
          busNumber: rec.ibus,
          machineId: rec.id,
          modelName: rec.model,
          category: schema?.category ?? rec.category,
          init(io: PsseDynamicModelIO) {
            const i32 = views.i32;
            const f64 = views.f64;
            for (let i = 0; i < Math.min(icons.length, 32); i++) {
              const v = icons[i];
              i32[iconOff + i] = typeof v === "number" ? Math.trunc(v) : 0;
            }
            for (let i = 0; i < Math.min(con.length, 160); i++) {
              f64[conOff + i] = con[i]!;
            }
            writeIoV2(io);
            initFnV2!(archCode!, base, icons.length, con.length);
          },
          doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO) {
            writeIoV2(io);
            stepFnV2!(archCode!, tSec, dtSec, base, con.length);
            return readIoV2();
          },
        });
      }
      break;
    }
  }

  return instances;
}

/**
 * Compiles user-authored AssemblyScript PSS/E `.dyr` / `USRMDL` source into `Uint8Array` WASM.
 */
export async function compileAssemblyScriptDyrModel(
  sourceTs: string,
): Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  try {
    const ascSpec = "assemblyscript/asc";
    const asc = (await import(/* @vite-ignore */ ascSpec)) as typeof import("assemblyscript/asc");
    let outWasm: Uint8Array | undefined;
    const { error, stderr } = await asc.main(
      ["model.ts", "--outFile", "runtime.wasm", "--bindings", "raw", "--optimize", "--noAssert"],
      {
        readFile: (filename: string) => (filename === "model.ts" ? sourceTs : null),
        writeFile: (filename: string, contents: Uint8Array | string) => {
          if (filename === "runtime.wasm") {
            outWasm = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
          }
        },
        listFiles: () => [],
      },
    );
    const errText = stderr?.toString?.() ?? "";
    if (errText.trim().length > 0) diagnostics.push(errText.trim());
    if (error) diagnostics.push(error.message);
    return outWasm ? { wasmBytes: outWasm, diagnostics } : { diagnostics };
  } catch (e) {
    diagnostics.push(e instanceof Error ? e.message : String(e));
    return { diagnostics };
  }
}

/**
 * Compiles user-authored AssemblyScript PSS/E `.dyr` / `USRMDL` source in a Web Worker
 * when running in a browser, falling back safely to `compileAssemblyScriptDyrModel` in Node.js
 * or if the browser worker cannot resolve `assemblyscript/asc`.
 */
export async function compileAssemblyScriptDyrInWorker(
  sourceTs: string,
  options?: { ascUrl?: string },
): Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }> {
  if (
    typeof Worker === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return compileAssemblyScriptDyrModel(sourceTs);
  }

  const ascUrl =
    options?.ascUrl ??
    (typeof globalThis.location?.origin === "string" && globalThis.location.origin !== "null"
      ? `${globalThis.location.origin}/assets/asc/asc.js`
      : "assemblyscript/asc");

  const workerCode = `
    self.onmessage = async (event) => {
      const { sourceTs } = event.data;
      const diagnostics = [];
      try {
        let asc;
        try {
          asc = await import(${JSON.stringify(ascUrl)});
        } catch {
          asc = await import("assemblyscript/asc");
        }
        let outWasm = null;
        const { error, stderr } = await asc.main(
          ["model.ts", "--outFile", "runtime.wasm", "--bindings", "raw", "--optimize", "--noAssert"],
          {
            readFile: (filename) => (filename === "model.ts" ? sourceTs : null),
            writeFile: (filename, contents) => {
              if (filename === "runtime.wasm") {
                outWasm = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
              }
            },
            listFiles: () => [],
          }
        );
        const errText = stderr && stderr.toString ? stderr.toString() : "";
        if (errText.trim().length > 0) diagnostics.push(errText.trim());
        if (error) diagnostics.push(error.message);
        if (outWasm) {
          self.postMessage({ ok: true, wasmBytes: outWasm, diagnostics }, [outWasm.buffer]);
        } else {
          self.postMessage({ ok: true, diagnostics });
        }
      } catch (err) {
        self.postMessage({
          ok: false,
          fallback: true,
          diagnostics: [err && err.message ? err.message : String(err)],
        });
      }
    };
  `;

  let blobUrl: string | undefined;
  let worker: Worker | undefined;
  try {
    const blob = new Blob([workerCode], { type: "application/javascript" });
    blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl, { type: "module" });

    return await new Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }>((resolve) => {
      let settled = false;
      const finish = (res: { wasmBytes?: Uint8Array; diagnostics: string[] }) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        resolve(res);
      };

      worker!.onmessage = (ev: MessageEvent) => {
        const data = ev.data as {
          ok?: boolean;
          fallback?: boolean;
          wasmBytes?: Uint8Array;
          diagnostics?: string[];
        };
        if (data?.fallback) {
          finish({ diagnostics: [] });
          return;
        }
        const diags = Array.isArray(data?.diagnostics) ? data.diagnostics : [];
        finish(data?.wasmBytes ? { wasmBytes: data.wasmBytes, diagnostics: diags } : { diagnostics: diags });
      };

      worker!.onerror = () => {
        finish({ diagnostics: [] });
      };

      worker!.postMessage({ sourceTs });
    }).then((res) => {
      if (!res.wasmBytes && res.diagnostics.length === 0) {
        return compileAssemblyScriptDyrModel(sourceTs);
      }
      return res;
    });
  } catch {
    worker?.terminate();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    return compileAssemblyScriptDyrModel(sourceTs);
  }
}

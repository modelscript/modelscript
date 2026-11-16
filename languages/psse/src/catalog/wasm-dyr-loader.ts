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

const compiledCache = new WeakMap<Uint8Array, WebAssembly.Instance>();

function getOrInstantiateWasm(wasmBytes: Uint8Array): WebAssembly.Instance | undefined {
  let inst = compiledCache.get(wasmBytes);
  if (inst) return inst;
  try {
    const copy = new Uint8Array(wasmBytes);
    const mod = new WebAssembly.Module(copy);
    inst = new WebAssembly.Instance(mod, {});
    compiledCache.set(wasmBytes, inst);
    return inst;
  } catch {
    return undefined;
  }
}

let builtInRegistrationAttempted = false;

/**
 * Ensures the built-in `@modelscript/psse-std-lib` (`package.json#modelscript`) library is
 * registered in `globalLibraryRegistry` when running in Node.js. Browser callers can register
 * pre-bundled JSON/WASM payloads via `globalLibraryRegistry.registerLibraryBundle(...)`.
 */
export async function ensureBuiltInPsseLibraryRegistered(): Promise<void> {
  if (globalLibraryRegistry.getPackagesForLanguage("psse").length > 0) return;
  if (builtInRegistrationAttempted) return;
  builtInRegistrationAttempted = true;
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
      if (fs.existsSync(path.join(dir, "package.json"))) {
        await globalLibraryRegistry.loadLibraryFromDir(dir);
        break;
      }
    }
  } catch {
    // Browser / restricted environments register bundles explicitly
  }
}

import { resolveDyrModelSchema, type DaeArchetypeId } from "../schema/index.js";

const ARCHETYPE_CODE: Record<DaeArchetypeId, number> = {
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
  comp_rc_xc: 19,
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

/**
 * Instantiates AssemblyScript `.dyr` dynamic models from any loaded `package.json#modelscript`
 * PSS/E library package (`pkg.wasmBytes`) matching records in `psseCase.dyr`.
 */
export function instantiateWasmDyrModelsForCase(psseCase: PsseCase): PsseLinkedDynamicInstance[] {
  const records = psseCase.dyr?.records ?? [];
  if (records.length === 0) return [];

  if (globalLibraryRegistry.getPackagesForLanguage("psse").length === 0) {
    void ensureBuiltInPsseLibraryRegistered();
  }

  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("psse")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (pkgs.length === 0) return [];

  const instances: PsseLinkedDynamicInstance[] = [];
  // Allocate 2048-byte aligned slots in linear memory starting at 4096 (supports both v1 and v2 ABI)
  let slotIndex = 0;

  for (const rec of records) {
    const safe = sanitizeIdent(rec.model.toUpperCase());
    const schema = resolveDyrModelSchema(rec.model);
    const archCode = schema ? ARCHETYPE_CODE[schema.daeArchetype] : undefined;

    for (const pkg of pkgs) {
      if (!pkg.wasmBytes) continue;
      const instance = getOrInstantiateWasm(pkg.wasmBytes);
      if (!instance) continue;
      const exports = instance.exports as WasmDyrExports;
      if (!exports.memory) continue;

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

      const mem = exports.memory;
      const base = 4096 + slotIndex * 2048;
      if (mem.buffer.byteLength < base + 2048) {
        const neededPages = Math.ceil((base + 2048 - mem.buffer.byteLength) / 65536);
        mem.grow(neededPages);
      }
      slotIndex++;

      const con = rec.con ?? [];
      const icons = rec.icons ?? [];

      if (useV1) {
        const conPtr = base;
        const statePtr = base + 512;
        const ioPtr = base + 640;

        const writeIo = (io: PsseDynamicModelIO) => {
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          f64[o + 0] = io.eterm;
          f64[o + 1] = io.speedDev;
          f64[o + 2] = io.efd;
          f64[o + 3] = io.pmech;
          f64[o + 4] = io.vr;
          f64[o + 5] = io.vi;
        };

        const readIo = (): { efd?: number | undefined; pmech?: number | undefined } => {
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          return { efd: f64[o + 2], pmech: f64[o + 3] };
        };

        instances.push({
          busNumber: rec.ibus,
          machineId: rec.id,
          modelName: rec.model,
          category: schema?.category ?? rec.category,
          init(io: PsseDynamicModelIO) {
            const f64 = new Float64Array(mem.buffer);
            for (let i = 0; i < Math.min(con.length, 64); i++) {
              f64[(conPtr >> 3) + i] = con[i]!;
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
        const iconPtr = base + 0x000;
        const conPtr = base + 0x080;
        const ioPtr = base + 0x780;

        const writeIoV2 = (io: PsseDynamicModelIO) => {
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          f64[o + 0] = io.eterm;
          f64[o + 1] = io.speedDev;
          f64[o + 2] = io.efd;
          f64[o + 3] = io.pmech;
          f64[o + 4] = io.vr;
          f64[o + 5] = io.vi;
        };

        const readIoV2 = () => {
          const f64 = new Float64Array(mem.buffer);
          const o = ioPtr >> 3;
          return {
            efd: f64[o + 2],
            pmech: f64[o + 3],
            vsPss: f64[o + 6],
            irInj: f64[o + 9],
            iiInj: f64[o + 10],
            qSvc: f64[o + 11],
            tripMult: f64[o + 12],
          };
        };

        instances.push({
          busNumber: rec.ibus,
          machineId: rec.id,
          modelName: rec.model,
          category: schema?.category ?? rec.category,
          init(io: PsseDynamicModelIO) {
            const i32 = new Int32Array(mem.buffer);
            const f64 = new Float64Array(mem.buffer);
            for (let i = 0; i < Math.min(icons.length, 32); i++) {
              const v = icons[i];
              i32[(iconPtr >> 2) + i] = typeof v === "number" ? Math.trunc(v) : 0;
            }
            for (let i = 0; i < Math.min(con.length, 160); i++) {
              f64[(conPtr >> 3) + i] = con[i]!;
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

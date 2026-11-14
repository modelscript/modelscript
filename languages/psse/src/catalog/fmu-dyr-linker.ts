// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  parseFmiLsRmsAnnotations,
  parseModelDescription,
  parseTerminalsAndIcons,
  type FmiLsRmsCompanionInstance,
  type FmiLsRmsManifest,
  type FmiModelDescription,
  type FmiTerminal,
} from "@modelscript/exchange";
import { fmuToPsse, type PsseProjectionResult } from "../projections/fmu-to-psse.js";
import type { PsseDynamicModelIO, PsseLinkedDynamicInstance } from "./wasm-dyr-loader.js";

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    await writer.write(copy);
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  }

  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.inflateRawSync(compressed));
}

async function readZipEntries(zipBytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let offset = 0;

  while (offset + 30 <= zipBytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameBytes = zipBytes.subarray(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;
    const raw = zipBytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) {
      files.set(name, new Uint8Array(raw));
    } else if (method === 8) {
      files.set(name, await inflateRawBytes(raw));
    }
    offset = dataStart + compSize;
  }

  return files;
}

export interface LoadedFmuPsseLink {
  modelDescription: FmiModelDescription;
  projection: PsseProjectionResult;
  instance: PsseLinkedDynamicInstance;
  fmiLsRms?: FmiLsRmsManifest | undefined;
  nortonCompanion?: FmiLsRmsCompanionInstance | undefined;
  terminals?: FmiTerminal[] | undefined;
}

interface StandardFmiBridge {
  setReal(vr: number, value: number): void;
  getReal(vr: number): number;
  doStep(tSec: number, dtSec: number): void;
}

function createStandardFmiBridge(
  exports: Record<string, unknown>,
  mem: WebAssembly.Memory | undefined,
  modelDescription: FmiModelDescription,
): StandardFmiBridge | undefined {
  if (!mem) return undefined;

  // Scratch pointers in WASM linear memory for marshaling FMI valueReference + float64 arrays
  const vrScratchPtr = 3072;
  const valScratchPtr = 3136;
  const strScratchPtr = 3200;
  const ensureMem = () => {
    if (mem.buffer.byteLength < 4096) mem.grow(1);
  };
  const writeCString = (ptr: number, text: string): number => {
    ensureMem();
    const bytes = new TextEncoder().encode(text);
    const u8 = new Uint8Array(mem.buffer);
    u8.set(bytes, ptr);
    u8[ptr + bytes.length] = 0;
    return ptr;
  };

  // FMI 3.0 C-ABI
  const fmi3Inst = exports["fmi3InstantiateCoSimulation"] as ((...args: number[]) => number) | undefined;
  const fmi3Set = exports["fmi3SetFloat64"] as
    | ((c: number, vrs: number, nvr: number, vals: number, nvals: number) => number)
    | undefined;
  const fmi3Get = exports["fmi3GetFloat64"] as
    | ((c: number, vrs: number, nvr: number, vals: number, nvals: number) => number)
    | undefined;
  const fmi3Step = exports["fmi3DoStep"] as
    | ((
        c: number,
        t: number,
        dt: number,
        noSet: number,
        evt: number,
        term: number,
        early: number,
        lastT: number,
      ) => number)
    | undefined;

  if (fmi3Inst && fmi3Set && fmi3Get && fmi3Step) {
    const namePtr = writeCString(strScratchPtr, modelDescription.modelName);
    const tokenPtr = writeCString(strScratchPtr + 128, modelDescription.guid || "modelscript");
    const comp = fmi3Inst(namePtr, tokenPtr, 0, 0, 0, 0, 0, 0, 0, 0);
    const enterInit = exports["fmi3EnterInitializationMode"] as
      | ((c: number, tolDef: number, tol: number, t0: number, stopDef: number, stop: number) => number)
      | undefined;
    const exitInit = exports["fmi3ExitInitializationMode"] as ((c: number) => number) | undefined;
    enterInit?.(comp, 0, 1e-6, 0.0, 0, 0.0);
    exitInit?.(comp);

    return {
      setReal(vr: number, value: number) {
        ensureMem();
        new Uint32Array(mem.buffer)[vrScratchPtr >> 2] = vr;
        new Float64Array(mem.buffer)[valScratchPtr >> 3] = value;
        fmi3Set(comp, vrScratchPtr, 1, valScratchPtr, 1);
      },
      getReal(vr: number): number {
        ensureMem();
        new Uint32Array(mem.buffer)[vrScratchPtr >> 2] = vr;
        fmi3Get(comp, vrScratchPtr, 1, valScratchPtr, 1);
        return new Float64Array(mem.buffer)[valScratchPtr >> 3] ?? 0;
      },
      doStep(tSec: number, dtSec: number) {
        ensureMem();
        fmi3Step(comp, tSec, dtSec, 1, 0, 0, 0, 0);
      },
    };
  }

  // FMI 2.0 C-ABI
  const fmi2Inst = exports["fmi2Instantiate"] as ((...args: number[]) => number) | undefined;
  const fmi2Set = exports["fmi2SetReal"] as ((c: number, vr: number, nvr: number, val: number) => number) | undefined;
  const fmi2Get = exports["fmi2GetReal"] as ((c: number, vr: number, nvr: number, val: number) => number) | undefined;
  const fmi2Step = exports["fmi2DoStep"] as ((c: number, t: number, dt: number, noSet: number) => number) | undefined;

  if (fmi2Inst && fmi2Set && fmi2Get && fmi2Step) {
    const namePtr = writeCString(strScratchPtr, modelDescription.modelName);
    const guidPtr = writeCString(strScratchPtr + 128, modelDescription.guid || "modelscript");
    const comp = fmi2Inst(namePtr, 1, guidPtr, 0, 0, 0, 0);
    const setupExp = exports["fmi2SetupExperiment"] as
      | ((c: number, tolDef: number, tol: number, t0: number, stopDef: number, stop: number) => number)
      | undefined;
    const enterInit = exports["fmi2EnterInitializationMode"] as ((c: number) => number) | undefined;
    const exitInit = exports["fmi2ExitInitializationMode"] as ((c: number) => number) | undefined;
    setupExp?.(comp, 0, 1e-6, 0.0, 0, 0.0);
    enterInit?.(comp);
    exitInit?.(comp);

    return {
      setReal(vr: number, value: number) {
        ensureMem();
        new Uint32Array(mem.buffer)[vrScratchPtr >> 2] = vr;
        new Float64Array(mem.buffer)[valScratchPtr >> 3] = value;
        fmi2Set(comp, vrScratchPtr, 1, valScratchPtr);
      },
      getReal(vr: number): number {
        ensureMem();
        new Uint32Array(mem.buffer)[vrScratchPtr >> 2] = vr;
        fmi2Get(comp, vrScratchPtr, 1, valScratchPtr);
        return new Float64Array(mem.buffer)[valScratchPtr >> 3] ?? 0;
      },
      doStep(tSec: number, dtSec: number) {
        fmi2Step(comp, tSec, dtSec, 1);
      },
    };
  }

  return undefined;
}

/**
 * Unpacks an FMI 2.0/3.0 `.fmu` archive, extracts `modelDescription.xml`, `fmi-ls-rms`
 * annotations, and any embedded WebAssembly (`*.wasm`), returning a `PsseLinkedDynamicInstance`
 * (and optional `FmiLsRmsCompanionInstance`) ready for `simulatePsseTransient`.
 */
export async function loadFmuForPsse(
  fmuBytes: Uint8Array,
  options: { busNumber?: number | undefined; machineId?: string | undefined } = {},
): Promise<LoadedFmuPsseLink> {
  const entries = await readZipEntries(fmuBytes);
  const xmlBytes = entries.get("modelDescription.xml");
  if (!xmlBytes) {
    throw new Error("Invalid .fmu archive: missing modelDescription.xml");
  }
  const xmlText = new TextDecoder().decode(xmlBytes);
  const modelDescription = parseModelDescription(xmlText);
  const fmiLsRms = parseFmiLsRmsAnnotations(xmlText);
  const termXmlBytes = entries.get("terminalsAndIcons.xml") ?? entries.get("terminalsAndIcons/terminalsAndIcons.xml");
  const terminals = termXmlBytes ? parseTerminalsAndIcons(new TextDecoder().decode(termXmlBytes)) : undefined;

  let detectedBusId: number | undefined;
  for (const v of modelDescription.variables) {
    if ((v.name === "bus_id" || v.name === "busNumber") && v.start !== undefined) {
      const parsed = Number(v.start);
      if (Number.isFinite(parsed) && parsed > 0) {
        detectedBusId = Math.trunc(parsed);
        break;
      }
    }
  }
  const effectiveBusNumber = options.busNumber ?? detectedBusId ?? 1;

  const projection = fmuToPsse(
    {
      modelName: modelDescription.modelName,
      description: modelDescription.description,
      guid: modelDescription.guid,
      fmiVersion: modelDescription.fmiVersion,
      variables: modelDescription.variables.map((v) => ({
        name: v.name,
        causality: v.causality,
        type: v.type,
        valueReference: v.valueReference,
        unit: v.unit,
        start: v.start,
        description: v.description,
      })),
    },
    effectiveBusNumber,
    options.machineId ?? "1",
  );

  // Locate optional embedded WebAssembly FMU binary (binaries/wasm/*.wasm or resources/*.wasm)
  let wasmBytes: Uint8Array | undefined;
  for (const [entryName, bytes] of entries.entries()) {
    if (entryName.endsWith(".wasm")) {
      wasmBytes = bytes;
      break;
    }
  }

  let wasmInst: WebAssembly.Instance | undefined;
  if (wasmBytes) {
    const mod = new WebAssembly.Module(new Uint8Array(wasmBytes));
    const wasiStub = {
      proc_exit: () => {},
      fd_write: () => 0,
      fd_seek: () => 0,
      fd_close: () => 0,
      environ_sizes_get: () => 0,
      environ_get: () => 0,
    };
    wasmInst = new WebAssembly.Instance(mod, {
      wasi_snapshot_preview1: wasiStub,
      env: { abort: () => {} },
    });
  }

  const exports = (wasmInst?.exports ?? {}) as Record<string, unknown>;
  const safeName = projection.modelName.replace(/[^A-Za-z0-9_]/g, "_");
  const initFn = exports[`${safeName}_init`] as
    | ((conPtr: number, count: number, statePtr: number, ioPtr: number) => void)
    | undefined;
  const stepFn = exports[`${safeName}_step`] as
    | ((t: number, dt: number, conPtr: number, statePtr: number, ioPtr: number) => void)
    | undefined;
  const mem = exports["memory"] as WebAssembly.Memory | undefined;

  const conPtr = 4096;
  const statePtr = 4608;
  const ioPtr = 4736;

  const fmiBridge = createStandardFmiBridge(exports, mem, modelDescription);
  const vrByName = new Map<string, number>();
  for (const v of modelDescription.variables) {
    if (typeof v.valueReference === "number") vrByName.set(v.name, v.valueReference);
  }

  const instance: PsseLinkedDynamicInstance = {
    busNumber: effectiveBusNumber,
    machineId: options.machineId,
    modelName: projection.modelName,
    init(io: PsseDynamicModelIO) {
      if (mem && typeof initFn === "function" && initFn.length >= 4) {
        if (mem.buffer.byteLength < ioPtr + 64) mem.grow(1);
        const f64 = new Float64Array(mem.buffer);
        for (let i = 0; i < Math.min(projection.conMap.length, 64); i++) {
          f64[(conPtr >> 3) + i] = projection.conMap[i]!.value;
        }
        const o = ioPtr >> 3;
        f64[o + 0] = io.eterm;
        f64[o + 1] = io.speedDev;
        f64[o + 2] = io.efd;
        f64[o + 3] = io.pmech;
        f64[o + 4] = io.vr;
        f64[o + 5] = io.vi;
        initFn(conPtr, projection.conMap.length, statePtr, ioPtr);
      } else if (fmiBridge) {
        const vrMap: Record<string, number> = {
          eterm: io.eterm,
          speedDev: io.speedDev,
          efd: io.efd,
          pmech: io.pmech,
          vr: io.vr,
          vi: io.vi,
        };
        for (const [k, val] of Object.entries(vrMap)) {
          const vr = vrByName.get(k);
          if (vr !== undefined) fmiBridge.setReal(vr, val);
        }
      }
    },
    doStep(tSec: number, dtSec: number, io: PsseDynamicModelIO) {
      if (mem && typeof stepFn === "function" && stepFn.length >= 5) {
        const f64 = new Float64Array(mem.buffer);
        const o = ioPtr >> 3;
        f64[o + 0] = io.eterm;
        f64[o + 1] = io.speedDev;
        f64[o + 2] = io.efd;
        f64[o + 3] = io.pmech;
        f64[o + 4] = io.vr;
        f64[o + 5] = io.vi;
        stepFn(tSec, dtSec, conPtr, statePtr, ioPtr);
        return { efd: f64[o + 2], pmech: f64[o + 3] };
      }
      if (fmiBridge) {
        const inputs: Record<string, number> = {
          eterm: io.eterm,
          speedDev: io.speedDev,
          vr: io.vr,
          vi: io.vi,
        };
        for (const [k, val] of Object.entries(inputs)) {
          const vr = vrByName.get(k);
          if (vr !== undefined) fmiBridge.setReal(vr, val);
        }
        fmiBridge.doStep(tSec, dtSec);
        const efdVr = vrByName.get("efd");
        const pmVr = vrByName.get("pmech");
        return {
          efd: efdVr !== undefined ? fmiBridge.getReal(efdVr) : io.efd,
          pmech: pmVr !== undefined ? fmiBridge.getReal(pmVr) : io.pmech,
        };
      }
      return { efd: io.efd, pmech: io.pmech };
    },
  };

  let nortonCompanion: FmiLsRmsCompanionInstance | undefined;
  const term0 = fmiLsRms?.terminals[0];
  if (fmiLsRms && term0) {
    const stampFn = exports["rms_stamp_norton"] as ((t: number, dt: number, outPtr: number) => void) | undefined;
    const stepRmsFn = exports["rms_do_step"] as ((t: number, dt: number, vr: number, vi: number) => void) | undefined;
    const nortonPtr = 4864;

    if (mem && stampFn && stepRmsFn) {
      nortonCompanion = {
        busNumber: effectiveBusNumber,
        machineId: options.machineId,
        stampNorton(tSec: number, dtSec: number) {
          if (mem.buffer.byteLength < nortonPtr + 64) mem.grow(1);
          stampFn(tSec, dtSec, nortonPtr);
          const f64 = new Float64Array(mem.buffer);
          const o = nortonPtr >> 3;
          return {
            gEq: f64[o + 0] ?? 0,
            bEq: f64[o + 1] ?? 0,
            irHist: f64[o + 2] ?? 0,
            iiHist: f64[o + 3] ?? 0,
          };
        },
        doStep(tSec: number, dtSec: number, vr: number, vi: number) {
          stepRmsFn(tSec, dtSec, vr, vi);
        },
      };
    } else if (fmiBridge) {
      const vrRef = vrByName.get(term0.vrVar);
      const viRef = vrByName.get(term0.viVar);
      const gRef = vrByName.get(term0.gEqVar);
      const bRef = vrByName.get(term0.bEqVar);
      const irRef = vrByName.get(term0.irHistVar);
      const iiRef = vrByName.get(term0.iiHistVar);
      nortonCompanion = {
        busNumber: effectiveBusNumber,
        machineId: options.machineId,
        stampNorton() {
          return {
            gEq: gRef !== undefined ? fmiBridge.getReal(gRef) : 0,
            bEq: bRef !== undefined ? fmiBridge.getReal(bRef) : 0,
            irHist: irRef !== undefined ? fmiBridge.getReal(irRef) : 0,
            iiHist: iiRef !== undefined ? fmiBridge.getReal(iiRef) : 0,
          };
        },
        doStep(tSec: number, dtSec: number, vr: number, vi: number) {
          if (vrRef !== undefined) fmiBridge.setReal(vrRef, vr);
          if (viRef !== undefined) fmiBridge.setReal(viRef, vi);
          fmiBridge.doStep(tSec, dtSec);
        },
      };
    }
  }

  return {
    modelDescription,
    projection,
    instance,
    ...(fmiLsRms ? { fmiLsRms } : {}),
    ...(nortonCompanion ? { nortonCompanion } : {}),
    ...(terminals ? { terminals } : {}),
  };
}

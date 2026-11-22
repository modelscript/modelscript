// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
} from "@modelscript/runtime";
import { ensureBuiltInSimulinkLibraryRegistered, lookupSimulinkBlockSchema } from "./library-package-adapter.js";
import { getSimulinkStdLibWasmBytes } from "./simulink-std-lib-data.js";
import { SimulinkArchetypeId } from "./simulink-std-schemas.js";

const SLOT_STRIDE_BYTES = 2048;
const RING_BUFFER_BYTES = 4096 * 16;
const MAX_PARAMS = 160;
const OFF_PARAM = 0x080;
const OFF_IN = 0x780;
const OFF_OUT = 0x7c0;

export type SimulinkParamValue = number | readonly number[] | readonly (readonly number[])[];

export interface SimulinkLinkedBlockInstance {
  blockType: string;
  archetypeId: number;
  init(): number;
  step(tSec: number, dtSec: number, inputs?: readonly number[]): number;
  getOutput(index?: number): number;
}

interface SimulinkWasmExports {
  memory: WebAssembly.Memory;
  simGetArenaBase(): number;
  simBlockInit(archetypeId: number, slotPtr: number, paramCount: number): number;
  simBlockStep(archetypeId: number, t: number, dt: number, slotPtr: number, paramCount: number): void;
}

export function resolveSimulinkStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSimulinkLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("simulink")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) return pkg.wasmBytes;
  }
  return getSimulinkStdLibWasmBytes();
}

function flattenNumbers(val: SimulinkParamValue | undefined): number[] {
  if (val === undefined) return [];
  if (typeof val === "number") return Number.isFinite(val) ? [val] : [0.0];
  const out: number[] = [];
  for (const item of val) {
    if (Array.isArray(item)) {
      for (const inner of item as readonly number[]) {
        out.push(Number.isFinite(inner) ? inner : 0.0);
      }
    } else if (typeof item === "number") {
      out.push(Number.isFinite(item) ? item : 0.0);
    }
  }
  return out;
}

function is2DArray(val: SimulinkParamValue | undefined): val is readonly (readonly number[])[] {
  return Array.isArray(val) && val.length > 0 && Array.isArray(val[0]);
}

function leftPadToLength(arr: readonly number[], len: number): number[] {
  if (arr.length === len) return [...arr];
  if (arr.length > len) return arr.slice(arr.length - len);
  const pad = new Array<number>(len - arr.length).fill(0.0);
  return [...pad, ...arr];
}

function packSpecializedParams(archetypeId: number, params: Record<string, SimulinkParamValue>): number[] | undefined {
  if (archetypeId === SimulinkArchetypeId.TRANSFER_FCN) {
    const numVal = params["Num"] ?? params["Numerator"];
    const denVal = params["Den"] ?? params["Denominator"];
    const orderVal = params["Order"];
    if (Array.isArray(numVal) || Array.isArray(denVal) || typeof orderVal === "number") {
      const denRaw = Array.isArray(denVal) ? flattenNumbers(denVal) : [1.0, 1.0];
      const numRaw = Array.isArray(numVal) ? flattenNumbers(numVal) : [1.0];
      const rawOrder = typeof orderVal === "number" ? Math.round(orderVal) : Math.max(1, denRaw.length - 1);
      const order = Math.max(1, Math.min(8, rawOrder));
      const num = leftPadToLength(numRaw, order + 1);
      const den = leftPadToLength(denRaw, order + 1);
      return [order, ...num, ...den];
    }
    return undefined;
  }

  if (archetypeId === SimulinkArchetypeId.STATE_SPACE) {
    const aVal = params["A"];
    const bVal = params["B"];
    const cVal = params["C"];
    const dVal = params["D"];
    const x0Val = params["X0"];
    if (
      Array.isArray(aVal) ||
      Array.isArray(bVal) ||
      Array.isArray(cVal) ||
      Array.isArray(dVal) ||
      Array.isArray(x0Val)
    ) {
      let n = 1;
      if (is2DArray(aVal)) n = aVal.length;
      else if (Array.isArray(aVal)) n = Math.max(1, Math.round(Math.sqrt(aVal.length)));
      else if (Array.isArray(x0Val)) n = x0Val.length;
      n = Math.max(1, Math.min(6, n));

      let m = 1;
      if (is2DArray(bVal)) m = bVal[0]?.length ?? 1;
      else if (Array.isArray(bVal)) m = Math.max(1, Math.round(bVal.length / n));
      m = Math.max(1, Math.min(6, m));

      let p = 1;
      if (is2DArray(cVal)) p = cVal.length;
      else if (Array.isArray(cVal)) p = Math.max(1, Math.round(cVal.length / n));
      p = Math.max(1, Math.min(6, p));

      const pad = (arr: number[], target: number): number[] => {
        const res = new Array<number>(target).fill(0.0);
        for (let i = 0; i < Math.min(arr.length, target); i++) res[i] = arr[i]!;
        return res;
      };

      const aFlat = pad(flattenNumbers(aVal), n * n);
      const bFlat = pad(flattenNumbers(bVal), n * m);
      const cFlat = pad(flattenNumbers(cVal), p * n);
      const dFlat = pad(flattenNumbers(dVal), p * m);
      const x0Flat = pad(flattenNumbers(x0Val), n);
      return [n, m, p, ...aFlat, ...bFlat, ...cFlat, ...dFlat, ...x0Flat];
    }
    return undefined;
  }

  if (archetypeId === SimulinkArchetypeId.LOOKUP_1D) {
    const bxVal = params["Breakpoints1"] ?? params["BreakpointsForDimension1"] ?? params["Breakpoints"] ?? params["X"];
    if (Array.isArray(bxVal)) {
      const bx = flattenNumbers(bxVal);
      const byVal = params["Breakpoints2"] ?? params["BreakpointsForDimension2"];
      const tableVal = params["Table"] ?? params["TableData"] ?? params["Z"] ?? params["Y"];
      const is2D = Array.isArray(byVal) || is2DArray(tableVal);
      if (is2D) {
        const by = Array.isArray(byVal)
          ? flattenNumbers(byVal)
          : Array.isArray(params["Y"])
            ? flattenNumbers(params["Y"])
            : [0.0, 1.0];
        const nx = Math.max(2, Math.min(32, bx.length));
        const ny = Math.max(2, Math.min(32, by.length));
        const zFlat = flattenNumbers(tableVal);
        const zPadded = new Array<number>(nx * ny).fill(0.0);
        for (let i = 0; i < Math.min(zFlat.length, nx * ny); i++) zPadded[i] = zFlat[i]!;
        return [2, nx, ny, ...bx.slice(0, nx), ...by.slice(0, ny), ...zPadded];
      } else {
        const n = Math.max(2, Math.min(32, bx.length));
        const yFlat = flattenNumbers(tableVal);
        const yPadded = new Array<number>(n).fill(0.0);
        for (let i = 0; i < Math.min(yFlat.length, n); i++) yPadded[i] = yFlat[i]!;
        return [1, n, 0, ...bx.slice(0, n), ...yPadded];
      }
    }
    return undefined;
  }

  if (archetypeId === SimulinkArchetypeId.STATEFLOW_CHART) {
    const transVal = params["Transitions"];
    if (Array.isArray(transVal)) {
      const initState = typeof params["InitialState"] === "number" ? params["InitialState"] : 0.0;
      const flat = flattenNumbers(transVal);
      const numTrans = Math.min(24, Math.floor(flat.length / 6));
      return [initState, numTrans, ...flat.slice(0, numTrans * 6)];
    }
    return undefined;
  }

  return undefined;
}

/**
 * Instantiates a cleanroom AssemblyScript WASM block from `@modelscript/simulink-std-lib`.
 */
export function instantiateSimulinkWasmBlock(
  blockType: string,
  params: Record<string, SimulinkParamValue> = {},
  wasmBytes?: Uint8Array,
): SimulinkLinkedBlockInstance | undefined {
  const schema = lookupSimulinkBlockSchema(blockType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const instance = createIsolatedWasmInstance(wasmBytes ?? resolveSimulinkStdLibWasmBytes());
  if (!instance) return undefined;
  const exports = instance.exports as unknown as SimulinkWasmExports;
  if (!exports.memory || typeof exports.simBlockInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.simGetArenaBase();
  const neededBytes =
    archetypeId === SimulinkArchetypeId.TRANSPORT_DELAY ? SLOT_STRIDE_BYTES + RING_BUFFER_BYTES : SLOT_STRIDE_BYTES;
  ensureMemoryCapacity(views, slotPtr + neededBytes);

  // Normalize convenient Simulink aliases for Backlash & CoulombViscousFriction
  const normalizedParams: Record<string, SimulinkParamValue> = { ...params };
  if (archetypeId === SimulinkArchetypeId.BACKLASH && typeof params["BacklashWidth"] === "number") {
    const half = Math.abs(params["BacklashWidth"]) * 0.5;
    if (normalizedParams["LowerValue"] === undefined) normalizedParams["LowerValue"] = -half;
    if (normalizedParams["UpperValue"] === undefined) normalizedParams["UpperValue"] = half;
  }
  if (archetypeId === SimulinkArchetypeId.COULOMB_FRICTION && typeof params["Offset"] === "number") {
    const off = Math.abs(params["Offset"]);
    if (normalizedParams["LowerValue"] === undefined) normalizedParams["LowerValue"] = -off;
    if (normalizedParams["UpperValue"] === undefined) normalizedParams["UpperValue"] = off;
  }

  const pBase = (slotPtr + OFF_PARAM) >> 3;
  const specialized = packSpecializedParams(archetypeId, normalizedParams);
  let paramCount: number;
  if (specialized) {
    paramCount = Math.min(specialized.length, MAX_PARAMS);
    for (let i = 0; i < paramCount; i++) {
      const v = specialized[i]!;
      views.f64[pBase + i] = Number.isFinite(v) ? v : 0.0;
    }
  } else {
    paramCount = schema.parameters.length;
    for (let i = 0; i < paramCount; i++) {
      const p = schema.parameters[i]!;
      const override = normalizedParams[p.key];
      views.f64[pBase + i] =
        typeof override === "number" && Number.isFinite(override)
          ? override
          : typeof p.defaultValue === "number"
            ? p.defaultValue
            : 0.0;
    }
  }

  return {
    blockType: schema.name,
    archetypeId,
    init() {
      return exports.simBlockInit(archetypeId, slotPtr, paramCount);
    },
    step(tSec: number, dtSec: number, inputs: readonly number[] = []): number {
      const inBase = (slotPtr + OFF_IN) >> 3;
      for (let i = 0; i < Math.min(inputs.length, 8); i++) {
        views.f64[inBase + i] = inputs[i] ?? 0.0;
      }
      exports.simBlockStep(archetypeId, tSec, dtSec, slotPtr, paramCount);
      return views.f64[(slotPtr + OFF_OUT) >> 3] ?? 0.0;
    },
    getOutput(index = 0): number {
      if (index < 0 || index >= 8) return 0.0;
      return views.f64[((slotPtr + OFF_OUT) >> 3) + index] ?? 0.0;
    },
  };
}

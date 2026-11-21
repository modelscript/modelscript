// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getDyrSchemaById,
  resolveCanonicalDyrModelName,
  resolveDyrModelSchema,
  type DyrModelSchema,
} from "../schema/index.js";
import type { DyrHeaderKind, PsseDyrCase, PsseDyrCategory, PsseDyrRecord } from "../types.js";
import { getDyrKernelWasmBinary } from "./dyr-wasm-binary.js";

const CATEGORY_FROM_CODE: readonly PsseDyrCategory[] = [
  "generator",
  "exciter",
  "governor",
  "stabilizer",
  "load",
  "facts",
  "hvdc",
  "relay",
  "user",
];

const HEADER_KIND_FROM_CODE: readonly DyrHeaderKind[] = [
  "machine",
  "bus",
  "load",
  "subsystem",
  "branch",
  "xfmr2w",
  "dc2t",
  "vscdc",
  "facts",
  "usrmdl",
];

interface DyrKernelExports {
  memory: WebAssembly.Memory;
  dyr_allocInput(byteLen: number): number;
  dyr_parse(byteLen: number): number;
  dyr_getRecordCount(): number;
  dyr_getTotalParams(): number;
  dyr_getSchemaIdsPtr(): number;
  dyr_getCategoriesPtr(): number;
  dyr_getHeaderKindsPtr(): number;
  dyr_getBusPtr(): number;
  dyr_getBus2Ptr(): number;
  dyr_getModelOffPtr(): number;
  dyr_getModelLenPtr(): number;
  dyr_getIdOffPtr(): number;
  dyr_getIdLenPtr(): number;
  dyr_getParamRowOffPtr(): number;
  dyr_getParamValuesPtr(): number;
  dyr_getParamIsIntPtr(): number;
  dyr_getSpanStartPtr(): number;
  dyr_getSpanEndPtr(): number;
  dyr_getSpanLinePtr(): number;
  dyr_getUsrMetaPtr(): number;
}

let cachedModule: WebAssembly.Module | undefined;
let cachedExports: DyrKernelExports | undefined;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getKernelExports(): DyrKernelExports {
  if (cachedExports) return cachedExports;
  if (!cachedModule) {
    const bytes = getDyrKernelWasmBinary();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    cachedModule = new WebAssembly.Module(copy);
  }
  const instance = new WebAssembly.Instance(cachedModule, {
    env: {
      abort() {
        throw new Error("dyr-kernel.wasm aborted");
      },
    },
  });
  cachedExports = instance.exports as unknown as DyrKernelExports;
  return cachedExports;
}

/**
 * Zero-GC Struct-of-Arrays (SoA) table representation of a parsed `.dyr` file.
 * Designed for 70k–100k+ bus transient stability pipelines without JS per-record heap churn.
 */
export interface PsseDyrSoaTables {
  /** UTF-8 source buffer used for zero-copy string slice decoding on demand. */
  utf8Bytes: Uint8Array;
  /** Number of parsed dynamic equipment records. */
  nRecords: number;
  /** Total raw parameter tokens across all records. */
  nTotalParams: number;
  /** 1-based index into `DYR_SCHEMA_LIST` (`0` = unknown/custom model). */
  recSchemaId: Uint16Array;
  /** `PsseDyrCategory` enum code (0..8). */
  recCategoryCode: Uint8Array;
  /** `DyrHeaderKind` enum code (0..9). */
  recHeaderKindCode: Uint8Array;
  /** Primary bus / area / zone / owner number (`0` for quoted DC/FACTS device names). */
  recBus: Int32Array;
  /** Secondary bus `JBUS` for branch protection relays (`0` otherwise). */
  recBus2: Int32Array;
  /** Byte offset & length of uppercase/raw model name in `utf8Bytes`. */
  recModelOff: Uint32Array;
  recModelLen: Uint16Array;
  /** Byte offset & length of machine/load/circuit/device ID in `utf8Bytes`. */
  recIdOff: Uint32Array;
  recIdLen: Uint16Array;
  /** CSR row offsets (`length = nRecords + 1`) into `paramValues` & `paramIsInt`. */
  paramRowOffsets: Uint32Array;
  /** Parsed IEEE-754 float64 values (or packed offset/len when `paramIsInt[k] === 2`). */
  paramValues: Float64Array;
  /** Raw float64 bits (`BigUint64Array`) for decoding string ICON payloads when `paramIsInt[k] === 2`. */
  paramRawBits: BigUint64Array;
  /** `0` = float, `1` = integer, `2` = quoted/string token. */
  paramIsInt: Uint8Array;
  /** Record byte start offset, end offset, and 1-based starting line number. */
  spanStart: Uint32Array;
  spanEnd: Uint32Array;
  spanLine: Uint32Array;
  /** Packed USRMDL metadata (`[ic, it, ni, nc, ns, nv]` per record, `-1` if not `USRMDL`). */
  usrMeta: Int32Array;
  /** Line start byte offsets (computed lazily if needed for column offsets). */
  decodeUtf8Slice(offset: number, length: number): string;
}

/**
 * Parses a PSS/E `.dyr` file directly in WebAssembly linear memory (`dyr-kernel.wasm`)
 * into contiguous Struct-of-Arrays (SoA) TypedArrays with zero intermediate JS object allocations.
 */
export function parseDyrSoa(source: string | Uint8Array): PsseDyrSoaTables {
  const utf8Bytes = typeof source === "string" ? textEncoder.encode(source) : source;
  const byteLen = utf8Bytes.byteLength;
  const ex = getKernelExports();

  const inputPtr = ex.dyr_allocInput(byteLen);
  if (byteLen > 0) {
    new Uint8Array(ex.memory.buffer, inputPtr, byteLen).set(utf8Bytes);
  }

  const nRecords = ex.dyr_parse(byteLen);
  const nTotalParams = ex.dyr_getTotalParams();
  const buf = ex.memory.buffer;

  // Copy views out of WASM linear memory so subsequent parseDyrSoa calls never alias/clobber results
  const recSchemaId = new Uint16Array(nRecords);
  recSchemaId.set(new Uint16Array(buf, ex.dyr_getSchemaIdsPtr(), nRecords));

  const recCategoryCode = new Uint8Array(nRecords);
  recCategoryCode.set(new Uint8Array(buf, ex.dyr_getCategoriesPtr(), nRecords));

  const recHeaderKindCode = new Uint8Array(nRecords);
  recHeaderKindCode.set(new Uint8Array(buf, ex.dyr_getHeaderKindsPtr(), nRecords));

  const recBus = new Int32Array(nRecords);
  recBus.set(new Int32Array(buf, ex.dyr_getBusPtr(), nRecords));

  const recBus2 = new Int32Array(nRecords);
  recBus2.set(new Int32Array(buf, ex.dyr_getBus2Ptr(), nRecords));

  const recModelOff = new Uint32Array(nRecords);
  recModelOff.set(new Uint32Array(buf, ex.dyr_getModelOffPtr(), nRecords));

  const recModelLen = new Uint16Array(nRecords);
  recModelLen.set(new Uint16Array(buf, ex.dyr_getModelLenPtr(), nRecords));

  const recIdOff = new Uint32Array(nRecords);
  recIdOff.set(new Uint32Array(buf, ex.dyr_getIdOffPtr(), nRecords));

  const recIdLen = new Uint16Array(nRecords);
  recIdLen.set(new Uint16Array(buf, ex.dyr_getIdLenPtr(), nRecords));

  const paramRowOffsets = new Uint32Array(nRecords + 1);
  paramRowOffsets.set(new Uint32Array(buf, ex.dyr_getParamRowOffPtr(), nRecords + 1));

  const paramValues = new Float64Array(nTotalParams);
  if (nTotalParams > 0) {
    paramValues.set(new Float64Array(buf, ex.dyr_getParamValuesPtr(), nTotalParams));
  }
  const paramRawBits = new BigUint64Array(paramValues.buffer);

  const paramIsInt = new Uint8Array(nTotalParams);
  if (nTotalParams > 0) {
    paramIsInt.set(new Uint8Array(buf, ex.dyr_getParamIsIntPtr(), nTotalParams));
  }

  const spanStart = new Uint32Array(nRecords);
  spanStart.set(new Uint32Array(buf, ex.dyr_getSpanStartPtr(), nRecords));

  const spanEnd = new Uint32Array(nRecords);
  spanEnd.set(new Uint32Array(buf, ex.dyr_getSpanEndPtr(), nRecords));

  const spanLine = new Uint32Array(nRecords);
  spanLine.set(new Uint32Array(buf, ex.dyr_getSpanLinePtr(), nRecords));

  const usrMeta = new Int32Array(nRecords * 6);
  if (nRecords > 0) {
    usrMeta.set(new Int32Array(buf, ex.dyr_getUsrMetaPtr(), nRecords * 6));
  }

  return {
    utf8Bytes,
    nRecords,
    nTotalParams,
    recSchemaId,
    recCategoryCode,
    recHeaderKindCode,
    recBus,
    recBus2,
    recModelOff,
    recModelLen,
    recIdOff,
    recIdLen,
    paramRowOffsets,
    paramValues,
    paramRawBits,
    paramIsInt,
    spanStart,
    spanEnd,
    spanLine,
    usrMeta,
    decodeUtf8Slice(offset: number, length: number): string {
      if (length <= 0) return "";
      return textDecoder.decode(utf8Bytes.subarray(offset, offset + length));
    },
  };
}

/**
 * Materializes a backward-compatible `PsseDyrCase` (including `ICON`s, `USRMDL` metadata,
 * multi-bus/DC headers, and slot lookup maps) from a `PsseDyrSoaTables` buffer.
 */
export function materializeDyrCaseFromSoa(soa: PsseDyrSoaTables): PsseDyrCase {
  const records: PsseDyrRecord[] = [];
  const generatorsByBusId = new Map<string, PsseDyrRecord>();
  const excitersByBusId = new Map<string, PsseDyrRecord>();
  const governorsByBusId = new Map<string, PsseDyrRecord>();
  const stabilizersByBusId = new Map<string, PsseDyrRecord>();
  const loadsByBusId = new Map<string, PsseDyrRecord>();
  const factsByBusId = new Map<string, PsseDyrRecord>();
  const limitersByBusId = new Map<string, PsseDyrRecord[]>();
  const relaysByKey = new Map<string, PsseDyrRecord[]>();
  const hvdcByName = new Map<string, PsseDyrRecord>();

  for (let i = 0; i < soa.nRecords; i++) {
    const modelRaw = soa.decodeUtf8Slice(soa.recModelOff[i]!, soa.recModelLen[i]!);
    const model = modelRaw.toUpperCase();
    const schemaId = soa.recSchemaId[i]!;
    const schema: DyrModelSchema | undefined =
      (schemaId > 0 ? getDyrSchemaById(schemaId) : undefined) ?? resolveDyrModelSchema(model);

    const headerKind = HEADER_KIND_FROM_CODE[soa.recHeaderKindCode[i]!] ?? "machine";
    const category = schema?.category ?? CATEGORY_FROM_CODE[soa.recCategoryCode[i]!] ?? "user";
    const ibus = soa.recBus[i]!;
    const jbus = soa.recBus2[i]!;
    const rawId = soa.decodeUtf8Slice(soa.recIdOff[i]!, soa.recIdLen[i]!).trim();
    const isDeviceHeader = headerKind === "dc2t" || headerKind === "vscdc" || (headerKind === "facts" && ibus === 0);
    const id = isDeviceHeader ? "1" : rawId || "1";
    const deviceName = isDeviceHeader ? rawId : undefined;

    const pStart = soa.paramRowOffsets[i]!;
    const pEnd = soa.paramRowOffsets[i + 1]!;
    const rawCount = pEnd - pStart;

    const umBase = i * 6;
    const isUsrMdl = headerKind === "usrmdl" && soa.usrMeta[umBase]! >= 0;
    const usrMeta = isUsrMdl
      ? {
          ic: soa.usrMeta[umBase + 0]!,
          it: soa.usrMeta[umBase + 1]!,
          ni: soa.usrMeta[umBase + 2]!,
          nc: soa.usrMeta[umBase + 3]!,
          ns: soa.usrMeta[umBase + 4]!,
          nv: soa.usrMeta[umBase + 5]!,
        }
      : undefined;

    // Decode ICON vs CON split
    const mIcons = schema?.icons?.length ?? 0;
    const nParams = schema?.params.length ?? 0;
    let iconSplitCount = 0;
    if (isUsrMdl && usrMeta) {
      iconSplitCount = Math.min(rawCount, Math.max(0, usrMeta.ni));
    } else if (mIcons > 0 && rawCount > 0) {
      let hasStringIcon = false;
      const checkLen = Math.min(mIcons, rawCount);
      for (let k = 0; k < checkLen; k++) {
        if (soa.paramIsInt[pStart + k] === 2) {
          hasStringIcon = true;
          break;
        }
      }
      if (hasStringIcon || rawCount >= mIcons + nParams) {
        iconSplitCount = Math.min(mIcons, rawCount);
      } else if (rawCount > nParams || (rawCount > checkLen && soa.paramIsInt[pStart + checkLen] === 0)) {
        let firstMInt = true;
        for (let k = 0; k < checkLen; k++) {
          if (soa.paramIsInt[pStart + k] === 0) {
            firstMInt = false;
            break;
          }
        }
        if (firstMInt) iconSplitCount = checkLen;
      }
    }

    const icons: (number | string)[] = [];
    const namedIcons: Record<string, number | string> = {};
    for (let k = 0; k < iconSplitCount; k++) {
      const idx = pStart + k;
      let val: number | string;
      if (soa.paramIsInt[idx] === 2) {
        const packed = soa.paramRawBits[idx]!;
        const sOff = Number(packed >> 16n);
        const sLen = Number(packed & 0xffffn);
        val = soa.decodeUtf8Slice(sOff, sLen);
      } else {
        val = Math.trunc(soa.paramValues[idx]!);
      }
      icons.push(val);
      const iconMeta = schema?.icons?.[k];
      if (iconMeta) {
        namedIcons[iconMeta.name] = val;
      }
    }

    const con: number[] = [];
    for (let k = iconSplitCount; k < rawCount; k++) {
      const idx = pStart + k;
      if (soa.paramIsInt[idx] !== 2) {
        const v = soa.paramValues[idx]!;
        if (Number.isFinite(v)) con.push(v);
      }
    }

    const namedParams: Record<string, number> = {};
    if (schema) {
      for (let k = 0; k < schema.params.length && k < con.length; k++) {
        namedParams[schema.params[k]!.name] = con[k]!;
      }
    }

    const canonicalModel = resolveCanonicalDyrModelName(model);
    const rec: PsseDyrRecord = {
      ibus,
      model,
      id,
      category,
      con,
      namedParams,
      ...(icons.length > 0 ? { icons, namedIcons } : {}),
      ...(jbus > 0 ? { jbus, ckt: id } : {}),
      ...(deviceName ? { deviceName } : {}),
      headerKind,
      ...(canonicalModel !== model ? { canonicalModel } : {}),
      ...(usrMeta ? { usrMeta } : {}),
      span: {
        startOffset: soa.spanStart[i]!,
        endOffset: soa.spanEnd[i]!,
        line: soa.spanLine[i]!,
        column: 1,
      },
    };
    records.push(rec);

    const key = `${ibus}_${id}`;
    const sub = schema?.subCategory;
    if (sub === "oel" || sub === "uel" || sub === "vhz" || sub === "compensator") {
      const list = limitersByBusId.get(key) ?? [];
      list.push(rec);
      limitersByBusId.set(key, list);
      continue;
    }

    if (category === "generator") {
      generatorsByBusId.set(key, rec);
      if (!generatorsByBusId.has(String(ibus))) generatorsByBusId.set(String(ibus), rec);
    } else if (category === "exciter") {
      excitersByBusId.set(key, rec);
      if (!excitersByBusId.has(String(ibus))) excitersByBusId.set(String(ibus), rec);
    } else if (category === "governor") {
      governorsByBusId.set(key, rec);
      if (!governorsByBusId.has(String(ibus))) governorsByBusId.set(String(ibus), rec);
    } else if (category === "stabilizer") {
      stabilizersByBusId.set(key, rec);
      if (!stabilizersByBusId.has(String(ibus))) stabilizersByBusId.set(String(ibus), rec);
    } else if (category === "load") {
      loadsByBusId.set(key, rec);
      if (!loadsByBusId.has(String(ibus))) loadsByBusId.set(String(ibus), rec);
    } else if (category === "facts" || category === "hvdc") {
      const fKey = deviceName || key;
      factsByBusId.set(fKey, rec);
      if (ibus > 0 && !factsByBusId.has(String(ibus))) factsByBusId.set(String(ibus), rec);
      if (deviceName) hvdcByName.set(deviceName.toUpperCase(), rec);
    } else if (category === "relay") {
      const rKey = jbus > 0 ? `${ibus}_${jbus}_${id}` : key;
      const list = relaysByKey.get(rKey) ?? [];
      list.push(rec);
      relaysByKey.set(rKey, list);
    }
  }

  return {
    records,
    generatorsByBusId,
    excitersByBusId,
    governorsByBusId,
    stabilizersByBusId,
    loadsByBusId,
    factsByBusId,
    limitersByBusId,
    relaysByKey,
    hvdcByName,
  };
}

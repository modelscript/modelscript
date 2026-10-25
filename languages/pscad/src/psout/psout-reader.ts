// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance parser and reader for PSCAD *.psout binary files.
 */

import type { SimulationResultLike } from "../comtrade/comtrade-writer.js";
import {
  type PscadCallType,
  type PscadPsoutCall,
  type PscadPsoutDocument,
  type PscadPsoutHeader,
  type PscadPsoutRun,
  type PscadPsoutTrace,
} from "./psout-types.js";
import { PsoutWasmBridge } from "./psout-wasm-bridge.js";

const HEADER_SIZE = 160;

export function readPscadPsout(rawInput: Uint8Array | ArrayBuffer): PscadPsoutDocument {
  const bytes = rawInput instanceof Uint8Array ? rawInput : new Uint8Array(rawInput);
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`Invalid PSCAD .psout file: buffer size (${bytes.length}) is smaller than 160-byte header.`);
  }

  const bridge = PsoutWasmBridge.create();
  const inputPtr = bridge.alloc(bytes.length);
  new Uint8Array(bridge.memoryBuffer, inputPtr, bytes.length).set(bytes);

  const status = bridge.exports.psout_decode(inputPtr, bytes.length);
  if (status !== 0) {
    switch (status) {
      case -1:
        throw new Error("Invalid PSCAD .psout buffer provided.");
      case -2:
        throw new Error("Invalid PSCAD .psout file: Magic GUID mismatch.");
      case -3:
        throw new Error("Invalid PSCAD .psout file: Verification float constant mismatch (unsupported byte order).");
      case -4:
        throw new Error("Unsupported PSCAD .psout format version.");
      default:
        throw new Error(`Failed to decode PSCAD .psout file (error code: ${status}).`);
    }
  }

  // Parse header
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const guid = Array.from(bytes.subarray(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const pageSize = bridge.exports.psout_get_page_size();
  const pageCount = bridge.exports.psout_get_page_count();
  const createdSec = Number(view.getBigInt64(136, true));
  const modifiedSec = Number(view.getBigInt64(144, true));

  const header: PscadPsoutHeader = {
    version: view.getUint32(48, true),
    pageSize,
    pageCount,
    createdOn: new Date(createdSec * 1000),
    modifiedOn: new Date(modifiedSec * 1000),
    guid,
  };

  // Parse string tags and property bags from metadata pages
  const propertyMap = new Map<number, Map<string, string>>();
  const nameMap = new Map<number, string>();
  scanMetadataPages(bytes, pageSize, Math.min(pageCount, 60), propertyMap, nameMap);

  // Read call hierarchy from WASM kernel
  const callCount = bridge.exports.psout_get_call_count();
  const callsById = new Map<number, PscadPsoutCall>();
  let rootCall: PscadPsoutCall | undefined;

  for (let i = 0; i < callCount; i++) {
    const id = bridge.exports.psout_get_call_id(i);
    const parentId = bridge.exports.psout_get_call_parent_id(i);
    const typeInt = bridge.exports.psout_get_call_type(i);
    const descPage = bridge.exports.psout_get_call_data_page(i);
    const varListPage = bridge.exports.psout_get_call_varlist_page(i);

    let callType: PscadCallType = "Unknown";
    if (typeInt === 1) callType = "Module";
    else if (typeInt === 2) callType = "Trace";
    else if (typeInt === 3) callType = "Root";

    // Read properties from varListPage if available
    let props = propertyMap.get(id);
    if (!props) {
      props = new Map<string, string>();
      propertyMap.set(id, props);
    }

    if (varListPage > 0 && varListPage < pageCount) {
      const varProps = parseVarListPage(bytes, varListPage, pageSize);
      for (const [k, v] of varProps) {
        if (!props.has(k)) props.set(k, v);
      }
    }

    const explicitName =
      nameMap.get(id) ??
      props.get("Name") ??
      props.get("Component") ??
      props.get("DataName") ??
      props.get("Description") ??
      `Call_${id}`;

    const call: PscadPsoutCall = {
      id,
      parentId,
      callType,
      name: explicitName,
      order: i,
      dataPage: descPage > 0 ? descPage : undefined,
      properties: props,
      children: [],
    };

    callsById.set(id, call);
    if (callType === "Root" && !rootCall) {
      rootCall = call;
    }
  }

  // If no explicit Root found from entries, pick or create Root
  if (!rootCall && callsById.size > 0) {
    rootCall = callsById.get(1) ?? callsById.values().next().value;
  }

  // Link children
  for (const call of callsById.values()) {
    if (call.parentId > 0 && call.parentId !== call.id) {
      const parent = callsById.get(call.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(call);
      }
    }
  }

  // Build path index
  const callPaths = new Map<string, PscadPsoutCall>();
  const pathForCall = new Map<number, string>();

  function indexPaths(node: PscadPsoutCall, currentPath: string): void {
    const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
    callPaths.set(fullPath, node);
    pathForCall.set(node.id, fullPath);
    for (const child of node.children ?? []) {
      indexPaths(child, fullPath);
    }
  }

  if (rootCall) {
    indexPaths(rootCall, "");
  }

  // Extract waveforms for all traces
  const traces = new Map<number, PscadPsoutTrace>();
  let timeTrace: PscadPsoutTrace | undefined;

  for (let i = 0; i < callCount; i++) {
    const id = bridge.exports.psout_get_call_id(i);
    const sampleCount = bridge.exports.psout_get_call_sample_count(i);
    const domainId = bridge.exports.psout_get_call_domain_id(i);
    const call = callsById.get(id);

    if (!call || sampleCount === 0) continue;

    const sampleArenaPtr = bridge.alloc(sampleCount * 8);
    const readCount = bridge.exports.psout_read_samples_for_call(
      inputPtr,
      bytes.length,
      id,
      sampleArenaPtr,
      sampleCount,
    );

    const floatView = new Float64Array(bridge.memoryBuffer, sampleArenaPtr, readCount);
    const values = new Float64Array(floatView);

    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < values.length; k++) {
      const v = values[k]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) min = max = 0;

    const unit = call.properties.get("Unit") ?? "";
    const group = call.properties.get("Group") ?? (call.parentId === 3 ? "Currents" : "Voltages");
    const description = call.properties.get("Description") ?? call.name;

    const traceObj: PscadPsoutTrace = {
      id: call.id,
      call,
      name: call.name,
      unit,
      group,
      description,
      values,
      min,
      max,
    };

    traces.set(call.id, traceObj);

    // Detect time domain trace (Call 3, or domainId == 0 with monotonic values, or unit === 's')
    if (
      !timeTrace &&
      (id === 3 ||
        domainId === 0 ||
        unit === "s" ||
        call.name.toLowerCase().includes("time") ||
        call.name.toLowerCase().includes("domain"))
    ) {
      timeTrace = traceObj;
    }
  }

  // Synthesize or link time vector for all traces
  let defaultTime: Float64Array | undefined = timeTrace?.values;
  if (!defaultTime) {
    const maxLen = Math.max(0, ...Array.from(traces.values()).map((t) => t.values.length));
    defaultTime = new Float64Array(maxLen);
    const dt = 50e-6; // Default 50us
    for (let k = 0; k < maxLen; k++) defaultTime[k] = k * dt;
  }

  for (const trace of traces.values()) {
    trace.time = defaultTime;
  }

  // Build Run object
  const run0: PscadPsoutRun = {
    index: 0,
    description: "Main Simulation Run",
    traces,
    getTrace(pathOrId: string | number): PscadPsoutTrace | undefined {
      if (typeof pathOrId === "number") {
        return traces.get(pathOrId);
      }
      const call = callPaths.get(pathOrId);
      if (call) {
        const direct = traces.get(call.id);
        if (direct) return direct;
        for (const child of call.children ?? []) {
          const t = traces.get(child.id);
          if (t) return t;
        }
      }
      for (const t of traces.values()) {
        if (t.name === pathOrId || t.description === pathOrId) return t;
      }
      return undefined;
    },
    listTracePaths(): string[] {
      const paths: string[] = [];
      for (const t of traces.values()) {
        const p = pathForCall.get(t.call.id);
        if (p) paths.push(p);
      }
      return paths;
    },
  };

  return {
    header,
    numRuns: 1,
    rootCall,
    run(_index?: number): PscadPsoutRun {
      return run0;
    },
    getCall(path: string): PscadPsoutCall | undefined {
      return callPaths.get(path);
    },
    toSimulationResult(_runIndex?: number): SimulationResultLike {
      const busVoltages = new Map<string, Float64Array>();
      const branchCurrents = new Map<string, Float64Array>();
      const controlSignals = new Map<string, Float64Array>();

      for (const trace of traces.values()) {
        if (trace === timeTrace || trace.id === 3) continue;

        const cleanName = trace.name.replace(/^V_/, "").replace(/^I_/, "");
        const grp = trace.group.toLowerCase();
        const nm = trace.name.toLowerCase();
        const u = trace.unit.toLowerCase();

        if (grp.includes("volt") || nm.includes("volt") || u === "kv" || u === "v" || u === "pu") {
          // Disambiguate duplicate names by adding ID suffix if needed
          const finalName = busVoltages.has(cleanName) ? `${cleanName}_${trace.id}` : cleanName;
          busVoltages.set(finalName, trace.values);
        } else if (grp.includes("curr") || nm.includes("curr") || u === "ka" || u === "a") {
          const finalName = branchCurrents.has(cleanName) ? `${cleanName}_${trace.id}` : cleanName;
          branchCurrents.set(finalName, trace.values);
        } else {
          const finalName = controlSignals.has(cleanName) ? `${cleanName}_${trace.id}` : cleanName;
          controlSignals.set(finalName, trace.values);
        }
      }

      return {
        time: defaultTime!,
        busVoltages,
        branchCurrents,
        controlSignals,
      };
    },
  };
}

/**
 * Scans tagged strings [0x01, 0x01, len_lo, len_hi, chars...] and associates property bags.
 */
function scanMetadataPages(
  bytes: Uint8Array,
  pageSize: number,
  maxPages: number,
  propertyMap: Map<number, Map<string, string>>,
  nameMap: Map<number, string>,
): void {
  for (let p = 0; p < maxPages; p++) {
    const pageOffset = p * pageSize;
    if (pageOffset + pageSize > bytes.length) break;

    let pos = pageOffset;
    const pageEnd = pageOffset + pageSize;

    while (pos + 4 < pageEnd) {
      if (bytes[pos] === 0x01 && bytes[pos + 1] === 0x01) {
        const slen = bytes[pos + 2]! | (bytes[pos + 3]! << 8);
        if (slen > 0 && slen < 128 && pos + 4 + slen <= pageEnd) {
          const str = new TextDecoder().decode(bytes.subarray(pos + 4, pos + 4 + slen));
          const colonIdx = str.indexOf(":");
          if (colonIdx > 0) {
            const id = parseInt(str.substring(0, colonIdx), 10);
            const key = str.substring(colonIdx + 1);
            if (!Number.isNaN(id)) {
              let nextPos = pos + 4 + slen;
              while (nextPos % 4 !== 0) nextPos++; // align
              let val = "";
              if (nextPos + 4 < pageEnd && bytes[nextPos] === 0x01 && bytes[nextPos + 1] === 0x01) {
                const vlen = bytes[nextPos + 2]! | (bytes[nextPos + 3]! << 8);
                if (vlen > 0 && vlen < 128 && nextPos + 4 + vlen <= pageEnd) {
                  val = new TextDecoder().decode(bytes.subarray(nextPos + 4, nextPos + 4 + vlen));
                }
              }

              if (!propertyMap.has(id)) {
                propertyMap.set(id, new Map<string, string>());
              }
              const props = propertyMap.get(id)!;
              props.set(key, val);
              if (key === "Name" && val) {
                nameMap.set(id, val);
              }
            }
          }
          pos += 4 + slen;
          continue;
        }
      }
      pos++;
    }
  }
}

/**
 * Parses binary VarList pages containing tagged key-value pairs.
 */
function parseVarListPage(bytes: Uint8Array, pageNum: number, pageSize: number): Map<string, string> {
  const map = new Map<string, string>();
  const pageOffset = pageNum * pageSize;
  if (pageOffset + pageSize > bytes.length) return map;

  const pageBytes = bytes.subarray(pageOffset, pageOffset + pageSize);
  let pos = 8; // Skip initial 8 bytes

  while (pos + 12 < pageSize) {
    // Check for VarType uint32 (128 for StringAscii)
    const varType =
      pageBytes[pos]! | (pageBytes[pos + 1]! << 8) | (pageBytes[pos + 2]! << 16) | (pageBytes[pos + 3]! << 24);
    if (varType === 0) {
      pos += 4;
      continue;
    }
    pos += 4;

    // Read Key: [0x01, 0x01, len_lo, len_hi, chars...]
    if (pageBytes[pos] !== 0x01 || pageBytes[pos + 1] !== 0x01) {
      pos++;
      continue;
    }
    const keyLen = pageBytes[pos + 2]! | (pageBytes[pos + 3]! << 8);
    pos += 4;
    let key = "";
    for (let i = 0; i < keyLen; i++) {
      const b = pageBytes[pos + i]!;
      if (b >= 32 && b <= 126) key += String.fromCharCode(b);
    }
    pos += (keyLen + 3) & ~3;

    // Skip possible zero padding before value
    while (pos < pageSize && pageBytes[pos] === 0) pos++;
    if (pos >= pageSize) break;

    // Read Value
    if (pageBytes[pos] === 0x01 && pageBytes[pos + 1] === 0x01) {
      const valLen = pageBytes[pos + 2]! | (pageBytes[pos + 3]! << 8);
      pos += 4;
      let val = "";
      for (let i = 0; i < valLen; i++) {
        const b = pageBytes[pos + i]!;
        if (b >= 32 && b <= 126) val += String.fromCharCode(b);
      }
      pos += (valLen + 3) & ~3;
      if (key && val) {
        map.set(key, val);
      }
    }
  }

  return map;
}

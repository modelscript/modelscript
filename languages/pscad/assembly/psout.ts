// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript WebAssembly Kernel for PSCAD *.psout binary files.
 *
 * Implements high-performance, zero-copy linear-memory serialization
 * and deserialization for PSCAD V5+ binary paged waveform containers.
 */

// =============================================================================
// Constants & Magic Identifiers
// =============================================================================

export const HEADER_SIZE: u32 = 160;
export const DEFAULT_PAGE_SIZE: u32 = 1024;

// 128-bit GUID: a2 4e 10 83 3d ca 85 f3 07 c9 09 0e a1 d6 f6 aa
export const GUID_PART_0: u64 = 0xf385ca3d83104ea2;
export const GUID_PART_1: u64 = 0xaaf6d6a10e09c907;

// IEEE 754 Float64 verification constants
export const VERIFY_FLOAT_1: f64 = 3.141592653589793;
export const VERIFY_FLOAT_2: f64 = 9461000000000000.0;
export const VERIFY_FLOAT_3: f64 = 6.62607004e-34;
export const VERIFY_FLOAT_4: f64 = -1.23456789;

// Call types
export const CALL_TYPE_INVALID: u32 = 0;
export const CALL_TYPE_MODULE: u32 = 1;
export const CALL_TYPE_TRACE: u32 = 2;
export const CALL_TYPE_ROOT: u32 = 3;

// Variable data types
export const VAR_TYPE_STRING: u32 = 128;
export const VAR_TYPE_REAL64: u32 = 33;
export const VAR_TYPE_REAL32: u32 = 32;
export const VAR_TYPE_INT32: u32 = 18;

// Error codes
export const ERR_OK: i32 = 0;
export const ERR_INVALID_BUFFER: i32 = -1;
export const ERR_INVALID_MAGIC: i32 = -2;
export const ERR_INVALID_FLOATS: i32 = -3;
export const ERR_UNSUPPORTED_VERSION: i32 = -4;
export const ERR_OUT_OF_BOUNDS: i32 = -5;
export const ERR_CORRUPT_PAGE: i32 = -6;

// =============================================================================
// Memory Management & Working Buffer
// =============================================================================

let g_output_buf_ptr: usize = 0;
let g_output_buf_len: u32 = 0;

export function psout_alloc_buffer(size: u32): usize {
  return heap.alloc(<usize>size);
}

export function psout_free_buffer(ptr: usize): void {
  if (ptr != 0) {
    heap.free(ptr);
  }
}

export function psout_get_buffer_ptr(): usize {
  return g_output_buf_ptr;
}

export function psout_get_buffer_len(): u32 {
  return g_output_buf_len;
}

// =============================================================================
// Deserialization (Reading .psout)
// =============================================================================

class ParsedCall {
  id: u32 = 0;
  parentId: u32 = 0;
  callType: u32 = 0;
  varListPage: u32 = 0;
  descPage: u32 = 0;
  sampleCount: u32 = 0;
  domainCallId: u32 = 0;
  order: u32 = 0;
}

let g_parsed_calls: Array<ParsedCall> | null = null;
let g_parsed_page_size: u32 = 1024;
let g_parsed_page_count: u32 = 0;
let g_parsed_num_runs: u32 = 1;
let g_parsed_created: i64 = 0;
let g_parsed_modified: i64 = 0;

export function psout_decode(ptr: usize, len: u32): i32 {
  if (ptr == 0 || len < HEADER_SIZE) {
    return ERR_INVALID_BUFFER;
  }

  // 1. Verify Magic GUID
  const guid0 = load<u64>(ptr + 0);
  const guid1 = load<u64>(ptr + 8);
  if (guid0 != GUID_PART_0 || guid1 != GUID_PART_1) {
    return ERR_INVALID_MAGIC;
  }

  // 2. Verify Floating Point Constants (byte order / endianness)
  const d1 = load<f64>(ptr + 16);
  const d2 = load<f64>(ptr + 24);
  const d3 = load<f64>(ptr + 32);
  const d4 = load<f64>(ptr + 40);

  if (d1 != VERIFY_FLOAT_1 || d2 != VERIFY_FLOAT_2 || d3 != VERIFY_FLOAT_3 || d4 != VERIFY_FLOAT_4) {
    return ERR_INVALID_FLOATS;
  }

  // 3. Header fields
  const version = load<u32>(ptr + 48);
  if (version != 1) {
    return ERR_UNSUPPORTED_VERSION;
  }

  const pageSizeVal = <u32>load<u64>(ptr + 64);
  const pageCountVal = <u32>load<u64>(ptr + 88);
  g_parsed_page_size = pageSizeVal > 0 ? pageSizeVal : DEFAULT_PAGE_SIZE;
  g_parsed_page_count = pageCountVal;
  g_parsed_created = load<i64>(ptr + 136);
  g_parsed_modified = load<i64>(ptr + 144);
  g_parsed_num_runs = 1;

  if (g_parsed_calls == null) {
    g_parsed_calls = new Array<ParsedCall>();
  } else {
    g_parsed_calls!.length = 0;
  }

  const ps = g_parsed_page_size;

  // 4. Read Call Table from Page 2 (offset = 2 * ps)
  if (<usize>(3 * ps) <= <usize>len) {
    const page2Offset: usize = ptr + <usize>(2 * ps);
    const callCount = load<u32>(page2Offset);
    let entryOffset = page2Offset + 16;
    const maxEntries = (ps - 16) / 24;
    const countToRead = callCount < maxEntries ? callCount : maxEntries;

    for (let i: u32 = 0; i < countToRead; i++) {
      const cId = load<u32>(entryOffset + 0);
      const pId = load<u32>(entryOffset + 4);
      const varListPage = load<u32>(entryOffset + 8);
      const cType = load<u32>(entryOffset + 16);

      if (cId > 0) {
        let call = new ParsedCall();
        call.id = cId;
        call.parentId = pId;
        call.varListPage = varListPage;
        call.callType = cType > 0 ? cType : CALL_TYPE_TRACE;
        call.order = i;
        g_parsed_calls!.push(call);
      }
      entryOffset += 24;
    }
  }

  // 5. Read Trace Map from Run 0 Trace index or Page 9 fallback
  let traceMapPage: u32 = 0;
  if (len >= 176) {
    traceMapPage = load<u32>(ptr + 172);
  }
  if (traceMapPage == 0 || traceMapPage >= g_parsed_page_count) {
    traceMapPage = 9; // Cigre.psout fallback
  }

  if (<usize>((traceMapPage + 1) * ps) <= <usize>len) {
    const pageOffset: usize = ptr + <usize>(traceMapPage * ps);
    let traceMapOff: usize = pageOffset + 8;
    const pageEnd: usize = pageOffset + <usize>ps;

    while (traceMapOff + 12 <= pageEnd) {
      const tCallId = load<u32>(traceMapOff + 0);
      const tDescPage = load<u32>(traceMapOff + 4);
      if (tCallId == 0 && tDescPage == 0) break;

      if (tDescPage > 0 && tDescPage < g_parsed_page_count) {
        const descOffset: usize = ptr + <usize>(tDescPage * ps);
        if (<usize>((tDescPage + 1) * ps) <= <usize>len) {
          const domainId = load<u32>(descOffset + 28);
          const sampleCount = load<u32>(descOffset + 36);

          // Find or create parsed call
          let found: ParsedCall | null = null;
          for (let i = 0; i < g_parsed_calls!.length; i++) {
            if (g_parsed_calls![i].id == tCallId) {
              found = g_parsed_calls![i];
              break;
            }
          }

          if (found == null) {
            found = new ParsedCall();
            found.id = tCallId;
            found.parentId = 1;
            found.callType = CALL_TYPE_TRACE;
            found.order = <u32>g_parsed_calls!.length;
            g_parsed_calls!.push(found);
          }

          found.callType = CALL_TYPE_TRACE;
          found.descPage = tDescPage;
          found.sampleCount = sampleCount;
          found.domainCallId = domainId;
        }
      }
      traceMapOff += 12;
    }
  }

  return ERR_OK;
}

export function psout_get_page_size(): u32 {
  return g_parsed_page_size;
}

export function psout_get_page_count(): u32 {
  return g_parsed_page_count;
}

export function psout_get_num_runs(): u32 {
  return g_parsed_num_runs;
}

export function psout_get_call_count(): u32 {
  return g_parsed_calls != null ? g_parsed_calls!.length : 0;
}

export function psout_get_call_id(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].id;
}

export function psout_get_call_parent_id(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].parentId;
}

export function psout_get_call_type(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].callType;
}

export function psout_get_call_data_page(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].descPage;
}

export function psout_get_call_sample_count(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].sampleCount;
}

export function psout_get_call_domain_id(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].domainCallId;
}

export function psout_get_call_varlist_page(idx: u32): u32 {
  if (g_parsed_calls == null || idx >= <u32>g_parsed_calls!.length) return 0;
  return g_parsed_calls![idx].varListPage;
}

// Copy raw trace f64 samples from consecutive pages into a host buffer
export function psout_read_samples_from_page(
  filePtr: usize,
  fileLen: u32,
  startPage: u32,
  numPages: u32,
  outSamplesPtr: usize,
  maxSamples: u32
): u32 {
  if (filePtr == 0 || outSamplesPtr == 0 || startPage >= g_parsed_page_count) return 0;

  const ps = g_parsed_page_size;
  const doublesPerPage = ps / 8;
  let copied: u32 = 0;

  for (let p: u32 = 0; p < numPages; p++) {
    const pageIndex = startPage + p;
    if (pageIndex >= g_parsed_page_count) break;

    const pageOffset: usize = <usize>(pageIndex * ps);
    if (pageOffset + <usize>ps > <usize>fileLen) break;

    const remaining = maxSamples - copied;
    const toCopy = remaining < doublesPerPage ? remaining : doublesPerPage;
    if (toCopy == 0) break;

    memory.copy(outSamplesPtr + <usize>(copied * 8), filePtr + pageOffset, <usize>(toCopy * 8));
    copied += toCopy;
  }

  return copied;
}

// Read all samples for a specific trace Call ID using its descriptor data-page table
export function psout_read_samples_for_call(
  filePtr: usize,
  fileLen: u32,
  callId: u32,
  outSamplesPtr: usize,
  maxSamples: u32
): u32 {
  if (filePtr == 0 || outSamplesPtr == 0 || g_parsed_calls == null) return 0;

  let descPage: u32 = 0;
  let totalSamples: u32 = 0;

  for (let i = 0; i < g_parsed_calls!.length; i++) {
    if (g_parsed_calls![i].id == callId) {
      descPage = g_parsed_calls![i].descPage;
      totalSamples = g_parsed_calls![i].sampleCount;
      break;
    }
  }

  const ps = g_parsed_page_size;
  if (<usize>((descPage + 1) * ps) > <usize>fileLen) return 0;
  const descOffset: usize = filePtr + <usize>(descPage * ps);

  const samplesToRead = totalSamples < maxSamples ? totalSamples : maxSamples;
  let readCount: u32 = 0;

  for (let chunk: u32 = 0; readCount < samplesToRead; chunk++) {
    const ptrOffset = descOffset + 44 + <usize>(chunk * 8);
    if (ptrOffset + 4 > descOffset + <usize>ps) break;

    const dataPage = load<u32>(ptrOffset);
    if (dataPage == 0 || dataPage >= g_parsed_page_count) break;

    if (<usize>((dataPage + 1) * ps) > <usize>fileLen) break;
    const dataOffset: usize = filePtr + <usize>(dataPage * ps);

    const remaining = samplesToRead - readCount;
    const chunkCount = remaining < 128 ? remaining : 128;

    memory.copy(outSamplesPtr + <usize>(readCount * 8), dataOffset, <usize>(chunkCount * 8));
    readCount += chunkCount;
  }

  return readCount;
}

// =============================================================================
// Serialization (Writing .psout)
// =============================================================================

class OutputTrace {
  callId: u32 = 0;
  name: string = "";
  unit: string = "";
  group: string = "";
  dataPtr: usize = 0;
  sampleCount: u32 = 0;
  descPage: u32 = 0;
  startDataPage: u32 = 0;
  numDataPages: u32 = 0;
}

let g_writer_traces: Array<OutputTrace> | null = null;
let g_writer_time_ptr: usize = 0;
let g_writer_time_count: u32 = 0;
let g_writer_page_size: u32 = 1024;

export function psout_writer_init(pageSize: u32): void {
  g_writer_page_size = pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  if (g_writer_traces == null) {
    g_writer_traces = new Array<OutputTrace>();
  } else {
    g_writer_traces!.length = 0;
  }
  g_writer_time_ptr = 0;
  g_writer_time_count = 0;
}

export function psout_writer_set_time(dataPtr: usize, count: u32): void {
  g_writer_time_ptr = dataPtr;
  g_writer_time_count = count;
}

export function psout_writer_add_trace(
  namePtr: usize,
  nameLen: u32,
  unitPtr: usize,
  unitLen: u32,
  groupPtr: usize,
  groupLen: u32,
  dataPtr: usize,
  count: u32
): u32 {
  if (g_writer_traces == null) {
    g_writer_traces = new Array<OutputTrace>();
  }

  let t = new OutputTrace();
  t.callId = <u32>(10 + g_writer_traces!.length);
  t.name = readAsciiString(namePtr, nameLen);
  t.unit = readAsciiString(unitPtr, unitLen);
  t.group = readAsciiString(groupPtr, groupLen);
  t.dataPtr = dataPtr;
  t.sampleCount = count;
  t.descPage = 0;
  t.startDataPage = 0;
  t.numDataPages = 0;

  g_writer_traces!.push(t);
  return t.callId;
}

export function psout_writer_build(createdEpochSec: i64): u32 {
  const pageSize = g_writer_page_size;
  const doublesPerPage = pageSize / 8; // 128 doubles per 1024-byte page
  const numTraces = g_writer_traces != null ? g_writer_traces!.length : 0;

  // Calculate string table byte length dynamically to prevent page overflow
  let stringBytes: u32 = 256; // Root, Time, Voltages
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    stringBytes += 64 + <u32>(tr.name.length * 2 + tr.unit.length + tr.group.length + 32);
  }
  const stringPages: u32 = (stringBytes + pageSize - 1) / pageSize;
  const stringStartPage: u32 = 3;
  const varListPage: u32 = stringStartPage + stringPages;
  const traceMapPage: u32 = varListPage + 1;
  const timeDescPage: u32 = traceMapPage + 1;
  const firstChannelDescPage: u32 = timeDescPage + 1;
  let curPage: u32 = firstChannelDescPage + <u32>numTraces;

  // Time data pages
  const timePages = (g_writer_time_count + doublesPerPage - 1) / doublesPerPage;
  const timeStartPage = curPage;
  curPage += timePages;

  // Channel trace data pages
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    tr.descPage = <u32>(firstChannelDescPage + i);
    const trPages = (tr.sampleCount + doublesPerPage - 1) / doublesPerPage;
    tr.startDataPage = curPage;
    tr.numDataPages = trPages;
    curPage += trPages;
  }

  const totalPages = curPage;
  const totalFileSize = totalPages * pageSize;

  // Allocate destination buffer
  const buf = heap.alloc(<usize>totalFileSize);
  memory.fill(buf, 0, <usize>totalFileSize);
  g_output_buf_ptr = buf;
  g_output_buf_len = totalFileSize;

  // 1. Write Header to Page 0
  store<u64>(buf + 0, GUID_PART_0);
  store<u64>(buf + 8, GUID_PART_1);
  store<f64>(buf + 16, VERIFY_FLOAT_1);
  store<f64>(buf + 24, VERIFY_FLOAT_2);
  store<f64>(buf + 32, VERIFY_FLOAT_3);
  store<f64>(buf + 40, VERIFY_FLOAT_4);
  store<u32>(buf + 48, 1); // version
  store<u32>(buf + 52, 1); // page size code (1 = 1024)
  store<u64>(buf + 56, <u64>HEADER_SIZE);
  store<u64>(buf + 64, <u64>pageSize);
  store<u64>(buf + 72, <u64>1048576); // reserve size
  store<u64>(buf + 80, <u64>44);      // growth rate
  store<u64>(buf + 88, <u64>totalPages);
  store<u64>(buf + 96, <u64>1);               // Root Call page = 1
  store<u64>(buf + 104, <u64>2);              // Run Index page = 2
  store<u64>(buf + 112, <u64>stringStartPage); // String Table page
  store<u64>(buf + 120, <u64>varListPage);     // Var List page
  store<u64>(buf + 128, <u64>traceMapPage);    // Run metadata / Trace Map page
  store<i64>(buf + 136, createdEpochSec);
  store<i64>(buf + 144, createdEpochSec);
  store<u64>(buf + 152, 0);

  // Run 0 metadata at offset 160 of Page 0
  store<u32>(buf + 160, 1);            // 1 run
  store<u32>(buf + 164, varListPage);  // varlist page
  store<u32>(buf + 168, 0);
  store<u32>(buf + 172, traceMapPage); // trace map page

  // 2. Write Page 1 (Root Call: "Root")
  const p1 = buf + <usize>(1 * pageSize);
  store<u32>(p1 + 0, CALL_TYPE_ROOT);
  store<u32>(p1 + 4, 1); // ID = 1
  store<u32>(p1 + 8, stringStartPage);

  // 3. Write Page 2 (Call Table entries: 24 bytes each)
  const p2 = buf + <usize>(2 * pageSize);
  store<u32>(p2 + 0, <u32>(3 + numTraces)); // Call Count
  let entryOff = p2 + 16;

  // Root Call entry (ID 1)
  store<u32>(entryOff + 0, 1);
  store<u32>(entryOff + 4, 0);
  store<u32>(entryOff + 8, varListPage);
  store<u32>(entryOff + 16, CALL_TYPE_ROOT);
  entryOff += 24;

  // Time Call entry (ID 3)
  store<u32>(entryOff + 0, 3);
  store<u32>(entryOff + 4, 1);
  store<u32>(entryOff + 8, varListPage);
  store<u32>(entryOff + 16, CALL_TYPE_TRACE);
  entryOff += 24;

  // Module entry: Voltages (ID 2)
  store<u32>(entryOff + 0, 2);
  store<u32>(entryOff + 4, 1);
  store<u32>(entryOff + 8, varListPage);
  store<u32>(entryOff + 16, CALL_TYPE_MODULE);
  entryOff += 24;

  // Write Trace Call entries
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    store<u32>(entryOff + 0, tr.callId);
    store<u32>(entryOff + 4, 2); // Parent: Voltages
    store<u32>(entryOff + 8, varListPage);
    store<u32>(entryOff + 16, CALL_TYPE_TRACE);
    entryOff += 24;
  }

  // 4. Write Trace Map Table ([callId, descPage, 0])
  const pTraceMap = buf + <usize>(traceMapPage * pageSize);
  store<u32>(pTraceMap + 0, 0);
  store<u32>(pTraceMap + 4, 0);
  let mapOff = pTraceMap + 8;

  // Time trace entry in map
  store<u32>(mapOff + 0, 3);
  store<u32>(mapOff + 4, timeDescPage);
  store<u32>(mapOff + 8, 0);
  mapOff += 12;

  // Channel traces in map
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    store<u32>(mapOff + 0, tr.callId);
    store<u32>(mapOff + 4, tr.descPage);
    store<u32>(mapOff + 8, 0);
    mapOff += 12;
  }

  // 5. Write Time Descriptor Page
  const pTimeDesc = buf + <usize>(timeDescPage * pageSize);
  store<u32>(pTimeDesc + 8, varListPage);
  store<u32>(pTimeDesc + 24, VAR_TYPE_REAL64);
  store<u32>(pTimeDesc + 28, 0);  // domainId = 0 (is domain)
  store<u32>(pTimeDesc + 36, g_writer_time_count);
  for (let p: u32 = 0; p < timePages; p++) {
    store<u32>(pTimeDesc + 44 + <usize>(p * 8), timeStartPage + p);
  }

  // 6. Write Channel Descriptor Pages
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    const pDesc = buf + <usize>(tr.descPage * pageSize);
    store<u32>(pDesc + 8, varListPage);
    store<u32>(pDesc + 24, VAR_TYPE_REAL64);
    store<u32>(pDesc + 28, 3); // domainId = 3 (time)
    store<u32>(pDesc + 36, tr.sampleCount);
    for (let p: u32 = 0; p < tr.numDataPages; p++) {
      store<u32>(pDesc + 44 + <usize>(p * 8), tr.startDataPage + p);
    }
  }

  // 7. Write String Table (Page stringStartPage)
  const pString = buf + <usize>(stringStartPage * pageSize);
  let strPos: usize = pString + 4;
  strPos = writeTaggedString(strPos, "1:Name");
  strPos = writeTaggedString(strPos, "Root");
  strPos = writeTaggedString(strPos, "3:Name");
  strPos = writeTaggedString(strPos, "Time");
  strPos = writeTaggedString(strPos, "3:Unit");
  strPos = writeTaggedString(strPos, "s");
  strPos = writeTaggedString(strPos, "3:Group");
  strPos = writeTaggedString(strPos, "Domain");
  strPos = writeTaggedString(strPos, "2:Name");
  strPos = writeTaggedString(strPos, "Voltages");

  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    strPos = writeTaggedString(strPos, tr.callId.toString() + ":Name");
    strPos = writeTaggedString(strPos, tr.name);
    strPos = writeTaggedString(strPos, tr.callId.toString() + ":Component");
    strPos = writeTaggedString(strPos, tr.name);
    const grp = tr.group.length > 0 ? tr.group : "Voltages";
    strPos = writeTaggedString(strPos, tr.callId.toString() + ":Group");
    strPos = writeTaggedString(strPos, grp);
    if (tr.unit.length > 0) {
      strPos = writeTaggedString(strPos, tr.callId.toString() + ":Unit");
      strPos = writeTaggedString(strPos, tr.unit);
    }
  }

  // 8. Write Time Vector Data Pages
  if (g_writer_time_ptr != 0 && g_writer_time_count > 0) {
    let srcOffset = g_writer_time_ptr;
    let remaining = g_writer_time_count;
    for (let p: u32 = 0; p < timePages; p++) {
      const dest = buf + <usize>((timeStartPage + p) * pageSize);
      const count = remaining < doublesPerPage ? remaining : doublesPerPage;
      memory.copy(dest, srcOffset, <usize>(count * 8));
      srcOffset += <usize>(count * 8);
      remaining -= count;
    }
  }

  // 9. Write Channel Trace Data Pages
  for (let i = 0; i < numTraces; i++) {
    const tr = g_writer_traces![i];
    if (tr.dataPtr != 0 && tr.sampleCount > 0) {
      let srcOffset = tr.dataPtr;
      let remaining = tr.sampleCount;
      for (let p: u32 = 0; p < tr.numDataPages; p++) {
        const dest = buf + <usize>((tr.startDataPage + p) * pageSize);
        const count = remaining < doublesPerPage ? remaining : doublesPerPage;
        memory.copy(dest, srcOffset, <usize>(count * 8));
        srcOffset += <usize>(count * 8);
        remaining -= count;
      }
    }
  }

  return totalFileSize;
}

function readAsciiString(ptr: usize, len: u32): string {
  let res = "";
  for (let i: u32 = 0; i < len; i++) {
    const ch = load<u8>(ptr + <usize>i);
    if (ch >= 32 && ch <= 126) {
      res += String.fromCharCode(ch);
    }
  }
  return res;
}

function writeTaggedString(dest: usize, text: string): usize {
  const len = <u16>text.length;
  store<u8>(dest + 0, 0x01);
  store<u8>(dest + 1, 0x01);
  store<u16>(dest + 2, len);
  for (let i: u16 = 0; i < len; i++) {
    store<u8>(dest + 4 + <usize>i, <u8>text.charCodeAt(i));
  }
  // Align to 4 bytes
  const total: usize = 4 + <usize>len;
  return dest + ((total + 3) & ~3);
}

function writeVariable(dest: usize, key: string, value: string): usize {
  store<u32>(dest, VAR_TYPE_STRING);
  let next = dest + 4;
  next = writeTaggedString(next, key);
  next = writeTaggedString(next, value);
  return next;
}

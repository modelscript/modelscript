// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript Multi-Instance EMTDC Linear-Memory ABI.
 *
 * Memory layout (bytes 0..2047 are below `memoryBase = 2048`):
 *   1024..1095 : fmi-ls-emt gEq (9 f64)
 *   1096..1119 : fmi-ls-emt iHist (3 f64)
 *   1120..1143 : fmi-ls-emt vNode (3 f64)
 *   1152..1279 : fmi-ls-emt params (16 f64)
 *   1280..1359 : EMTDC Context Header (10 f64 slots):
 *                [0] TIME (s)
 *                [1] DELT (s)
 *                [2] TIMEZERO (0.0 or 1.0)
 *                [3] FIRSTSTEP (0.0 or 1.0)
 *                [4] LASTSTEP (0.0 or 1.0)
 *                [5] NSTORF (f64-encoded i32 cursor)
 *                [6] NSTORI (f64-encoded i32 cursor)
 *                [7] NSTORL (f64-encoded i32 cursor)
 *                [8] NSTORC (f64-encoded i32 cursor)
 *                [9] ACTIVE_INST_ID (f64-encoded i32)
 *   1360..1871 : Subroutine Argument Buffer (64 f64 slots)
 */

@external("env", "emtdc_host_io")
export declare function emtdc_host_io(opCode: i32, a0: f64, a1: f64, a2: f64): f64;

@external("env", "emtdc_host_plot")
export declare function emtdc_host_plot(channelId: i32, value: f64, timeSec: f64): void;

export const CTX_BASE: usize = 1280;
export const ARGS_BASE: usize = 1360;

export const MAX_STORF: i32 = 16384;
export const MAX_STORI: i32 = 8192;
export const MAX_STORL: i32 = 4096;
export const MAX_STORC: i32 = 4096;
export const MAX_NODES: i32 = 2048;

const STORF = new Float64Array(MAX_STORF);
const STORI = new Int32Array(MAX_STORI);
const STORL = new Uint8Array(MAX_STORL);
const STORC = new Float64Array(MAX_STORC * 2);

const VDC = new Float64Array(MAX_NODES);
const CBR = new Float64Array(MAX_NODES);
const CCIN = new Float64Array(MAX_NODES);
const GGIN = new Float64Array(MAX_NODES);

let nextRealSlot: i32 = 1;
let nextIntSlot: i32 = 1;
let nextLogicalSlot: i32 = 1;
let nextCompId: i32 = 1;
let lastStatusCode: i32 = 0;

export function emtdc_reset_arena(): void {
  STORF.fill(0.0);
  STORI.fill(0);
  STORL.fill(0);
  STORC.fill(0.0);
  VDC.fill(0.0);
  CBR.fill(0.0);
  CCIN.fill(0.0);
  GGIN.fill(0.0);
  nextRealSlot = 1;
  nextIntSlot = 1;
  nextLogicalSlot = 1;
  nextCompId = 1;
  lastStatusCode = 0;
  emtdc_set_context(0.0, 50e-6, 1, 1, 0);
}

export function emtdc_set_context(
  timeSec: f64,
  dtSec: f64,
  timeZero: i32,
  firstStep: i32,
  lastStep: i32,
): void {
  store<f64>(CTX_BASE + 0, timeSec);
  store<f64>(CTX_BASE + 8, dtSec > 1e-12 ? dtSec : 50e-6);
  store<f64>(CTX_BASE + 16, timeZero != 0 ? 1.0 : 0.0);
  store<f64>(CTX_BASE + 24, firstStep != 0 ? 1.0 : 0.0);
  store<f64>(CTX_BASE + 32, lastStep != 0 ? 1.0 : 0.0);
}

export function emtdc_set_cursors(nstorf: i32, nstori: i32, nstorl: i32, nstorc: i32): void {
  store<f64>(CTX_BASE + 40, <f64>nstorf);
  store<f64>(CTX_BASE + 48, <f64>nstori);
  store<f64>(CTX_BASE + 56, <f64>nstorl);
  store<f64>(CTX_BASE + 64, <f64>nstorc);
}

export function emtdc_get_nstorf(): i32 {
  return <i32>load<f64>(CTX_BASE + 40);
}

export function emtdc_get_nstori(): i32 {
  return <i32>load<f64>(CTX_BASE + 48);
}

export function emtdc_alloc_real(count: i32): i32 {
  const base = nextRealSlot;
  const n = count > 0 ? count : 1;
  if (base + n < MAX_STORF) {
    nextRealSlot = base + n;
  }
  return base;
}

export function emtdc_alloc_int(count: i32): i32 {
  const base = nextIntSlot;
  const n = count > 0 ? count : 1;
  if (base + n < MAX_STORI) {
    nextIntSlot = base + n;
  }
  return base;
}

export function emtdc_alloc_logical(count: i32): i32 {
  const base = nextLogicalSlot;
  const n = count > 0 ? count : 1;
  if (base + n < MAX_STORL) {
    nextLogicalSlot = base + n;
  }
  return base;
}

export function emtdc_next_component_id(): i32 {
  const id = nextCompId;
  nextCompId += 1;
  return id;
}

export function emtdc_set_status(code: i32): void {
  lastStatusCode = code;
}

export function emtdc_get_status(): i32 {
  return lastStatusCode;
}

@inline
export function ctxTime(): f64 {
  return load<f64>(CTX_BASE + 0);
}

@inline
export function ctxDt(): f64 {
  const dt = load<f64>(CTX_BASE + 8);
  return dt > 1e-12 ? dt : 50e-6;
}

@inline
export function ctxTimeZero(): bool {
  return load<f64>(CTX_BASE + 16) > 0.5;
}

@inline
export function ctxFirstStep(): bool {
  return load<f64>(CTX_BASE + 24) > 0.5;
}

@inline
export function ctxLastStep(): bool {
  return load<f64>(CTX_BASE + 32) > 0.5;
}

@inline
export function getArg(argsPtr: usize, idx: i32, argCount: i32, fallback: f64 = 0.0): f64 {
  if (idx < 0 || idx >= argCount) return fallback;
  return load<f64>(argsPtr + (<usize>idx << 3));
}

@inline
export function setArg(argsPtr: usize, idx: i32, argCount: i32, val: f64): void {
  if (idx < 0 || idx >= argCount) return;
  store<f64>(argsPtr + (<usize>idx << 3), val);
}

@inline
export function getStorf(idx: i32): f64 {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORF ? MAX_STORF - 1 : idx;
  return unchecked(STORF[clamped]);
}

@inline
export function setStorf(idx: i32, val: f64): void {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORF ? MAX_STORF - 1 : idx;
  unchecked((STORF[clamped] = val));
}

@inline
export function getStori(idx: i32): i32 {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORI ? MAX_STORI - 1 : idx;
  return unchecked(STORI[clamped]);
}

@inline
export function setStori(idx: i32, val: i32): void {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORI ? MAX_STORI - 1 : idx;
  unchecked((STORI[clamped] = val));
}

@inline
export function getStorl(idx: i32): u8 {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORL ? MAX_STORL - 1 : idx;
  return unchecked(STORL[clamped]);
}

@inline
export function setStorl(idx: i32, val: u8): void {
  const clamped = idx < 0 ? 0 : idx >= MAX_STORL ? MAX_STORL - 1 : idx;
  unchecked((STORL[clamped] = val));
}

export function emtdc_get_vdc(node: i32): f64 {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  return unchecked(VDC[c]);
}

export function emtdc_set_vdc(node: i32, val: f64): void {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  unchecked((VDC[c] = val));
}

export function emtdc_get_cbr(branch: i32): f64 {
  const c = branch < 0 ? 0 : branch >= MAX_NODES ? MAX_NODES - 1 : branch;
  return unchecked(CBR[c]);
}

export function emtdc_set_cbr(branch: i32, val: f64): void {
  const c = branch < 0 ? 0 : branch >= MAX_NODES ? MAX_NODES - 1 : branch;
  unchecked((CBR[c] = val));
}

export function emtdc_get_ccin(node: i32): f64 {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  return unchecked(CCIN[c]);
}

export function emtdc_add_ccin(node: i32, current: f64): void {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  unchecked((CCIN[c] = CCIN[c] + current));
}

export function emtdc_get_ggin(node: i32): f64 {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  return unchecked(GGIN[c]);
}

export function emtdc_add_ggin(node: i32, g: f64): void {
  const c = node < 0 ? 0 : node >= MAX_NODES ? MAX_NODES - 1 : node;
  unchecked((GGIN[c] = GGIN[c] + g));
}

@inline
export function activeRealBase(nSlots: i32): i32 {
  let base = emtdc_get_nstorf();
  if (base <= 0) base = 1;
  emtdc_set_cursors(base + nSlots, emtdc_get_nstori(), <i32>load<f64>(CTX_BASE + 56), <i32>load<f64>(CTX_BASE + 64));
  return base;
}

@inline
export function activeIntBase(nSlots: i32): i32 {
  let base = emtdc_get_nstori();
  if (base <= 0) base = 1;
  emtdc_set_cursors(emtdc_get_nstorf(), base + nSlots, <i32>load<f64>(CTX_BASE + 56), <i32>load<f64>(CTX_BASE + 64));
  return base;
}

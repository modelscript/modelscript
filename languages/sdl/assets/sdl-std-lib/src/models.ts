// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/sdl-std-lib`.
 *
 * Implements zero-GC 2048-byte aligned slot ABI for ITU-T Z.100 predefined sorts
 * and canonical telecom protocol blocks (Alternating-Bit Protocol, Watchdog Timer,
 * Call Setup):
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — block parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — EFSM state & timer remaining
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — timer countdown derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — signal bus:
 *       IO[0] = inputSignalFlag   IO[1] = inputSeqBit
 *       IO[2] = outputSignalFlag  IO[3] = outputSeqBit
 *       IO[4] = timerActive       IO[5] = timerExpired
 *       IO[6] = alarmFlag         IO[7] = currentStateId
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_ABP_SENDER: i32 = 20;
const ARCH_ABP_RECEIVER: i32 = 21;
const ARCH_WATCHDOG_TIMER: i32 = 23;
const ARCH_CALL_ORIG: i32 = 24;
const ARCH_CALL_TERM: i32 = 25;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

export function sdlModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setState(slotPtr, 0, 0.0); // stateId = 0 (Idle/Ready)
  setState(slotPtr, 1, 0.0); // timerRemaining = 0.0
  setState(slotPtr, 2, 0.0); // seqBit = 0
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);

  if (archetypeId == ARCH_WATCHDOG_TIMER) {
    const timeout = getCon(slotPtr, conCount, 0, 2.0);
    setState(slotPtr, 1, timeout);
    setIo(slotPtr, 4, 1.0); // timerActive
  } else {
    setIo(slotPtr, 4, 0.0);
  }
  setIo(slotPtr, 5, 0.0); // timerExpired
  setIo(slotPtr, 6, 0.0); // alarmFlag
  setIo(slotPtr, 7, 0.0); // currentStateId
}

export function sdlModelStep(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  let stateId = getState(slotPtr, 0);
  let rem = getState(slotPtr, 1);
  let seq = getState(slotPtr, 2);

  if (archetypeId == ARCH_WATCHDOG_TIMER) {
    const timeout = getCon(slotPtr, conCount, 0, 2.0);
    const kick = getIo(slotPtr, 0);
    if (kick > 0.5) {
      rem = timeout;
      stateId = 0.0;
      setIo(slotPtr, 5, 0.0);
      setIo(slotPtr, 6, 0.0);
    } else if (rem > 0.0) {
      rem = rem - dt;
      setDState(slotPtr, 1, -1.0);
      if (rem <= 0.0) {
        rem = 0.0;
        stateId = 1.0; // Alarm state
        setIo(slotPtr, 5, 1.0);
        setIo(slotPtr, 6, 1.0);
      }
    }
    setState(slotPtr, 0, stateId);
    setState(slotPtr, 1, rem);
    setIo(slotPtr, 7, stateId);
    return;
  }

  if (archetypeId == ARCH_ABP_SENDER) {
    const timeout = getCon(slotPtr, conCount, 0, 1.0);
    const inFlag = getIo(slotPtr, 0);
    const ackSeq = getIo(slotPtr, 1);
    setIo(slotPtr, 2, 0.0);
    if (stateId < 0.5 && inFlag > 0.5) {
      // Idle -> WaitAck
      stateId = 1.0;
      rem = timeout;
      setIo(slotPtr, 2, 1.0);
      setIo(slotPtr, 3, seq);
      setIo(slotPtr, 4, 1.0);
    } else if (stateId >= 0.5) {
      if (inFlag > 0.5 && Math.abs(ackSeq - seq) < 0.1) {
        // Matching ACK received -> Idle, flip seq
        stateId = 0.0;
        seq = 1.0 - seq;
        rem = 0.0;
        setIo(slotPtr, 4, 0.0);
      } else {
        rem = rem - dt;
        setDState(slotPtr, 1, -1.0);
        if (rem <= 0.0) {
          // Retransmit on timer expiry
          rem = timeout;
          setIo(slotPtr, 2, 1.0);
          setIo(slotPtr, 3, seq);
          setIo(slotPtr, 5, 1.0);
        }
      }
    }
    setState(slotPtr, 0, stateId);
    setState(slotPtr, 1, rem);
    setState(slotPtr, 2, seq);
    setIo(slotPtr, 7, stateId);
    return;
  }

  if (archetypeId == ARCH_ABP_RECEIVER) {
    const inFlag = getIo(slotPtr, 0);
    const frameSeq = getIo(slotPtr, 1);
    setIo(slotPtr, 2, 0.0);
    if (inFlag > 0.5) {
      setIo(slotPtr, 2, 1.0);
      setIo(slotPtr, 3, frameSeq);
      if (Math.abs(frameSeq - seq) < 0.1) {
        seq = 1.0 - seq;
      }
    }
    setState(slotPtr, 2, seq);
    setIo(slotPtr, 7, seq);
    return;
  }

  if (archetypeId == ARCH_CALL_ORIG || archetypeId == ARCH_CALL_TERM) {
    const inFlag = getIo(slotPtr, 0);
    if (inFlag > 0.5 && stateId < 2.0) {
      stateId = stateId + 1.0;
      setIo(slotPtr, 2, 1.0);
    }
    setState(slotPtr, 0, stateId);
    setIo(slotPtr, 7, stateId);
    return;
  }

  // Predefined sorts: pass-through
  const defVal = getCon(slotPtr, conCount, 0, 0.0);
  setState(slotPtr, 0, defVal);
  setIo(slotPtr, 7, defVal);
}

export function sdlBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    sdlModelInit(archetypeId, slotPtr, conCount);
  }
}

export function sdlBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    sdlModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}

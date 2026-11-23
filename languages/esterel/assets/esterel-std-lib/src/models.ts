// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript synchronous reactive runtime for `@modelscript/esterel-std-lib`.
 *
 * Implements the 6 canonical Esterel reactive patterns using a zero-GC 256-byte slot ABI:
 *   - `0x00..0x1F` (32 B): `META[8]` (`i32`) — archetypeId, state bits, counters
 *   - `0x20..0x5F` (64 B): `PARAM[16]` (`i32`) — integer parameters (deadline, count, limit, priority)
 *   - `0x60..0x9F` (64 B): `IN[16]` (`i32`) — present (1) / absent (0) input signals
 *   - `0xA0..0xDF` (64 B): `OUT[16]` (`i32`) — present (1) / absent (0) output signals
 */

const OFF_META: usize = 0x00;
const OFF_PARAM: usize = 0x20;
const OFF_IN: usize = 0x60;
const OFF_OUT: usize = 0xa0;

const ARCH_ABRO: i32 = 1;
const ARCH_WATCHDOG: i32 = 2;
const ARCH_DEBOUNCER: i32 = 3;
const ARCH_ARBITER: i32 = 4;
const ARCH_TIMEOUT: i32 = 5;
const ARCH_STOPWATCH: i32 = 6;

@inline
function getMeta(slot: usize, idx: i32): i32 {
  return load<i32>(slot + OFF_META + (<usize>idx << 2));
}

@inline
function setMeta(slot: usize, idx: i32, val: i32): void {
  store<i32>(slot + OFF_META + (<usize>idx << 2), val);
}

@inline
function getParam(slot: usize, idx: i32, fallback: i32): i32 {
  const v = load<i32>(slot + OFF_PARAM + (<usize>idx << 2));
  return v > 0 ? v : fallback;
}

@inline
function getIn(slot: usize, idx: i32): i32 {
  return load<i32>(slot + OFF_IN + (<usize>idx << 2)) != 0 ? 1 : 0;
}

@inline
function setOut(slot: usize, idx: i32, val: i32): void {
  store<i32>(slot + OFF_OUT + (<usize>idx << 2), val);
}

export function initSlot(slot: usize, archetypeId: i32): void {
  setMeta(slot, 0, archetypeId);
  for (let i: i32 = 1; i < 8; i++) setMeta(slot, i, 0);
  for (let i: i32 = 0; i < 16; i++) setOut(slot, i, 0);
}

export function stepSlot(slot: usize): i32 {
  const arch = getMeta(slot, 0);
  for (let i: i32 = 0; i < 16; i++) setOut(slot, i, 0);

  if (arch == ARCH_ABRO) {
    // IN: 0=A, 1=B, 2=R; OUT: 0=O
    // META[1]: started (0=first tick, 1=active), META[2]: gotA, META[3]: gotB, META[4]: emitted
    const a = getIn(slot, 0);
    const b = getIn(slot, 1);
    const r = getIn(slot, 2);
    const started = getMeta(slot, 1);

    if (started == 0) {
      setMeta(slot, 1, 1);
      setMeta(slot, 2, 0);
      setMeta(slot, 3, 0);
      setMeta(slot, 4, 0);
      return 0;
    }

    if (r != 0) {
      // Strong abort & restart; non-immediate awaits pause on reset tick
      setMeta(slot, 2, 0);
      setMeta(slot, 3, 0);
      setMeta(slot, 4, 0);
      return 0;
    }

    if (getMeta(slot, 4) != 0) {
      return 0;
    }

    let gotA = getMeta(slot, 2) | a;
    let gotB = getMeta(slot, 3) | b;
    setMeta(slot, 2, gotA);
    setMeta(slot, 3, gotB);
    if (gotA != 0 && gotB != 0) {
      setOut(slot, 0, 1);
      setMeta(slot, 4, 1);
      return 1;
    }
    return 0;
  }

  if (arch == ARCH_WATCHDOG) {
    // IN: 0=TICK, 1=KICK, 2=RESET; OUT: 0=ALARM; PARAM[0]=DEADLINE (default 3)
    const tick = getIn(slot, 0);
    const kick = getIn(slot, 1);
    const reset = getIn(slot, 2);
    const deadline = getParam(slot, 0, 3);
    const started = getMeta(slot, 1);

    if (started == 0 || reset != 0) {
      setMeta(slot, 1, 1);
      setMeta(slot, 2, 0); // elapsed ticks
      setMeta(slot, 3, 0); // alarmed
      return 0;
    }

    if (kick != 0) {
      setMeta(slot, 2, 0);
      setMeta(slot, 3, 0);
      return 0;
    }

    if (getMeta(slot, 3) != 0) {
      return 0;
    }

    if (tick != 0) {
      const next = getMeta(slot, 2) + 1;
      setMeta(slot, 2, next);
      if (next >= deadline) {
        setOut(slot, 0, 1);
        setMeta(slot, 3, 1);
        return 1;
      }
    }
    return 0;
  }

  if (arch == ARCH_DEBOUNCER) {
    // IN: 0=RAW, 1=RESET; OUT: 0=STABLE; PARAM[0]=COUNT (default 2)
    const raw = getIn(slot, 0);
    const reset = getIn(slot, 1);
    const target = getParam(slot, 0, 2);
    if (reset != 0 || raw == 0) {
      setMeta(slot, 2, 0);
      return 0;
    }
    const cnt = getMeta(slot, 2) + 1;
    setMeta(slot, 2, cnt);
    if (cnt >= target) {
      setOut(slot, 0, 1);
      return 1;
    }
    return 0;
  }

  if (arch == ARCH_ARBITER) {
    // IN: 0=REQ1, 1=REQ2; OUT: 0=GNT1, 1=GNT2
    const req1 = getIn(slot, 0);
    const req2 = getIn(slot, 1);
    if (req1 != 0) {
      setOut(slot, 0, 1);
      return 1;
    }
    if (req2 != 0) {
      setOut(slot, 1, 1);
      return 2;
    }
    return 0;
  }

  if (arch == ARCH_TIMEOUT) {
    // IN: 0=START, 1=TICK, 2=CANCEL; OUT: 0=EXPIRED; PARAM[0]=LIMIT (default 4)
    const start = getIn(slot, 0);
    const tick = getIn(slot, 1);
    const cancel = getIn(slot, 2);
    const limit = getParam(slot, 0, 4);
    let active = getMeta(slot, 1);

    if (active == 0) {
      if (start != 0) {
        setMeta(slot, 1, 1);
        setMeta(slot, 2, 0);
      }
      return 0;
    }

    if (cancel != 0) {
      setMeta(slot, 1, 0);
      setMeta(slot, 2, 0);
      return 0;
    }

    if (tick != 0) {
      const next = getMeta(slot, 2) + 1;
      setMeta(slot, 2, next);
      if (next >= limit) {
        setOut(slot, 0, 1);
        setMeta(slot, 1, 0);
        setMeta(slot, 2, 0);
        return 1;
      }
    }
    return 0;
  }

  if (arch == ARCH_STOPWATCH) {
    // IN: 0=START_STOP, 1=TICK, 2=RESET; OUT: 0=COUNT_TICK, 1=RUNNING
    const startStop = getIn(slot, 0);
    const tick = getIn(slot, 1);
    const reset = getIn(slot, 2);
    let running = getMeta(slot, 1);

    if (reset != 0) {
      setMeta(slot, 1, 0);
      return 0;
    }
    if (startStop != 0) {
      running = running == 0 ? 1 : 0;
      setMeta(slot, 1, running);
    }
    if (running != 0) {
      setOut(slot, 1, 1);
      if (tick != 0) {
        setOut(slot, 0, 1);
        return 3;
      }
      return 2;
    }
    return 0;
  }

  return 0;
}

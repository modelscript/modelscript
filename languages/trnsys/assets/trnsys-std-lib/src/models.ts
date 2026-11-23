// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript transient thermal runtime for `@modelscript/trnsys-std-lib`.
 *
 * Implements classic TRNSYS component physics (Type1, Type2, Type3, Type4, Type14, Type15, Type25, Type56)
 * using a zero-GC 1024-byte aligned slot ABI:
 *   - `0x000..0x03F` (64 B):  `META[16]`  (`i32`)
 *   - `0x040..0x13F` (256 B): `PAR[32]`   (`f64`) — TRNSYS PARAMETERS
 *   - `0x140..0x23F` (256 B): `IN[32]`    (`f64`) — TRNSYS INPUTS
 *   - `0x240..0x33F` (256 B): `OUT[32]`   (`f64`) — TRNSYS OUTPUTS
 *   - `0x340..0x3FF` (192 B): `STATE[24]` (`f64`) — internal dynamic states (e.g. tank nodes, zone temp, controller state)
 */

const OFF_PAR: usize = 0x040;
const OFF_IN: usize = 0x140;
const OFF_OUT: usize = 0x240;
const OFF_STATE: usize = 0x340;

const TYPE_COLLECTOR: i32 = 1;
const TYPE_CONTROLLER: i32 = 2;
const TYPE_PUMP: i32 = 3;
const TYPE_TANK: i32 = 4;
const TYPE_FORCING: i32 = 14;
const TYPE_WEATHER: i32 = 15;
const TYPE_PRINTER: i32 = 25;
const TYPE_BUILDING: i32 = 56;

const PI: f64 = 3.141592653589793;

@inline
function getPar(slotPtr: usize, parCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= parCount) return fallback;
  const v = load<f64>(slotPtr + OFF_PAR + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIn(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IN + (<usize>idx << 3));
}

@inline
function setOut(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_OUT + (<usize>idx << 3), v);
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

/**
 * Initializes component dynamic states inside its slot.
 */
export function trnsysModelInit(typeNumber: i32, slotPtr: usize, parCount: i32): void {
  if (typeNumber == TYPE_CONTROLLER) {
    setState(slotPtr, 0, 0.0);
    setOut(slotPtr, 0, 0.0);
  } else if (typeNumber == TYPE_TANK) {
    let nNodes = <i32>Math.round(getPar(slotPtr, parCount, 5, 3.0));
    if (nNodes < 1) nNodes = 1;
    if (nNodes > 6) nNodes = 6;
    const tInit = getPar(slotPtr, parCount, 6, 20.0);
    for (let i = 0; i < nNodes; i++) {
      setState(slotPtr, i, tInit);
    }
    setOut(slotPtr, 0, tInit);
    setOut(slotPtr, 1, 0.0);
    setOut(slotPtr, 2, tInit);
    setOut(slotPtr, 3, 0.0);
    setOut(slotPtr, 4, 0.0);
    setOut(slotPtr, 5, tInit);
  } else if (typeNumber == TYPE_BUILDING) {
    const tInit = getPar(slotPtr, parCount, 3, 20.0);
    setState(slotPtr, 0, tInit);
    setOut(slotPtr, 0, tInit);
    setOut(slotPtr, 1, 0.0);
    setOut(slotPtr, 2, 0.0);
  }
}

/**
 * Advances a TRNSYS component by one timestep `dt` (hours) at simulation time `t` (hours).
 */
export function trnsysModelStep(typeNumber: i32, t: f64, dt: f64, slotPtr: usize, parCount: i32): void {
  if (typeNumber == TYPE_COLLECTOR) {
    // Type 1: Hottel-Whillier-Bliss flat-plate collector
    const area = getPar(slotPtr, parCount, 0, 4.0);
    const cp = getPar(slotPtr, parCount, 1, 4.19);
    const frTauAlpha = getPar(slotPtr, parCount, 2, 0.75);
    const frUl = getPar(slotPtr, parCount, 3, 15.0);
    const frUl2 = getPar(slotPtr, parCount, 4, 0.0);

    const tIn = getIn(slotPtr, 0);
    const mDot = getIn(slotPtr, 1);
    const tAmb = getIn(slotPtr, 2);
    const it = getIn(slotPtr, 3);

    const dT = tIn - tAmb;
    let qu = area * (frTauAlpha * it - frUl * dT - frUl2 * dT * dT);
    if (mDot <= 1e-9 || qu < 0.0) {
      qu = 0.0;
    }
    const tOut = mDot > 1e-9 ? tIn + qu / (mDot * cp) : tIn;
    setOut(slotPtr, 0, tOut);
    setOut(slotPtr, 1, mDot);
    setOut(slotPtr, 2, qu);
    return;
  }

  if (typeNumber == TYPE_CONTROLLER) {
    // Type 2: Differential controller with deadband hysteresis
    const tHighLimit = getPar(slotPtr, parCount, 1, 95.0);
    const tHigh = getIn(slotPtr, 0);
    const tLow = getIn(slotPtr, 1);
    const tMon = getIn(slotPtr, 2);
    const gammaPrev = getState(slotPtr, 0);
    const dTon = getIn(slotPtr, 4);
    const dToff = getIn(slotPtr, 5);

    let gammaOut = gammaPrev;
    if (tMon >= tHighLimit) {
      gammaOut = 0.0;
    } else if (gammaPrev > 0.5) {
      gammaOut = tHigh - tLow < dToff ? 0.0 : 1.0;
    } else {
      gammaOut = tHigh - tLow >= dTon ? 1.0 : 0.0;
    }
    setState(slotPtr, 0, gammaOut);
    setOut(slotPtr, 0, gammaOut);
    return;
  }

  if (typeNumber == TYPE_PUMP) {
    // Type 3: Circulation pump
    const mDotMax = getPar(slotPtr, parCount, 0, 200.0);
    const cp = getPar(slotPtr, parCount, 1, 4.19);
    const pMax = getPar(slotPtr, parCount, 2, 180.0);
    const fPar = getPar(slotPtr, parCount, 3, 0.05);

    const tIn = getIn(slotPtr, 0);
    const gamma = Math.max(0.0, Math.min(1.0, getIn(slotPtr, 2)));
    const mDotOut = gamma * mDotMax;
    const power = gamma * pMax;
    const tOut = mDotOut > 1e-9 ? tIn + (fPar * power) / (mDotOut * cp) : tIn;
    setOut(slotPtr, 0, tOut);
    setOut(slotPtr, 1, mDotOut);
    setOut(slotPtr, 2, power);
    return;
  }

  if (typeNumber == TYPE_TANK) {
    // Type 4: Multi-node stratified storage tank with exact exponential decay per sub-step
    const volume = Math.max(1e-4, getPar(slotPtr, parCount, 0, 0.3));
    const cp = Math.max(1e-3, getPar(slotPtr, parCount, 1, 4.19));
    const rho = Math.max(1.0, getPar(slotPtr, parCount, 2, 1000.0));
    const uLoss = Math.max(0.0, getPar(slotPtr, parCount, 3, 1.5));
    const height = Math.max(0.1, getPar(slotPtr, parCount, 4, 1.5));
    let nNodes = <i32>Math.round(getPar(slotPtr, parCount, 5, 3.0));
    if (nNodes < 1) nNodes = 1;
    if (nNodes > 6) nNodes = 6;

    const tHotIn = getIn(slotPtr, 0);
    const mDotHot = Math.max(0.0, getIn(slotPtr, 1));
    const tColdIn = getIn(slotPtr, 2);
    const mDotLoad = Math.max(0.0, getIn(slotPtr, 3));
    const tEnv = getIn(slotPtr, 4);

    const radius = Math.sqrt(volume / (PI * height));
    const sideAreaNode = (2.0 * PI * radius * height) / <f64>nNodes;
    const capArea = PI * radius * radius;
    const massNode = (rho * volume) / <f64>nNodes;
    const capNode = massNode * cp;

    let totalLoss: f64 = 0.0;
    let sumT: f64 = 0.0;

    // Exact linear ODE update per node for dt
    for (let i = 0; i < nNodes; i++) {
      const ti = getState(slotPtr, i);
      let areaNode = sideAreaNode;
      if (i == 0) areaNode += capArea;
      if (i == nNodes - 1) areaNode += capArea;
      const uaNode = uLoss * areaNode;

      const tAbove = i == 0 ? tHotIn : getState(slotPtr, i - 1);
      const tBelow = i == nNodes - 1 ? tColdIn : getState(slotPtr, i + 1);

      const a = (mDotHot * cp + mDotLoad * cp + uaNode) / capNode;
      const b = (mDotHot * cp * tAbove + mDotLoad * cp * tBelow + uaNode * tEnv) / capNode;

      let tNext = ti;
      if (dt > 0.0) {
        if (a > 1e-12) {
          const tEq = b / a;
          tNext = tEq + (ti - tEq) * Math.exp(-a * dt);
        } else {
          tNext = ti + b * dt;
        }
      }
      setState(slotPtr, i, tNext);
      totalLoss += uaNode * (0.5 * (ti + tNext) - tEnv);
      sumT += tNext;
    }

    const tTop = getState(slotPtr, 0);
    const tBot = getState(slotPtr, nNodes - 1);
    setOut(slotPtr, 0, tBot);
    setOut(slotPtr, 1, mDotHot);
    setOut(slotPtr, 2, tTop);
    setOut(slotPtr, 3, mDotLoad);
    setOut(slotPtr, 4, totalLoss);
    setOut(slotPtr, 5, sumT / <f64>nNodes);
    return;
  }

  if (typeNumber == TYPE_FORCING) {
    // Type 14: Periodic piecewise-linear forcing function
    const nPairs = parCount >> 1;
    if (nPairs < 2) {
      setOut(slotPtr, 0, 0.0);
      setOut(slotPtr, 1, 0.0);
      return;
    }
    const period = getPar(slotPtr, parCount, (nPairs - 1) * 2, 24.0);
    const tMod = period > 0.0 ? t - Math.floor(t / period) * period : t;
    let val = getPar(slotPtr, parCount, 1, 0.0);
    for (let i = 0; i < nPairs - 1; i++) {
      const ta = getPar(slotPtr, parCount, i * 2, 0.0);
      const va = getPar(slotPtr, parCount, i * 2 + 1, 0.0);
      const tb = getPar(slotPtr, parCount, (i + 1) * 2, period);
      const vb = getPar(slotPtr, parCount, (i + 1) * 2 + 1, va);
      if (tMod >= ta && tMod <= tb) {
        const span = tb - ta;
        val = span > 1e-12 ? va + ((tMod - ta) / span) * (vb - va) : vb;
        break;
      }
    }
    setOut(slotPtr, 0, val);
    setOut(slotPtr, 1, val);
    return;
  }

  if (typeNumber == TYPE_WEATHER) {
    // Type 15: Synthetic diurnal weather processor
    const tMean = getPar(slotPtr, parCount, 0, 20.0);
    const tAmp = getPar(slotPtr, parCount, 1, 5.0);
    const iPeak = getPar(slotPtr, parCount, 2, 2880.0);
    const sunrise = getPar(slotPtr, parCount, 3, 6.0);
    const sunset = getPar(slotPtr, parCount, 4, 18.0);

    const hr = t - Math.floor(t / 24.0) * 24.0;
    const tAmb = tMean - tAmp * Math.cos((2.0 * PI * (hr - 3.0)) / 24.0);
    let it: f64 = 0.0;
    if (hr > sunrise && hr < sunset && sunset > sunrise) {
      it = iPeak * Math.sin((PI * (hr - sunrise)) / (sunset - sunrise));
    }
    setOut(slotPtr, 0, tAmb);
    setOut(slotPtr, 1, it);
    setOut(slotPtr, 2, 50.0);
    setOut(slotPtr, 3, 2.0);
    return;
  }

  if (typeNumber == TYPE_PRINTER) {
    return;
  }

  if (typeNumber == TYPE_BUILDING) {
    // Type 56: Lumped thermal capacitance zone ODE
    const cap = Math.max(1.0, getPar(slotPtr, parCount, 0, 5000.0));
    const ua = Math.max(0.0, getPar(slotPtr, parCount, 1, 250.0));
    const solarAp = Math.max(0.0, getPar(slotPtr, parCount, 2, 6.0));

    const tAmb = getIn(slotPtr, 0);
    const it = getIn(slotPtr, 1);
    const qInt = getIn(slotPtr, 2);
    const qHvac = getIn(slotPtr, 3);

    const tZone = getState(slotPtr, 0);
    const qGain = solarAp * it + qInt + qHvac;
    const a = ua / cap;
    const b = (ua * tAmb + qGain) / cap;

    let tNext = tZone;
    if (dt > 0.0) {
      if (a > 1e-12) {
        const tEq = b / a;
        tNext = tEq + (tZone - tEq) * Math.exp(-a * dt);
      } else {
        tNext = tZone + b * dt;
      }
    }
    setState(slotPtr, 0, tNext);
    setOut(slotPtr, 0, tNext);
    setOut(slotPtr, 1, qHvac);
    setOut(slotPtr, 2, ua * (tNext - tAmb));
  }
}

/**
 * Batched initialization across `count` 16-byte descriptors:
 * `{ typeNumber: i32, slotPtr: u32, reserved: i32, parCount: i32 }`.
 */
export function trnsysBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const typeNumber = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const parCount = load<i32>(entry + 12);
    trnsysModelInit(typeNumber, slotPtr, parCount);
  }
}

/**
 * Batched timestep across `count` 16-byte descriptors.
 */
export function trnsysBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const typeNumber = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const parCount = load<i32>(entry + 12);
    trnsysModelStep(typeNumber, t, dt, slotPtr, parCount);
  }
}

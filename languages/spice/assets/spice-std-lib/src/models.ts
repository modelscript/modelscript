// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript device & behavioral primitive runtime for `@modelscript/spice-std-lib`.
 *
 * Uses the standardized zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — SPICE model parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — persistent device state (hysteresis, flip-flop, pole, phase)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives / scratch
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — terminal I/O bus:
 *       Inputs:
 *         IO[0] = v1 (Vd / Vbe / Vgs / Vctrl / Vin+ / D / Set)
 *         IO[1] = v2 (Vce / Vds / Vsw / Vin- / Clk / Reset / Vfm)
 *         IO[2] = v3 (Vbs / Ictrl / Vam / Iload)
 *         IO[3] = tempK (K, default 300.15)
 *         IO[4] = dt (s, default 1e-6)
 *         IO[5] = t (s)
 *       Outputs:
 *         IO[8]  = iOut (Id / Ic / Isw / Iout)
 *         IO[9]  = iAux (Ib / Ig)
 *         IO[10] = vOut (Vout for op-amp / logic / Schmitt / behavioral / regulator)
 *         IO[11] = gm (conductance / transconductance in S)
 *         IO[12] = gds (output conductance in S)
 *         IO[13] = region (0=cutoff/off, 1=triode/forward/on, 2=saturation/active, 3=breakdown)
 *         IO[14] = cje (BJT B-E depletion capacitance in F)
 *         IO[15] = cjc (BJT B-C depletion capacitance in F)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `SpiceArchetypeId` in spice-std-schemas.ts)
const ARCH_DIODE_SHOCKLEY: i32 = 1;
const ARCH_BJT_NPN: i32 = 10;
const ARCH_BJT_PNP: i32 = 11;
const ARCH_MOSFET_NMOS: i32 = 20;
const ARCH_MOSFET_PMOS: i32 = 21;
const ARCH_JFET_NJF: i32 = 22;
const ARCH_DIGITAL_GATE: i32 = 30;
const ARCH_SCHMITT_TRIGGER: i32 = 31;
const ARCH_SEQUENTIAL_LOGIC: i32 = 32;
const ARCH_ANALOG_OTA: i32 = 40;
const ARCH_MODULATOR_FM_AM: i32 = 41;
const ARCH_BEHAVIORAL_VSRC: i32 = 50;
const ARCH_BEHAVIORAL_ISRC: i32 = 51;
const ARCH_SWITCH_VCTRL: i32 = 60;
const ARCH_SWITCH_ICTRL: i32 = 61;
const ARCH_OPAMP_SINGLE_POLE: i32 = 70;
const ARCH_REGULATOR_LINEAR: i32 = 80;

// k_B / q in V/K (Boltzmann constant divided by elementary charge)
const KB_OVER_Q: f64 = 8.617333262e-5;
const EXP_LIMIT: f64 = 40.0;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Smoothly clamped exponential with linear continuation above `EXP_LIMIT`
 * to prevent floating-point overflow during Newton iterations.
 */
@inline
function safeExp(x: f64): f64 {
  if (x > EXP_LIMIT) {
    const eMax = Math.exp(EXP_LIMIT);
    return eMax * (1.0 + (x - EXP_LIMIT));
  }
  if (x < -EXP_LIMIT) {
    return Math.exp(-EXP_LIMIT);
  }
  return Math.exp(x);
}

@inline
function safeExpDeriv(x: f64): f64 {
  if (x > EXP_LIMIT) {
    return Math.exp(EXP_LIMIT);
  }
  if (x < -EXP_LIMIT) {
    return Math.exp(-EXP_LIMIT);
  }
  return Math.exp(x);
}

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
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Voltage-dependent p-n depletion junction capacitance with SPICE Fc=0.5 linear continuation:
 *   Cj(V) = Cj0 / (1 - V / Vj)^mj                         for V <= Fc * Vj
 *   Cj(V) = Cj0 / (1 - Fc)^(1 + mj) * (1 - Fc*(1+mj) + mj*V/Vj)   for V > Fc * Vj
 */
@inline
function depletionCap(c0: f64, v: f64, vj: f64, mj: f64): f64 {
  if (c0 <= 0.0) return 0.0;
  const vjSafe = Math.max(0.1, vj);
  const fc: f64 = 0.5;
  const x = v / vjSafe;
  if (x <= fc) {
    return c0 / Math.pow(Math.max(1.0e-6, 1.0 - x), mj);
  }
  const f1 = Math.pow(1.0 - fc, 1.0 + mj);
  return (c0 / f1) * (1.0 - fc * (1.0 + mj) + mj * x);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function spiceGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes persistent device state for a SPICE archetype slot.
 * Returns the number of active state variables for the archetype.
 */
export function spiceModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, 0.0);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);
  setIo(slotPtr, 12, 0.0);
  setIo(slotPtr, 13, 0.0);

  if (archetypeId == ARCH_SCHMITT_TRIGGER) {
    // STATE[0] = latched logic state (0 or 1)
    setState(slotPtr, 0, 0.0);
    return 1;
  }
  if (archetypeId == ARCH_SEQUENTIAL_LOGIC) {
    // STATE[0] = Q, STATE[1] = prevClk
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    return 2;
  }
  if (archetypeId == ARCH_MODULATOR_FM_AM) {
    // STATE[0] = accumulated phase (rad)
    setState(slotPtr, 0, 0.0);
    return 1;
  }
  if (archetypeId == ARCH_OPAMP_SINGLE_POLE) {
    // STATE[0] = dominant-pole internal output voltage
    setState(slotPtr, 0, 0.0);
    return 1;
  }
  return 0;
}

/**
 * Evaluates cleanroom semiconductor physics or behavioral primitive equations
 * for a single SPICE model slot.
 */
export function spiceModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const v1 = getIo(slotPtr, 0);
  const v2 = getIo(slotPtr, 1);
  const v3 = getIo(slotPtr, 2);
  const tempK = getIo(slotPtr, 3) > 1.0 ? getIo(slotPtr, 3) : 300.15;
  const dt = getIo(slotPtr, 4) > 0.0 ? getIo(slotPtr, 4) : 1.0e-6;
  const vt = KB_OVER_Q * tempK;

  // 1. Shockley Diode with Zener Reverse Breakdown: I = Is * (exp(V / (n * Vt)) - 1)
  if (archetypeId == ARCH_DIODE_SHOCKLEY) {
    const is = Math.max(1.0e-20, getCon(slotPtr, conCount, 0, 2.52e-9));
    const n = Math.max(0.1, getCon(slotPtr, conCount, 1, 1.752));
    const bv = getCon(slotPtr, conCount, 3, 100.0);
    const ibv = Math.max(1.0e-12, getCon(slotPtr, conCount, 4, 1.0e-4));

    const nVt = n * vt;
    const argF = v1 / nVt;
    let id = is * (safeExp(argF) - 1.0);
    let gd = (is / nVt) * safeExpDeriv(argF) + 1.0e-12;
    let region: f64 = v1 >= 0.0 ? 1.0 : 0.0;

    if (bv > 0.0 && v1 < -bv) {
      const argBr = (-v1 - bv) / nVt;
      id -= ibv * safeExp(argBr);
      gd += (ibv / nVt) * safeExpDeriv(argBr);
      region = 3.0;
    }

    setIo(slotPtr, 8, id);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, v1);
    setIo(slotPtr, 11, gd);
    setIo(slotPtr, 12, gd);
    setIo(slotPtr, 13, region);
    return;
  }

  // 2. Gummel-Poon BJT (NPN / PNP) with Forward/Reverse Early Voltages (Vaf, Var),
  //    High-Level Injection Knee Current (Ikf), and Depletion Junction Capacitances (Cje, Cjc)
  if (archetypeId == ARCH_BJT_NPN || archetypeId == ARCH_BJT_PNP) {
    const pol: f64 = archetypeId == ARCH_BJT_PNP ? -1.0 : 1.0;
    const is = Math.max(1.0e-20, getCon(slotPtr, conCount, 0, 1.434e-14));
    const bf = Math.max(1.0, getCon(slotPtr, conCount, 1, 255.9));
    const br = Math.max(0.1, getCon(slotPtr, conCount, 2, 6.092));
    const nf = Math.max(0.1, getCon(slotPtr, conCount, 3, 1.0));
    const vaf = getCon(slotPtr, conCount, 4, 74.03);
    const varRev = getCon(slotPtr, conCount, 6, 100.0);
    const ikf = getCon(slotPtr, conCount, 7, 0.2);
    const cje0 = Math.max(0.0, getCon(slotPtr, conCount, 8, 2.5e-11));
    const vje = Math.max(0.1, getCon(slotPtr, conCount, 9, 0.75));
    const mje = Math.max(0.05, getCon(slotPtr, conCount, 10, 0.33));
    const cjc0 = Math.max(0.0, getCon(slotPtr, conCount, 11, 8.0e-12));
    const vjc = Math.max(0.1, getCon(slotPtr, conCount, 12, 0.75));
    const mjc = Math.max(0.05, getCon(slotPtr, conCount, 13, 0.33));
    const nr = Math.max(0.1, getCon(slotPtr, conCount, 14, 1.0));

    const vbe = pol * v1;
    const vce = pol * v2;
    const vbc = vbe - vce;
    const nfVt = nf * vt;
    const nrVt = nr * vt;

    const argF = vbe / nfVt;
    const argR = vbc / nrVt;
    const iF = is * (safeExp(argF) - 1.0);
    const iR = is * (safeExp(argR) - 1.0);
    const diFdVbe = (is / nfVt) * safeExpDeriv(argF);

    // Gummel-Poon normalized base charge qb = (q1 / 2) * (1 + sqrt(1 + 4 * q2))
    let invQ1: f64 = 1.0;
    if (vaf > 1.0e-3) invQ1 -= vbc / vaf;
    if (varRev > 1.0e-3) invQ1 -= vbe / varRev;
    const q1 = 1.0 / clamp(invQ1, 0.1, 10.0);
    const q2 = ikf > 1.0e-12 && iF > 0.0 ? iF / ikf : 0.0;
    const sqrtTerm = Math.sqrt(1.0 + 4.0 * q2);
    const qb = Math.max(1.0e-6, 0.5 * q1 * (1.0 + sqrtTerm));

    const ic = pol * ((iF - iR) / qb - iR / br);
    const ib = pol * (iF / bf + iR / br);

    // Analytical small-signal transconductance gm = dIc/dVbe and output conductance gds = dIc/dVce
    const dqbDiF = ikf > 1.0e-12 && iF > 0.0 ? q1 / (ikf * sqrtTerm) : 0.0;
    const gm = Math.max(0.0, (diFdVbe * (qb - iF * dqbDiF)) / (qb * qb));
    const gds = (vaf > 1.0e-3 ? Math.abs(iF / qb) / vaf : 0.0) + 1.0e-12;

    // Voltage-dependent depletion junction capacitances Cje(Vbe), Cjc(Vbc)
    const cje = depletionCap(cje0, vbe, vje, mje);
    const cjc = depletionCap(cjc0, vbc, vjc, mjc);

    let region: f64 = 0.0;
    if (vbe > 0.3 && vbc < 0.3) region = 2.0; // forward-active
    else if (vbe > 0.3 && vbc >= 0.3) region = 1.0; // saturation
    else if (vbc > 0.3) region = 3.0; // reverse-active

    setIo(slotPtr, 8, ic);
    setIo(slotPtr, 9, ib);
    setIo(slotPtr, 10, v2);
    setIo(slotPtr, 11, gm);
    setIo(slotPtr, 12, gds);
    setIo(slotPtr, 13, region);
    setIo(slotPtr, 14, cje);
    setIo(slotPtr, 15, cjc);
    return;
  }

  // 3. BSIM Short-Channel MOSFET (NMOS / PMOS) with Smooth Subthreshold (n*Vt),
  //    DIBL Threshold Shift (eta0), Velocity Saturation (Esat), and Channel-Length Modulation (lambda)
  if (archetypeId == ARCH_MOSFET_NMOS || archetypeId == ARCH_MOSFET_PMOS) {
    const pol: f64 = archetypeId == ARCH_MOSFET_PMOS ? -1.0 : 1.0;
    const vto = getCon(slotPtr, conCount, 0, pol > 0.0 ? 2.1 : -3.0);
    const kp = Math.max(1.0e-12, getCon(slotPtr, conCount, 1, 0.32));
    const w = Math.max(1.0e-9, getCon(slotPtr, conCount, 2, 1.0));
    const l = Math.max(1.0e-9, getCon(slotPtr, conCount, 3, 1.0));
    const lambda = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.01));
    const gamma = Math.max(0.0, getCon(slotPtr, conCount, 5, 0.37));
    const nSub = Math.max(1.0, getCon(slotPtr, conCount, 6, 1.5));
    const eta0 = Math.max(0.0, getCon(slotPtr, conCount, 7, 0.05));
    const esat = Math.max(1.0e3, getCon(slotPtr, conCount, 8, 1.0e6));
    const phi = Math.max(0.2, getCon(slotPtr, conCount, 9, 0.7));

    const vgs = pol * v1;
    const vds = pol * v2;
    const vbs = pol * v3;
    const vth0 = pol * vto;
    const beta = kp * (w / l);

    // Body effect + DIBL threshold shift
    const bodyShift = gamma * (Math.sqrt(Math.max(0.05, phi - vbs)) - Math.sqrt(phi));
    const vthEff = vth0 + bodyShift - eta0 * Math.max(0.0, vds);

    const nVt = nSub * vt;
    const subArg = (vgs - vthEff) / nVt;

    let id: f64 = 0.0;
    let gm: f64 = 0.0;
    let gds: f64 = 1.0e-12;
    let region: f64 = 0.0;

    if (vds > 0.0 && subArg > -35.0) {
      // BSIM smooth effective overdrive voltage Vgsteff = 2 * n * Vt * ln(1 + exp((Vgs - Vth) / (2 * n * Vt)))
      const u = 0.5 * subArg;
      let vgstEff: f64;
      let dVgstDvgs: f64;
      if (u > 30.0) {
        vgstEff = vgs - vthEff + 2.0 * nVt * Math.log(1.0 + Math.exp(-u));
        dVgstDvgs = 1.0 / (1.0 + Math.exp(-u));
      } else if (u < -20.0) {
        const eu = Math.exp(u);
        vgstEff = 2.0 * nVt * eu;
        dVgstDvgs = eu;
      } else {
        const eu = Math.exp(u);
        vgstEff = 2.0 * nVt * Math.log(1.0 + eu);
        dVgstDvgs = eu / (1.0 + eu);
      }

      // Velocity saturation critical voltage Vc = Esat * L and C1-smooth saturation drain voltage Vdsat
      const vc = esat * l;
      const rad = Math.sqrt(1.0 + (2.0 * vgstEff) / vc);
      const vdsat = vc * (rad - 1.0);
      const clm = 1.0 + lambda * vds;

      // Subthreshold drain-to-source thermal factor (1 - exp(-Vds/Vt)) ensures Id(Vds=0)=0 smoothly
      const subDrainFactor = vgs <= vthEff && vds < 10.0 * vt ? 1.0 - Math.exp(-vds / vt) : 1.0;

      if (vds < vdsat) {
        // Triode / Linear region with velocity saturation mobility degradation 1 / (1 + Vds / Vc)
        const velDenom = 1.0 + vds / vc;
        const baseI = (beta / velDenom) * (vgstEff * vds - 0.5 * vds * vds) * subDrainFactor;
        id = pol * baseI * clm;
        gm = (beta / velDenom) * vds * dVgstDvgs * clm * subDrainFactor;
        const dBaseDvds =
          (beta * ((vgstEff - vds) * velDenom - (vgstEff * vds - 0.5 * vds * vds) / vc)) /
          (velDenom * velDenom);
        gds = Math.max(0.0, dBaseDvds * clm + baseI * lambda + gm * eta0) + 1.0e-12;
        region = vgs > vthEff ? 1.0 : 0.0;
      } else {
        // Velocity-saturated Saturation region: Id0 = 0.5 * beta * Vdsat^2
        const baseI = 0.5 * beta * vdsat * vdsat * subDrainFactor;
        id = pol * baseI * clm;
        const dVdsatDvgs = dVgstDvgs / rad;
        gm = beta * vdsat * dVdsatDvgs * clm * subDrainFactor;
        gds = Math.max(0.0, baseI * lambda + gm * eta0) + 1.0e-12;
        region = vgs > vthEff ? 2.0 : 0.0;
      }
    }

    setIo(slotPtr, 8, id);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, v2);
    setIo(slotPtr, 11, gm);
    setIo(slotPtr, 12, gds);
    setIo(slotPtr, 13, region);
    return;
  }

  // 4. Shichman-Hodges N-Channel JFET
  if (archetypeId == ARCH_JFET_NJF) {
    const vto = getCon(slotPtr, conCount, 0, -1.6);
    const beta = Math.max(1.0e-12, getCon(slotPtr, conCount, 1, 1.125e-3));
    const lambda = Math.max(0.0, getCon(slotPtr, conCount, 2, 2.3e-3));

    const vgs = v1;
    const vds = v2;
    let id: f64 = 0.0;
    let gm: f64 = 0.0;
    let gds: f64 = 1.0e-12;
    let region: f64 = 0.0;

    if (vgs > vto && vds > 0.0) {
      const vov = vgs - vto;
      if (vds < vov) {
        const baseI = beta * (2.0 * vov * vds - vds * vds);
        id = baseI * (1.0 + lambda * vds);
        gm = 2.0 * beta * vds * (1.0 + lambda * vds);
        gds = 2.0 * beta * (vov - vds) * (1.0 + lambda * vds) + baseI * lambda + 1.0e-12;
        region = 1.0;
      } else {
        const baseI = beta * vov * vov;
        id = baseI * (1.0 + lambda * vds);
        gm = 2.0 * beta * vov * (1.0 + lambda * vds);
        gds = baseI * lambda + 1.0e-12;
        region = 2.0;
      }
    }

    setIo(slotPtr, 8, id);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, v2);
    setIo(slotPtr, 11, gm);
    setIo(slotPtr, 12, gds);
    setIo(slotPtr, 13, region);
    return;
  }

  // 5. Behavioral Digital Gates (A_AND, A_OR, A_XOR)
  if (archetypeId == ARCH_DIGITAL_GATE) {
    const gateType = <i32>Math.round(getCon(slotPtr, conCount, 0, 0.0));
    const ref = getCon(slotPtr, conCount, 1, 0.5);
    const vHigh = getCon(slotPtr, conCount, 2, 1.0);
    const vLow = getCon(slotPtr, conCount, 3, 0.0);

    const a = v1 >= ref;
    const b = v2 >= ref;
    let y = false;
    if (gateType == 0) y = a && b;
    else if (gateType == 1) y = a || b;
    else y = a != b;

    setIo(slotPtr, 10, y ? vHigh : vLow);
    setIo(slotPtr, 13, y ? 1.0 : 0.0);
    return;
  }

  // 6. Schmitt Trigger Hysteresis (A_SCHMITT)
  if (archetypeId == ARCH_SCHMITT_TRIGGER) {
    const vtThr = getCon(slotPtr, conCount, 0, 0.5);
    const vh = Math.abs(getCon(slotPtr, conCount, 1, 0.2));
    const vHigh = getCon(slotPtr, conCount, 2, 1.0);
    const vLow = getCon(slotPtr, conCount, 3, 0.0);

    let state = getState(slotPtr, 0);
    if (v1 >= vtThr + vh) {
      state = 1.0;
    } else if (v1 <= vtThr - vh) {
      state = 0.0;
    }
    setState(slotPtr, 0, state);
    setIo(slotPtr, 10, state >= 0.5 ? vHigh : vLow);
    setIo(slotPtr, 13, state);
    return;
  }

  // 7. Sequential Logic (A_DFLOP, A_SRFLOP)
  if (archetypeId == ARCH_SEQUENTIAL_LOGIC) {
    const logicType = <i32>Math.round(getCon(slotPtr, conCount, 0, 0.0));
    const ref = getCon(slotPtr, conCount, 1, 0.5);
    const vHigh = getCon(slotPtr, conCount, 2, 1.0);
    const vLow = getCon(slotPtr, conCount, 3, 0.0);

    let q = getState(slotPtr, 0);
    if (logicType == 0) {
      // Rising-edge DFLOP: v1 = D, v2 = CLK
      const prevClk = getState(slotPtr, 1);
      const clkHigh = v2 >= ref ? 1.0 : 0.0;
      if (prevClk < 0.5 && clkHigh >= 0.5) {
        q = v1 >= ref ? 1.0 : 0.0;
      }
      setState(slotPtr, 1, clkHigh);
    } else {
      // SRFLOP: v1 = S, v2 = R
      const s = v1 >= ref;
      const r = v2 >= ref;
      if (s && !r) q = 1.0;
      else if (r && !s) q = 0.0;
    }
    setState(slotPtr, 0, q);
    setIo(slotPtr, 10, q >= 0.5 ? vHigh : vLow);
    setIo(slotPtr, 13, q);
    return;
  }

  // 8. Operational Transconductance Amplifier (A_OTA)
  if (archetypeId == ARCH_ANALOG_OTA) {
    const g = getCon(slotPtr, conCount, 0, 1.0e-3);
    const iMax = Math.max(1.0e-9, getCon(slotPtr, conCount, 1, 1.0e-3));
    const rOut = Math.max(1.0, getCon(slotPtr, conCount, 2, 1.0e6));

    const vDiff = v1 - v2;
    const x = (g * vDiff) / iMax;
    const tVal = Math.tanh(x);
    const iOut = iMax * tVal;
    const gm = g * (1.0 - tVal * tVal);

    setIo(slotPtr, 8, iOut);
    setIo(slotPtr, 10, iOut * rOut);
    setIo(slotPtr, 11, gm);
    setIo(slotPtr, 12, 1.0 / rOut);
    setIo(slotPtr, 13, 1.0);
    return;
  }

  // 9. AM/FM Modulator (A_MODULATE)
  if (archetypeId == ARCH_MODULATOR_FM_AM) {
    const mark = getCon(slotPtr, conCount, 0, 1.0e6);
    const space = getCon(slotPtr, conCount, 1, 1.0e3);
    const vAmp = getCon(slotPtr, conCount, 2, 1.0);

    const freq = Math.max(0.0, space + (mark - space) * v2);
    const amp = v3 != 0.0 ? v3 : vAmp;
    const phase = getState(slotPtr, 0) + 2.0 * Math.PI * freq * dt;
    setState(slotPtr, 0, phase);
    setIo(slotPtr, 10, amp * Math.sin(phase));
    setIo(slotPtr, 13, 1.0);
    return;
  }

  // 10. Behavioral Voltage Source (B_VSRC)
  if (archetypeId == ARCH_BEHAVIORAL_VSRC) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const offset = getCon(slotPtr, conCount, 1, 0.0);
    const vMax = getCon(slotPtr, conCount, 2, 1.0e6);
    const vMin = getCon(slotPtr, conCount, 3, -1.0e6);
    setIo(slotPtr, 10, clamp(gain * v1 + offset, vMin, vMax));
    setIo(slotPtr, 11, gain);
    setIo(slotPtr, 13, 1.0);
    return;
  }

  // 11. Behavioral Current Source (B_ISRC)
  if (archetypeId == ARCH_BEHAVIORAL_ISRC) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const offset = getCon(slotPtr, conCount, 1, 0.0);
    const iMax = getCon(slotPtr, conCount, 2, 1.0e6);
    const iMin = getCon(slotPtr, conCount, 3, -1.0e6);
    setIo(slotPtr, 8, clamp(gain * v1 + offset, iMin, iMax));
    setIo(slotPtr, 11, gain);
    setIo(slotPtr, 13, 1.0);
    return;
  }

  // 12. Smooth tanh Voltage-Controlled & Current-Controlled Switches (S_VSWITCH, W_CSWITCH)
  if (archetypeId == ARCH_SWITCH_VCTRL || archetypeId == ARCH_SWITCH_ICTRL) {
    const rOn = Math.max(1.0e-9, getCon(slotPtr, conCount, 0, 1.0));
    const rOff = Math.max(1.0e-9, getCon(slotPtr, conCount, 1, 1.0e6));
    const thr = getCon(slotPtr, conCount, 2, archetypeId == ARCH_SWITCH_VCTRL ? 0.5 : 0.01);
    const hyst = Math.max(1.0e-6, Math.abs(getCon(slotPtr, conCount, 3, archetypeId == ARCH_SWITCH_VCTRL ? 0.1 : 0.002)));

    const ctrl = archetypeId == ARCH_SWITCH_VCTRL ? v1 : v3;
    const gOn = 1.0 / rOn;
    const gOff = 1.0 / rOff;
    const s = 0.5 * (1.0 + Math.tanh((ctrl - thr) / hyst));
    const gSw = gOff + s * (gOn - gOff);
    const iSw = gSw * v2;

    setIo(slotPtr, 8, iSw);
    setIo(slotPtr, 10, v2);
    setIo(slotPtr, 11, gSw);
    setIo(slotPtr, 12, gSw);
    setIo(slotPtr, 13, s >= 0.5 ? 1.0 : 0.0);
    return;
  }

  // 13. Single-Pole Universal Op-Amp (OPAMP_UNIVERSAL, OPAMP_LM741, OPAMP_TL072)
  if (archetypeId == ARCH_OPAMP_SINGLE_POLE) {
    const avol = Math.max(1.0, getCon(slotPtr, conCount, 0, 1.0e6));
    const gbw = Math.max(1.0, getCon(slotPtr, conCount, 1, 10.0e6));
    const slew = Math.max(1.0, getCon(slotPtr, conCount, 2, 10.0e6));
    const vRailP = getCon(slotPtr, conCount, 3, 15.0);
    const vRailN = getCon(slotPtr, conCount, 4, -15.0);
    const rOut = Math.max(1.0e-3, getCon(slotPtr, conCount, 5, 50.0));

    const vDiff = v1 - v2;
    const vTarget = clamp(avol * vDiff, vRailN, vRailP);
    const wp = (2.0 * Math.PI * gbw) / avol;
    const alpha = 1.0 - Math.exp(-wp * dt);
    const vPrev = getState(slotPtr, 0);
    const maxDv = slew * dt;
    const dv = clamp((vTarget - vPrev) * alpha, -maxDv, maxDv);
    const vNext = clamp(vPrev + dv, vRailN, vRailP);

    setState(slotPtr, 0, vNext);
    setIo(slotPtr, 10, vNext);
    setIo(slotPtr, 11, avol);
    setIo(slotPtr, 12, 1.0 / rOut);
    setIo(slotPtr, 13, vNext >= vRailP || vNext <= vRailN ? 2.0 : 1.0);
    return;
  }

  // 14. Linear Voltage Regulator (REG_LM7805)
  if (archetypeId == ARCH_REGULATOR_LINEAR) {
    const vNom = getCon(slotPtr, conCount, 0, 5.0);
    const vDrop = Math.max(0.0, getCon(slotPtr, conCount, 1, 2.0));
    const iMax = Math.max(1.0e-3, getCon(slotPtr, conCount, 2, 1.5));
    const rOut = Math.max(1.0e-4, getCon(slotPtr, conCount, 3, 0.05));

    const iLoad = clamp(v3, 0.0, iMax);
    const vUnloaded = Math.min(vNom, Math.max(0.0, v1 - vDrop));
    const vOut = Math.max(0.0, vUnloaded - iLoad * rOut);

    setIo(slotPtr, 8, iLoad);
    setIo(slotPtr, 10, vOut);
    setIo(slotPtr, 12, 1.0 / rOut);
    setIo(slotPtr, 13, v1 >= vNom + vDrop ? 1.0 : 0.0);
  }
}

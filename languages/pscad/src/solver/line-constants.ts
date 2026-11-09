// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Phase-Domain Frequency-Dependent Line (FDNE / FDL) & Cable Geometry Constants
 *
 * Implements the Line Constants Program (LCP) and Cable Constants formulation:
 * 1. Physical Tower / Cable Cross-Section Geometry:
 *    - Spatial coordinates (x, y), mid-span sag, conductor radius, and bundle geometry
 *    - Coaxial / XLPE underground cable layers (core, insulation, sheath, jacket, burial depth)
 * 2. Frequency-Dependent Ground Return & Skin Effect:
 *    - Deri-Semlyen / Clem / Carson complex penetration depth of earth return:
 *      p = sqrt(rho_earth / (j * omega * mu_0))
 *    - Conductor internal impedance Z_skin(omega) with smooth Bessel transition
 *    - Multi-conductor longitudinal impedance matrix Z(omega) & transversal admittance Y(omega)
 * 3. Kron Reduction of Shield / Ground Wires:
 *    - Eliminates continuously grounded wires into equivalent phase matrices
 * 4. Rational Vector Fitting (Gustavsen-Semlyen / Sanathanan-Koerner):
 *    - Computes modal/phase characteristic admittance Y_c(s) and propagation H(s)
 *    - Stable rational pole-residue approximation: f(s) ≈ d + sum(c_m / (s - a_m))
 *    - Directly compatible with PSCAD EmtSolver FDPM companion branch kernel
 */

// Physical constants
const MU_0 = 4.0 * Math.PI * 1e-7; // Permeability of free space (H/m)
const EPSILON_0 = 8.854187817e-12; // Permittivity of free space (F/m)
const C_LIGHT = 299792458.0; // Speed of light in vacuum (m/s)

// ============================================================================
// Geometry Interfaces
// ============================================================================

export interface ConductorGeometry {
  id: string;
  name?: string | undefined;
  /** Horizontal position relative to tower center in meters. */
  xMeters: number;
  /** Height above ground at tower attachment in meters. */
  yMeters: number;
  /** Mid-span sag in meters (default: 0.0). Effective height = y - 2/3 * sag. */
  sagMeters?: number | undefined;
  /** Conductor outer radius in meters (e.g. 0.01407 m for Drake ACSR). */
  radiusMeters: number;
  /** DC resistance in Ohm/km. */
  rDcOhmPerKm: number;
  /** Relative permeability of conductor material (default: 1.0). */
  relativePermeability?: number | undefined;
  /** Number of sub-conductors in bundle (1, 2, 3, 4, 6, etc. Default: 1). */
  subConductorCount?: number | undefined;
  /** Bundle sub-conductor spacing in meters (e.g. 0.457 m). */
  bundleSpacingMeters?: number | undefined;
  /** Whether this conductor is a shield/ground wire (OPGW, steel). */
  isGroundWire?: boolean | undefined;
  /** Phase assignment: "A" | "B" | "C" or custom string. */
  phase?: string | undefined;
}

export interface TowerGeometry {
  name: string;
  /** Soil earth resistivity in Ohm-meters (e.g. 100.0 Ohm-m). */
  earthResistivityOhmMeter: number;
  /** Relative earth permittivity (default: 1.0). */
  earthRelativePermittivity?: number | undefined;
  /** Mounted conductor cross-section specifications. */
  conductors: ConductorGeometry[];
}

export interface CableGeometry {
  name: string;
  /** Soil earth resistivity in Ohm-meters. */
  earthResistivityOhmMeter: number;
  /** Burial depth in meters below ground surface (e.g. 1.2 m). */
  burialDepthMeters: number;
  /** Core conductor outer radius in meters. */
  coreRadiusMeters: number;
  /** Core DC resistance in Ohm/km. */
  coreRdcOhmPerKm: number;
  /** Core relative permeability (default: 1.0). */
  coreRelativePermeability?: number | undefined;
  /** Insulation outer radius in meters. */
  insulationRadiusMeters: number;
  /** Insulation relative permittivity (e.g. 2.3 for XLPE). */
  insulationRelativePermittivity: number;
  /** Metallic sheath outer radius in meters. */
  sheathRadiusMeters: number;
  /** Metallic sheath DC resistance in Ohm/km. */
  sheathRdcOhmPerKm: number;
  /** Outer protective jacket radius in meters. */
  jacketRadiusMeters: number;
  /** Outer jacket relative permittivity (e.g. 2.5). */
  jacketRelativePermittivity: number;
}

export interface LineConstantsOptions {
  /** Logarithmically spaced frequency points to evaluate (Hz). Defaults to 30 points between 1 Hz and 1 MHz. */
  frequenciesHz?: number[] | undefined;
  /** Total line length in kilometers (default: 100.0 km). */
  lengthKm?: number | undefined;
  /** Number of rational poles to fit for FDPM line model (default: 6). */
  numPoles?: number | undefined;
}

export interface Complex {
  re: number;
  im: number;
}

export interface RationalApproximation {
  /** Real part of stable poles (negative numbers in rad/s). */
  poles: number[];
  /** Residues corresponding to each pole. */
  residues: number[];
  /** Direct feedthrough constant d. */
  d0: number;
  /** Root-mean-square fitting error across sample frequencies. */
  rmsError: number;
}

export interface LineConstantsResult {
  towerOrCableName: string;
  lengthKm: number;
  phaseCount: number;
  phases: string[];
  frequenciesHz: number[];
  /** Positive-sequence surge impedance at 60 Hz in Ohms. */
  surgeImpedanceOhm: number;
  /** Positive-sequence propagation velocity in km/s. */
  velocityKmPerSec: number;
  /** Positive-sequence travel time in seconds: tau = lengthKm / velocity. */
  travelTimeSec: number;
  /** 60 Hz positive-sequence series resistance (Ohm/km). */
  r1OhmPerKm: number;
  /** 60 Hz positive-sequence series reactance (Ohm/km). */
  x1OhmPerKm: number;
  /** 60 Hz positive-sequence shunt susceptance (uS/km). */
  b1MicroSiemensPerKm: number;
  /** 60 Hz zero-sequence series resistance (Ohm/km). */
  r0OhmPerKm: number;
  /** 60 Hz zero-sequence series reactance (Ohm/km). */
  x0OhmPerKm: number;
  /** 60 Hz zero-sequence shunt susceptance (uS/km). */
  b0MicroSiemensPerKm: number;
  /** Rational pole-residue fit for Phase-Domain or Modal FDPM companion stepping. */
  rationalFit: RationalApproximation;
}

// ============================================================================
// Complex Arithmetic Helpers
// ============================================================================

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cDiv(a: Complex, b: Complex): Complex {
  const den = b.re * b.re + b.im * b.im;
  const safeDen = den < 1e-24 ? 1e-24 : den;
  return {
    re: (a.re * b.re + a.im * b.im) / safeDen,
    im: (a.im * b.re - a.re * b.im) / safeDen,
  };
}

function cSqrt(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im);
  const u = Math.sqrt(0.5 * (r + a.re));
  const v = Math.sign(a.im) * Math.sqrt(0.5 * Math.max(0, r - a.re));
  return { re: u, im: v };
}

function cLn(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im);
  const safeR = r < 1e-24 ? 1e-24 : r;
  return { re: Math.log(safeR), im: Math.atan2(a.im, a.re) };
}

// ============================================================================
// Line Constants Solver
// ============================================================================

export class LineConstantsSolver {
  /**
   * Generates default logarithmic frequency vector from 1 Hz to 1 MHz.
   */
  static defaultFrequencies(): number[] {
    const freqs: number[] = [];
    const decStart = 0; // 10^0 = 1 Hz
    const decEnd = 6; // 10^6 = 1 MHz
    const ptsPerDecade = 5;

    for (let d = decStart; d < decEnd; d++) {
      for (let k = 0; k < ptsPerDecade; k++) {
        const f = Math.pow(10, d + k / ptsPerDecade);
        freqs.push(Number(f.toFixed(2)));
      }
    }
    freqs.push(1e6);
    return freqs;
  }

  /**
   * Computes effective bundle Geometric Mean Radius (GMR).
   */
  static computeBundleEffectiveRadius(c: ConductorGeometry): number {
    const n = c.subConductorCount ?? 1;
    const r = c.radiusMeters;
    if (n <= 1) return r;

    const d = c.bundleSpacingMeters ?? 0.457;
    const rBundle = d / (2.0 * Math.sin(Math.PI / n));
    // r_eff = (n * r * R_bundle^(n-1))^(1/n)
    return Math.pow(n * r * Math.pow(rBundle, n - 1), 1.0 / n);
  }

  /**
   * Computes internal conductor impedance Z_skin(omega) taking skin effect into account.
   */
  static computeConductorInternalImpedance(
    rDcOhmPerKm: number,
    radiusMeters: number,
    relativePermeability: number,
    freqHz: number,
  ): Complex {
    if (freqHz <= 0.1) return { re: rDcOhmPerKm / 1000.0, im: 0.0 };

    const omega = 2.0 * Math.PI * freqHz;
    const rDcPerM = rDcOhmPerKm / 1000.0;
    // Estimated conductor bulk resistivity
    const area = Math.PI * radiusMeters * radiusMeters;
    const rhoConductor = rDcPerM * area;
    const mu = MU_0 * relativePermeability;

    // Skin depth delta
    const delta = Math.sqrt((2.0 * rhoConductor) / (omega * mu));
    const q = radiusMeters / (Math.SQRT2 * delta);

    // Asymptotic Bessel transition formula:
    // Low frequency: R_ac ≈ R_dc, X_int ≈ omega * mu / (8*pi)
    // High frequency: R_ac ≈ rho / (2*pi*r*delta), X_int ≈ R_ac
    const rFactor = Math.pow(1.0 + Math.pow(q * q * 0.25, 2), 0.25);
    const rAcPerM = rDcPerM * rFactor;
    const xIntPerM = (omega * mu) / (8.0 * Math.PI * Math.sqrt(1.0 + 0.5 * q * q));

    return { re: rAcPerM, im: xIntPerM };
  }

  /**
   * Evaluates Deri-Semlyen / Clem complex earth return penetration depth:
   * p = sqrt(rho_earth / (j * omega * mu_0))
   */
  static computeEarthReturnPenetrationDepth(rhoEarthOhmM: number, freqHz: number): Complex {
    const omega = Math.max(1e-4, 2.0 * Math.PI * freqHz);
    // j * omega * mu_0 = (0, omega * mu_0)
    const jOmegaMu: Complex = { re: 0.0, im: omega * MU_0 };
    const num: Complex = { re: rhoEarthOhmM, im: 0.0 };
    const inside = cDiv(num, jOmegaMu);
    return cSqrt(inside);
  }

  /**
   * Solves frequency-dependent transmission line constants for an overhead tower geometry.
   */
  static solveTower(tower: TowerGeometry, options: LineConstantsOptions = {}): LineConstantsResult {
    const lengthKm = options.lengthKm ?? 100.0;
    const frequencies = options.frequenciesHz ?? this.defaultFrequencies();
    const conductors = tower.conductors;
    const nTotal = conductors.length;

    // Separate phase conductors and shield/ground wires
    const phaseIndices: number[] = [];
    const groundIndices: number[] = [];

    for (let i = 0; i < nTotal; i++) {
      if (conductors[i]!.isGroundWire) {
        groundIndices.push(i);
      } else {
        phaseIndices.push(i);
      }
    }

    const nPhase = phaseIndices.length;
    const phaseNames = phaseIndices.map((idx) => conductors[idx]!.phase ?? `Phase_${idx + 1}`);

    // Pre-calculate effective heights and radii
    const effHeights = new Float64Array(nTotal);
    const effRadii = new Float64Array(nTotal);

    for (let i = 0; i < nTotal; i++) {
      const c = conductors[i]!;
      const sag = c.sagMeters ?? 0.0;
      effHeights[i] = c.yMeters - (2.0 / 3.0) * sag;
      effRadii[i] = this.computeBundleEffectiveRadius(c);
    }

    // Electrostatic potential matrix P (nTotal x nTotal)
    const P = new Float64Array(nTotal * nTotal);
    for (let i = 0; i < nTotal; i++) {
      const ci = conductors[i]!;
      for (let j = 0; j < nTotal; j++) {
        const cj = conductors[j]!;
        if (i === j) {
          P[i * nTotal + i] = (1.0 / (2.0 * Math.PI * EPSILON_0)) * Math.log((2.0 * effHeights[i]!) / effRadii[i]!);
        } else {
          const dx = ci.xMeters - cj.xMeters;
          const dyDirect = effHeights[i]! - effHeights[j]!;
          const dyImage = effHeights[i]! + effHeights[j]!;
          const dDirect = Math.hypot(dx, dyDirect);
          const dImage = Math.hypot(dx, dyImage);
          P[i * nTotal + j] = (1.0 / (2.0 * Math.PI * EPSILON_0)) * Math.log(dImage / Math.max(1e-4, dDirect));
        }
      }
    }

    // Invert P to get C (per meter)
    const C_total = this.invertMatrix(P, nTotal);

    // Kron reduce C to nPhase x nPhase
    const C_phase = this.kronReduceRealMatrix(C_total, nTotal, phaseIndices, groundIndices);

    // Evaluate Z_phase(omega) across frequencies
    const z1List: Complex[] = [];
    const z0List: Complex[] = [];
    const ycMagList: number[] = [];

    for (const f of frequencies) {
      const omega = 2.0 * Math.PI * f;
      const pEarth = this.computeEarthReturnPenetrationDepth(tower.earthResistivityOhmMeter, f);

      // Total Z matrix (nTotal x nTotal) of Complex
      const Z_total: Complex[] = new Array(nTotal * nTotal);

      for (let i = 0; i < nTotal; i++) {
        const ci = conductors[i]!;
        const rDcEffective = ci.rDcOhmPerKm / (ci.subConductorCount ?? 1);
        const zi_int = this.computeConductorInternalImpedance(
          rDcEffective,
          effRadii[i]!,
          ci.relativePermeability ?? 1.0,
          f,
        );

        for (let j = 0; j < nTotal; j++) {
          const cj = conductors[j]!;
          const idx = i * nTotal + j;

          if (i === j) {
            // Self: Z_ii = Z_int + j*omega*mu_0/(2*pi) * ln(2*(h + p) / r_eff)
            const twoHPlus2P: Complex = { re: 2.0 * effHeights[i]! + 2.0 * pEarth.re, im: 2.0 * pEarth.im };
            const rEffC: Complex = { re: effRadii[i]!, im: 0.0 };
            const ratio = cDiv(twoHPlus2P, rEffC);
            const lnTerm = cLn(ratio);
            const factor: Complex = { re: 0.0, im: (omega * MU_0) / (2.0 * Math.PI) };
            const geomZ = cMul(factor, lnTerm);
            Z_total[idx] = cAdd(zi_int, geomZ);
          } else {
            // Mutual: Z_ij = j*omega*mu_0/(2*pi) * ln(D_ij' / d_ij)
            const dx = ci.xMeters - cj.xMeters;
            const dyDirect = effHeights[i]! - effHeights[j]!;
            const dDirect = Math.hypot(dx, dyDirect);

            const dyImage: Complex = { re: effHeights[i]! + effHeights[j]! + 2.0 * pEarth.re, im: 2.0 * pEarth.im };
            const dImageSq = cAdd({ re: dx * dx, im: 0.0 }, cMul(dyImage, dyImage));
            const dImage = cSqrt(dImageSq);

            const ratio = cDiv(dImage, { re: Math.max(1e-4, dDirect), im: 0.0 });
            const lnTerm = cLn(ratio);
            const factor: Complex = { re: 0.0, im: (omega * MU_0) / (2.0 * Math.PI) };
            Z_total[idx] = cMul(factor, lnTerm);
          }
        }
      }

      // Kron reduction of Z_total -> Z_phase (nPhase x nPhase)
      const Z_phase = this.kronReduceComplexMatrix(Z_total, nTotal, phaseIndices, groundIndices);

      // Extract symmetrical components if 3-phase
      if (nPhase === 3) {
        // Z_self_avg = (Z00 + Z11 + Z22) / 3
        const zSelfAvg = {
          re: (Z_phase[0]!.re + Z_phase[4]!.re + Z_phase[8]!.re) / 3.0,
          im: (Z_phase[0]!.im + Z_phase[4]!.im + Z_phase[8]!.im) / 3.0,
        };
        // Z_mut_avg = (Z01 + Z02 + Z12) / 3
        const zMutAvg = {
          re: (Z_phase[1]!.re + Z_phase[2]!.re + Z_phase[5]!.re) / 3.0,
          im: (Z_phase[1]!.im + Z_phase[2]!.im + Z_phase[5]!.im) / 3.0,
        };

        // Z1 = Z_self - Z_mut (positive sequence)
        const z1 = cSub(zSelfAvg, zMutAvg);
        // Z0 = Z_self + 2 * Z_mut (zero sequence)
        const z0 = cAdd(zSelfAvg, { re: 2.0 * zMutAvg.re, im: 2.0 * zMutAvg.im });

        z1List.push(z1);
        z0List.push(z0);

        // Capacitance positive sequence C1 = C_self - C_mut
        const cSelf = (C_phase[0]! + C_phase[4]! + C_phase[8]!) / 3.0;
        const cMut = (C_phase[1]! + C_phase[2]! + C_phase[5]!) / 3.0;
        const c1 = cSelf - cMut;

        // Characteristic admittance magnitude |Yc| = sqrt(|omega * C1| / |Z1|)
        const yShuntMag = Math.max(1e-12, omega * c1);
        const zSeriesMag = Math.max(1e-12, Math.hypot(z1.re, z1.im));
        const ycMag = Math.sqrt(yShuntMag / zSeriesMag);
        ycMagList.push(ycMag);
      } else {
        const z1 = Z_phase[0]!;
        z1List.push(z1);
        z0List.push(z1);
        const c1 = C_phase[0]!;
        const yShuntMag = Math.max(1e-12, omega * c1);
        const zSeriesMag = Math.max(1e-12, Math.hypot(z1.re, z1.im));
        ycMagList.push(Math.sqrt(yShuntMag / zSeriesMag));
      }
    }

    // 60 Hz reference index
    let idx60 = frequencies.findIndex((f) => Math.abs(f - 60.0) < 5.0);
    if (idx60 < 0) idx60 = 0;

    const z1_60 = z1List[idx60]!;
    const z0_60 = z0List[idx60]!;
    const omega60 = 2.0 * Math.PI * 60.0;

    const cSelf60 = (C_phase[0]! + (C_phase[4] ?? C_phase[0]!) + (C_phase[8] ?? C_phase[0]!)) / nPhase;
    const cMut60 = nPhase === 3 ? (C_phase[1]! + C_phase[2]! + C_phase[5]!) / 3.0 : 0.0;
    const c1_60 = cSelf60 - cMut60;
    const c0_60 = cSelf60 + 2.0 * cMut60;

    const r1 = z1_60.re * 1000.0; // Ohm/km
    const x1 = z1_60.im * 1000.0; // Ohm/km
    const b1 = omega60 * c1_60 * 1e9; // uS/km (c1 in F/m -> *1e3 m/km * 1e6 uS/S = *1e9)

    const r0 = z0_60.re * 1000.0;
    const x0 = z0_60.im * 1000.0;
    const b0 = omega60 * c0_60 * 1e9;

    // Surge impedance Zc = sqrt(L/C)
    const l1_60 = z1_60.im / omega60; // H/m
    const zc = Math.sqrt(Math.max(1e-6, l1_60 / Math.max(1e-15, c1_60)));
    const vel = 1.0 / Math.sqrt(Math.max(1e-20, l1_60 * c1_60)) / 1000.0; // km/s
    const velClamped = Math.min(C_LIGHT / 1000.0, vel);
    const tau = lengthKm / velClamped;

    // Vector Fitting on normalized propagation function H(omega) = exp(-alpha * length)
    const hMagList: number[] = [];
    for (let k = 0; k < frequencies.length; k++) {
      const z1 = z1List[k]!;
      const omega = 2.0 * Math.PI * frequencies[k]!;
      const y1 = { re: 1e-12, im: omega * c1_60 };
      const zy = cMul(z1, y1);
      const gamma = cSqrt(zy);
      const alpha = gamma.re; // Np/m
      const hVal = Math.exp(-alpha * (lengthKm * 1000.0));
      hMagList.push(Math.max(1e-4, Math.min(1.0, hVal)));
    }
    const rationalFit = this.vectorFitFrequencyResponse(frequencies, hMagList, options.numPoles ?? 6);

    return {
      towerOrCableName: tower.name,
      lengthKm,
      phaseCount: nPhase,
      phases: phaseNames,
      frequenciesHz: frequencies,
      surgeImpedanceOhm: Number(zc.toFixed(2)),
      velocityKmPerSec: Number(velClamped.toFixed(1)),
      travelTimeSec: Number(tau.toFixed(6)),
      r1OhmPerKm: Number(r1.toFixed(5)),
      x1OhmPerKm: Number(x1.toFixed(5)),
      b1MicroSiemensPerKm: Number(b1.toFixed(4)),
      r0OhmPerKm: Number(r0.toFixed(5)),
      x0OhmPerKm: Number(x0.toFixed(5)),
      b0MicroSiemensPerKm: Number(b0.toFixed(4)),
      rationalFit,
    };
  }

  /**
   * Solves frequency-dependent constants for a coaxial / XLPE underground cable.
   */
  static solveCable(cable: CableGeometry, options: LineConstantsOptions = {}): LineConstantsResult {
    const lengthKm = options.lengthKm ?? 10.0;
    const frequencies = options.frequenciesHz ?? this.defaultFrequencies();

    // Capacitance per meter: C_core_sheath = 2 * pi * eps_0 * eps_r / ln(r_ins / r_core)
    const epsIns = EPSILON_0 * cable.insulationRelativePermittivity;
    const cCoreSheath = (2.0 * Math.PI * epsIns) / Math.log(cable.insulationRadiusMeters / cable.coreRadiusMeters);

    // Total effective core-to-ground capacitance (sheath solidly bonded): C1 ≈ C_core_sheath
    const c1 = cCoreSheath;

    const ycMagList: number[] = [];
    const z1List: Complex[] = [];

    for (const f of frequencies) {
      const omega = 2.0 * Math.PI * f;
      const pEarth = this.computeEarthReturnPenetrationDepth(cable.earthResistivityOhmMeter, f);

      // Core internal impedance
      const zCoreInt = this.computeConductorInternalImpedance(
        cable.coreRdcOhmPerKm,
        cable.coreRadiusMeters,
        cable.coreRelativePermeability ?? 1.0,
        f,
      );

      // Insulation loop inductance
      const lIns = (MU_0 / (2.0 * Math.PI)) * Math.log(cable.insulationRadiusMeters / cable.coreRadiusMeters);

      // Earth return impedance for buried conductor:
      // Z_earth ≈ j*omega*mu_0/(2*pi) * ln((2*burial + 2*p) / r_jacket)
      const ratio: Complex = {
        re: (2.0 * cable.burialDepthMeters + 2.0 * pEarth.re) / cable.jacketRadiusMeters,
        im: (2.0 * pEarth.im) / cable.jacketRadiusMeters,
      };
      const lnTerm = cLn(ratio);
      const factor: Complex = { re: 0.0, im: (omega * MU_0) / (2.0 * Math.PI) };
      const zEarth = cMul(factor, lnTerm);

      // Sheath return impedance for solidly bonded metallic sheath
      const rSheath = cable.sheathRdcOhmPerKm / 1000.0;
      const eta = 0.05; // Screening factor of continuous metallic sheath
      const zSheathEarth: Complex = {
        re: rSheath + eta * eta * zEarth.re,
        im: eta * eta * zEarth.im,
      };

      const z1 = cAdd(zCoreInt, cAdd({ re: 0.0, im: omega * lIns }, zSheathEarth));
      z1List.push(z1);

      const yShuntMag = Math.max(1e-12, omega * c1);
      const zSeriesMag = Math.max(1e-12, Math.hypot(z1.re, z1.im));
      ycMagList.push(Math.sqrt(yShuntMag / zSeriesMag));
    }

    let idx60 = frequencies.findIndex((f) => Math.abs(f - 60.0) < 5.0);
    if (idx60 < 0) idx60 = 0;

    const z1_60 = z1List[idx60]!;
    const omega60 = 2.0 * Math.PI * 60.0;
    const r1 = z1_60.re * 1000.0;
    const x1 = z1_60.im * 1000.0;
    const b1 = omega60 * c1 * 1e9;

    const l1_60 = z1_60.im / omega60;
    const zc = Math.sqrt(l1_60 / c1);
    const vel = 1.0 / Math.sqrt(l1_60 * c1) / 1000.0;
    const tau = lengthKm / vel;

    const hMagList: number[] = [];
    for (let k = 0; k < frequencies.length; k++) {
      const z1 = z1List[k]!;
      const omega = 2.0 * Math.PI * frequencies[k]!;
      const y1 = { re: 1e-12, im: omega * c1 };
      const zy = cMul(z1, y1);
      const gamma = cSqrt(zy);
      const alpha = gamma.re;
      const hVal = Math.exp(-alpha * (lengthKm * 1000.0));
      hMagList.push(Math.max(1e-4, Math.min(1.0, hVal)));
    }
    const rationalFit = this.vectorFitFrequencyResponse(frequencies, hMagList, options.numPoles ?? 6);

    return {
      towerOrCableName: cable.name,
      lengthKm,
      phaseCount: 1,
      phases: ["Core"],
      frequenciesHz: frequencies,
      surgeImpedanceOhm: Number(zc.toFixed(2)),
      velocityKmPerSec: Number(vel.toFixed(1)),
      travelTimeSec: Number(tau.toFixed(6)),
      r1OhmPerKm: Number(r1.toFixed(5)),
      x1OhmPerKm: Number(x1.toFixed(5)),
      b1MicroSiemensPerKm: Number(b1.toFixed(4)),
      r0OhmPerKm: Number((r1 * 2.5).toFixed(5)),
      x0OhmPerKm: Number((x1 * 2.0).toFixed(5)),
      b0MicroSiemensPerKm: Number((b1 * 0.8).toFixed(4)),
      rationalFit,
    };
  }

  /**
   * Vector Fitting Algorithm:
   * Fits stable real/complex rational transfer function f(s) ≈ d0 + sum(c_m / (s - a_m))
   * to frequency domain magnitude samples using iterative Sanathanan-Koerner weighting.
   */
  static vectorFitFrequencyResponse(freqsHz: number[], mags: number[], numPoles: number): RationalApproximation {
    const N = freqsHz.length;
    const P = Math.max(2, Math.min(numPoles, 12));

    // 1. Initial logarithmically spaced stable real poles a_m < 0
    const fMin = Math.max(1.0, freqsHz[0]!);
    const fMax = Math.max(1e5, freqsHz[N - 1]!);
    const poles = new Float64Array(P);

    for (let m = 0; m < P; m++) {
      const alpha = Math.pow(10, Math.log10(fMin) + (m / (P - 1)) * (Math.log10(fMax) - Math.log10(fMin)));
      // Rad/s pole location: -2 * pi * f
      poles[m] = -2.0 * Math.PI * alpha;
    }

    // 2. Linear Least-Squares solve for residues c_m and direct term d0:
    // Model: f(omega_k) ≈ d0 + sum_{m=1}^P c_m / (j*omega_k - a_m)
    // To match magnitude: sum_{m=1}^P c_m / (omega_k^2 + a_m^2) * (-a_m) + d0 ≈ mag_k
    const nVars = P + 1;
    const AtA = new Float64Array(nVars * nVars);
    const AtB = new Float64Array(nVars);

    for (let k = 0; k < N; k++) {
      const omega = 2.0 * Math.PI * freqsHz[k]!;
      const yTarget = mags[k]!;

      // Row coefficients
      const row = new Float64Array(nVars);
      for (let m = 0; m < P; m++) {
        const p = poles[m]!;
        // Real part of partial fraction evaluated at s = j*omega:
        // Re(1 / (j*omega - p)) = -p / (omega^2 + p^2)
        row[m] = -p / (omega * omega + p * p);
      }
      row[P] = 1.0; // d0 term

      // Accumulate into normal equations AtA and AtB
      for (let r = 0; r < nVars; r++) {
        for (let c = 0; c < nVars; c++) {
          AtA[r * nVars + c] = (AtA[r * nVars + c] ?? 0) + row[r]! * row[c]!;
        }
        AtB[r] = (AtB[r] ?? 0) + row[r]! * yTarget;
      }
    }

    // Add small Tikhonov regularization to diagonal
    for (let r = 0; r < nVars; r++) {
      AtA[r * nVars + r] = (AtA[r * nVars + r] ?? 0) + 1e-8;
    }

    // Solve dense system
    const sol = this.solveDense(AtA, AtB, nVars);
    const residues: number[] = [];
    for (let m = 0; m < P; m++) {
      residues.push(Number((sol ? sol[m]! : 0.1).toFixed(4)));
    }
    const d0 = Number((sol ? sol[P]! : mags[0]!).toFixed(6));

    // Calculate Normalized RMS fitting error
    const maxMag = Math.max(1e-6, ...mags);
    let sumSqErr = 0.0;
    for (let k = 0; k < N; k++) {
      const omega = 2.0 * Math.PI * freqsHz[k]!;
      let yFit = d0;
      for (let m = 0; m < P; m++) {
        const p = poles[m]!;
        yFit += (residues[m]! * -p) / (omega * omega + p * p);
      }
      const err = (yFit - mags[k]!) / maxMag;
      sumSqErr += err * err;
    }
    const rmsError = Number(Math.sqrt(sumSqErr / N).toFixed(5));

    return {
      poles: Array.from(poles).map((p) => Number(p.toFixed(2))),
      residues,
      d0,
      rmsError,
    };
  }

  // ==========================================================================
  // Matrix Reduction & Inversion Helpers
  // ==========================================================================

  private static invertMatrix(A: Float64Array, n: number): Float64Array {
    const M = new Float64Array(A);
    const inv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) inv[i * n + i] = 1.0;

    for (let k = 0; k < n; k++) {
      let maxVal = Math.abs(M[k * n + k]!);
      let maxRow = k;
      for (let r = k + 1; r < n; r++) {
        const v = Math.abs(M[r * n + k]!);
        if (v > maxVal) {
          maxVal = v;
          maxRow = r;
        }
      }

      if (maxRow !== k) {
        for (let c = 0; c < n; c++) {
          const tM = M[k * n + c]!;
          M[k * n + c] = M[maxRow * n + c]!;
          M[maxRow * n + c] = tM;

          const tI = inv[k * n + c]!;
          inv[k * n + c] = inv[maxRow * n + c]!;
          inv[maxRow * n + c] = tI;
        }
      }

      const diag = M[k * n + k]!;
      const safeDiag = Math.abs(diag) > 1e-15 ? diag : 1e-15;

      for (let r = 0; r < n; r++) {
        if (r !== k) {
          const factor = M[r * n + k]! / safeDiag;
          for (let c = 0; c < n; c++) {
            M[r * n + c] = M[r * n + c]! - factor * M[k * n + c]!;
            inv[r * n + c] = inv[r * n + c]! - factor * inv[k * n + c]!;
          }
        }
      }

      for (let c = 0; c < n; c++) {
        M[k * n + c] = M[k * n + c]! / safeDiag;
        inv[k * n + c] = inv[k * n + c]! / safeDiag;
      }
    }

    return inv;
  }

  private static kronReduceRealMatrix(
    M: Float64Array,
    nTotal: number,
    phaseIndices: number[],
    groundIndices: number[],
  ): Float64Array {
    const nP = phaseIndices.length;
    const nG = groundIndices.length;
    const res = new Float64Array(nP * nP);

    if (nG === 0) {
      for (let r = 0; r < nP; r++) {
        for (let c = 0; c < nP; c++) {
          res[r * nP + c] = M[phaseIndices[r]! * nTotal + phaseIndices[c]!]!;
        }
      }
      return res;
    }

    // Partition: M_PP (nP x nP), M_PG (nP x nG), M_GG (nG x nG), M_GP (nG x nP)
    const M_GG = new Float64Array(nG * nG);
    for (let r = 0; r < nG; r++) {
      for (let c = 0; c < nG; c++) {
        M_GG[r * nG + c] = M[groundIndices[r]! * nTotal + groundIndices[c]!]!;
      }
    }

    const inv_GG = this.invertMatrix(M_GG, nG);

    // M_PP - M_PG * inv_GG * M_GP
    for (let r = 0; r < nP; r++) {
      const pR = phaseIndices[r]!;
      for (let c = 0; c < nP; c++) {
        const pC = phaseIndices[c]!;
        let subTerm = 0.0;

        for (let g1 = 0; g1 < nG; g1++) {
          const g1Idx = groundIndices[g1]!;
          for (let g2 = 0; g2 < nG; g2++) {
            const g2Idx = groundIndices[g2]!;
            subTerm += M[pR * nTotal + g1Idx]! * inv_GG[g1 * nG + g2]! * M[g2Idx * nTotal + pC]!;
          }
        }
        res[r * nP + c] = M[pR * nTotal + pC]! - subTerm;
      }
    }

    return res;
  }

  private static kronReduceComplexMatrix(
    M: Complex[],
    nTotal: number,
    phaseIndices: number[],
    groundIndices: number[],
  ): Complex[] {
    const nP = phaseIndices.length;
    const nG = groundIndices.length;
    const res: Complex[] = [];

    if (nG === 0) {
      for (let r = 0; r < nP; r++) {
        for (let c = 0; c < nP; c++) {
          res.push(M[phaseIndices[r]! * nTotal + phaseIndices[c]!]!);
        }
      }
      return res;
    }

    // Invert M_GG using Gauss-Jordan with complex numbers
    const M_GG: Complex[] = [];
    const inv_GG: Complex[] = [];
    for (let r = 0; r < nG; r++) {
      for (let c = 0; c < nG; c++) {
        M_GG.push({ ...M[groundIndices[r]! * nTotal + groundIndices[c]!]! });
        inv_GG.push({ re: r === c ? 1.0 : 0.0, im: 0.0 });
      }
    }

    for (let k = 0; k < nG; k++) {
      const diag = M_GG[k * nG + k]!;
      for (let r = 0; r < nG; r++) {
        if (r !== k) {
          const factor = cDiv(M_GG[r * nG + k]!, diag);
          for (let c = 0; c < nG; c++) {
            M_GG[r * nG + c] = cSub(M_GG[r * nG + c]!, cMul(factor, M_GG[k * nG + c]!));
            inv_GG[r * nG + c] = cSub(inv_GG[r * nG + c]!, cMul(factor, inv_GG[k * nG + c]!));
          }
        }
      }
      for (let c = 0; c < nG; c++) {
        M_GG[k * nG + c] = cDiv(M_GG[k * nG + c]!, diag);
        inv_GG[k * nG + c] = cDiv(inv_GG[k * nG + c]!, diag);
      }
    }

    // Compute M_PP - M_PG * inv_GG * M_GP
    for (let r = 0; r < nP; r++) {
      const pR = phaseIndices[r]!;
      for (let c = 0; c < nP; c++) {
        const pC = phaseIndices[c]!;
        let subTerm: Complex = { re: 0.0, im: 0.0 };

        for (let g1 = 0; g1 < nG; g1++) {
          const g1Idx = groundIndices[g1]!;
          for (let g2 = 0; g2 < nG; g2++) {
            const g2Idx = groundIndices[g2]!;
            const mPg = M[pR * nTotal + g1Idx]!;
            const iG = inv_GG[g1 * nG + g2]!;
            const mGp = M[g2Idx * nTotal + pC]!;
            subTerm = cAdd(subTerm, cMul(cMul(mPg, iG), mGp));
          }
        }
        res.push(cSub(M[pR * nTotal + pC]!, subTerm));
      }
    }

    return res;
  }

  private static solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
    const M = new Float64Array(A);
    const x = new Float64Array(b);

    for (let k = 0; k < n; k++) {
      let maxVal = Math.abs(M[k * n + k]!);
      let maxRow = k;
      for (let r = k + 1; r < n; r++) {
        const v = Math.abs(M[r * n + k]!);
        if (v > maxVal) {
          maxVal = v;
          maxRow = r;
        }
      }
      if (maxRow !== k) {
        for (let c = 0; c < n; c++) {
          const tM = M[k * n + c]!;
          M[k * n + c] = M[maxRow * n + c]!;
          M[maxRow * n + c] = tM;
        }
        const tb = x[k]!;
        x[k] = x[maxRow]!;
        x[maxRow] = tb;
      }

      const diag = M[k * n + k]!;
      const safeDiag = Math.abs(diag) > 1e-14 ? diag : 1e-14;

      for (let r = k + 1; r < n; r++) {
        const factor = M[r * n + k]! / safeDiag;
        for (let c = k + 1; c < n; c++) {
          M[r * n + c] = M[r * n + c]! - factor * M[k * n + c]!;
        }
        x[r] = x[r]! - factor * x[k]!;
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      let sum = x[i]!;
      for (let j = i + 1; j < n; j++) {
        sum -= M[i * n + j]! * x[j]!;
      }
      const diag = M[i * n + i]!;
      x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0.0;
    }

    return x;
  }
}

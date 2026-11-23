// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Cleanroom Seeded 1-Group / 2-Group 3D Monte Carlo Neutron Transport Solver.
 *
 * Implements:
 *   - Macroscopic cross-section homogenization from MCNP `M<n>` cards + cleanroom ENDF-like stdlib
 *   - Power-iteration 3D Monte Carlo `k_eff` criticality solver (`KCODE` / `KSRC`)
 *   - Fixed-source 3D Monte Carlo shielding & attenuation solver (`SDEF` / `NPS`)
 *   - `F1` surface current, `F2` surface flux, `F4` cell track-length flux, `F6` heating tallies
 */

import { computeExactCellVolume, findCellAtPoint, traceRayToBoundary, type Vec3 } from "../cad/csg-geometry.js";
import { lookupIsotopeCrossSection } from "../catalog/library-package-adapter.js";
import type { McnpCellCard, McnpDeck, McnpMaterialCard } from "../types.js";

const AVOGADRO_BARN = 0.602214076;
const STEP_EPS = 1e-6;

export interface MacroscopicXs {
  sigmaS: number;
  sigmaC: number;
  sigmaF: number;
  sigmaA: number;
  sigmaT: number;
  nuSigmaF: number;
  sigma12: number;
}

export interface TallyResult {
  id: number;
  type: number;
  mean: number;
  stdErr: number;
  relErr: number;
  uncollidedMean?: number | undefined;
}

export interface CriticalityResult {
  mode: "criticality";
  kEff: number;
  kEffStdErr: number;
  cycleKeff: number[];
  activeCycles: number;
  inactiveCycles: number;
  historiesPerCycle: number;
  leakageFraction: number;
  absorptionFraction: number;
  tallies: Map<number, TallyResult>;
}

export interface FixedSourceResult {
  mode: "fixed-source";
  nps: number;
  transmittedFraction: number;
  absorbedFraction: number;
  escapedFraction: number;
  tallies: Map<number, TallyResult>;
}

export type McnpSolverResult = CriticalityResult | FixedSourceResult;

export interface McnpSolverOptions {
  seed?: number | undefined;
  /** Number of energy groups: 1 (fast/single-group) or 2 (fast + thermal). */
  groups?: 1 | 2 | undefined;
  /** Override energy group for 1-group fixed-source runs ("fast" | "thermal"). */
  spectrum?: "fast" | "thermal" | undefined;
  /** Override NPS for fixed-source runs. */
  nps?: number | undefined;
  /** Override KCODE histories per cycle. */
  nsrck?: number | undefined;
  /** Override KCODE inactive cycles. */
  ikz?: number | undefined;
  /** Override KCODE total cycles. */
  kct?: number | undefined;
  /** Max collisions per particle history guard. */
  maxCollisions?: number | undefined;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleIsotropicDirection(rng: () => number): Vec3 {
  const mu = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - mu * mu));
  const phi = 2 * Math.PI * rng();
  return [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), mu];
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-14) return [1, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Computes homogenized macroscopic neutron cross-sections (cm^-1) for an MCNP material card
 * at the given cell density (negative = g/cm^3, positive = atoms/barn-cm).
 */
export function computeMaterialCrossSections(
  mat: McnpMaterialCard,
  density: number,
  group: "fast" | "thermal" = "fast",
): MacroscopicXs {
  if (mat.isotopes.length === 0 || density === 0) {
    return { sigmaS: 0, sigmaC: 0, sigmaF: 0, sigmaA: 0, sigmaT: 0, nuSigmaF: 0, sigma12: 0 };
  }

  const isWeightFraction = mat.isotopes.some((iso) => iso.fraction < 0);
  const absFracs = mat.isotopes.map((iso) => Math.abs(iso.fraction));
  const fracSum = absFracs.reduce((a, b) => a + b, 0) || 1;
  const normFracs = absFracs.map((f) => f / fracSum);

  const isoData = mat.isotopes.map((iso) => {
    const data = lookupIsotopeCrossSection(iso.zaidNum);
    return (
      data ?? {
        zaid: iso.zaidNum,
        symbol: `Z${iso.zaidNum}`,
        name: "Generic Isotope",
        atomicMass: 12.0,
        fast: { sigmaS: 3.0, sigmaC: 0.05, sigmaF: 0.0, sigmaT: 3.05, nu: 0.0, sigma12: 0.1 },
        thermal: { sigmaS: 4.0, sigmaC: 0.2, sigmaF: 0.0, sigmaT: 4.2, nu: 0.0 },
        provenance: "Fallback",
      }
    );
  });

  // Compute isotopic atom number densities N_i (atoms / barn-cm)
  const atomDensities: number[] = new Array(mat.isotopes.length).fill(0);
  if (isWeightFraction) {
    if (density < 0) {
      const rho = Math.abs(density);
      for (let i = 0; i < isoData.length; i++) {
        atomDensities[i] = (rho * normFracs[i]! * AVOGADRO_BARN) / isoData[i]!.atomicMass;
      }
    } else {
      const moles = isoData.map((d, i) => normFracs[i]! / d.atomicMass);
      const moleSum = moles.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < isoData.length; i++) {
        atomDensities[i] = density * (moles[i]! / moleSum);
      }
    }
  } else {
    if (density < 0) {
      const rho = Math.abs(density);
      let avgMass = 0;
      for (let i = 0; i < isoData.length; i++) {
        avgMass += normFracs[i]! * isoData[i]!.atomicMass;
      }
      const nTot = (rho * AVOGADRO_BARN) / (avgMass || 1);
      for (let i = 0; i < isoData.length; i++) {
        atomDensities[i] = nTot * normFracs[i]!;
      }
    } else {
      for (let i = 0; i < isoData.length; i++) {
        atomDensities[i] = density * normFracs[i]!;
      }
    }
  }

  let sigmaS = 0;
  let sigmaC = 0;
  let sigmaF = 0;
  let nuSigmaF = 0;
  let sigma12 = 0;

  for (let i = 0; i < isoData.length; i++) {
    const ni = atomDensities[i]!;
    const xs = group === "fast" ? isoData[i]!.fast : isoData[i]!.thermal;
    sigmaS += ni * xs.sigmaS;
    sigmaC += ni * xs.sigmaC;
    sigmaF += ni * xs.sigmaF;
    nuSigmaF += ni * xs.nu * xs.sigmaF;
    if (group === "fast") {
      sigma12 += ni * isoData[i]!.fast.sigma12;
    }
  }

  const sigmaA = sigmaC + sigmaF;
  const sigmaT = sigmaS + sigmaA;
  return { sigmaS, sigmaC, sigmaF, sigmaA, sigmaT, nuSigmaF, sigma12 };
}

function isGraveyardCell(cell: McnpCellCard | undefined): boolean {
  if (!cell) return true;
  if ("N" in cell.imp) return cell.imp["N"] === 0;
  const vals = Object.values(cell.imp);
  return vals.length > 0 && vals.every((v) => v === 0);
}

function buildCellXsTable(deck: McnpDeck, group: "fast" | "thermal"): Map<number, MacroscopicXs> {
  const table = new Map<number, MacroscopicXs>();
  for (const cell of deck.cells.values()) {
    if (cell.materialId === 0 || !cell.density) {
      table.set(cell.id, { sigmaS: 0, sigmaC: 0, sigmaF: 0, sigmaA: 0, sigmaT: 0, nuSigmaF: 0, sigma12: 0 });
      continue;
    }
    const mat = deck.materials.get(cell.materialId);
    if (!mat) {
      table.set(cell.id, { sigmaS: 0, sigmaC: 0, sigmaF: 0, sigmaA: 0, sigmaT: 0, nuSigmaF: 0, sigma12: 0 });
      continue;
    }
    table.set(cell.id, computeMaterialCrossSections(mat, cell.density, group));
  }
  return table;
}

/**
 * Runs a 3D power-iteration Monte Carlo `k_eff` criticality calculation for an MCNP `KCODE` deck.
 */
export function solveMcnpCriticality(deck: McnpDeck, options: McnpSolverOptions = {}): CriticalityResult {
  const kcode = deck.source.kcode ?? { nsrck: 1000, rkk: 1.0, ikz: 10, kct: 50, line: 1 };
  const nsrck = options.nsrck ?? kcode.nsrck;
  const ikz = options.ikz ?? kcode.ikz;
  const kct = options.kct ?? kcode.kct;
  const groups = options.groups ?? 1;
  const maxCollisions = options.maxCollisions ?? 2000;
  const rng = createRng(options.seed ?? 1337);

  const fastXs = buildCellXsTable(deck, "fast");
  const thermalXs = groups === 2 ? buildCellXsTable(deck, "thermal") : fastXs;

  // Initialize fission bank from KSRC or origin
  const initialSeeds: Vec3[] = deck.source.ksrc.length > 0 ? deck.source.ksrc : [[0, 0, 0]];
  let bank: Vec3[] = [];
  for (let i = 0; i < nsrck; i++) {
    const pt = initialSeeds[i % initialSeeds.length]!;
    bank.push([pt[0], pt[1], pt[2]]);
  }

  let kCurrent = kcode.rkk > 0 ? kcode.rkk : 1.0;
  const cycleKeff: number[] = [];
  let totalLeaked = 0;
  let totalAbsorbed = 0;
  let activeHistories = 0;

  // F4 cell flux accumulators across active cycles
  const f4Tallies = Array.from(deck.tallies.values()).filter((t) => t.type === 4);
  const f4Sum = new Map<number, number>();
  const f4SumSq = new Map<number, number>();
  for (const t of f4Tallies) {
    f4Sum.set(t.id, 0);
    f4SumSq.set(t.id, 0);
  }

  for (let cycle = 0; cycle < kct; cycle++) {
    const isActive = cycle >= ikz;
    const nextBank: Vec3[] = [];
    let cycleTrackLengthNuFiss = 0;
    const cycleF4 = new Map<number, number>();
    for (const t of f4Tallies) cycleF4.set(t.id, 0);

    for (let h = 0; h < bank.length; h++) {
      let pos: Vec3 = [bank[h]![0], bank[h]![1], bank[h]![2]];
      let dir = sampleIsotropicDirection(rng);
      let groupIdx: 0 | 1 = 0; // Fission neutrons born fast
      let cell = findCellAtPoint(deck, pos);
      let collisions = 0;

      while (cell && !isGraveyardCell(cell) && collisions < maxCollisions) {
        const xs = (groupIdx === 0 ? fastXs.get(cell.id) : thermalXs.get(cell.id))!;
        const hit = traceRayToBoundary(deck, cell, pos, dir);
        const dBnd = hit ? hit.distance : Infinity;
        const dColl = xs.sigmaT > 0 ? -Math.log(Math.max(1e-15, rng())) / xs.sigmaT : Infinity;

        if (!Number.isFinite(dBnd) && !Number.isFinite(dColl)) {
          if (isActive) totalLeaked++;
          break;
        }

        const step = Math.min(dBnd, dColl);
        if (xs.nuSigmaF > 0) {
          cycleTrackLengthNuFiss += step * xs.nuSigmaF;
        }

        if (isActive && f4Tallies.length > 0) {
          for (const t of f4Tallies) {
            if (t.targets.includes(cell.id)) {
              const vol = computeExactCellVolume(deck, cell.id) ?? 1.0;
              cycleF4.set(t.id, (cycleF4.get(t.id) ?? 0) + step / vol);
            }
          }
        }

        if (dColl < dBnd) {
          // Collision inside cell
          collisions++;
          pos = [pos[0] + step * dir[0], pos[1] + step * dir[1], pos[2] + step * dir[2]];

          // Bank fission sites using expected yield nu * sigma_f / (sigma_t * kCurrent)
          if (xs.nuSigmaF > 0) {
            const expectedSites = xs.nuSigmaF / (xs.sigmaT * kCurrent);
            const nSites = Math.floor(expectedSites + rng());
            for (let s = 0; s < nSites; s++) {
              nextBank.push([pos[0], pos[1], pos[2]]);
            }
          }

          // Sample scattering vs absorption
          const scatterProb = xs.sigmaS / xs.sigmaT;
          if (rng() < scatterProb) {
            dir = sampleIsotropicDirection(rng);
            if (groups === 2 && groupIdx === 0 && xs.sigmaS > 0) {
              const downProb = Math.min(1, xs.sigma12 / xs.sigmaS);
              if (rng() < downProb) {
                groupIdx = 1;
              }
            }
          } else {
            if (isActive) totalAbsorbed++;
            break;
          }
        } else {
          // Boundary crossing
          const advance = dBnd + STEP_EPS;
          pos = [pos[0] + advance * dir[0], pos[1] + advance * dir[1], pos[2] + advance * dir[2]];
          if (hit?.boundary === "*") {
            // Simple specular bounce for reflective boundary: reverse direction and step back inside
            pos = [pos[0] - 2 * STEP_EPS * dir[0], pos[1] - 2 * STEP_EPS * dir[1], pos[2] - 2 * STEP_EPS * dir[2]];
            dir = [-dir[0], -dir[1], -dir[2]];
          } else {
            cell = findCellAtPoint(deck, pos);
            if (!cell || isGraveyardCell(cell)) {
              if (isActive) totalLeaked++;
              break;
            }
          }
        }
      }
      if (isActive) activeHistories++;
    }

    const cycleK = cycleTrackLengthNuFiss / Math.max(1, bank.length);
    kCurrent = cycleK > 0.05 ? cycleK : kCurrent;
    if (isActive) {
      cycleKeff.push(cycleK);
      for (const t of f4Tallies) {
        const val = (cycleF4.get(t.id) ?? 0) / Math.max(1, bank.length);
        f4Sum.set(t.id, (f4Sum.get(t.id) ?? 0) + val);
        f4SumSq.set(t.id, (f4SumSq.get(t.id) ?? 0) + val * val);
      }
    }

    // Resample fission bank to maintain constant nsrck histories per cycle
    if (nextBank.length > 0) {
      const resampled: Vec3[] = [];
      for (let i = 0; i < nsrck; i++) {
        const pick = nextBank[Math.floor(rng() * nextBank.length)]!;
        resampled.push([pick[0], pick[1], pick[2]]);
      }
      bank = resampled;
    }
  }

  const nActive = cycleKeff.length;
  const meanK = nActive > 0 ? cycleKeff.reduce((a, b) => a + b, 0) / nActive : 0;
  let variance = 0;
  if (nActive > 1) {
    for (const k of cycleKeff) {
      variance += (k - meanK) * (k - meanK);
    }
    variance /= nActive - 1;
  }
  const kEffStdErr = nActive > 1 ? Math.sqrt(variance / nActive) : 0;

  const tallies = new Map<number, TallyResult>();
  for (const t of f4Tallies) {
    const sum = f4Sum.get(t.id) ?? 0;
    const sumSq = f4SumSq.get(t.id) ?? 0;
    const mean = nActive > 0 ? sum / nActive : 0;
    const v = nActive > 1 ? Math.max(0, (sumSq - (sum * sum) / nActive) / (nActive - 1)) : 0;
    const stdErr = nActive > 1 ? Math.sqrt(v / nActive) : 0;
    tallies.set(t.id, {
      id: t.id,
      type: t.type,
      mean,
      stdErr,
      relErr: mean > 0 ? stdErr / mean : 0,
    });
  }

  return {
    mode: "criticality",
    kEff: meanK,
    kEffStdErr,
    cycleKeff,
    activeCycles: nActive,
    inactiveCycles: ikz,
    historiesPerCycle: nsrck,
    leakageFraction: activeHistories > 0 ? totalLeaked / activeHistories : 0,
    absorptionFraction: activeHistories > 0 ? totalAbsorbed / activeHistories : 0,
    tallies,
  };
}

/**
 * Runs a 3D fixed-source Monte Carlo transport simulation for an MCNP `SDEF` / `NPS` deck.
 */
export function solveMcnpFixedSource(deck: McnpDeck, options: McnpSolverOptions = {}): FixedSourceResult {
  const nps = options.nps ?? deck.nps ?? 5000;
  const maxCollisions = options.maxCollisions ?? 1000;
  const rng = createRng(options.seed ?? 2025);

  const sdef = deck.source.sdef;
  const defaultSpectrum: "fast" | "thermal" =
    options.spectrum ?? (sdef?.erg !== undefined && sdef.erg < 1e-5 ? "thermal" : "fast");
  const xsTable = buildCellXsTable(deck, defaultSpectrum);

  const srcPos: Vec3 = sdef?.pos ?? [0, 0, 0];
  const hasBeam = sdef?.vec !== undefined && sdef.dir !== undefined && Math.abs(sdef.dir - 1) < 1e-6;
  const beamDir: Vec3 = hasBeam ? normalizeVec3(sdef.vec!) : [1, 0, 0];

  const tallyList = Array.from(deck.tallies.values());
  const sumMap = new Map<number, number>();
  const sumSqMap = new Map<number, number>();
  const uncollSumMap = new Map<number, number>();
  for (const t of tallyList) {
    sumMap.set(t.id, 0);
    sumSqMap.set(t.id, 0);
    uncollSumMap.set(t.id, 0);
  }

  let absorbed = 0;
  let escaped = 0;
  let transmitted = 0;

  for (let h = 0; h < nps; h++) {
    let pos: Vec3 = [srcPos[0], srcPos[1], srcPos[2]];
    let dir: Vec3 = hasBeam ? [beamDir[0], beamDir[1], beamDir[2]] : sampleIsotropicDirection(rng);
    let cell = findCellAtPoint(deck, pos);
    let collisions = 0;

    const histScore = new Map<number, number>();
    const histUncoll = new Map<number, number>();

    while (cell && !isGraveyardCell(cell) && collisions < maxCollisions) {
      const xs = xsTable.get(cell.id)!;
      const hit = traceRayToBoundary(deck, cell, pos, dir);
      const dBnd = hit ? hit.distance : Infinity;
      const dColl = xs.sigmaT > 0 ? -Math.log(Math.max(1e-15, rng())) / xs.sigmaT : Infinity;

      if (!Number.isFinite(dBnd) && !Number.isFinite(dColl)) {
        escaped++;
        break;
      }

      const step = Math.min(dBnd, dColl);

      // Score cell tallies (F4 flux, F6 heating)
      for (const t of tallyList) {
        if ((t.type === 4 || t.type === 6) && t.targets.includes(cell.id)) {
          const vol = computeExactCellVolume(deck, cell.id) ?? 1.0;
          const contrib = t.type === 4 ? step / vol : (step * xs.sigmaA * (sdef?.erg ?? 1.0)) / vol;
          histScore.set(t.id, (histScore.get(t.id) ?? 0) + contrib);
        }
      }

      if (dColl < dBnd) {
        collisions++;
        pos = [pos[0] + step * dir[0], pos[1] + step * dir[1], pos[2] + step * dir[2]];
        const scatterProb = xs.sigmaT > 0 ? xs.sigmaS / xs.sigmaT : 0;
        if (rng() < scatterProb) {
          dir = sampleIsotropicDirection(rng);
        } else {
          absorbed++;
          break;
        }
      } else {
        // Score surface crossing tallies (F1 current, F2 flux)
        if (hit) {
          for (const t of tallyList) {
            if ((t.type === 1 || t.type === 2) && t.targets.includes(hit.surfaceId)) {
              const scoreVal = t.type === 1 ? 1.0 : 1.0 / Math.max(0.05, Math.abs(dir[0]));
              histScore.set(t.id, (histScore.get(t.id) ?? 0) + scoreVal);
              if (collisions === 0) {
                histUncoll.set(t.id, (histUncoll.get(t.id) ?? 0) + scoreVal);
              }
            }
          }
        }
        const advance = dBnd + STEP_EPS;
        pos = [pos[0] + advance * dir[0], pos[1] + advance * dir[1], pos[2] + advance * dir[2]];
        cell = findCellAtPoint(deck, pos);
        if (!cell || isGraveyardCell(cell)) {
          escaped++;
          if (collisions === 0) transmitted++;
          break;
        }
      }
    }

    for (const t of tallyList) {
      const s = histScore.get(t.id) ?? 0;
      sumMap.set(t.id, (sumMap.get(t.id) ?? 0) + s);
      sumSqMap.set(t.id, (sumSqMap.get(t.id) ?? 0) + s * s);
      uncollSumMap.set(t.id, (uncollSumMap.get(t.id) ?? 0) + (histUncoll.get(t.id) ?? 0));
    }
  }

  const tallies = new Map<number, TallyResult>();
  for (const t of tallyList) {
    const sum = sumMap.get(t.id) ?? 0;
    const sumSq = sumSqMap.get(t.id) ?? 0;
    const mean = sum / nps;
    const variance = nps > 1 ? Math.max(0, (sumSq - (sum * sum) / nps) / (nps - 1)) : 0;
    const stdErr = nps > 1 ? Math.sqrt(variance / nps) : 0;
    tallies.set(t.id, {
      id: t.id,
      type: t.type,
      mean,
      stdErr,
      relErr: mean > 0 ? stdErr / mean : 0,
      uncollidedMean: (uncollSumMap.get(t.id) ?? 0) / nps,
    });
  }

  return {
    mode: "fixed-source",
    nps,
    transmittedFraction: transmitted / nps,
    absorbedFraction: absorbed / nps,
    escapedFraction: escaped / nps,
    tallies,
  };
}

/**
 * Automatically dispatches to `solveMcnpCriticality` (if `KCODE` present) or `solveMcnpFixedSource`.
 */
export function solveMcnpDeck(deck: McnpDeck, options: McnpSolverOptions = {}): McnpSolverResult {
  if (deck.source.kcode) {
    return solveMcnpCriticality(deck, options);
  }
  return solveMcnpFixedSource(deck, options);
}

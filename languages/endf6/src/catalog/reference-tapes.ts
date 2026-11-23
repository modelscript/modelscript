// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Synthetic Cleanroom ENDF-6 Reference Tape Generator.
 */

import { formatEndfCard, formatEndfTextCard } from "../parser/endf-float.js";
import { CLEANROOM_ENDF6_NUCLIDES } from "./endf6-std-schemas.js";

/**
 * Generates a valid, well-formed 80-column ENDF-6 tape for any cleanroom reference nuclide
 * (`H-1`, `B-10`, `U-235`, `U-238`, `Pu-239`), complete with TPID, `MF=1 MT=451`, optional
 * `MF=2 MT=151`, `MF=3` (`MT=1, 2, 18, 102`), optional `MF=8 MT=457`, and `SEND`/`FEND`/`MEND`/`TEND`.
 */
export function generateReferenceEndf6Tape(nuclideSymbol: string): string {
  const nuc = CLEANROOM_ENDF6_NUCLIDES.get(nuclideSymbol) ?? CLEANROOM_ENDF6_NUCLIDES.get("U-235")!;
  const mat = nuc.mat;
  const lines: string[] = [];
  let ns = 1;

  // TPID
  lines.push(formatEndfTextCard(`MODELSCRIPT CLEANROOM ENDF-6 TAPE - ${nuc.name} (${nuc.symbol})`, 1, 0, 0, 0));

  // MF=1, MT=451 (Descriptive data)
  const descLines = [`${nuc.symbol} (${nuc.name}) - ${nuc.provenance}`, `ZA=${nuc.za}  AWR=${nuc.awr}  MAT=${mat}`];
  const hasFission = nuc.sigmaFissionThermal > 0 || nuc.sigmaFissionFast > 0;
  const dirEntries: Array<[number, number, number]> = [
    [1, 451, 6 + descLines.length],
    ...(nuc.firstResonance ? [[2, 151, 6] as [number, number, number]] : []),
    [3, 1, 8],
    [3, 2, 8],
    ...(hasFission ? [[3, 18, 8] as [number, number, number]] : []),
    [3, 102, 8],
    ...(Number.isFinite(nuc.halfLifeSeconds) ? [[8, 457, 4] as [number, number, number]] : []),
  ];

  lines.push(
    formatEndfCard(
      [nuc.za, nuc.awr, { int: nuc.firstResonance ? 1 : 0 }, { int: hasFission ? 1 : 0 }, { int: 0 }, { int: 1 }],
      mat,
      1,
      451,
      ns++,
    ),
  );
  lines.push(
    formatEndfCard(
      [0, Number.isFinite(nuc.halfLifeSeconds) ? 1 : 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 6 }],
      mat,
      1,
      451,
      ns++,
    ),
  );
  lines.push(formatEndfCard([1.0, 2.0e7, { int: 0 }, { int: 0 }, { int: 10 }, { int: 8 }], mat, 1, 451, ns++));
  lines.push(
    formatEndfCard(
      [293.6, 0, { int: 0 }, { int: 0 }, { int: descLines.length }, { int: dirEntries.length }],
      mat,
      1,
      451,
      ns++,
    ),
  );
  for (const dl of descLines) {
    lines.push(formatEndfTextCard(dl, mat, 1, 451, ns++));
  }
  for (const [dmf, dmt, dnc] of dirEntries) {
    lines.push(formatEndfCard([0, 0, { int: dmf }, { int: dmt }, { int: dnc }, { int: 1 }], mat, 1, 451, ns++));
  }
  // SEND & FEND for MF=1
  lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 1, 0, 99999));
  lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 0, 0, 0));

  // MF=2, MT=151 (SLBW resonance parameters)
  if (nuc.firstResonance) {
    const r = nuc.firstResonance;
    ns = 1;
    lines.push(formatEndfCard([nuc.za, nuc.awr, { int: 0 }, { int: 0 }, { int: 1 }, { int: 0 }], mat, 2, 151, ns++));
    lines.push(
      formatEndfCard([nuc.za, 1.0, { int: 0 }, { int: hasFission ? 1 : 0 }, { int: 1 }, { int: 0 }], mat, 2, 151, ns++),
    );
    lines.push(formatEndfCard([1.0e-5, 1.0e3, { int: 1 }, { int: 1 }, { int: 0 }, { int: 0 }], mat, 2, 151, ns++));
    lines.push(formatEndfCard([r.spi, r.ap, { int: 0 }, { int: 0 }, { int: 1 }, { int: 0 }], mat, 2, 151, ns++));
    lines.push(formatEndfCard([nuc.awr, 0.0, { int: 0 }, { int: 0 }, { int: 6 }, { int: 1 }], mat, 2, 151, ns++));
    const gt = r.gn + r.gg + r.gf;
    lines.push(formatEndfCard([r.er, r.aj, gt, r.gn, r.gg, r.gf], mat, 2, 151, ns++));
    lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 2, 0, 99999));
    lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 0, 0, 0));
  }

  // MF=3 pointwise cross-sections on a 6-point log-spaced grid (INT=5 log-log)
  const energies = [1.0e-5, 0.0253, 1.0, 1.0e3, 1.0e6, 2.0e7];
  const eThermal = 0.0253;
  const eval1OverV = (sigTh: number, sigFast: number, e: number): number => {
    if (sigTh <= 0 && sigFast <= 0) return 0;
    if (e <= 10.0) {
      return sigTh * Math.sqrt(eThermal / e);
    }
    const s10 = sigTh * Math.sqrt(eThermal / 10.0);
    const t = Math.min(1, Math.log10(e / 10.0) / Math.log10(1.0e6 / 10.0));
    const target = Math.max(sigFast, 1e-6);
    return Math.exp(Math.log(Math.max(s10, 1e-6)) * (1 - t) + Math.log(target) * t);
  };

  const elasticPts = energies.map((e) => {
    const t = Math.max(0, Math.min(1, Math.log10(e / eThermal) / Math.log10(1.0e6 / eThermal)));
    return nuc.sigmaElasticThermal * (1 - t) + nuc.sigmaElasticFast * t;
  });
  const capturePts = energies.map((e) => eval1OverV(nuc.sigmaCaptureThermal, nuc.sigmaCaptureFast, e));
  const fissionPts = hasFission
    ? energies.map((e) => eval1OverV(nuc.sigmaFissionThermal, nuc.sigmaFissionFast, e))
    : [];
  const totalPts = energies.map((_, i) => elasticPts[i]! + capturePts[i]! + (fissionPts[i] ?? 0));

  const emitMf3 = (mt: number, sigmas: number[]): void => {
    ns = 1;
    lines.push(formatEndfCard([nuc.za, nuc.awr, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 3, mt, ns++));
    lines.push(
      formatEndfCard([0.0, 0.0, { int: 0 }, { int: 0 }, { int: 1 }, { int: energies.length }], mat, 3, mt, ns++),
    );
    lines.push(formatEndfCard([{ int: energies.length }, { int: 5 }], mat, 3, mt, ns++));
    for (let i = 0; i < energies.length; i += 3) {
      const row: number[] = [];
      for (let j = i; j < Math.min(i + 3, energies.length); j++) {
        row.push(energies[j]!, sigmas[j]!);
      }
      lines.push(formatEndfCard(row, mat, 3, mt, ns++));
    }
    lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 3, 0, 99999));
  };

  emitMf3(1, totalPts);
  emitMf3(2, elasticPts);
  if (hasFission) emitMf3(18, fissionPts);
  emitMf3(102, capturePts);
  // FEND for MF=3
  lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 0, 0, 0));

  // MF=8, MT=457 (Radioactive decay data for unstable nuclides)
  if (Number.isFinite(nuc.halfLifeSeconds)) {
    ns = 1;
    lines.push(formatEndfCard([nuc.za, nuc.awr, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 8, 457, ns++));
    lines.push(
      formatEndfCard(
        [nuc.halfLifeSeconds, nuc.halfLifeSeconds * 0.005, { int: 0 }, { int: 0 }, { int: 6 }, { int: 0 }],
        mat,
        8,
        457,
        ns++,
      ),
    );
    lines.push(formatEndfCard([0.0, 0.0, 0.0, 0.0, 4.5e6, 1.0e4], mat, 8, 457, ns++));
    lines.push(
      formatEndfCard(
        [nuc.firstResonance?.spi ?? 0.5, 1.0, { int: 0 }, { int: 0 }, { int: 6 }, { int: 1 }],
        mat,
        8,
        457,
        ns++,
      ),
    );
    lines.push(formatEndfCard([4.0, 0.0, 4.6e6, 5.0e3, 1.0, 0.0], mat, 8, 457, ns++));
    lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 8, 0, 99999));
    lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], mat, 0, 0, 0));
  }

  // MEND & TEND
  lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 0, 0, 0, 0));
  lines.push(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], -1, 0, 0, 0));

  return lines.join("\n") + "\n";
}

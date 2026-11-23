// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — ENDF-6 Structural, Grid & Physics Consistency Linter.
 */

import { Endf6ErrorCode } from "../errors.js";
import { parseEndf6Tape } from "../parser/tape-parser.js";
import { evaluateTab1 } from "../solver/interpolation.js";
import type { Endf6Diagnostic, Endf6Tape } from "../types.js";

/** Standard ENDF-6 MF file numbers (ENDF-102 Table 1). */
const VALID_MF_NUMBERS = new Set<number>([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 23, 26, 27, 28, 30, 31, 32, 33, 34, 35, 40,
]);

/**
 * Lints a parsed `Endf6Tape` and returns all `ENDF1001`–`ENDF5006` diagnostics.
 */
export function lintEndf6Tape(tape: Endf6Tape): Endf6Diagnostic[] {
  const diags: Endf6Diagnostic[] = [];

  // 1. Parse-level card format / length errors (ENDF1001)
  for (const err of tape.parseErrors) {
    diags.push({
      id: Endf6ErrorCode.CARD_FORMAT_ERROR.id,
      code: Endf6ErrorCode.CARD_FORMAT_ERROR.code,
      rule: Endf6ErrorCode.CARD_FORMAT_ERROR.rule,
      severity: Endf6ErrorCode.CARD_FORMAT_ERROR.severity,
      message: Endf6ErrorCode.CARD_FORMAT_ERROR.message(err.message),
      line: err.line,
    });
  }

  // 2. Card-level MAT/MF/MT range checks (ENDF2001, ENDF2002, ENDF2003)
  const seenInvalidMat = new Set<number>();
  const seenInvalidMf = new Set<string>();
  const seenInvalidMt = new Set<string>();

  for (const card of tape.cards) {
    if (!Number.isFinite(card.mat) || !Number.isFinite(card.mf) || !Number.isFinite(card.mt)) {
      continue;
    }
    if (card.mat < -1 || card.mat > 9999) {
      if (!seenInvalidMat.has(card.mat)) {
        seenInvalidMat.add(card.mat);
        diags.push({
          id: Endf6ErrorCode.INVALID_MAT.id,
          code: Endf6ErrorCode.INVALID_MAT.code,
          rule: Endf6ErrorCode.INVALID_MAT.rule,
          severity: Endf6ErrorCode.INVALID_MAT.severity,
          message: Endf6ErrorCode.INVALID_MAT.message(String(card.mat)),
          line: card.line,
          mat: card.mat,
        });
      }
    }
    if (card.mf !== 0 && !VALID_MF_NUMBERS.has(card.mf)) {
      const key = `${card.mat}:${card.mf}`;
      if (!seenInvalidMf.has(key)) {
        seenInvalidMf.add(key);
        diags.push({
          id: Endf6ErrorCode.INVALID_MF.id,
          code: Endf6ErrorCode.INVALID_MF.code,
          rule: Endf6ErrorCode.INVALID_MF.rule,
          severity: Endf6ErrorCode.INVALID_MF.severity,
          message: Endf6ErrorCode.INVALID_MF.message(String(card.mf)),
          line: card.line,
          mat: card.mat,
          mf: card.mf,
        });
      }
    }
    if (card.mt < 0 || card.mt > 999) {
      const key = `${card.mat}:${card.mf}:${card.mt}`;
      if (!seenInvalidMt.has(key)) {
        seenInvalidMt.add(key);
        diags.push({
          id: Endf6ErrorCode.INVALID_MT.id,
          code: Endf6ErrorCode.INVALID_MT.code,
          rule: Endf6ErrorCode.INVALID_MT.rule,
          severity: Endf6ErrorCode.INVALID_MT.severity,
          message: Endf6ErrorCode.INVALID_MT.message(String(card.mt)),
          line: card.line,
          mat: card.mat,
          mf: card.mf,
          mt: card.mt,
        });
      }
    }
  }

  // 3. Tape-level TEND terminator check (ENDF1005)
  if (tape.materials.size > 0 && !tape.hasTend) {
    const lastLine = tape.cards.length > 0 ? tape.cards[tape.cards.length - 1]!.line : 1;
    diags.push({
      id: Endf6ErrorCode.MISSING_TEND.id,
      code: Endf6ErrorCode.MISSING_TEND.code,
      rule: Endf6ErrorCode.MISSING_TEND.rule,
      severity: Endf6ErrorCode.MISSING_TEND.severity,
      message: Endf6ErrorCode.MISSING_TEND.message(),
      line: lastLine,
    });
  }

  // 4. Per-material checks
  for (const mat of tape.materials.values()) {
    // Missing MEND (ENDF1004)
    if (!mat.hasMend) {
      diags.push({
        id: Endf6ErrorCode.MISSING_MEND.id,
        code: Endf6ErrorCode.MISSING_MEND.code,
        rule: Endf6ErrorCode.MISSING_MEND.rule,
        severity: Endf6ErrorCode.MISSING_MEND.severity,
        message: Endf6ErrorCode.MISSING_MEND.message(String(mat.mat)),
        line: mat.endLine,
        mat: mat.mat,
      });
    }

    // Missing FEND for any present MF file (ENDF1003)
    for (const mf of mat.presentFiles) {
      if (!mat.terminatedFiles.has(mf)) {
        const lastSec = [...mat.sections].reverse().find((s) => s.mf === mf);
        diags.push({
          id: Endf6ErrorCode.MISSING_FEND.id,
          code: Endf6ErrorCode.MISSING_FEND.code,
          rule: Endf6ErrorCode.MISSING_FEND.rule,
          severity: Endf6ErrorCode.MISSING_FEND.severity,
          message: Endf6ErrorCode.MISSING_FEND.message(String(mat.mat), String(mf)),
          line: lastSec?.endLine ?? mat.endLine,
          mat: mat.mat,
          mf,
        });
      }
    }

    // Missing SEND per section (ENDF1002) & ZA/AWR header checks (ENDF5001, ENDF5002)
    let reportedBadZa = false;
    let reportedBadAwr = false;
    for (const sec of mat.sections) {
      if (!sec.hasSend) {
        diags.push({
          id: Endf6ErrorCode.MISSING_SEND.id,
          code: Endf6ErrorCode.MISSING_SEND.code,
          rule: Endf6ErrorCode.MISSING_SEND.rule,
          severity: Endf6ErrorCode.MISSING_SEND.severity,
          message: Endf6ErrorCode.MISSING_SEND.message(String(sec.mat), String(sec.mf), String(sec.mt)),
          line: sec.endLine,
          mat: sec.mat,
          mf: sec.mf,
          mt: sec.mt,
        });
      }

      if (sec.head) {
        const z = Math.floor(sec.head.za / 1000);
        if (!reportedBadZa && (!Number.isFinite(sec.head.za) || sec.head.za <= 0 || z < 1 || z > 118)) {
          reportedBadZa = true;
          diags.push({
            id: Endf6ErrorCode.INVALID_ZA.id,
            code: Endf6ErrorCode.INVALID_ZA.code,
            rule: Endf6ErrorCode.INVALID_ZA.rule,
            severity: Endf6ErrorCode.INVALID_ZA.severity,
            message: Endf6ErrorCode.INVALID_ZA.message(String(mat.mat), String(sec.head.za)),
            line: sec.head.line,
            mat: mat.mat,
            mf: sec.mf,
            mt: sec.mt,
          });
        }
        if (!reportedBadAwr && (!Number.isFinite(sec.head.awr) || sec.head.awr <= 0)) {
          reportedBadAwr = true;
          diags.push({
            id: Endf6ErrorCode.INVALID_AWR.id,
            code: Endf6ErrorCode.INVALID_AWR.code,
            rule: Endf6ErrorCode.INVALID_AWR.rule,
            severity: Endf6ErrorCode.INVALID_AWR.severity,
            message: Endf6ErrorCode.INVALID_AWR.message(String(mat.mat), String(sec.head.awr)),
            line: sec.head.line,
            mat: mat.mat,
            mf: sec.mf,
            mt: sec.mt,
          });
        }
      }
    }

    // MF=3 pointwise cross-section checks (ENDF3001, ENDF3002, ENDF3003, ENDF5003, ENDF5004)
    for (const xs of mat.crossSections.values()) {
      const { tab1 } = xs;

      if (tab1.points.length === 0) {
        diags.push({
          id: Endf6ErrorCode.EMPTY_TAB1.id,
          code: Endf6ErrorCode.EMPTY_TAB1.code,
          rule: Endf6ErrorCode.EMPTY_TAB1.rule,
          severity: Endf6ErrorCode.EMPTY_TAB1.severity,
          message: Endf6ErrorCode.EMPTY_TAB1.message(String(xs.mt)),
          line: xs.line,
          mat: mat.mat,
          mf: 3,
          mt: xs.mt,
        });
        continue;
      }

      for (const reg of tab1.regions) {
        if (!Number.isInteger(reg.interp) || reg.interp < 1 || reg.interp > 5) {
          diags.push({
            id: Endf6ErrorCode.INVALID_INTERP_SCHEME.id,
            code: Endf6ErrorCode.INVALID_INTERP_SCHEME.code,
            rule: Endf6ErrorCode.INVALID_INTERP_SCHEME.rule,
            severity: Endf6ErrorCode.INVALID_INTERP_SCHEME.severity,
            message: Endf6ErrorCode.INVALID_INTERP_SCHEME.message(String(xs.mt), String(reg.interp)),
            line: tab1.line,
            mat: mat.mat,
            mf: 3,
            mt: xs.mt,
          });
        }
      }

      if (tab1.regions.length > 0) {
        const lastNbt = tab1.regions[tab1.regions.length - 1]!.nbt;
        if (lastNbt !== tab1.np) {
          diags.push({
            id: Endf6ErrorCode.TAB1_NBT_MISMATCH.id,
            code: Endf6ErrorCode.TAB1_NBT_MISMATCH.code,
            rule: Endf6ErrorCode.TAB1_NBT_MISMATCH.rule,
            severity: Endf6ErrorCode.TAB1_NBT_MISMATCH.severity,
            message: Endf6ErrorCode.TAB1_NBT_MISMATCH.message(String(xs.mt), String(lastNbt), String(tab1.np)),
            line: tab1.line,
            mat: mat.mat,
            mf: 3,
            mt: xs.mt,
          });
        }
      }

      let reportedNonMonotonic = false;
      let reportedNegative = false;
      for (let i = 0; i < tab1.points.length; i++) {
        const pt = tab1.points[i]!;
        if (i > 0 && !reportedNonMonotonic && pt.x < tab1.points[i - 1]!.x) {
          reportedNonMonotonic = true;
          diags.push({
            id: Endf6ErrorCode.NON_MONOTONIC_ENERGY.id,
            code: Endf6ErrorCode.NON_MONOTONIC_ENERGY.code,
            rule: Endf6ErrorCode.NON_MONOTONIC_ENERGY.rule,
            severity: Endf6ErrorCode.NON_MONOTONIC_ENERGY.severity,
            message: Endf6ErrorCode.NON_MONOTONIC_ENERGY.message(
              String(xs.mt),
              String(tab1.points[i - 1]!.x),
              String(pt.x),
            ),
            line: tab1.line,
            mat: mat.mat,
            mf: 3,
            mt: xs.mt,
          });
        }
        if (!reportedNegative && pt.y < 0) {
          reportedNegative = true;
          diags.push({
            id: Endf6ErrorCode.NEGATIVE_CROSS_SECTION.id,
            code: Endf6ErrorCode.NEGATIVE_CROSS_SECTION.code,
            rule: Endf6ErrorCode.NEGATIVE_CROSS_SECTION.rule,
            severity: Endf6ErrorCode.NEGATIVE_CROSS_SECTION.severity,
            message: Endf6ErrorCode.NEGATIVE_CROSS_SECTION.message(String(xs.mt), String(pt.x), String(pt.y)),
            line: tab1.line,
            mat: mat.mat,
            mf: 3,
            mt: xs.mt,
          });
        }
      }
    }

    // MF=3 MT=1 total >= partial sum consistency check (ENDF4001)
    const mt1 = mat.crossSections.get(1);
    if (mt1 && mt1.tab1.points.length > 0) {
      const partialMts = [2, 18, 102].filter((m) => mat.crossSections.has(m));
      if (partialMts.length > 0) {
        for (const pt of mt1.tab1.points) {
          let partialSum = 0;
          for (const pm of partialMts) {
            const pSec = mat.crossSections.get(pm)!;
            partialSum += evaluateTab1(pSec.tab1, pt.x);
          }
          // Allow 1% numerical tolerance
          if (pt.y + 1e-6 < partialSum * 0.99) {
            diags.push({
              id: Endf6ErrorCode.TOTAL_LESS_THAN_PARTIALS.id,
              code: Endf6ErrorCode.TOTAL_LESS_THAN_PARTIALS.code,
              rule: Endf6ErrorCode.TOTAL_LESS_THAN_PARTIALS.rule,
              severity: Endf6ErrorCode.TOTAL_LESS_THAN_PARTIALS.severity,
              message: Endf6ErrorCode.TOTAL_LESS_THAN_PARTIALS.message(
                String(mat.mat),
                pt.x.toExponential(3),
                pt.y.toFixed(4),
                partialSum.toFixed(4),
              ),
              line: mt1.line,
              mat: mat.mat,
              mf: 3,
              mt: 1,
            });
            break;
          }
        }
      }
    }

    // MF=2 MT=151 resonance width checks (ENDF5005)
    for (const range of mat.resonances) {
      for (const res of range.resonances) {
        if (res.gt <= 0) {
          diags.push({
            id: Endf6ErrorCode.INVALID_RESONANCE_WIDTH.id,
            code: Endf6ErrorCode.INVALID_RESONANCE_WIDTH.code,
            rule: Endf6ErrorCode.INVALID_RESONANCE_WIDTH.rule,
            severity: Endf6ErrorCode.INVALID_RESONANCE_WIDTH.severity,
            message: Endf6ErrorCode.INVALID_RESONANCE_WIDTH.message(String(mat.mat), String(res.er)),
            line: res.line,
            mat: mat.mat,
            mf: 2,
            mt: 151,
          });
        }
      }
    }

    // MF=8 MT=457 decay half-life check (ENDF5006)
    if (mat.decay && mat.decay.nst === 0 && (!Number.isFinite(mat.decay.halfLife) || mat.decay.halfLife <= 0)) {
      diags.push({
        id: Endf6ErrorCode.INVALID_HALF_LIFE.id,
        code: Endf6ErrorCode.INVALID_HALF_LIFE.code,
        rule: Endf6ErrorCode.INVALID_HALF_LIFE.rule,
        severity: Endf6ErrorCode.INVALID_HALF_LIFE.severity,
        message: Endf6ErrorCode.INVALID_HALF_LIFE.message(String(mat.mat), String(mat.decay.halfLife)),
        line: mat.decay.line,
        mat: mat.mat,
        mf: 8,
        mt: 457,
      });
    }
  }

  return diags;
}

/**
 * Convenience helper that parses an ENDF-6 tape string and lints it.
 */
export function lintEndf6Source(source: string): Endf6Diagnostic[] {
  return lintEndf6Tape(parseEndf6Tape(source));
}

export { Endf6ErrorCode, type Endf6ErrorKey, type Endf6ErrorSpec } from "../errors.js";

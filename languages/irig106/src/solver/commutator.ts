// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IRIG 106 Chapter 9 PCM Frame Commutator Solver & Polynomial Engineering-Unit Calibration Engine.
 *
 * Computes:
 * - Exact PCM minor frame rate, major frame rate, and word rate from D1 / MF1 / MF2 / MF\N
 * - 2D Major/Minor frame commutator grid with supercommutation (WP/WI) and subcommutation (FP/FI)
 * - Word/bit-level slot overlap detection
 * - Per-parameter sample rate (Hz), Nyquist bandwidth (Hz), and bit-rate utilization
 * - Horner-form polynomial engineering-unit calibration y = sum(c_k * x^k)
 */

import { parseWordFragmentMask } from "../parser/tmats-parser.js";
import type { TmatsConversionGroup, TmatsMeasurement, TmatsModel, TmatsPcmFormatGroup } from "../types.js";

export interface CommutatorSlotAssignment {
  measurementName: string;
  bitStart: number;
  bitLength: number;
  line: number;
  isSync?: boolean;
}

export interface CommutatorCell {
  /** 1-based minor frame index within the major frame */
  frameIndex: number;
  /** 1-based word position within the minor frame (0 = SYNC word column) */
  wordPosition: number;
  isSync: boolean;
  assignments: CommutatorSlotAssignment[];
  hasConflict: boolean;
}

export interface CommutatorConflict {
  frameIndex: number;
  wordPosition: number;
  measurementA: string;
  measurementB: string;
  line: number;
}

export type CommutationType = "normal" | "supercommutated" | "subcommutated" | "super-subcommutated";

export interface ParameterSchedule {
  name: string;
  wordPositions: number[];
  framePositions: number[];
  slotsPerMajorFrame: number;
  sampleRateHz: number;
  nyquistBandwidthHz: number;
  bitLength: number;
  bitsPerSecond: number;
  commutationType: CommutationType;
  engineeringUnits?: string | undefined;
  conversionType?: string | undefined;
  line: number;
}

export interface CommutatorGridResult {
  pcmIndex: number;
  dataLinkName: string;
  bitRateBps: number;
  wordLengthBits: number;
  wordsPerMinorFrame: number;
  bitsPerMinorFrame: number;
  minorFramesPerMajorFrame: number;
  syncPattern: string;
  syncPatternBits: number;
  minorFrameRateHz: number;
  majorFrameRateHz: number;
  wordRateHz: number;
  minorFramePeriodSec: number;
  majorFramePeriodSec: number;
  /** 2D array: grid[frameIdx0][colIdx0], where col 0..wordsPerMinorFrame-1 are data words and last col is SYNC */
  grid: CommutatorCell[][];
  schedules: ParameterSchedule[];
  conflicts: CommutatorConflict[];
  totalDataSlots: number;
  occupiedDataSlots: number;
  utilizationPercent: number;
}

/**
 * Expands a measurement's word positions within a minor frame (handling supercommutation `WI`).
 */
export function expandWordPositions(meas: TmatsMeasurement, wordsPerMinorFrame: number): number[] {
  if (meas.wordPosition === undefined || meas.wordPosition < 1) return [];
  const start = Math.floor(meas.wordPosition);
  if (start > wordsPerMinorFrame) return [start]; // keep out-of-bounds for linting
  const interval = meas.wordInterval !== undefined && meas.wordInterval > 0 ? Math.floor(meas.wordInterval) : 0;
  if (interval <= 0) return [start];
  const positions: number[] = [];
  for (let w = start; w <= wordsPerMinorFrame; w += interval) {
    positions.push(w);
  }
  return positions;
}

/**
 * Expands a measurement's minor frame positions within a major frame (handling subcommutation `FP`/`FI`).
 */
export function expandFramePositions(meas: TmatsMeasurement, minorFramesPerMajorFrame: number): number[] {
  const start = Math.max(1, Math.floor(meas.framePosition || 1));
  if (start > minorFramesPerMajorFrame) return [start];
  const interval = Math.max(1, Math.floor(meas.frameInterval || 1));
  const positions: number[] = [];
  for (let f = start; f <= minorFramesPerMajorFrame; f += interval) {
    positions.push(f);
  }
  return positions;
}

function bitRangesOverlap(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  if (aLen <= 0 || bLen <= 0) return false;
  const aEnd = aStart + aLen;
  const bEnd = bStart + bLen;
  return aStart < bEnd && bStart < aEnd;
}

function resolvePcmFormat(model: TmatsModel, pcmIndex?: number): TmatsPcmFormatGroup | undefined {
  if (pcmIndex !== undefined) return model.pcmFormats.get(pcmIndex);
  return model.pcmFormats.values().next().value;
}

/**
 * Builds the 2D PCM Major/Minor Frame Commutator Grid and computes per-parameter sample rates & bandwidths.
 */
export function buildCommutatorGrid(model: TmatsModel, pcmIndex?: number): CommutatorGridResult {
  const pcm = resolvePcmFormat(model, pcmIndex);
  const idx = pcm?.index ?? pcmIndex ?? 1;
  const dataLinkName = pcm?.dataLinkName ?? `PCM_${idx}`;
  const wordLengthBits = pcm?.commonWordLengthBits ?? 16;
  const wordsPerMinorFrame = Math.max(0, Math.floor(pcm?.wordsPerMinorFrame ?? 0));
  const syncPattern = pcm?.syncPattern ?? "";
  const syncPatternBits = pcm?.syncPatternBits ?? 0;
  const bitsPerMinorFrame =
    pcm?.bitsPerMinorFrame && pcm.bitsPerMinorFrame > 0
      ? pcm.bitsPerMinorFrame
      : wordsPerMinorFrame * wordLengthBits + syncPatternBits;
  const bitRateBps = pcm?.bitRateBps ?? 0;
  const minorFramesPerMajorFrame = Math.max(1, pcm?.minorFramesPerMajorFrame ?? 1);

  const minorFrameRateHz = bitsPerMinorFrame > 0 ? bitRateBps / bitsPerMinorFrame : 0;
  const majorFrameRateHz = minorFrameRateHz / minorFramesPerMajorFrame;
  const wordRateHz = wordsPerMinorFrame * minorFrameRateHz;
  const minorFramePeriodSec = minorFrameRateHz > 0 ? 1 / minorFrameRateHz : 0;
  const majorFramePeriodSec = majorFrameRateHz > 0 ? 1 / majorFrameRateHz : 0;

  // Initialize grid: minorFramesPerMajorFrame rows x (wordsPerMinorFrame + 1) columns (last column = SYNC)
  const grid: CommutatorCell[][] = [];
  for (let f = 1; f <= minorFramesPerMajorFrame; f++) {
    const row: CommutatorCell[] = [];
    for (let w = 1; w <= wordsPerMinorFrame; w++) {
      row.push({
        frameIndex: f,
        wordPosition: w,
        isSync: false,
        assignments: [],
        hasConflict: false,
      });
    }
    row.push({
      frameIndex: f,
      wordPosition: wordsPerMinorFrame + 1,
      isSync: true,
      assignments: syncPattern
        ? [
            {
              measurementName: `SYNC (${syncPattern})`,
              bitStart: 0,
              bitLength: syncPatternBits || wordLengthBits,
              line: pcm?.line ?? 1,
              isSync: true,
            },
          ]
        : [],
      hasConflict: false,
    });
    grid.push(row);
  }

  // Gather measurements matching this PCM format's DLN (or matching index)
  const measurements: TmatsMeasurement[] = [];
  for (const dg of model.measurementGroups.values()) {
    if (
      (pcm?.dataLinkName && dg.dataLinkName === pcm.dataLinkName) ||
      (!dg.dataLinkName && dg.index === idx) ||
      model.pcmFormats.size <= 1
    ) {
      measurements.push(...dg.measurements);
    }
  }

  const conflicts: CommutatorConflict[] = [];
  const schedules: ParameterSchedule[] = [];

  for (const meas of measurements) {
    const wordPositions = expandWordPositions(meas, wordsPerMinorFrame).filter(
      (w) => w >= 1 && w <= wordsPerMinorFrame,
    );
    const framePositions = expandFramePositions(meas, minorFramesPerMajorFrame).filter(
      (f) => f >= 1 && f <= minorFramesPerMajorFrame,
    );

    const maskRange = parseWordFragmentMask(meas.wordFragmentMask, wordLengthBits);
    const bitStart = meas.bitStart ?? maskRange.bitStart;
    const bitLength = meas.bitLength ?? maskRange.bitLength;

    for (const f of framePositions) {
      for (const w of wordPositions) {
        const cell = grid[f - 1]![w - 1]!;
        for (const existing of cell.assignments) {
          if (
            existing.measurementName !== meas.name &&
            bitRangesOverlap(existing.bitStart, existing.bitLength, bitStart, bitLength)
          ) {
            cell.hasConflict = true;
            conflicts.push({
              frameIndex: f,
              wordPosition: w,
              measurementA: existing.measurementName,
              measurementB: meas.name,
              line: meas.line,
            });
          }
        }
        cell.assignments.push({
          measurementName: meas.name,
          bitStart,
          bitLength,
          line: meas.line,
        });
      }
    }

    const slotsPerMajorFrame = wordPositions.length * framePositions.length;
    const sampleRateHz = slotsPerMajorFrame * majorFrameRateHz;
    const nyquistBandwidthHz = sampleRateHz / 2;
    const bitsPerSecond = sampleRateHz * bitLength;

    const isSuper = wordPositions.length > 1;
    const isSub = framePositions.length < minorFramesPerMajorFrame && minorFramesPerMajorFrame > 1;
    let commutationType: CommutationType = "normal";
    if (isSuper && isSub) commutationType = "super-subcommutated";
    else if (isSuper) commutationType = "supercommutated";
    else if (isSub) commutationType = "subcommutated";

    const conv = model.conversionsByName.get(meas.name);
    schedules.push({
      name: meas.name,
      wordPositions,
      framePositions,
      slotsPerMajorFrame,
      sampleRateHz,
      nyquistBandwidthHz,
      bitLength,
      bitsPerSecond,
      commutationType,
      engineeringUnits: conv?.engineeringUnits,
      conversionType: conv?.conversionType,
      line: meas.line,
    });
  }

  const totalDataSlots = minorFramesPerMajorFrame * wordsPerMinorFrame;
  let occupiedDataSlots = 0;
  for (let f = 0; f < minorFramesPerMajorFrame; f++) {
    for (let w = 0; w < wordsPerMinorFrame; w++) {
      if (grid[f]![w]!.assignments.length > 0) occupiedDataSlots++;
    }
  }
  const utilizationPercent = totalDataSlots > 0 ? (occupiedDataSlots / totalDataSlots) * 100 : 0;

  return {
    pcmIndex: idx,
    dataLinkName,
    bitRateBps,
    wordLengthBits,
    wordsPerMinorFrame,
    bitsPerMinorFrame,
    minorFramesPerMajorFrame,
    syncPattern,
    syncPatternBits,
    minorFrameRateHz,
    majorFrameRateHz,
    wordRateHz,
    minorFramePeriodSec,
    majorFramePeriodSec,
    grid,
    schedules,
    conflicts,
    totalDataSlots,
    occupiedDataSlots,
    utilizationPercent,
  };
}

/**
 * Evaluates a polynomial engineering-unit calibration y = sum_{k=0}^{n} c_k * x^k using Horner's method.
 */
export function evaluatePolynomialCalibration(coefficients: readonly number[], rawCounts: number): number {
  if (coefficients.length === 0) return rawCounts;
  let acc = 0;
  for (let k = coefficients.length - 1; k >= 0; k--) {
    acc = acc * rawCounts + coefficients[k]!;
  }
  return acc;
}

/**
 * Decodes an unsigned integer PCM word according to TMATS `C-x\BFM` binary format.
 */
export function decodeBinaryWord(rawUnsigned: number, bitLength: number, binaryFormat: string = "UNS"): number {
  const bits = Math.max(1, Math.min(53, Math.floor(bitLength)));
  const mask = Math.pow(2, bits) - 1;
  const masked = Math.floor(rawUnsigned) & mask;
  const signBit = Math.pow(2, bits - 1);
  const fmt = binaryFormat.trim().toUpperCase();

  switch (fmt) {
    case "TWO":
      return masked >= signBit ? masked - Math.pow(2, bits) : masked;
    case "ONE":
      return masked >= signBit ? masked - (Math.pow(2, bits) - 1) : masked;
    case "OFF":
      return masked - signBit;
    case "SIG": {
      const mag = masked & (signBit - 1);
      return masked >= signBit ? -mag : mag;
    }
    case "UNS":
    default:
      return masked;
  }
}

/**
 * Evaluates a TMATS `C-x` data conversion (COE polynomial, PRS piecewise linear table, NON identity, DER derived).
 */
export function evaluateConversion(
  conversion: TmatsConversionGroup,
  rawCounts: number,
  derivedValues?: Record<string, number>,
): number {
  switch (conversion.conversionType) {
    case "COE":
      return evaluatePolynomialCalibration(conversion.coefficients, rawCounts);

    case "PRS": {
      const pts = conversion.pairSets;
      if (pts.length === 0) return rawCounts;
      if (pts.length === 1 || rawCounts <= pts[0]!.raw) return pts[0]!.eu;
      const last = pts[pts.length - 1]!;
      if (rawCounts >= last.raw) return last.eu;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (rawCounts >= a.raw && rawCounts <= b.raw) {
          const span = b.raw - a.raw;
          if (span === 0) return a.eu;
          const t = (rawCounts - a.raw) / span;
          return a.eu + t * (b.eu - a.eu);
        }
      }
      return last.eu;
    }

    case "DER": {
      if (derivedValues && conversion.derivedParameters.length > 0) {
        let sum = 0;
        for (const p of conversion.derivedParameters) {
          sum += derivedValues[p] ?? 0;
        }
        return conversion.coefficients.length > 0 ? evaluatePolynomialCalibration(conversion.coefficients, sum) : sum;
      }
      return evaluatePolynomialCalibration(conversion.coefficients, rawCounts);
    }

    case "NON":
    case "DIS":
    case "OTH":
    default:
      return rawCounts;
  }
}

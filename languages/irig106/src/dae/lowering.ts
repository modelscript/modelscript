// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for IRIG 106 Chapter 9 TMATS Telemetry Channels.
 *
 * Lowers PCM minor/major frame timing parameters, per-channel sampling & Nyquist
 * bandwidth equations, and Horner-form polynomial engineering-unit calibration
 * equations directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { buildCommutatorGrid } from "../solver/commutator.js";
import type { TmatsModel } from "../types.js";

export interface Irig106DaeLoweringResult {
  channelCount: number;
  equationCount: number;
  variableMap: Map<string, number>;
}

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Lowers a `TmatsModel` directly into an `IDaeBuilder` linear-memory arena.
 */
export function lowerIrig106ToDae(builder: IDaeBuilder, model: TmatsModel): Irig106DaeLoweringResult {
  const variableMap = new Map<string, number>();
  let equationCount = 0;
  let channelCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    causality: Causality = Causality.Local,
    startVal: number = 0.0,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const lookedUp = builder.lookupVariable(name);
    if (lookedUp !== -1) {
      variableMap.set(name, lookedUp);
      return lookedUp;
    }
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  const pcmIndices = model.pcmFormats.size > 0 ? Array.from(model.pcmFormats.keys()) : [1];

  for (const pcmIdx of pcmIndices) {
    const grid = buildCommutatorGrid(model, pcmIdx);
    const prefix = pcmIndices.length > 1 ? `p${pcmIdx}_` : "";

    // Frame timing parameters & relations
    const bitRateVar = getOrAddVar(`${prefix}pcm_bit_rate`, Variability.Parameter, Causality.Local, grid.bitRateBps);
    const bitsPerFrameVar = getOrAddVar(
      `${prefix}pcm_bits_per_minor_frame`,
      Variability.Parameter,
      Causality.Local,
      Math.max(1, grid.bitsPerMinorFrame),
    );
    const minorFramesVar = getOrAddVar(
      `${prefix}pcm_minor_frames_per_major`,
      Variability.Parameter,
      Causality.Local,
      grid.minorFramesPerMajorFrame,
    );
    const minorFrameRateVar = getOrAddVar(
      `${prefix}pcm_minor_frame_rate`,
      Variability.Continuous,
      Causality.Output,
      grid.minorFrameRateHz,
    );
    const majorFrameRateVar = getOrAddVar(
      `${prefix}pcm_major_frame_rate`,
      Variability.Continuous,
      Causality.Output,
      grid.majorFrameRateHz,
    );

    // pcm_minor_frame_rate = pcm_bit_rate / pcm_bits_per_minor_frame
    builder.addEquation(
      EqKind.Simple,
      builder.addName(minorFrameRateVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(bitRateVar), builder.addName(bitsPerFrameVar)),
    );
    equationCount++;

    // pcm_major_frame_rate = pcm_minor_frame_rate / pcm_minor_frames_per_major
    builder.addEquation(
      EqKind.Simple,
      builder.addName(majorFrameRateVar),
      builder.addBinaryExpr(BinOp.Div, builder.addName(minorFrameRateVar), builder.addName(minorFramesVar)),
    );
    equationCount++;

    // Per-channel calibration & sampling equations
    for (const sched of grid.schedules) {
      channelCount++;
      const id = sanitizeId(sched.name);

      const rawVar = getOrAddVar(`${prefix}raw_${id}`, Variability.Continuous, Causality.Input, 0.0);
      const euVar = getOrAddVar(`${prefix}eu_${id}`, Variability.Continuous, Causality.Output, 0.0);
      const slotsVar = getOrAddVar(
        `${prefix}slots_${id}`,
        Variability.Parameter,
        Causality.Local,
        sched.slotsPerMajorFrame,
      );
      const fsVar = getOrAddVar(`${prefix}fs_${id}`, Variability.Continuous, Causality.Output, sched.sampleRateHz);
      const bwVar = getOrAddVar(
        `${prefix}bw_${id}`,
        Variability.Continuous,
        Causality.Output,
        sched.nyquistBandwidthHz,
      );

      // fs = slots_per_major_frame * pcm_major_frame_rate
      builder.addEquation(
        EqKind.Simple,
        builder.addName(fsVar),
        builder.addBinaryExpr(BinOp.Mul, builder.addName(slotsVar), builder.addName(majorFrameRateVar)),
      );
      equationCount++;

      // bw = 0.5 * fs (Nyquist sampling limit)
      builder.addEquation(
        EqKind.Simple,
        builder.addName(bwVar),
        builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(0.5), builder.addName(fsVar)),
      );
      equationCount++;

      // Calibration equation: eu = sum_{k=0}^{n} c_k * raw^k (Horner form)
      const conv = model.conversionsByName.get(sched.name);
      let rhsExpr: number;
      if (conv && conv.conversionType === "COE" && conv.coefficients.length > 0) {
        const coeffs = conv.coefficients;
        rhsExpr = builder.addRealLiteral(coeffs[coeffs.length - 1]!);
        for (let k = coeffs.length - 2; k >= 0; k--) {
          const mulExpr = builder.addBinaryExpr(BinOp.Mul, rhsExpr, builder.addName(rawVar));
          rhsExpr = builder.addBinaryExpr(BinOp.Add, mulExpr, builder.addRealLiteral(coeffs[k]!));
        }
      } else {
        // Identity pass-through: eu = raw
        rhsExpr = builder.addName(rawVar);
      }

      builder.addEquation(EqKind.Simple, builder.addName(euVar), rhsExpr);
      equationCount++;
    }
  }

  return {
    channelCount,
    equationCount,
    variableMap,
  };
}

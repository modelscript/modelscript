// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for `@modelscript/jcamp-dx`.
 *
 * Lowers Beer-Lambert optical absorption (`A = eps * c * l`, `T = 10^(-A)`, `I = I0 * T`)
 * and Lorentzian / Gaussian spectral absorption line-shape models directly into
 * `@modelscript/runtime`'s `IDaeBuilder` without allocating intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { parseJcampDx } from "../parser/jcamp-parser.js";
import { findSpectralPeaks } from "../solver/spectroscopy.js";
import type { JcampBlock, JcampDocument } from "../types.js";

export type LineShapeKind = "lorentzian" | "gaussian";

export interface JcampDaeLoweringOptions {
  /** Line-shape model for detected spectral bands (`"lorentzian"` or `"gaussian"`). Default `"lorentzian"`. */
  lineShape?: LineShapeKind;
  /** Maximum number of dominant spectral peaks to lower as line-shape oscillators (default `6`). */
  maxPeaks?: number;
  /** Default half-width at half-maximum / sigma in X units (default `15.0`). */
  defaultWidth?: number;
  /** Molar absorptivity `eps` [L/(mol·cm)] for Beer-Lambert equation (default `100.0`). */
  molarAbsorptivity?: number;
  /** Optical path length `l` [cm] (default `1.0`). */
  pathLength?: number;
  /** Analyte concentration `c` [mol/L] (default `0.01`). */
  concentration?: number;
}

export interface JcampDaeLoweringResult {
  variableMap: Map<string, number>;
  equationCount: number;
  peakCount: number;
  lineShape: LineShapeKind;
}

/**
 * Lowers a JCAMP-DX spectrum's Beer-Lambert optical balance and Lorentzian/Gaussian
 * absorption band equations directly into `IDaeBuilder`.
 */
export function lowerJcampDxToDae(
  builder: IDaeBuilder,
  input: string | JcampDocument | JcampBlock,
  options: JcampDaeLoweringOptions = {},
): JcampDaeLoweringResult {
  const block: JcampBlock =
    typeof input === "string"
      ? (parseJcampDx(input).primary ?? {
          title: "Empty",
          jcampDxVersion: "4.24",
          dataType: "INFRARED SPECTRUM",
          points: [],
          peakTable: [],
          ldrs: [],
          comments: [],
          checkpointErrors: [],
          parseErrors: [],
          children: [],
          startLine: 1,
          endLine: 1,
          hasEnd: false,
        })
      : "blocks" in input
        ? (input.primary ?? input.blocks[0]!)
        : input;

  const lineShape: LineShapeKind = options.lineShape ?? "lorentzian";
  const maxPeaks = options.maxPeaks ?? 6;
  const defaultWidth = options.defaultWidth ?? 15.0;
  const epsVal = options.molarAbsorptivity ?? 100.0;
  const pathVal = options.pathLength ?? 1.0;
  const concVal = options.concentration ?? 0.01;

  const variableMap = new Map<string, number>();
  let equationCount = 0;

  function addVar(name: string, variability: Variability, causality: Causality, startVal: number): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Independent spectral coordinate (wavenumber / ppm / wavelength)
  const pts = block.points.length > 0 ? block.points : block.peakTable;
  const xStart = block.firstX ?? pts[0]?.x ?? 1700.0;

  const vX = addVar("spectral_x", Variability.Continuous, Causality.Input, xStart);
  const vEps = addVar("beer_lambert_eps", Variability.Parameter, Causality.Local, epsVal);
  const vConc = addVar("beer_lambert_c", Variability.Parameter, Causality.Local, concVal);
  const vPath = addVar("beer_lambert_l", Variability.Parameter, Causality.Local, pathVal);
  const vI0 = addVar("incident_intensity_I0", Variability.Parameter, Causality.Local, 1.0);

  const vBeerA = addVar("beer_lambert_A", Variability.Continuous, Causality.Output, epsVal * concVal * pathVal);
  const vTotalA = addVar("spectrum_absorbance", Variability.Continuous, Causality.Output, 0.0);
  const vTrans = addVar("spectrum_transmittance", Variability.Continuous, Causality.Output, 1.0);
  const vIntensity = addVar("transmitted_intensity_I", Variability.Continuous, Causality.Output, 1.0);

  // Equation 1: Beer-Lambert law: beer_lambert_A = eps * c * l
  const epsC = builder.addBinaryExpr(BinOp.Mul, builder.addName(vEps), builder.addName(vConc));
  const epsCL = builder.addBinaryExpr(BinOp.Mul, epsC, builder.addName(vPath));
  builder.addEquation(EqKind.Simple, builder.addName(vBeerA), epsCL);
  equationCount++;

  // Detect dominant spectral peaks to lower as Lorentzian / Gaussian bands
  const isTrans = (block.yUnits ?? "").toUpperCase().includes("TRANS");
  const detected = findSpectralPeaks(pts, {
    mode: isTrans ? "minima" : "maxima",
    minProminence: 0.01,
  }).slice(0, maxPeaks);

  // If no peaks detected from data, synthesize a single representative band at xStart
  const bands =
    detected.length > 0
      ? detected.map((pk) => ({
          center: pk.x,
          amplitude: isTrans ? Math.max(0.05, -Math.log10(Math.max(pk.y, 1e-4))) : Math.max(0.05, pk.y),
          width: defaultWidth,
        }))
      : [{ center: xStart, amplitude: epsVal * concVal * pathVal, width: defaultWidth }];

  let sumAbsExpr: number | null = null;

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!;
    const vCenter = addVar(`band_${i}_x0`, Variability.Parameter, Causality.Local, b.center);
    const vAmp = addVar(`band_${i}_A`, Variability.Parameter, Causality.Local, b.amplitude);
    const vWidth = addVar(`band_${i}_w`, Variability.Parameter, Causality.Local, b.width);
    const vBandA = addVar(`band_${i}_absorbance`, Variability.Continuous, Causality.Local, 0.0);

    // dx = spectral_x - band_i_x0
    const dx = builder.addBinaryExpr(BinOp.Sub, builder.addName(vX), builder.addName(vCenter));
    const dx2 = builder.addBinaryExpr(BinOp.Mul, dx, dx);
    const w2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(vWidth), builder.addName(vWidth));

    let bandExpr: number;
    if (lineShape === "lorentzian") {
      // A_i(x) = A * w^2 / ((x - x0)^2 + w^2)
      const num = builder.addBinaryExpr(BinOp.Mul, builder.addName(vAmp), w2);
      const den = builder.addBinaryExpr(BinOp.Add, dx2, w2);
      bandExpr = builder.addBinaryExpr(BinOp.Div, num, den);
    } else {
      // Gaussian: A_i(x) = A * exp(-0.5 * (x - x0)^2 / w^2)
      // Expressed with Pow(e, exponent) for universal IDaeBuilder compatibility
      const twoW2 = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(2.0), w2);
      const ratio = builder.addBinaryExpr(BinOp.Div, dx2, twoW2);
      const negRatio = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), ratio);
      const expTerm = builder.addBinaryExpr(BinOp.Pow, builder.addRealLiteral(Math.E), negRatio);
      bandExpr = builder.addBinaryExpr(BinOp.Mul, builder.addName(vAmp), expTerm);
    }

    builder.addEquation(EqKind.Simple, builder.addName(vBandA), bandExpr);
    equationCount++;

    sumAbsExpr =
      sumAbsExpr === null
        ? builder.addName(vBandA)
        : builder.addBinaryExpr(BinOp.Add, sumAbsExpr, builder.addName(vBandA));
  }

  // Equation: spectrum_absorbance = sum_i band_i_absorbance
  builder.addEquation(EqKind.Simple, builder.addName(vTotalA), sumAbsExpr ?? builder.addName(vBeerA));
  equationCount++;

  // Equation: spectrum_transmittance = 10 ^ (-spectrum_absorbance)
  const negA = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), builder.addName(vTotalA));
  const transExpr = builder.addBinaryExpr(BinOp.Pow, builder.addRealLiteral(10.0), negA);
  builder.addEquation(EqKind.Simple, builder.addName(vTrans), transExpr);
  equationCount++;

  // Equation: transmitted_intensity_I = incident_intensity_I0 * spectrum_transmittance
  const intensityExpr = builder.addBinaryExpr(BinOp.Mul, builder.addName(vI0), builder.addName(vTrans));
  builder.addEquation(EqKind.Simple, builder.addName(vIntensity), intensityExpr);
  equationCount++;

  return {
    variableMap,
    equationCount,
    peakCount: bands.length,
    lineShape,
  };
}

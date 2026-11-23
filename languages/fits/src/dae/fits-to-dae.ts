// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Zero-GC Linear DAE Arena Lowering for FITS Photometry & Radiative Transfer.
 *
 * Lowers FITS HDU physical calibration (`BSCALE`/`BZERO`), exposure flux rate,
 * instrumental magnitude, and 1D Beer-Lambert radiative transfer differential equations
 * directly into ModelScript's linear memory `DAEBuilder` arena (`ExprId`, `EqId`, `VarId`):
 *
 * - Physical pixel calibration:  `flux_phys = bzero + bscale * adu_count`
 * - Exposure-normalized flux:    `flux_rate = flux_phys / exptime`
 * - Radiative transfer ODE:      `der(intensity) = -kappa * intensity + source_emissivity`
 * - Optical depth ODE:           `der(tau) = kappa`
 * - Attenuated observed flux:    `flux_obs = intensity * aperture_area`
 * - Calibrated magnitude:        `mag = zp - 2.5 * log10(flux_obs / flux_ref)`
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { computeImageStatistics } from "../solver/photometry.js";
import type { FitsDocument, FitsHdu } from "../types.js";

export interface FitsDaeOptions {
  /** Index of HDU to lower (default: 0). */
  hduIndex?: number | undefined;
  /** Override model name in DAEBuilder. */
  modelName?: string | undefined;
  /** Photometric zero-point magnitude (default: 25.0). */
  zeroPoint?: number | undefined;
  /** Extinction opacity coefficient kappa (1/m, default: 0.12). */
  kappa?: number | undefined;
  /** Source emissivity j (W sr^-1 m^-3, default: 0.05). */
  emissivity?: number | undefined;
  /** Collecting aperture area (m^2, default: 1.0). */
  apertureArea?: number | undefined;
}

function getNumericCard(hdu: FitsHdu | undefined, key: string, fallback: number): number {
  const card = hdu?.header.keywords[key];
  return card && typeof card.value === "number" && Number.isFinite(card.value) ? card.value : fallback;
}

function getStringCard(hdu: FitsHdu | undefined, key: string): string | undefined {
  const card = hdu?.header.keywords[key];
  return card && typeof card.value === "string" ? card.value.trim() : undefined;
}

/**
 * Lowers a `FitsDocument` HDU into a balanced `DAEBuilder` linear-memory arena
 * (`varCount === eqCount`) modeling photometric calibration and radiative transfer.
 */
export function lowerFitsToDae(doc: FitsDocument, options: FitsDaeOptions = {}): DAEBuilder {
  const interner = new StringInterner();
  const hdu = doc.hdus[options.hduIndex ?? 0] ?? doc.hdus[0];

  const rawName = options.modelName ?? getStringCard(hdu, "OBJECT") ?? hdu?.name ?? "FITS_Model";
  const name = rawName.replace(/[^a-zA-Z0-9_]/g, "_") || "FITS_Model";
  const arena = new DAEBuilder(interner, name);

  function addVar(varName: string, variability: Variability, initVal: number): number {
    arena.addVariable(varName, VarType.Real, variability, Causality.Local, initVal);
    const id = interner.intern(varName);
    return arena.addExpression(ExprKind.Name, id);
  }

  const bscale = getNumericCard(hdu, "BSCALE", hdu?.image?.bscale ?? 1.0);
  const bzero = getNumericCard(hdu, "BZERO", hdu?.image?.bzero ?? 0.0);
  const exptime = Math.max(1e-6, getNumericCard(hdu, "EXPTIME", 1.0));
  const zp = options.zeroPoint ?? getNumericCard(hdu, "MAGZPT", 25.0);
  const kappa = options.kappa ?? 0.12;
  const emissivity = options.emissivity ?? 0.05;
  const apertureArea = options.apertureArea ?? 1.0;

  let initialAdu = 1000.0;
  if (hdu?.image && hdu.image.data.length > 0) {
    const stats = computeImageStatistics(hdu.image.data);
    // Recover mean raw ADU from physical mean
    const invScale = bscale !== 0 ? 1.0 / bscale : 1.0;
    initialAdu = Math.max(1.0, (stats.mean - bzero) * invScale);
  }

  // 1. Parameters (each with a defining equation to keep varCount === eqCount)
  const bscaleExpr = addVar(`${name}_bscale`, Variability.Parameter, bscale);
  arena.addEquation(EqKind.Simple, bscaleExpr, arena.addRealLiteral(bscale));

  const bzeroExpr = addVar(`${name}_bzero`, Variability.Parameter, bzero);
  arena.addEquation(EqKind.Simple, bzeroExpr, arena.addRealLiteral(bzero));

  const exptimeExpr = addVar(`${name}_exptime`, Variability.Parameter, exptime);
  arena.addEquation(EqKind.Simple, exptimeExpr, arena.addRealLiteral(exptime));

  const aduExpr = addVar(`${name}_adu`, Variability.Parameter, initialAdu);
  arena.addEquation(EqKind.Simple, aduExpr, arena.addRealLiteral(initialAdu));

  const kappaExpr = addVar(`${name}_kappa`, Variability.Parameter, kappa);
  arena.addEquation(EqKind.Simple, kappaExpr, arena.addRealLiteral(kappa));

  const emissExpr = addVar(`${name}_emissivity`, Variability.Parameter, emissivity);
  arena.addEquation(EqKind.Simple, emissExpr, arena.addRealLiteral(emissivity));

  const areaExpr = addVar(`${name}_aperture_area`, Variability.Parameter, apertureArea);
  arena.addEquation(EqKind.Simple, areaExpr, arena.addRealLiteral(apertureArea));

  const zpExpr = addVar(`${name}_zero_point`, Variability.Parameter, zp);
  arena.addEquation(EqKind.Simple, zpExpr, arena.addRealLiteral(zp));

  // 2. Algebraic photometric calibration variables
  const initPhys = bzero + bscale * initialAdu;
  const fluxPhysExpr = addVar(`${name}_flux_phys`, Variability.Continuous, initPhys);
  arena.addEquation(
    EqKind.Simple,
    fluxPhysExpr,
    arena.addBinaryExpr(BinOp.Add, bzeroExpr, arena.addBinaryExpr(BinOp.Mul, bscaleExpr, aduExpr)),
  );

  const initRate = Math.max(1e-9, initPhys / exptime);
  const fluxRateExpr = addVar(`${name}_flux_rate`, Variability.Continuous, initRate);
  arena.addEquation(EqKind.Simple, fluxRateExpr, arena.addBinaryExpr(BinOp.Div, fluxPhysExpr, exptimeExpr));

  // 3. Radiative transfer differential equations (Beer-Lambert + source emissivity)
  // der(intensity) = emissivity - kappa * intensity
  const intensityExpr = addVar(`${name}_intensity`, Variability.Continuous, initRate);
  const absorptionTerm = arena.addBinaryExpr(BinOp.Mul, kappaExpr, intensityExpr);
  arena.addEquation(
    EqKind.Simple,
    arena.addDer(intensityExpr),
    arena.addBinaryExpr(BinOp.Sub, emissExpr, absorptionTerm),
  );

  // der(tau) = kappa (cumulative optical depth along path)
  const tauExpr = addVar(`${name}_tau`, Variability.Continuous, 0.0);
  arena.addEquation(EqKind.Simple, arena.addDer(tauExpr), kappaExpr);

  // 4. Observed flux & calibrated instrumental magnitude
  const initObs = Math.max(1e-9, initRate * apertureArea);
  const fluxObsExpr = addVar(`${name}_flux_obs`, Variability.Continuous, initObs);
  arena.addEquation(EqKind.Simple, fluxObsExpr, arena.addBinaryExpr(BinOp.Mul, intensityExpr, areaExpr));

  const initMag = zp - 2.5 * Math.log10(initObs);
  const magExpr = addVar(`${name}_magnitude`, Variability.Continuous, initMag);
  const logTerm = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.5), arena.addCallExpr("log10", [fluxObsExpr]));
  arena.addEquation(EqKind.Simple, magExpr, arena.addBinaryExpr(BinOp.Sub, zpExpr, logTerm));

  return arena;
}

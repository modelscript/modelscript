// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Zero-GC Linear DAE Arena Lowering for Atmospheric Primitive-Equation Balance.
 *
 * Lowers GRIB Edition 1 synoptic meteorological fields into ModelScript's linear memory
 * `DAEBuilder` arena (`ExprId`, `EqId`, `VarId`) with exact structural balance (`varCount === eqCount`):
 *
 * - Ideal-gas density:          `rho = p_hydro / (R_d * T_mean)`
 * - Hydrostatic balance ODE:    `der(p_hydro) = -rho * g0`
 * - Geostrophic wind balance:   `u_g = -(g0 / f_coriolis) * dZ_dy`
 *                               `v_g =  (g0 / f_coriolis) * dZ_dx`
 * - Inertial momentum ODEs:     `der(u) =  f_coriolis * (v - v_g)`
 *                               `der(v) = -f_coriolis * (u - u_g)`
 * - Specific kinetic energy:    `ke = 0.5 * (u * u + v * v)`
 * - GRIB1 physical unpacking:   `y_phys = (ref_value + x_packed * two_pow_E) * ten_neg_D`
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
import {
  computeCoriolisParameter,
  computeGeostrophicWindField,
  R_DRY_AIR,
  STANDARD_GRAVITY,
} from "../solver/meteorology.js";
import { computeGribFieldStats } from "../solver/packing.js";
import type { GribDocument } from "../types.js";

export interface GribDaeOptions {
  /** Message index to lower (default: 0). */
  messageIndex?: number | undefined;
  /** Override DAE model name. */
  modelName?: string | undefined;
  /** Representative latitude in degrees for Coriolis parameter f (default: mean GDS latitude or 45 deg). */
  latitudeDeg?: number | undefined;
  /** Mean column temperature in Kelvin (default: 265 K or TMP field mean). */
  meanTemperatureK?: number | undefined;
  /** Reference pressure in Pa (default: 50000 Pa or ISBL level * 100). */
  referencePressurePa?: number | undefined;
}

/**
 * Lowers a `GribDocument` message into a balanced `DAEBuilder` linear-memory arena
 * (`varCount === eqCount`) capturing atmospheric hydrostatic + geostrophic balance
 * and WMO GRIB1 physical unpacking.
 */
export function lowerGribToDae(doc: GribDocument, options: GribDaeOptions = {}): DAEBuilder {
  const interner = new StringInterner();
  const msg = doc.messages[options.messageIndex ?? 0] ?? doc.messages[0];

  const paramName = msg?.pds?.parameterName ?? (msg?.pds ? `P${msg.pds.parameterCode}` : "FIELD");
  const rawName = options.modelName ?? `GRIB1_${paramName}`;
  const name = rawName.replace(/[^a-zA-Z0-9_]/g, "_") || "GRIB1_Model";
  const arena = new DAEBuilder(interner, name);

  function addVar(varName: string, variability: Variability, initVal: number): number {
    arena.addVariable(varName, VarType.Real, variability, Causality.Local, initVal);
    const id = interner.intern(varName);
    return arena.addExpression(ExprKind.Name, id);
  }

  function bin(op: BinOp, left: number, right: number): number {
    return arena.addExpression(ExprKind.Binary, op, left, right);
  }

  const gds = msg?.gds;
  const bds = msg?.bds;
  const pds = msg?.pds;

  const latDeg = options.latitudeDeg ?? (gds ? (gds.la1 + gds.la2) * 0.5 : 45.0);
  const fRaw = computeCoriolisParameter(latDeg);
  const fCoriolis = Math.abs(fRaw) < 1e-6 ? computeCoriolisParameter(45.0) : fRaw;

  const stats = bds ? computeGribFieldStats(bds.values, gds) : null;
  const meanTempK =
    options.meanTemperatureK ??
    (pds?.parameterCode === 11 && stats && stats.validCount > 0 ? stats.areaWeightedMean : 265.0);
  const refPressurePa =
    options.referencePressurePa ?? (pds?.levelType === 100 && pds.levelValue > 0 ? pds.levelValue * 100 : 50000.0);

  // Estimate representative horizontal geopotential gradients (m/m)
  let dZdx = 2.0e-5;
  let dZdy = -1.5e-5;
  if (gds && bds && pds?.parameterCode === 7 && gds.ni >= 2 && gds.nj >= 2 && bds.values.length === gds.ni * gds.nj) {
    const field = computeGeostrophicWindField(bds.values, gds);
    const midIdx = Math.floor(gds.nj / 2) * gds.ni + Math.floor(gds.ni / 2);
    const uMid = field.u[midIdx] ?? 10.0;
    const vMid = field.v[midIdx] ?? 5.0;
    dZdy = -(fCoriolis / STANDARD_GRAVITY) * uMid;
    dZdx = (fCoriolis / STANDARD_GRAVITY) * vMid;
  }

  const refValue = bds?.referenceValue ?? 0.0;
  const twoPowE = Math.pow(2, bds?.binaryScaleFactor ?? 0);
  const tenNegD = Math.pow(10, -(pds?.decimalScaleFactor ?? 0));
  const samplePackedX = bds?.packedValues?.[0] ?? 1.0;

  // 1. Parameters (each with a defining equation to ensure varCount === eqCount)
  const g0Expr = addVar(`${name}_g0`, Variability.Parameter, STANDARD_GRAVITY);
  arena.addEquation(EqKind.Simple, g0Expr, arena.addRealLiteral(STANDARD_GRAVITY));

  const rdExpr = addVar(`${name}_R_d`, Variability.Parameter, R_DRY_AIR);
  arena.addEquation(EqKind.Simple, rdExpr, arena.addRealLiteral(R_DRY_AIR));

  const fExpr = addVar(`${name}_f_coriolis`, Variability.Parameter, fCoriolis);
  arena.addEquation(EqKind.Simple, fExpr, arena.addRealLiteral(fCoriolis));

  const tMeanExpr = addVar(`${name}_T_mean`, Variability.Parameter, meanTempK);
  arena.addEquation(EqKind.Simple, tMeanExpr, arena.addRealLiteral(meanTempK));

  const dZdxExpr = addVar(`${name}_dZ_dx`, Variability.Parameter, dZdx);
  arena.addEquation(EqKind.Simple, dZdxExpr, arena.addRealLiteral(dZdx));

  const dZdyExpr = addVar(`${name}_dZ_dy`, Variability.Parameter, dZdy);
  arena.addEquation(EqKind.Simple, dZdyExpr, arena.addRealLiteral(dZdy));

  const refValExpr = addVar(`${name}_ref_value`, Variability.Parameter, refValue);
  arena.addEquation(EqKind.Simple, refValExpr, arena.addRealLiteral(refValue));

  const twoPowEExpr = addVar(`${name}_two_pow_E`, Variability.Parameter, twoPowE);
  arena.addEquation(EqKind.Simple, twoPowEExpr, arena.addRealLiteral(twoPowE));

  const tenNegDExpr = addVar(`${name}_ten_neg_D`, Variability.Parameter, tenNegD);
  arena.addEquation(EqKind.Simple, tenNegDExpr, arena.addRealLiteral(tenNegD));

  const packedXExpr = addVar(`${name}_x_packed`, Variability.Parameter, samplePackedX);
  arena.addEquation(EqKind.Simple, packedXExpr, arena.addRealLiteral(samplePackedX));

  // 2. GRIB1 physical unpacking equation: y_phys = (ref_value + x_packed * two_pow_E) * ten_neg_D
  const initYPhys = (refValue + samplePackedX * twoPowE) * tenNegD;
  const yPhysExpr = addVar(`${name}_y_phys`, Variability.Continuous, initYPhys);
  arena.addEquation(
    EqKind.Simple,
    yPhysExpr,
    bin(BinOp.Mul, bin(BinOp.Add, refValExpr, bin(BinOp.Mul, packedXExpr, twoPowEExpr)), tenNegDExpr),
  );

  // 3. Hydrostatic pressure ODE & ideal gas density
  //    rho = p_hydro / (R_d * T_mean)
  //    der(p_hydro) = -rho * g0
  const initRho = refPressurePa / (R_DRY_AIR * meanTempK);
  const pHydroExpr = addVar(`${name}_p_hydro`, Variability.Continuous, refPressurePa);
  const rhoExpr = addVar(`${name}_rho`, Variability.Continuous, initRho);

  arena.addEquation(EqKind.Simple, rhoExpr, bin(BinOp.Div, pHydroExpr, bin(BinOp.Mul, rdExpr, tMeanExpr)));
  arena.addEquation(
    EqKind.Simple,
    arena.addExpression(ExprKind.Der, pHydroExpr),
    bin(BinOp.Mul, arena.addRealLiteral(-1.0), bin(BinOp.Mul, rhoExpr, g0Expr)),
  );

  // 4. Geostrophic wind algebraic balance
  //    u_g = -(g0 / f_coriolis) * dZ_dy
  //    v_g =  (g0 / f_coriolis) * dZ_dx
  const initUg = -(STANDARD_GRAVITY / fCoriolis) * dZdy;
  const initVg = (STANDARD_GRAVITY / fCoriolis) * dZdx;
  const ugExpr = addVar(`${name}_u_g`, Variability.Continuous, initUg);
  const vgExpr = addVar(`${name}_v_g`, Variability.Continuous, initVg);

  const gOverF = bin(BinOp.Div, g0Expr, fExpr);
  arena.addEquation(
    EqKind.Simple,
    ugExpr,
    bin(BinOp.Mul, arena.addRealLiteral(-1.0), bin(BinOp.Mul, gOverF, dZdyExpr)),
  );
  arena.addEquation(EqKind.Simple, vgExpr, bin(BinOp.Mul, gOverF, dZdxExpr));

  // 5. Horizontal momentum ODEs (inertial balance around geostrophic equilibrium)
  //    der(u) =  f_coriolis * (v - v_g)
  //    der(v) = -f_coriolis * (u - u_g)
  const uExpr = addVar(`${name}_u`, Variability.Continuous, initUg);
  const vExpr = addVar(`${name}_v`, Variability.Continuous, initVg);

  arena.addEquation(
    EqKind.Simple,
    arena.addExpression(ExprKind.Der, uExpr),
    bin(BinOp.Mul, fExpr, bin(BinOp.Sub, vExpr, vgExpr)),
  );
  arena.addEquation(
    EqKind.Simple,
    arena.addExpression(ExprKind.Der, vExpr),
    bin(BinOp.Mul, arena.addRealLiteral(-1.0), bin(BinOp.Mul, fExpr, bin(BinOp.Sub, uExpr, ugExpr))),
  );

  // 6. Specific kinetic energy: ke = 0.5 * (u * u + v * v)
  const initKe = 0.5 * (initUg * initUg + initVg * initVg);
  const keExpr = addVar(`${name}_ke`, Variability.Continuous, initKe);
  arena.addEquation(
    EqKind.Simple,
    keExpr,
    bin(
      BinOp.Mul,
      arena.addRealLiteral(0.5),
      bin(BinOp.Add, bin(BinOp.Mul, uExpr, uExpr), bin(BinOp.Mul, vExpr, vExpr)),
    ),
  );

  return arena;
}

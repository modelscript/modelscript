// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers MELCOR control-volume mass/energy balances (CVH), flow-path momentum (FL),
 * heat-structure thermal balances (HS), and core decay-heat / oxidation ODEs (COR)
 * directly into ModelScript's zero-GC `DAEBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInMelcorLibraryRegistered, lookupMelcorModelSchema } from "../catalog/library-package-adapter.js";
import type { MelcorDeck } from "../types.js";

export interface MelcorDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  rGas?: number | undefined;
  cvGas?: number | undefined;
}

const DEFAULT_R_GAS = 461.52; // Steam / water vapor specific gas constant [J/(kg*K)]
const DEFAULT_CV_GAS = 1500.0; // Effective isochoric specific heat [J/(kg*K)]

export function resolveMelcorSchemaParamDefaults(
  modelName: string,
  overrides: Record<string, number> = {},
): Record<string, number> {
  ensureBuiltInMelcorLibraryRegistered();
  const resolved: Record<string, number> = {};
  const schema = lookupMelcorModelSchema(modelName);
  if (schema) {
    for (const p of schema.parameters) {
      if (typeof p.defaultValue === "number" && Number.isFinite(p.defaultValue)) {
        resolved[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (Number.isFinite(v)) {
      resolved[k] = v;
    }
  }
  return resolved;
}

export function lowerMelcorToDae(deck: MelcorDeck, options?: MelcorDaeOptions): DAEBuilder {
  ensureBuiltInMelcorLibraryRegistered();
  const modelName = (options?.modelName ?? (deck.title || "MelcorPlant")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const rGas = options?.rGas ?? DEFAULT_R_GAS;
  const cvGas = options?.cvGas ?? DEFAULT_CV_GAS;
  const cpGas = cvGas + rGas;

  // 1. Declare CVH Control Volume variables: m_<id>, U_<id>, P_<id>, T_<id>
  const cvVars = new Map<number, { mVar: number; uVar: number; pVar: number; tVar: number }>();
  for (const cv of deck.controlVolumes.values()) {
    const vol = Math.max(1e-4, cv.volume);
    const p0 = Math.max(1.0, cv.pressure);
    const t0 = Math.max(10.0, cv.temperature);
    const m0 = (p0 * vol) / (rGas * t0);
    const u0 = m0 * cvGas * t0;

    const mVar = dae.addVariable(`m_cv_${cv.id}`, VarType.Real, Variability.Continuous, Causality.Local, m0);
    const uVar = dae.addVariable(`U_cv_${cv.id}`, VarType.Real, Variability.Continuous, Causality.Local, u0);
    const pVar = dae.addVariable(`P_cv_${cv.id}`, VarType.Real, Variability.Continuous, Causality.Local, p0);
    const tVar = dae.addVariable(`T_cv_${cv.id}`, VarType.Real, Variability.Continuous, Causality.Local, t0);
    cvVars.set(cv.id, { mVar, uVar, pVar, tVar });
  }

  // 2. Declare FL Flow Path variables: mdot_fl_<id>
  const flVars = new Map<number, number>();
  for (const fl of deck.flowPaths.values()) {
    const mdotVar = dae.addVariable(
      `mdot_fl_${fl.id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      fl.initialFlow,
    );
    flVars.set(fl.id, mdotVar);
  }

  // 3. Declare HS Heat Structure variables: T_hs_<id>
  const hsVars = new Map<number, number>();
  for (const hs of deck.heatStructures.values()) {
    const tHsVar = dae.addVariable(
      `T_hs_${hs.id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      hs.initialTemperature,
    );
    hsVars.set(hs.id, tHsVar);
  }

  // 4. Declare COR Core variables: T_cor, m_H2
  let tCorVar = -1;
  let h2Var = -1;
  if (deck.core?.present) {
    tCorVar = dae.addVariable(
      "T_cor",
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      deck.core.initialTemperatureK,
    );
    if (deck.core.oxidationEnabled) {
      h2Var = dae.addVariable("m_H2", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    }
  }

  // 5. CVH Conservation Equations (mass, internal energy, EOS P, T)
  for (const cv of deck.controlVolumes.values()) {
    const v = cvVars.get(cv.id);
    if (!v) continue;
    const vol = Math.max(1e-4, cv.volume);

    if (cv.cvType === "TIME_INDEPENDENT") {
      dae.addEquation(EqKind.Simple, dae.addDer(v.mVar), dae.addRealLiteral(0.0));
      dae.addEquation(EqKind.Simple, dae.addDer(v.uVar), dae.addRealLiteral(0.0));
      dae.addEquation(EqKind.Simple, dae.addName(v.pVar), dae.addRealLiteral(cv.pressure));
      dae.addEquation(EqKind.Simple, dae.addName(v.tVar), dae.addRealLiteral(cv.temperature));
      continue;
    }

    let netMass: number = dae.addRealLiteral(0.0);
    let netEnergy: number = dae.addRealLiteral(0.0);

    for (const fl of deck.flowPaths.values()) {
      const mdotVar = flVars.get(fl.id);
      if (mdotVar === undefined) continue;
      if (fl.toCv === cv.id) {
        netMass = dae.addBinaryExpr(BinOp.Add, netMass, dae.addName(mdotVar));
        const fromV = cvVars.get(fl.fromCv);
        const tUp = fromV ? dae.addName(fromV.tVar) : dae.addName(v.tVar);
        const hFlow = dae.addBinaryExpr(
          BinOp.Mul,
          dae.addName(mdotVar),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cpGas), tUp),
        );
        netEnergy = dae.addBinaryExpr(BinOp.Add, netEnergy, hFlow);
      }
      if (fl.fromCv === cv.id) {
        netMass = dae.addBinaryExpr(BinOp.Sub, netMass, dae.addName(mdotVar));
        const hFlow = dae.addBinaryExpr(
          BinOp.Mul,
          dae.addName(mdotVar),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cpGas), dae.addName(v.tVar)),
        );
        netEnergy = dae.addBinaryExpr(BinOp.Sub, netEnergy, hFlow);
      }
    }

    // Add convective heat transfer from attached Heat Structures
    for (const hs of deck.heatStructures.values()) {
      const tHsVar = hsVars.get(hs.id);
      if (tHsVar === undefined) continue;
      if (hs.leftBoundaryCv === cv.id && hs.leftHtc > 0) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tHsVar), dae.addName(v.tVar));
        const q = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hs.leftHtc * hs.surfaceArea), dT);
        netEnergy = dae.addBinaryExpr(BinOp.Add, netEnergy, q);
      }
      if (hs.rightBoundaryCv === cv.id && hs.rightHtc > 0) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tHsVar), dae.addName(v.tVar));
        const q = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hs.rightHtc * hs.surfaceArea), dT);
        netEnergy = dae.addBinaryExpr(BinOp.Add, netEnergy, q);
      }
    }

    // der(m_cv) = netMass
    dae.addEquation(EqKind.Simple, dae.addDer(v.mVar), netMass);
    // der(U_cv) = netEnergy
    dae.addEquation(EqKind.Simple, dae.addDer(v.uVar), netEnergy);
    // U_cv = m_cv * cvGas * T_cv
    const uEos = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addBinaryExpr(BinOp.Mul, dae.addName(v.mVar), dae.addRealLiteral(cvGas)),
      dae.addName(v.tVar),
    );
    dae.addEquation(EqKind.Simple, dae.addName(v.uVar), uEos);
    // P_cv * V = m_cv * rGas * T_cv
    const pEos = dae.addBinaryExpr(
      BinOp.Div,
      dae.addBinaryExpr(
        BinOp.Mul,
        dae.addBinaryExpr(BinOp.Mul, dae.addName(v.mVar), dae.addRealLiteral(rGas)),
        dae.addName(v.tVar),
      ),
      dae.addRealLiteral(vol),
    );
    dae.addEquation(EqKind.Simple, dae.addName(v.pVar), pEos);
  }

  // 6. FL Momentum Equations: der(mdot_fl) = (A / L) * (P_from - P_to) - (K / L) * mdot_fl
  for (const fl of deck.flowPaths.values()) {
    const mdotVar = flVars.get(fl.id);
    if (mdotVar === undefined) continue;
    const fromV = cvVars.get(fl.fromCv);
    const toV = cvVars.get(fl.toCv);
    if (fromV && toV) {
      const aEff = Math.max(1e-6, fl.area * Math.max(0.0, fl.openFraction));
      const len = Math.max(0.1, fl.length);
      const kLoss = Math.max(0.1, fl.forwardLoss);
      const dp = dae.addBinaryExpr(BinOp.Sub, dae.addName(fromV.pVar), dae.addName(toV.pVar));
      const drive = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(aEff / len), dp);
      const drag = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kLoss / len), dae.addName(mdotVar));
      dae.addEquation(EqKind.Simple, dae.addDer(mdotVar), dae.addBinaryExpr(BinOp.Sub, drive, drag));
    } else {
      dae.addEquation(EqKind.Simple, dae.addDer(mdotVar), dae.addRealLiteral(0.0));
    }
  }

  // 7. HS Thermal Balance Equations: m * cp * der(T_hs) = Q_src - Q_left - Q_right
  for (const hs of deck.heatStructures.values()) {
    const tHsVar = hsVars.get(hs.id);
    if (tHsVar === undefined) continue;
    const cTh = Math.max(1.0, hs.mass * hs.specificHeat);
    let qNet: number = dae.addRealLiteral(hs.heatSourceW);
    if (hs.leftBoundaryCv !== undefined) {
      const lCv = cvVars.get(hs.leftBoundaryCv);
      if (lCv) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tHsVar), dae.addName(lCv.tVar));
        qNet = dae.addBinaryExpr(
          BinOp.Sub,
          qNet,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hs.leftHtc * hs.surfaceArea), dT),
        );
      }
    }
    if (hs.rightBoundaryCv !== undefined) {
      const rCv = cvVars.get(hs.rightBoundaryCv);
      if (rCv) {
        const dT = dae.addBinaryExpr(BinOp.Sub, dae.addName(tHsVar), dae.addName(rCv.tVar));
        qNet = dae.addBinaryExpr(
          BinOp.Sub,
          qNet,
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hs.rightHtc * hs.surfaceArea), dT),
        );
      }
    }
    dae.addEquation(EqKind.Simple, dae.addDer(tHsVar), dae.addBinaryExpr(BinOp.Div, qNet, dae.addRealLiteral(cTh)));
  }

  // 8. COR Decay-Heat Heatup ODE: der(T_cor) = Q_decay / (m_cor * cp_cor)
  if (deck.core?.present && tCorVar !== -1) {
    const cCore = Math.max(1.0, deck.core.coreMassKg * deck.core.coreSpecificHeatJkgK);
    const qDecay = deck.core.decayHeatW;
    dae.addEquation(EqKind.Simple, dae.addDer(tCorVar), dae.addRealLiteral(qDecay / cCore));

    if (h2Var !== -1) {
      // Linearized placeholder rate in DAE for H2 accumulation (exact nonlinear Urbanic-Heidrick in melcor-solver)
      dae.addEquation(EqKind.Simple, dae.addDer(h2Var), dae.addRealLiteral(0.0));
    }
  }

  return dae;
}

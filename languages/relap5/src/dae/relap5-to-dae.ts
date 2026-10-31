// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Direct Linear-Memory DAE Arena Lowering for Nuclear Hydrodynamics.
 *
 * Compiles two-phase two-fluid hydrodynamic volumes, junctions, and reactor point kinetics
 * into ModelScript's zero-GC DAEBuilder:
 *   1. Hydrodynamic state variables: P_i, alpha_i, Tf_i, Tg_i
 *   2. Junction flow rates: mf_j, mg_j with form loss momentum equations
 *   3. 6-group delayed neutron precursor point kinetics ODEs
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { Relap5Deck } from "../types.js";

export interface Relap5DaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export function lowerRelap5ToDae(deck: Relap5Deck, options?: Relap5DaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? (deck.title || "Relap5NuclearPlant")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // 1. Declare Volume State Variables (4 per volume)
  const volVars = new Map<number, { pVar: number; alphaVar: number; tfVar: number; tgVar: number }>();
  for (const vol of deck.volumes.values()) {
    const id = vol.id;
    const pVar = dae.addVariable(`P_${id}`, VarType.Real, Variability.Continuous, Causality.Local, vol.initialPressure);
    const alphaVar = dae.addVariable(
      `alpha_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      vol.initialVoidFraction ?? 0.0,
    );
    const tfVar = dae.addVariable(
      `Tf_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      vol.initialTemperature,
    );
    const tgVar = dae.addVariable(
      `Tg_${id}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      vol.initialTemperature + 5.0,
    );
    volVars.set(id, { pVar, alphaVar, tfVar, tgVar });
  }

  // 2. Declare Junction Flow Variables (2 per junction)
  const juncVars = new Map<number, { mfVar: number; mgVar: number }>();
  for (const junc of deck.junctions.values()) {
    const jId = junc.id;
    const mfVar = dae.addVariable(
      `mf_${jId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      junc.initialLiquidVelocity * junc.area * 750.0,
    );
    const mgVar = dae.addVariable(
      `mg_${jId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      junc.initialVaporVelocity * junc.area * 35.0,
    );
    juncVars.set(jId, { mfVar, mgVar });
  }

  // 3. Declare Reactor Point Kinetics Variables (8 variables when kinetics present)
  let nVar = -1;
  let rhoVar = -1;
  const cVars: { cVar: number; lambda: number; betaI: number }[] = [];
  if (deck.kinetics) {
    const k = deck.kinetics;
    nVar = dae.addVariable("reactor_power", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    rhoVar = dae.addVariable("reactivity", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const groups =
      k.delayedGroups.length === 6
        ? k.delayedGroups
        : [
            { group: 1, decayConstant: 0.0124, fraction: 0.000215 },
            { group: 2, decayConstant: 0.0305, fraction: 0.001424 },
            { group: 3, decayConstant: 0.111, fraction: 0.001274 },
            { group: 4, decayConstant: 0.301, fraction: 0.002568 },
            { group: 5, decayConstant: 1.14, fraction: 0.000748 },
            { group: 6, decayConstant: 3.01, fraction: 0.000271 },
          ];

    const lambdaPrompt = Math.max(1e-7, k.promptGenerationTime);
    for (let i = 0; i < 6; i++) {
      const grp = groups[i];
      if (!grp) continue;
      const cInit = grp.fraction / (lambdaPrompt * grp.decayConstant);
      const cVar = dae.addVariable(`C_${i + 1}`, VarType.Real, Variability.Continuous, Causality.Local, cInit);
      cVars.push({ cVar, lambda: grp.decayConstant, betaI: grp.fraction });
    }
  }

  // 4. Formulate Volume Conservation ODEs (P, alpha, Tf, Tg)
  const rhoF = 750.0; // Liquid density [kg/m^3]
  const rhoG = 35.0; // Vapor density [kg/m^3]
  const cpF = 5200.0; // Liquid heat capacity [J/(kg*K)]
  const cpG = 3800.0; // Vapor heat capacity [J/(kg*K)]
  const hInterphase = 25000.0; // Interphase volumetric heat transfer [W/(m^3*K)]
  const csSq = 1.0e6; // Effective two-phase speed of sound squared [m^2/s^2]

  const firstVol = deck.volumes.values().next().value;

  for (const vol of deck.volumes.values()) {
    const id = vol.id;
    const vEntry = volVars.get(id);
    if (!vEntry) continue;
    const volM3 = Math.max(0.01, vol.volume);

    let netMf: number = dae.addRealLiteral(0.0);
    let netMg: number = dae.addRealLiteral(0.0);
    let advEnergyF: number = dae.addRealLiteral(0.0);
    let advEnergyG: number = dae.addRealLiteral(0.0);

    for (const junc of deck.junctions.values()) {
      const jv = juncVars.get(junc.id);
      if (!jv) continue;

      if (junc.toVolume === id) {
        netMf = dae.addBinaryExpr(BinOp.Add, netMf, dae.addName(jv.mfVar));
        netMg = dae.addBinaryExpr(BinOp.Add, netMg, dae.addName(jv.mgVar));

        const fromV = volVars.get(junc.fromVolume);
        if (fromV) {
          const dTf = dae.addBinaryExpr(BinOp.Sub, dae.addName(fromV.tfVar), dae.addName(vEntry.tfVar));
          const qAdvF = dae.addBinaryExpr(
            BinOp.Mul,
            dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cpF), dae.addName(jv.mfVar)),
            dTf,
          );
          advEnergyF = dae.addBinaryExpr(BinOp.Add, advEnergyF, qAdvF);

          const dTg = dae.addBinaryExpr(BinOp.Sub, dae.addName(fromV.tgVar), dae.addName(vEntry.tgVar));
          const qAdvG = dae.addBinaryExpr(
            BinOp.Mul,
            dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(cpG), dae.addName(jv.mgVar)),
            dTg,
          );
          advEnergyG = dae.addBinaryExpr(BinOp.Add, advEnergyG, qAdvG);
        }
      }
      if (junc.fromVolume === id) {
        netMf = dae.addBinaryExpr(BinOp.Sub, netMf, dae.addName(jv.mfVar));
        netMg = dae.addBinaryExpr(BinOp.Sub, netMg, dae.addName(jv.mgVar));
      }
    }

    // Eq 1: Compressible pressure balance der(P_id) = (cs^2 / V) * (netMf + netMg)
    const netMassFlow = dae.addBinaryExpr(BinOp.Add, netMf, netMg);
    const derPRhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(csSq / volM3), netMassFlow);
    dae.addEquation(EqKind.Simple, dae.addDer(vEntry.pVar), derPRhs);

    // Eq 2: Vapor void fraction balance der(alpha_id) = netMg / (rhoG * V) + k_evap * (Tf - Tg)
    const dTfg = dae.addBinaryExpr(BinOp.Sub, dae.addName(vEntry.tfVar), dae.addName(vEntry.tgVar));
    const voidAdv = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1.0 / (rhoG * volM3)), netMg);
    const voidEvap = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-4), dTfg);
    const derAlphaRhs = dae.addBinaryExpr(BinOp.Add, voidAdv, voidEvap);
    dae.addEquation(EqKind.Simple, dae.addDer(vEntry.alphaVar), derAlphaRhs);

    // Eq 3: Liquid temperature balance der(Tf_id) = (Q_core + advEnergyF - h_ig * V * (Tf - Tg)) / (rhoF * cpF * V)
    const qInterphase = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(hInterphase * volM3), dTfg);
    let qNetF = dae.addBinaryExpr(BinOp.Sub, advEnergyF, qInterphase);
    const hasHeatStructure = Array.from(deck.heatStructures.values()).some(
      (hs) => hs.leftVolumeId === id || hs.rightVolumeId === id,
    );
    if (nVar !== -1 && (hasHeatStructure || (firstVol && firstVol.id === id && deck.heatStructures.size === 0))) {
      const p0 = deck.kinetics?.initialPower ?? 3.0e9;
      const qCore = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(p0 * 0.01), dae.addName(nVar));
      qNetF = dae.addBinaryExpr(BinOp.Add, qNetF, qCore);
    }
    const invCapF = dae.addRealLiteral(1.0 / (rhoF * cpF * volM3));
    const derTfRhs = dae.addBinaryExpr(BinOp.Mul, invCapF, qNetF);
    dae.addEquation(EqKind.Simple, dae.addDer(vEntry.tfVar), derTfRhs);

    // Eq 4: Vapor temperature balance der(Tg_id) = (h_ig * V * (Tf - Tg) + advEnergyG) / (rhoG * cpG * V)
    const qNetG = dae.addBinaryExpr(BinOp.Add, qInterphase, advEnergyG);
    const invCapG = dae.addRealLiteral(1.0 / (rhoG * cpG * volM3));
    const derTgRhs = dae.addBinaryExpr(BinOp.Mul, invCapG, qNetG);
    dae.addEquation(EqKind.Simple, dae.addDer(vEntry.tgVar), derTgRhs);
  }

  // 5. Formulate Junction Two-Fluid Momentum ODEs (mf, mg)
  for (const junc of deck.junctions.values()) {
    const jv = juncVars.get(junc.id);
    if (!jv) continue;
    const fromP = dae.lookupVariable(`P_${junc.fromVolume}`);
    const toP = dae.lookupVariable(`P_${junc.toVolume}`);
    const area = Math.max(1e-4, junc.area);
    const fromLen = deck.volumes.get(junc.fromVolume)?.length ?? 5.0;
    const toLen = deck.volumes.get(junc.toVolume)?.length ?? 5.0;
    const lEff = Math.max(0.5, 0.5 * (fromLen + toLen));
    const kLoss = Math.max(0.1, junc.forwardLoss + 0.5);

    if (fromP !== -1 && toP !== -1) {
      const deltaP = dae.addBinaryExpr(BinOp.Sub, dae.addName(fromP), dae.addName(toP));
      const geomFactor = dae.addRealLiteral(area / lEff);
      const driveTerm = dae.addBinaryExpr(BinOp.Mul, geomFactor, deltaP);

      const dragCoeffF = dae.addRealLiteral(kLoss / lEff);
      const dragF = dae.addBinaryExpr(BinOp.Mul, dragCoeffF, dae.addName(jv.mfVar));
      const derMfRhs = dae.addBinaryExpr(BinOp.Sub, driveTerm, dragF);
      dae.addEquation(EqKind.Simple, dae.addDer(jv.mfVar), derMfRhs);

      const dragCoeffG = dae.addRealLiteral((kLoss * 2.0) / lEff);
      const dragG = dae.addBinaryExpr(BinOp.Mul, dragCoeffG, dae.addName(jv.mgVar));
      const derMgRhs = dae.addBinaryExpr(BinOp.Sub, driveTerm, dragG);
      dae.addEquation(EqKind.Simple, dae.addDer(jv.mgVar), derMgRhs);
    } else {
      dae.addEquation(EqKind.Simple, dae.addDer(jv.mfVar), dae.addRealLiteral(0.0));
      dae.addEquation(EqKind.Simple, dae.addDer(jv.mgVar), dae.addRealLiteral(0.0));
    }
  }

  // 6. Formulate 6-Group Point Reactor Kinetics ODEs
  if (deck.kinetics && nVar !== -1 && rhoVar !== -1) {
    const k = deck.kinetics;
    const lambdaPrompt = Math.max(1e-7, k.promptGenerationTime);
    const betaTotal = k.totalDelayedFraction > 0 ? k.totalDelayedFraction : 0.0065;

    let delayedSourceSum: number = dae.addRealLiteral(0.0);

    for (const grp of cVars) {
      // der(C_i) = (beta_i / Lambda) * reactor_power - lambda_i * C_i
      const prodRate = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(grp.betaI / lambdaPrompt), dae.addName(nVar));
      const decayRate = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(grp.lambda), dae.addName(grp.cVar));
      const derCRhs = dae.addBinaryExpr(BinOp.Sub, prodRate, decayRate);
      dae.addEquation(EqKind.Simple, dae.addDer(grp.cVar), derCRhs);

      delayedSourceSum = dae.addBinaryExpr(BinOp.Add, delayedSourceSum, decayRate);
    }

    // der(reactor_power) = ((reactivity - beta) / Lambda) * reactor_power + sum(lambda_i * C_i)
    const rhoMinusBeta = dae.addBinaryExpr(BinOp.Sub, dae.addName(rhoVar), dae.addRealLiteral(betaTotal));
    const promptRate = dae.addBinaryExpr(
      BinOp.Mul,
      dae.addBinaryExpr(BinOp.Div, rhoMinusBeta, dae.addRealLiteral(lambdaPrompt)),
      dae.addName(nVar),
    );
    const derNRhs = dae.addBinaryExpr(BinOp.Add, promptRate, delayedSourceSum);
    dae.addEquation(EqKind.Simple, dae.addDer(nVar), derNRhs);

    // Doppler + Moderator Temperature Reactivity Feedback: reactivity = alpha_T * (Tf_core - Tf_0)
    const coreVars = firstVol ? volVars.get(firstVol.id) : undefined;
    if (firstVol && coreVars) {
      const alphaTotal = (k.fuelTempReactivityCoeff ?? -2.5e-5) + (k.moderatorTempReactivityCoeff ?? -1.5e-4);
      const dTcore = dae.addBinaryExpr(
        BinOp.Sub,
        dae.addName(coreVars.tfVar),
        dae.addRealLiteral(firstVol.initialTemperature),
      );
      const rhoFeedback = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(alphaTotal), dTcore);
      dae.addEquation(EqKind.Simple, dae.addName(rhoVar), rhoFeedback);
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(rhoVar), dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
